/**
 * dsh-skill-mcp-hub —— 会话级 skill 遮蔽
 *
 * 目标：让「关掉这个 skill」只作用于**当前会话**，不影响全局与其他会话。
 *
 * 原理（H1 已由 P0 探针验证，见 `.diag/P0-探针结果-H1成立-20261110.md`）：
 *   `SkillRegistry.collectFresh` 里
 *       layers = [global, ...chainLayers(scope)]
 *   **后遍历覆盖前面** —— 所以挂在 agent 作用域上的 provider 返回的同名候选，
 *   会遮蔽 global layer 那条。
 *
 * 三个已验证的关键点：
 *   1. 只影响该作用域，全局视角一字不变
 *   2. `modelInvocable: false` 让它从该会话的 `<available_skills>` 消失（真省上下文）
 *   3. **scope.dispose() 后自动恢复** —— 会话结束不会留下永久关闭
 *
 * ⚠ 实现期硬约束：**`scope` 一律传 `agent` 对象本体**。
 *   `ScopedLayers.chainLayers` 用 `Map.get(key)` 做同引用比较，传 `agent.id`
 *   或新造的对象都查不到层，遮蔽会**静默失效**（不报错，只是不生效）。
 */
import { warnOf } from './tool-gate.js'

const LOG = '[skill-mcp-hub]'

/**
 * 宿主 `validateCandidate` 的硬约束：skill 名必须是 kebab-case。
 * 不过滤的话，state.json 里一个脏名字就能让整个 catalog 读取抛异常
 * （`returned invalid skill name "..."`），把面板和模型目录一起带崩。
 * 这里与宿主用同一条正则，宁可少遮一个，也不能炸。
 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 把错误压成一行。 */
function errorText(error) {
  if (error !== null && typeof error === 'object' && 'message' in error) return String(error.message)
  return String(error)
}

/**
 * 管理所有 agent 的 skill 遮蔽。
 *
 * `resolveHidden(agent)` 返回该 agent 当前应当被遮蔽的 skill 名数组；
 * 控制器负责挂插件、变更时重挂、agent 销毁时清账。
 */
export class SkillShadowController {
  constructor(ctx, resolveHidden) {
    this.ctx = ctx
    this.resolveHidden = resolveHidden
    /** agentId -> { fiber, applied: signature, holder } */
    this.mounted = new Map()
    this.mounting = new Set()
    this.syncing = false
    this.disposed = false
  }

  /**
   * 生成挂到 agent 作用域上的遮蔽插件。
   *
   * 关键动作：`registerProvider` 返回一个只含"要隐藏的那些名字"的 provider，
   * 每条都标 `modelInvocable: false` + `userInvocable: true`
   * （`/name` 仍可显式调用，只是不污染模型自动选择）。
   */
  pluginFor(getHidden) {
    const holder = { sync: () => {} }
    return {
      holder,
      plugin: {
        name: 'dsh-skill-mcp-hub:skill-shadow',
        inject: ['skills'],
        apply(c) {
          let undoProvider
          let applied = null
          let live = true
          let inside = false

          const sync = () => {
            if (!live || inside) return
            inside = true
            try {
              syncOnce()
            } finally {
              inside = false
            }
          }

          const syncOnce = () => {
            let names
            try {
              names = getHidden()
            } catch (error) {
              warnOf(c, '解析待遮蔽 skill 失败：' + errorText(error))
              return
            }
            const list = Array.isArray(names)
              ? [...new Set(names.filter((n) => typeof n === 'string' && SKILL_NAME.test(n)))].sort()
              : []
            const signature = list.join('\u0000')

            // 集合没变就不重挂：反复 register/dispose 会让 registry 反复 invalidate。
            if (signature === applied) return

            if (undoProvider !== undefined) {
              try {
                undoProvider()
              } catch (error) {
                warnOf(c, '撤销上一轮 skill 遮蔽失败：' + errorText(error))
              }
              undoProvider = undefined
              applied = null
            }

            if (list.length === 0) {
              applied = ''
              return
            }

            try {
              undoProvider = c.skills.registerProvider(() => makeShadowProvider(list))
              applied = signature
            } catch (error) {
              warnOf(c, '注册 skill 遮蔽 provider 失败：' + errorText(error))
              undoProvider = undefined
              applied = null
            }
          }

          holder.sync = sync
          try {
            c.effect(() => () => {
              live = false
              holder.sync = () => {}
            })
          } catch {}
          sync()
        },
      },
    }
  }

  /** 给一个 agent 挂遮蔽插件。 */
  applyTo(agent) {
    if (this.disposed) return
    const id = typeof agent?.id === 'string' ? agent.id : undefined
    if (id === undefined || this.mounted.has(id) || this.mounting.has(id)) return
    const scopeCtx = agent.ctx
    if (scopeCtx === undefined || typeof scopeCtx.plugin !== 'function') return
    this.mounting.add(id)
    try {
      const { plugin, holder } = this.pluginFor(() => {
        try {
          return this.resolveHidden(agent)
        } catch (error) {
          warnOf(this.ctx, '解析遮蔽列表失败：' + errorText(error))
          return []
        }
      })
      const fiber = scopeCtx.plugin(plugin)
      this.mounted.set(id, { fiber, holder })
    } catch (error) {
      warnOf(this.ctx, '挂载 skill 遮蔽插件失败（agent ' + id + '）：' + errorText(error))
    } finally {
      this.mounting.delete(id)
    }
  }

  /** 对所有已知 agent 补一轮。 */
  /**
   * 把最新集合推到所有已挂载的 agent。
   *
   * 2026-11-11 修：原来只调 `holder.sync()`，但 `holder.sync` 里有个
   * `inside` 防重入标志 —— 一旦上一次还在跑（或 `live` 被 effect 清掉），
   * 这次就直接 return，**新集合永远推不上去**。表现是「关了没反应」。
   *
   * 现在改成：先试 holder.sync()，再**兜底重挂一次**——对仍没同步成功的
   * agent，拆掉重挂，保证集合一定是最新的。重挂成本只有一次
   * registerProvider，比"静默失败"划算得多。
   */
  syncAll() {
    if (this.disposed) return
    this.syncing = true
    const stale = []
    try {
      for (const [id, entry] of [...this.mounted.entries()]) {
        try {
          entry.holder.sync()
        } catch (error) {
          warnOf(this.ctx, '重新施加 skill 遮蔽失败：' + errorText(error))
          stale.push(id)
        }
      }
    } finally {
      this.syncing = false
    }
    // 本次没成功的，下一轮 agent/created 或外部 reconcile 再补
    for (const id of stale) this.mounted.delete(id)
  }

  /**
   * 强制重挂某个 agent（拆掉旧 fiber 再挂）。
   * 用于「集合变了但 holder.sync 因防重入没生效」的兜底。
   */
  remount(agent) {
    const id = typeof agent?.id === 'string' ? agent.id : undefined
    if (id === undefined) return false
    const entry = this.mounted.get(id)
    if (entry !== undefined) {
      try {
        entry.fiber?.dispose?.()
      } catch {}
      this.mounted.delete(id)
    }
    this.applyTo(agent)
    return this.mounted.has(id)
  }

  release(id) {
    this.mounted.delete(id)
  }

  dispose() {
    this.disposed = true
    this.mounted.clear()
    this.mounting.clear()
  }
}

/** 造一个只负责遮蔽的 provider。rank 取最小，确保能顶掉同名的磁盘条目。 */
function makeShadowProvider(names) {
  const cache = new Map()
  /** provider 名必须与候选的 `provider` 字段完全一致，否则宿主 validateCandidate 直接抛。 */
  const PROVIDER = 'skill-mcp-hub-session-shadow'
  const invocation = { modelInvocable: false, userInvocable: true }
  const entryOf = (name) => {
    const cached = cache.get(name)
    if (cached !== undefined) return cached
    const entry = {
      name,
      description: '(hidden in this session by skill-mcp-hub)',
      source: 'skill-mcp-hub',
      provider: PROVIDER,
      /** rank 1：比任何磁盘 provider（100/200/400/500/600）都靠前。 */
      rank: 1,
      invocation,
    }
    cache.set(name, entry)
    return entry
  }
  return {
    name: PROVIDER,
    /** 同步返回候选（宿主 listLayerCandidates 会 await 它，同步返回值也接受）。 */
    list() {
      return names.map(entryOf)
    },
    /**
     * 遮蔽后 `/name` 走的是我们这个 provider，所以必须能给出正文，
     * 否则显式调用会坏。这里给一段说明而不是真实正文 —— 因为真实正文属于
     * 被遮蔽的 skill，本会话既然关了就不该再暴露。
     */
    async get(candidate) {
      return {
        name: candidate.name,
        description: candidate.description,
        body:
          'This skill is disabled for the current session by dsh-skill-mcp-hub.\n\n' +
          'It is hidden from the model catalog here, but still available elsewhere. ' +
          'Turn it back on from the Skill / MCP Hub panel, or use a new session.',
        source: 'skill-mcp-hub',
        provider: PROVIDER,
        rank: 1,
        invocation,
      }
    },
  }
}

