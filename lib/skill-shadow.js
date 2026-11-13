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
    /**
     * 按会话记的「该遮哪些名字」账本：agentId -> 名单。
     *
     * 为什么要这一份 —— `skill` 工具执行时宿主传的 scope 是 **AgentLoop**，
     * 不是 Agent（见文件头）。挂在 agent 作用域上的 provider 它看不到，
     * 于是显式 `/name` 仍会读到真正文。
     *
     * 2026-11-13 实测：把 provider 挂到全局层也救不了 —— 候选确实进了
     * `collectLayer`，却进不了工具拿到的最终结果（机制未查明）。
     * 真正生效的是 `installGlobal()` 里对 `skills.list/snapshot/get` 的
     * **结果级过滤**，它不依赖层与排名。这份账本就是过滤时查的名单。
     */
    this.byId = new Map()
    /** agentId -> agent 引用，用于按 `scope.session` 认身份（loop 上没有 session id 时）。 */
    this.agentRefs = new Map()
    this.globalInstalled = false
    /** 全局 provider 各自的 control（用来丢宿主目录缓存）。 */
    this.globalControls = []
    /** 注册 / 打补丁各自的撤销函数。 */
    this.undoGlobals = []
  }

  /** 注册全局兜底 provider（只注册一次）。 */
  installGlobal() {
    if (this.globalInstalled || this.disposed) return
    this.globalInstalled = true
    /**
     * ⚠ 关键：`this.ctx` 未必是**真正未作用域**的那个 ctx。
     * 插件的 ctx 若落在一个 scope 里，provider 就进不了 `layers.global`，
     * 而 `skill` 工具（scope = AgentLoop，没有父链）只看得到 global 层 ——
     * 表现为「模型目录隐藏了，但 `/名字` 仍读到真正文」。
     *
     * 所以依次尝试 `ctx`、`ctx.root` 等多个落点，能挂的都挂上；
     * 同一个层重复挂会抛 already registered，直接跳过。
     */
    const targets = []
    const pushTarget = (candidate) => {
      if (candidate === undefined || candidate === null) return
      if (targets.includes(candidate)) return
      targets.push(candidate)
    }
    pushTarget(this.ctx)
    try {
      pushTarget(this.ctx?.root)
    } catch {}
    for (const target of targets) {
      let skills
      try {
        skills = target.skills
      } catch {
        continue
      }
      if (skills === undefined || skills === null || typeof skills.registerProvider !== 'function') {
        continue
      }
      try {
        const undo = skills.registerProvider((control) => {
          this.globalControls.push(control)
          return makeShadowProvider((options) => this.namesFor(options))
        })
        this.undoGlobals.push(undo)
        /**
         * 真正的遮蔽机制：直接包 `skills.list` / `skills.get` 做**结果级过滤**。
         *
         * 为什么不用 provider 排名：`dsh-tool-skill` 的 `execute` 用
         * `scope: exec.agent`（AgentLoop）读目录，而 AgentLoop 的 scope 没有父链；
         * 我们的 provider 即便挂在 global 层、候选也确实进了 collect，
         * 宿主那边的合并结果里仍会丢掉（实测 providerCalls=1 但结果无我们的候选）。
         * 结果级过滤不依赖层与排名，一定生效。
         */
        if (this.listPatched !== true && typeof skills.list === 'function') {
          const originalList = skills.list.bind(skills)
          const self = this
          try {
            skills.list = async (options_) => {
              const result = await originalList(options_)
              if (!Array.isArray(result)) return result
              const hidden = self.namesFor(options_)
              return hidden.length === 0 ? result : result.filter((s) => !hidden.includes(s?.name))
            }
            this.listPatched = true
            this.undoGlobals.push(() => {
              try {
                skills.list = originalList
              } catch {}
            })
          } catch {}
        }
        // 模型目录走的是 snapshot()（`agent/pre-step` 用它的 skills 组装目录），单独包一层。
        if (this.snapshotPatched !== true && typeof skills.snapshot === 'function') {
          const originalSnapshot = skills.snapshot.bind(skills)
          const self = this
          try {
            skills.snapshot = async (options_) => {
              const result = await originalSnapshot(options_)
              if (result === undefined || result === null || !Array.isArray(result.skills)) return result
              const hidden = self.namesFor(options_)
              if (hidden.length === 0) return result
              return { ...result, skills: result.skills.filter((s) => !hidden.includes(s?.name)) }
            }
            this.snapshotPatched = true
            this.undoGlobals.push(() => {
              try {
                skills.snapshot = originalSnapshot
              } catch {}
            })
          } catch {}
        }
        if (this.getPatched !== true && typeof skills.get === 'function') {
          const originalGet = skills.get.bind(skills)
          const self = this
          try {
            skills.get = async (name, options_) => {
              const hidden = self.namesFor(options_)
              if (hidden.includes(name)) {
                return {
                  name,
                  description: '(hidden in this session by skill-mcp-hub)',
                  source: 'skill-mcp-hub',
                  provider: 'skill-mcp-hub-session-shadow',
                  invocation: { modelInvocable: false, userInvocable: true },
                  content:
                    'This skill is disabled for the current session by dsh-skill-mcp-nexus. ' +
                    'Re-enable it in the skill panel, or start a new session for the change to take effect.',
                }
              }
              return originalGet(name, options_)
            }
            this.getPatched = true
            this.undoGlobals.push(() => {
              try {
                skills.get = originalGet
              } catch {}
            })
          } catch {}
        }
      } catch (error) {
        warnOf(this.ctx, '注册全局 skill 遮蔽兜底失败：' + errorText(error))
      }
    }
  }

  /** 让全局兜底丢掉目录缓存。 */
  bumpGlobal() {
    for (const control of this.globalControls) {
      try {
        control?.invalidate?.()
      } catch {}
    }
  }

  /**
   * 认调用方是哪个会话。
   *
   * 优先 `.id`（Agent 直接就是 session id）；认不出来时用 `scope.session`
   * 与已知 agent 的 `.session` 做**同引用比较** —— AgentLoop 的 `.id` 未必
   * 是 session id，但它 `.session` 与 Agent 是同一个对象。
   */
  sessionIdOf(scope) {
    if (typeof scope === 'string') return this.byId.has(scope) ? scope : undefined
    if (scope === undefined || scope === null || typeof scope !== 'object') return undefined
    if (typeof scope.id === 'string' && this.byId.has(scope.id)) return scope.id
    const session = scope.session
    if (session !== undefined && session !== null) {
      for (const [id, agent] of this.agentRefs) {
        if (agent?.session === session) return id
      }
    }
    if (typeof scope.id === 'string' && this.byId.size === 1) return [...this.byId.keys()][0]
    return undefined
  }

  /** 某次读取该遮哪些名字。 */
  namesFor(options) {
    const id = this.sessionIdOf(options?.scope)
    if (id === undefined) return []
    return this.byId.get(id) ?? []
  }

  /** 把某个 agent 的名单记进全局账本。 */
  publish(id, agent) {
    let list = []
    try {
      const raw = this.resolveHidden(agent)
      list = Array.isArray(raw)
        ? [...new Set(raw.filter((n) => typeof n === 'string' && SKILL_NAME.test(n)))].sort()
        : []
    } catch (error) {
      warnOf(this.ctx, '解析全局兜底名单失败：' + errorText(error))
      return
    }
    this.agentRefs.set(id, agent)
    const previous = this.byId.get(id)
    this.byId.set(id, list)
    const changed =
      previous === undefined || previous.length !== list.length || previous.some((n, i) => n !== list[i])
    if (changed) this.bumpGlobal()
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
              undoProvider = undefined
              applied = null
              /**
               * 撞名兜底（2026-11-13）：正常路径下销毁时会 `undoProvider()`，
               * 不该再撞名。但 `fiber.dispose()` 在 cordis 里可能是**异步**的，
               * 如果 `remount()` 紧接着就挂新实例，旧 provider 可能还没撤掉。
               * 这里隔一拍重试一次，能救回绝大多数情况。
               */
              const text = errorText(error)
              const tries = (holder.retryCount ?? 0) + 1
              holder.retryCount = tries
              if (text.includes('already registered') && holder.retryScheduled !== true && tries <= 3) {
                holder.retryScheduled = true
                setTimeout(() => {
                  holder.retryScheduled = false
                  if (live) sync()
                }, 60)
                return
              }
              warnOf(c, '注册 skill 遮蔽 provider 失败：' + text)
            }
          }

          holder.sync = sync
          try {
            c.effect(() => () => {
              live = false
              holder.sync = () => {}
              /**
               * ★ 2026-11-13 修（这是「只有第一个 skill 被遮蔽」的真因）：
               *
               * 原来这里只把 `live = false`、把 `holder.sync` 换成空函数，
               * **没有调用 `undoProvider()`** —— provider 一直挂在宿主里。
               *
               * 后果：toggle 处理完会走 `remount()`（拆掉旧 fiber 再挂新的），
               * 新实例 `registerProvider` 时撞上「同名 provider 已存在」直接抛。
               * 于是宿主里留下的是**上一次成功注册的那份名单**：
               *   · 关第 1 个 → 注册成功（列表 [A]）
               *   · 关第 2 个 → remount → 撞名 → 宿主还是 [A]
               * ⇒ 只有第一个被遮蔽，后面全部无效。
               *
               * 在 `b5ec765` 那个「pending 补跑」版本里更糟：补跑会再注册一次、
               * 撞名、`applied` 被清成 null，连原来那份都留不住 ⇒ **一个都不遮蔽**。
               */
              if (undoProvider !== undefined) {
                try {
                  undoProvider()
                } catch (error) {
                  warnOf(c, '销毁时撤销 skill 遮蔽 provider 失败：' + errorText(error))
                }
                undoProvider = undefined
                applied = null
              }
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
    if (id === undefined) return
    // 全局兜底这份无论如何都要记 —— 它才是 `skill` 工具那条路径能看到的。
    this.installGlobal()
    this.publish(id, agent)
    if (this.mounted.has(id) || this.mounting.has(id)) return
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
    // 全局兜底那份跟着重算（agent 引用还在，名单可能变了）
    for (const [id, agent] of [...this.agentRefs.entries()]) this.publish(id, agent)
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

  /**
   * 真正拆除某个 agent 上的遮蔽插件。
   *
   * ⚠ 只从 Map 里删是不够的：那个 fiber 是挂在 **agent 的 scope ctx** 上的，
   * 不是挂在我们自己的 ctx 上 —— 我们（插件）销毁时 cordis 不会连带拆它。
   * 不显式 dispose，provider 就永远留在作用域里；下次挂载同名 provider 直接撞名，
   * 宿主里留下的是上一份遗留名单（表现为「只有第一个 skill 被遮蔽」）。
   */
  release(id) {
    const entry = this.mounted.get(id)
    if (entry === undefined) {
      // 即便插件没挂上，全局兜底那份账也要销掉
      if (this.byId.delete(id)) {
        this.agentRefs.delete(id)
        this.bumpGlobal()
      }
      return
    }
    this.mounted.delete(id)
    try {
      entry.fiber?.dispose?.()
    } catch (error) {
      warnOf(this.ctx, '释放 agent ' + id + ' 的 skill 遮蔽失败：' + errorText(error))
    }
    if (this.byId.delete(id)) {
      this.agentRefs.delete(id)
      this.bumpGlobal()
    }
  }

  dispose() {
    this.disposed = true
    for (const id of [...this.mounted.keys()]) this.release(id)
    this.mounted.clear()
    this.mounting.clear()
    const hadGlobal = this.byId.size > 0
    this.byId.clear()
    this.agentRefs.clear()
    const undos = this.undoGlobals
    this.undoGlobals = []
    this.globalControls = []
    for (const undo of undos) {
      try {
        undo()
      } catch (error) {
        warnOf(this.ctx, '撤销全局 skill 遮蔽兜底失败：' + errorText(error))
      }
    }
    if (hadGlobal) this.bumpGlobal()
  }
}

/**
 * 造一个只负责遮蔽的 provider。rank 取最小，确保能顶掉同名的磁盘条目。
 *
 * `source` 可以是固定名单（各 agent 一份的用法），也可以是
 * `(options) => string[]`（全局兜底那份按调用方 scope 现算）。
 */
function makeShadowProvider(source, options = {}) {
  const cache = new Map()
  const namesOf = typeof source === 'function' ? source : () => source
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
    list(options_) {
      let list
      try {
        list = namesOf(options_)
      } catch {
        return []
      }
      return Array.isArray(list) ? list.map(entryOf) : []
    },
    /**
     * 遮蔽后 `/name` 走的是我们这个 provider，所以必须能给出正文，
     * 否则显式调用会坏。这里给一段说明而不是真实正文 —— 因为真实正文属于
     * 被遮蔽的 skill，本会话既然关了就不该再暴露。
     *
     * ⚠ 字段名必须是 `content`，不是 `body`。写错时宿主
     * `validateDefinition()` 会抛
     * `TypeError: loaded skill "X" content must be a string` —— 2026-11-13 真机踩过。
     */
    async get(candidate) {
      return {
        name: candidate.name,
        description: candidate.description,
        content:
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



