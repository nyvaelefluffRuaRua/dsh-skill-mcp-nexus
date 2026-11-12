/**
 * dsh-skill-mcp-hub —— 按 agent 施加的工具限制（MCP 会话级开关的骨架）
 *
 * 这套结构照抄并加固了 `dsh-skill-mcp-panel` 2.3.5 修过的坑（Issue #59/#62：
 * 禁用任一工具后宿主主线程 100% 卡死）。三条约束必须同时成立：
 *
 *   1. **重入守卫**：`restrict()` 与 `undo()` 都会**同步** emit `tools/change`，
 *      而控制器正监听这个事件 —— 没有守卫就是自己触发自己的无限递归，
 *      爆栈抛出的 RangeError 若被空 catch 吞掉，表现就是"不崩但一直烧 CPU"。
 *   2. **只在集合真的变化时重施**：记住上次施加的签名，没变就直接返回。
 *   3. **监听器归控制器独占**：每个 agent 的微型插件**不自己订阅** `tools/change`，
 *      只由控制器统一 sync；挂载途中的 agent 用 `mounting` 挡掉。
 *
 * 另外：所有 catch 都要接 logger —— 那次故障之所以完全没日志，就是因为
 * 关键 catch 是空的。
 */

const LOG = '[skill-mcp-hub]'

/** 把错误压成一行日志文本。 */
function errorText(error) {
  if (error !== null && typeof error === 'object' && 'message' in error) return String(error.message)
  return String(error)
}

/** 往里打一条 warn；拿不到 logger 时退 console。 */
export function warnOf(ctx, message) {
  const line = LOG + ' ' + message
  try {
    const logger = typeof ctx?.get === 'function' ? ctx.get('logger') : undefined
    if (logger !== null && typeof logger === 'object' && typeof logger.warn === 'function') {
      logger.warn(line)
      return
    }
  } catch {}
  try {
    if (typeof console !== 'undefined' && typeof console.warn === 'function') console.warn(line)
  } catch {}
}

/**
 * 控制所有 agent 上的工具限制。
 *
 * `resolveDeny(agent)` 由调用方提供：给定一个 agent，返回它当前应当被 deny 的工具名
 * 数组（= 全局关掉的 server 的工具 ∪ 本会话额外关掉的 server 的工具）。
 */
export class ToolGateController {
  constructor(ctx, resolveDeny) {
    this.ctx = ctx
    this.resolveDeny = resolveDeny
    this.mounted = new Map()
    this.mounting = new Set()
    this.syncing = false
    this.disposed = false
  }

  /** 生成挂到 agent 作用域上的微型插件。`holder.sync()` 由控制器调用。 */
  pluginFor(getDeny) {
    const holder = { sync: () => {} }
    return {
      holder,
      plugin: {
        name: 'dsh-skill-mcp-hub:tool-gate',
        inject: ['tools'],
        apply(c) {
          let undo
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
            let known
            try {
              known = new Set(c.tools.view(undefined).restrictableNames)
            } catch (error) {
              warnOf(c, '读取可限制工具列表失败：' + errorText(error))
              return
            }
            const wanted = getDeny()
            const usable = wanted.filter((name) => known.has(name))
            const signature = usable.slice().sort().join('\u0000')
            if (signature === applied) return
            if (undo !== undefined) {
              try {
                undo()
              } catch (error) {
                warnOf(c, '撤销上一轮限制失败：' + errorText(error))
              }
              undo = undefined
              applied = null
            }
            if (usable.length === 0) {
              applied = ''
              return
            }
            try {
              undo = c.tools.restrict({ deny: usable })
              applied = signature
            } catch (error) {
              warnOf(c, '施加工具限制失败：' + errorText(error))
              undo = undefined
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

  /** 对所有已挂载 agent 补一轮。重入守卫是这里的核心。 */
  syncAll() {
    if (this.disposed || this.syncing) return
    this.syncing = true
    try {
      for (const entry of [...this.mounted.values()]) {
        try {
          entry.holder.sync()
        } catch (error) {
          warnOf(this.ctx, '重新施加工具限制失败：' + errorText(error))
        }
      }
    } finally {
      this.syncing = false
    }
  }

  /** 给一个 agent 施加限制。 */
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
          return this.resolveDeny(agent)
        } catch (error) {
          warnOf(this.ctx, '解析待禁工具失败：' + errorText(error))
          return []
        }
      })
      const fiber = scopeCtx.plugin(plugin)
      this.mounted.set(id, { fiber, holder })
    } catch (error) {
      warnOf(this.ctx, '挂载工具闸门失败（agent ' + id + '）：' + errorText(error))
    } finally {
      this.mounting.delete(id)
    }
  }

  /** agent 销毁后清账（限制本身由它的作用域解绑）。 */
  release(id) {
    this.mounted.delete(id)
  }

  /** 对宿主已知的 agent 全部补挂。 */
  reapply(listAgents) {
    if (this.disposed) return
    for (const agent of listAgents()) this.applyTo(agent)
  }

  dispose() {
    this.disposed = true
    this.mounted.clear()
    this.mounting.clear()
  }
}
