/**
 * dsh-skill-mcp-hub —— 宿主半区
 *
 * 一个 Typert 远程服务（"skillMcpHub"），对外暴露「统一管理 skill 与 MCP」的全部操作：
 *   · 列表（skill / mcp / groups）
 *   · 全局启停（skill 走磁盘改名，MCP 走 state + 运行时 restrict）
 *   · 会话级启停（只作用于当前 agent 的作用域，不动全局）
 *   · 别名 / 备注 / 分组
 *   · 自建 MCP 服务器（写自己的受管块，不碰用户手写行）
 *   · MCP 连接测试（独立 initialize + tools/list 握手）
 *
 * 两条硬约束（来自 P0 探针与 panel 的实战教训）：
 *   1. 调 `skills.list/get/snapshot` 传 scope 时**必须传 agent 对象本体**，
 *      否则 `ScopedLayers.chainLayers` 的同引用比较查不到层，遮蔽静默失效。
 *   2. 施加 `tools.restrict` 必须走 ToolGateController（带重入守卫 + 签名比对），
 *      否则 `tools/change` 自触发会把主线程烧到 100%。
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { strictCodec } from './codec.js'
import { emptyState, loadState, normalizeState, saveState, statePath } from './state.js'
import { scanSkills, setSkillEnabledGlobal } from './skills.js'
import { readMcpRows, serverOfTool, toolsToDeny } from './mcp.js'
import { ToolGateController, warnOf } from './tool-gate.js'
import { SkillShadowController } from './skill-shadow.js'
import { probeServer } from './probe.js'
import { HUB_MANIFEST, NS as HUB_NS } from './manifest.js'
import { normalizeOverrides, offNamesOf, onNamesOf, resolveHidden, setOverride, switchStateOf } from './layers.js'

export const name = 'dsh-skill-mcp-hub'
export const inject = ['typert', 'tools', 'skills', 'sessions', 'agents']

// ── wire 模式（zod v4）─────────────────────────────────────────────────
const scopeRefSchema = z.object({
  kind: z.enum(['global', 'workspace']),
  path: z.string().optional(),
})

const skillRowSchema = z.object({
  name: z.string(),
  description: z.string(),
  root: z.string(),
  rootLabel: z.string(),
  rank: z.number(),
  dir: z.string(),
  /** 磁盘层面是否启用（没改名、frontmatter 没禁）。 */
  enabled: z.boolean(),
  disabledByRename: z.boolean(),
  disabledByFrontmatter: z.boolean(),
  alias: z.string(),
  note: z.string(),
  group: z.string(),
})

const mcpRowSchema = z.object({
  serverName: z.string(),
  transport: z.enum(['stdio', 'streamable-http']),
  command: z.string().optional(),
  url: z.string().optional(),
  /** patch 里该行是否写了 disabled: true。 */
  disabledInPatch: z.boolean(),
  /** 本插件记录的全局开关（state）。 */
  globalEnabled: z.boolean(),
  /** 是否本插件自己加的行（可删）。 */
  builtin: z.boolean(),
  alias: z.string(),
  note: z.string(),
  /** 已注册的工具数（运行时视角）。 */
  toolCount: z.number(),
})

const groupRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
})

const listResultSchema = z.object({
  skills: z.array(skillRowSchema),
  mcp: z.array(mcpRowSchema),
  groups: z.array(groupRowSchema),
  shadowedSkills: z.number(),
  totalSkillEntries: z.number(),
  dshHome: z.string(),
  stateFile: z.string(),
  /** 本插件是否在不写 patch 的前提下管理 MCP —— 界面上必须显示这条折扣。 */
  mcpNote: z.string(),
})

const togglePayloadSchema = z.object({
  kind: z.enum(['skill', 'mcp']),
  name: z.string().min(1),
  enabled: z.boolean(),
  sessionId: z.string().optional(),
})

const annotatePayloadSchema = z.object({
  kind: z.enum(['skill', 'mcp']),
  name: z.string().min(1),
  alias: z.string().optional(),
  note: z.string().optional(),
  group: z.string().optional(),
})

const groupPayloadSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  color: z.string().optional(),
})

const groupDeleteSchema = z.object({ id: z.string().min(1) })

const okResultSchema = z.object({ ok: z.boolean(), detail: z.string().optional() })

const sessionStateSchema = z.object({
  sessionId: z.string(),
  /** 本会话额外关掉的 skill 名。 */
  disabledSkills: z.array(z.string()),
  /** 本会话额外关掉的 mcp server 名。 */
  disabledMcp: z.array(z.string()),
})

const testPayloadSchema = z.object({ serverName: z.string().min(1) })
const testResultSchema = z.object({
  ok: z.boolean(),
  toolCount: z.number(),
  elapsedMs: z.number(),
  error: z.string().optional(),
})

const serverInputSchema = z.object({
  serverName: z.string().min(1),
  transport: z.enum(['stdio', 'streamable-http']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
})

// ── 服务 ─────────────────────────────────────────────────────────────
/**
 * 内置依赖表（**确定的**，直接标橙，不用扫描）。
 *
 * 收录标准：**关掉会造成功能性损坏**，而不是"少个工具但能绕开"。
 * 分两类来源：
 *   · 跨进程运行时依赖（QQ 桥接这种，skill 正文里查不到）
 *   · skill 正文里写明"必须"的强依赖
 *
 * ⚠ 用户/其他 AI 也可以用 `setDependents` 接口往 state 里加，两者会合并。
 */
const MCP_RUNTIME_DEPENDENTS = {
  // ── QQ 桥接（dsh-qq 是独立进程，不在 skill 里）──
  snowluma: ['QQ 桥接：收发消息'],
  'snowluma-host': ['QQ 桥接：宿主侧连接'],
  'web-search-safe': ['QQ 桥接：联网搜索'],
  // ── 技能强依赖 ──
  comfy: ['comfyui-local-image：本地出图'],
  'comfy-mcp': ['comfyui-local-image：本地出图'],
  github: ['agent-reach：GitHub 检索', 'find-skills', 'humanizer-zh', 'understand-dashboard'],
  fetch: ['code-review：抓取源码'],
}

/**
 * 从 skill 正文里扫出它引用了哪些 MCP（2026-11-11 加）。
 *
 * **⚠ 这是启发式，不一定准**：
 *   · 只要正文出现过 `mcp__<名>__` 或直接写了服务器名，就算"引用"
 *   · 但"提了一嘴"（例："你也可以用 github MCP"）和"强依赖"分不清
 *   · 所以界面上必须标注「仅供参考」，别当成硬承诺
 *
 * @returns `{ '<mcp名>': ['skill-a', 'skill-b'] }`
 */
async function scanSkillMcpRefs(skillRoots, knownServers) {
  const out = {}
  if (!Array.isArray(skillRoots) || !Array.isArray(knownServers) || knownServers.length === 0) return out
  const { readdir, readFile, stat } = await import('node:fs/promises')
  const { join } = await import('node:path')

  for (const root of skillRoots) {
    if (typeof root !== 'string' || root === '') continue
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const dir = join(root, entry.name)
      let text
      try {
        // 启用的才算（.disabled 的 skill 不会被加载，别污染依赖表）
        text = await readFile(join(dir, 'SKILL.md'), 'utf8')
      } catch {
        continue
      }
      if (typeof text !== 'string' || text === '') continue
      for (const server of knownServers) {
        if (typeof server !== 'string' || server === '') continue
        const explicit = new RegExp('mcp__' + escapeRegExp(server) + '__')
        /**
         * 裸词匹配只对**有辨识度的名字**启用。
         *
         * 2026-11-11 实测：`time` 扫出 8 个 skill —— 全是正文里 "at the same time"
         * 这种英文单词误中；`fetch` / `sqlite` 同理。
         * 所以：只认显式 `mcp__名__`，或名字够特别（含 `-` 或长度 ≥6）才做裸词匹配。
         */
        const distinctive = server.includes('-') || server.length >= 6
        const bare = distinctive ? new RegExp('\\b' + escapeRegExp(server) + '\\b') : null
        if (explicit.test(text) || (bare !== null && bare.test(text))) {
          if (out[server] === undefined) out[server] = []
          if (!out[server].includes(entry.name)) out[server].push(entry.name)
        }
      }
    }
  }
  for (const k of Object.keys(out)) out[k].sort()
  return out
}

/** 正则转义（服务器名里可能有 `-` `.` 这类字符）。 */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export class SkillMcpHubGateway extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, 'skillMcpHub')
    /** 每个 agent id 的会话级关闭集合（运行时临时状态，不落盘）。 */
    this.sessionOverrides = new Map()
    /** 工具闸门控制器（MCP 会话级开关的执行者）。 */
    this.gate = undefined
  }

  get C() {
    return this.ctx
  }

  /** DSH home：优先宿主 homePaths，退回 $DSH_HOME，再退 ~/.dsh。 */
  dshHome() {
    try {
      const hp = this.C.get('homePaths')
      if (hp?.home) return hp.home
    } catch {}
    const env = process.env.DSH_HOME?.trim()
    if (env) return env
    return join(homedir(), '.dsh')
  }

  agentsHome() {
    const env = process.env.DSH_AGENTS_HOME?.trim()
    return env ? resolvePath(env) : join(homedir(), '.agents')
  }

  profileName() {
    // profile 名对 patch 路径很关键；宿主没有稳定服务可读时按 default 兜底。
    try {
      const p = this.C.get('loader')?.profile?.name ?? this.C.get('profile')?.name
      if (typeof p === 'string' && p !== '') return p
    } catch {}
    return process.env.DSH_PROFILE?.trim() || 'default'
  }

  patchPath() {
    return join(this.dshHome(), 'profiles', this.profileName(), 'cordis.patch.yml')
  }

  /** 四个技能根（本机工作区 .dsh/skills 不存在也必须容忍）。 */
  skillRoots() {
    const home = this.dshHome()
    const ws = this.C.get('workingDirectory')
    let projectRoot
    try {
      projectRoot = ws?.current?.()
    } catch {}
    const roots = []
    roots[0] = projectRoot ? join(projectRoot, '.dsh', 'skills') : ''
    roots[1] = projectRoot ? join(projectRoot, '.agents', 'skills') : ''
    roots[2] = join(home, 'skills')
    roots[3] = join(this.agentsHome(), 'skills')
    return roots
  }

  /** 当前活动 agent 列表（给闸门补挂用）。 */
  listAgents() {
    try {
      const rows = this.C.agents?.list?.()
      return Array.isArray(rows) ? rows : []
    } catch {
      return []
    }
  }

  agentOf(sessionId) {
    if (typeof sessionId !== 'string') return undefined
    try {
      return this.C.agents?.get?.(sessionId)
    } catch {
      return undefined
    }
  }

  /**
   * 三层分层的 key（主人 2026-11-11 定）：
   *
   *   · **全局** —— state.json（`globalEnabled`），侧边栏面板管
   *   · **工作区** —— 按 workspaceKey 存，侧边栏面板管
   *   · **会话** —— 按 sessionId 存，输入栏那个按钮管
   *
   * 后两层分开存，互不覆盖：同一个工作区里，A 会话关掉的东西
   * 不该让 B 会话也关掉（那是会话级语义），而工作区级关掉的
   * 应该对这个工作区所有会话都生效。
   *
   * 所以遮蔽列表 = 工作区级 ∪ 会话级。
   */

  /** 工作区 key：优先 agent.cwd，退到 agent.workspace / workingDirectory，再退到 session:<id>。 */
  workspaceKeyOf(agent) {
    const candidates = [agent?.cwd, agent?.workspace, agent?.workingDirectory]
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim() !== '') return 'ws:' + c.trim()
    }
    return ''
  }

  /** 会话 key：agent 自己的 id。 */
  sessionKeyOf(agent) {
    return typeof agent?.id === 'string' && agent.id !== '' ? 'ss:' + agent.id : ''
  }

  /** 读某一层的开关集合。 */
  layerOf(key) {
    if (typeof key !== 'string' || key === '') return { skills: [], mcp: [] }
    return this.sessionOverrides.get(key) ?? { skills: [], mcp: [] }
  }

  /**
   * 某 agent 当前应当被**遮蔽**的 skill 名。
   *
   * 三层求值（2026-11-11 主人最终定调：**工作区能反向开全局关掉的东西**）：
   *
   *   基准 = 全局是否开启（state.globalEnabled，缺省 true）
   *   然后按 工作区 → 会话 的顺序叠覆盖（后者优先）：
   *     · 标 `off` ⇒ 最终关
   *     · 标 `on`  ⇒ 最终开（**即使全局关着也能开回来**）
   *     · 没标     ⇒ 跟随上一层
   *
   * 结果里返回「最终应当关闭」的名字集合。
   *
   * 全局关 skill 有两种形态：
   *  ① 磁盘改名 `.disabled` —— 宿主自己就扫不到，不需要再遮蔽
   *  ② state 里 `globalEnabled === false` —— 这个要算，因为文件还在
   */
  hiddenSkillsOf(agent, state) {
    /**
     * globalMap 合并两个来源（2026-11-11 修）：
     *   ① this.diskEnabled —— 磁盘真实状态（.disabled 改名 / frontmatter）
     *   ② state.skills[名].globalEnabled —— 面板上"全局关"的
     *
     * 只算 ② 的话：磁盘改名停用的 skill 根本不在 state 里，层里的 'on' 覆盖
     * 没人接，表现为"关着的 skill 点不开"（主人 2026-11-11 实测）。
     */
    const globalMap = {}
    for (const [name, on] of Object.entries(this.diskEnabled ?? {})) globalMap[name] = on
    for (const [name, meta] of Object.entries(state?.skills ?? {})) {
      globalMap[name] = meta?.globalEnabled !== false
    }
    const ws = this.layerOf(this.workspaceKeyOf(agent)).skills
    const ss = this.layerOf(this.sessionKeyOf(agent)).skills
    return resolveHidden(globalMap, ws, ss)
  }

  /**
   * 把 state 里的 sessionOverlays 灌进内存 Map。
   *
   * 为什么要这一层：`hiddenSkillsOf` 是**同步**的（遮蔽 provider 要求同步返回），
   * 不能 await 读盘。所以启动时读一次灌进内存，改动时两边一起写。
   *
   * 2026-11-11 加：会话层原来是纯内存，进程重启就清零 —— 用户会看到
   * 「关了又自己开」。现在持久化到 state.json，重启后还在。
   */
  hydrateOverlays(state) {
    this.sessionOverrides.clear()
    for (const [key, row] of Object.entries(state?.sessionOverlays ?? {})) {
      this.sessionOverrides.set(key, {
        skills: normalizeOverrides(row?.skills),
        mcp: normalizeOverrides(row?.mcp),
      })
    }
    return this.sessionOverrides.size
  }

  /** 把内存 Map 写回 state 对象（调用方负责 saveState）。空层直接剔除。 */
  snapshotOverlays(state) {
    const out = {}
    for (const [key, row] of this.sessionOverrides.entries()) {
      const skills = normalizeOverrides(row?.skills)
      const mcp = normalizeOverrides(row?.mcp)
      if (Object.keys(skills).length === 0 && Object.keys(mcp).length === 0) continue
      out[key] = { skills, mcp }
    }
    state.sessionOverlays = out
    return out
  }

  /** 改完覆盖后落盘（读最新 state → 写回覆盖 → 保存）。 */
  async persistOverlays() {
    try {
      const state = await loadState(this.dshHome())
      this.snapshotOverlays(state)
      await saveState(this.dshHome(), state)
      return true
    } catch (error) {
      warnOf(this.ctx, '保存会话层覆盖失败：' + String(error))
      return false
    }
  }

  /** 重扫磁盘，把"哪些 skill 当前启用"记进内存（供同步求值用）。 */
  async refreshDisk() {
    try {
      const { winners } = await scanSkills(this.skillRoots())
      const map = {}
      for (const w of winners) map[w.name] = w.enabled === true
      this.diskEnabled = map
      return map
    } catch (error) {
      warnOf(this.ctx, '扫描磁盘 skill 状态失败：' + String(error))
      return this.diskEnabled ?? {}
    }
  }

  /**
   * 某 agent 当前应当被 restrict 掉的 mcp 名。
   * 与 skill 同一套三层求值：全局基准 ∪ 各层 off（下层只做减法）。
   */
  hiddenMcpOf(agent, state) {
    const globalMap = {}
    for (const [name, meta] of Object.entries(state?.mcp ?? {})) {
      globalMap[name] = meta?.globalEnabled !== false
    }
    const ws = this.layerOf(this.workspaceKeyOf(agent)).mcp
    const ss = this.layerOf(this.sessionKeyOf(agent)).mcp
    return resolveHidden(globalMap, ws, ss)
  }

  /**
   * 某条目在各局部层的显式覆盖，供 UI 算三态。
   * @returns { ws: {键: 'on'|'off'}, ss: {…} }，只包含**实际标过**的条目
   */
  overridesFor(name, field) {
    const out = {}
    for (const [key, row] of this.sessionOverrides.entries()) {
      const obj = normalizeOverrides(row?.[field])
      if (Object.hasOwn(obj, name)) out[key] = obj[name]
    }
    return out
  }

  /**
   * 清掉**所有层**对某个条目的覆盖。
   *
   * 为什么需要（2026-11-11）：全局一动，说明用户是在全局层面做决定。
   * 下层的旧表态如果留着，会在全局切回来时"诈尸"——用户会觉得
   * "我明明关了怎么又开了"。
   *
   * @returns 被清掉的层 key 数组（给调用方回执/自检用）
   */
  clearOverridesEverywhere(name) {
    const cleared = []
    for (const [key, row] of [...this.sessionOverrides.entries()]) {
      const had = Object.hasOwn(normalizeOverrides(row?.skills), name) || Object.hasOwn(normalizeOverrides(row?.mcp), name)
      if (!had) continue
      const skills = setOverride(row.skills, name, null)
      const mcp = setOverride(row.mcp, name, null)
      // 两层都空了就把这行也删掉，别留空壳
      if (Object.keys(skills).length === 0 && Object.keys(mcp).length === 0) {
        this.sessionOverrides.delete(key)
      } else {
        this.sessionOverrides.set(key, { ...row, skills, mcp })
      }
      cleared.push(key)
    }
    return cleared
  }

  /** 全局关掉的 server 名集合（state 里 globalEnabled === false 的）。 */
  globalDisabledMcp(state) {
    const out = new Set()
    for (const [server, meta] of Object.entries(state.mcp)) {
      if (meta.globalEnabled === false) out.add(server)
    }
    return out
  }

  /** 给一个 agent 算出应当 deny 的工具名（全局 ⊕ 工作区 ⊕ 会话，三层并集）。 */
  denyFor(agent, state) {
    const known = this.knownToolNames()
    const disabled = this.globalDisabledMcp(state)
    // 工作区级 + 会话级都算——两层是并集关系，任一层关掉就生效。
    for (const server of this.hiddenMcpOf(agent, state)) disabled.add(server)
    return toolsToDeny(known, disabled)
  }

  knownToolNames() {
    try {
      return [...this.C.tools.view(undefined).restrictableNames]
    } catch {
      return []
    }
  }

  /** 按 server 数已注册工具数。 */
  toolCountByServer() {
    const counts = new Map()
    for (const toolName of this.knownToolNames()) {
      const server = serverOfTool(toolName)
      if (server === undefined) continue
      counts.set(server, (counts.get(server) ?? 0) + 1)
    }
    return counts
  }

  /** 让面板能主动触发一次全量重施（改完 state 后调用）。 */
  resyncGate() {
    this.gate?.syncAll()
  }

  // ── 远程方法 ────────────────────────────────────────────────────────
  /** 全量列表。 */
  async list() {
    const state = await loadState(this.dshHome())
    const { winners, shadowed, total } = await scanSkills(this.skillRoots())
    // 顺手刷新磁盘状态缓存，保证同步求值（hiddenSkillsOf）拿到最新数据
    this.diskEnabled = {}
    for (const w of winners) this.diskEnabled[w.name] = w.enabled === true
    const patchRows = await readMcpRows(this.patchPath())
    const counts = this.toolCountByServer()

    /**
     * 依赖预计算（2026-11-12 挪到这里：skill 行要显示「依赖的 MCP 是否关了」，
     * 所以必须在构建 skills 数组**之前**就能查到）。
     */
    const patchServerNames = patchRows.map((r) => r.serverName).filter((n) => typeof n === 'string' && n !== '')
    const scannedRefs = await scanSkillMcpRefs(this.skillRoots(), patchServerNames)

    /** skill → 它引用了哪些 MCP（反向索引，只收扫描结果）。 */
    const skillNeeds = {}
    for (const [serverName, refs] of Object.entries(scannedRefs)) {
      for (const skillName of refs) {
        if (skillNeeds[skillName] === undefined) skillNeeds[skillName] = []
        if (!skillNeeds[skillName].includes(serverName)) skillNeeds[skillName].push(serverName)
      }
    }

    /**
     * 哪些 MCP 现在是关的。
     *
     * 判据 = 全局关了（`state.mcp[x].globalEnabled === false`）或本层藏了。
     * **不依赖 `mcp` 数组**——那个还没构建出来。
     */
    const mcpOff = new Set()
    for (const name of patchServerNames) {
      if (state.mcp[name]?.globalEnabled === false) mcpOff.add(name)
    }
    for (const key of Object.keys(state.sessionOverlays ?? {})) {
      const layer = state.sessionOverlays[key]?.mcp
      if (layer === undefined) continue
      for (const name of Object.keys(layer)) mcpOff.add(name)
    }


    const skills = winners.map((item) => {
      const meta = state.skills[item.name] ?? {}
      return {
        name: item.name,
        description: item.description,
        root: item.root,
        rootLabel: item.rootLabel,
        rank: item.rank,
        dir: item.dir,
        enabled: item.enabled,
        disabledByRename: item.disabledByRename,
        disabledByFrontmatter: item.disabledByFrontmatter,
        alias: meta.alias ?? '',
        note: meta.note ?? '',
        group: meta.group ?? '',
        /** 各层的显式覆盖：{ ws: {...}, ss: {...} }，供 UI 算三态。 */
        overrides: this.overridesFor(item.name, 'skills'),
        /**
         * 这个 skill 依赖的 MCP 里，**哪些现在是关的**（2026-11-12 加）。
         *
         * 界面据此在 skill 行上打 ⚠ ——「你要用的 MCP 被关了，可能跑不起来」。
         * 空数组 = 没依赖，或依赖的都开着，两种情况都不用提示。
         */
        mcpOff: (skillNeeds[item.name] ?? []).filter((n) => mcpOff.has(n)),
        mcpNeeds: skillNeeds[item.name] ?? [],
      }
    })

    /**
     * 合并「运行时依赖（手写）」与「skill 引用（自动扫）」—— 2026-11-11。
     *
     * 分两类是为了让界面能区别对待：
     *   · hard（手写）—— 关掉真的会断（QQ 桥接在别的进程里用它）
     *   · soft（扫描）—— **仅供参考**，正文提过一嘴也算，不一定真依赖
     */
    const mergedDeps = {}
    for (const name of patchServerNames) {
      /**
       * hard = 内置表 + 用户在 state 里手动标注的（两者都是"确定"的）
       * soft = 自动扫描的（**仅供参考**）
       */
      const builtin = MCP_RUNTIME_DEPENDENTS[name] ?? []
      const manual = Array.isArray(state.mcp[name]?.dependents) ? state.mcp[name].dependents : []
      const hard = [...new Set([...builtin, ...manual])]
      const soft = scannedRefs[name] ?? []
      const all = [...hard, ...soft.filter((s) => !hard.some((h) => h.includes(s) || s.includes(h)))]
      if (all.length > 0) mergedDeps[name] = { hard, soft, all }
    }


    const seen = new Set()
    const mcp = []
    for (const row of patchRows) {
      seen.add(row.serverName)
      const meta = state.mcp[row.serverName] ?? {}
      mcp.push({
        serverName: row.serverName,
        transport: row.transport,
        command: row.command,
        url: row.url,
        disabledInPatch: row.disabled,
        globalEnabled: meta.globalEnabled !== false,
        builtin: meta.builtin === true,
        alias: meta.alias ?? '',
        note: meta.note ?? '',
        toolCount: counts.get(row.serverName) ?? 0,
        /**
         * 运行时依赖提示（2026-11-11 加）。
         *
         * 有些 MCP 背后有**别的进程在用它**，关掉不是"少个工具"而是
         * "某个功能整个哑掉"，而且**不报错**（遮蔽是静默的）。
         * 这里把一个已知依赖表带出去，让界面能提前警示。
         */
        /**
         * 依赖提示：**手写运行时依赖 + 自动扫描的 skill 引用** 合并。
         *
         * `dependents`      —— 全部（用于悬停展示）
         * `dependentsHard` —— 手写的那部分（QQ 桥接这类，真关就断）
         * `dependentsSoft` —— 扫出来的 skill 引用（**仅供参考，不一定准**）
         */
        dependents: mergedDeps[row.serverName]?.all ?? [],
        dependentsHard: mergedDeps[row.serverName]?.hard ?? [],
        dependentsSoft: mergedDeps[row.serverName]?.soft ?? [],
        overrides: this.overridesFor(row.serverName, 'mcp'),
      })
    }
    // state 里有、patch 里没有的（例如用户手删了行）也要显示，让用户看到不一致
    for (const [server, meta] of Object.entries(state.mcp)) {
      if (seen.has(server)) continue
      mcp.push({
        serverName: server,
        transport: 'stdio',
        command: undefined,
        url: undefined,
        disabledInPatch: false,
        globalEnabled: meta.globalEnabled !== false,
        builtin: meta.builtin === true,
        alias: meta.alias ?? '',
        note: meta.note ?? '',
        toolCount: counts.get(server) ?? 0,
      })
    }
    mcp.sort((a, b) => a.serverName.localeCompare(b.serverName))
    return {
      skills,
      mcp,
      groups: state.groups,
      shadowedSkills: shadowed,
      totalSkillEntries: total,
      /**
       * 已知工作区列表（2026-11-11 加，主人要求「下面再加上其他工作区」）。
       *
       * 来源两处合并：
       *   ① `$DSH_HOME/sessions/--<slug>--` 目录名反解出路径（跑过会话的都算）
       *   ② state.sessionOverlays 里已有的 `ws:` 键（配过覆盖的）
       *
       * 顺带标出 `current`（本次会话所在的那个），界面据此区分。
       */
      workspaces: await this.listWorkspaces(),
      currentWorkspace: this.currentWorkspacePath(),
      dshHome: this.dshHome(),
      stateFile: statePath(this.dshHome()),
      mcpNote:
        'MCP 的全局关只作用于运行时（tools.restrict），不改 cordis.patch.yml；本插件未加载时该服务器仍会连接。',
    }
  }

  /**
   * 当前活跃的工作区路径（界面用来标「当前」）。
   *
   * 2026-11-11 改：**从 agent 对象取 cwd**，不走 `workingDirectory` 服务。
   * 理由：`workspaceKeyOf(agent)` 一直是这么取的且验证可用；
   * `workingDirectory.current()` 在本机可能返回空（截图里列表没标"当前"就是这原因）。
   * 多个 agent 时取第一个有 cwd 的（通常就是主视图那个）。
   */
  currentWorkspacePath() {
    for (const agent of this.listAgents()) {
      if (agent === null || typeof agent !== 'object') continue
      const candidates = [agent.cwd, agent.workspace, agent.workingDirectory]
      for (const c of candidates) {
        if (typeof c === 'string' && c.trim() !== '') return c.trim()
      }
    }
    // 兜底：退回 workingDirectory 服务
    try {
      const ws = this.C.get('workingDirectory')
      const cur = ws?.current?.()
      if (typeof cur === 'string' && cur !== '') return cur
    } catch {}
    return ''
  }

  /**
   * 列出已知工作区（2026-11-11 加）。
   *
   * 来源两处合并：
   *   ① `$DSH_HOME/sessions/--<slug>--` 目录名反解（跑过会话的都算）
   *   ② state.sessionOverlays 里已有的 `ws:` 键（配过覆盖的，即使没会话）
   *
   * slug 规则：路径里的 `:` `\` `/` 换成 `-`，首尾各补 `--`。
   * 反解是把 `--` 包起来的那段里每个 `-` 还原成路径分隔符——**这是有损的**，
   * 所以优先用 ② 的原始路径；① 只在没有更好来源时用。
   */
  async listWorkspaces() {
    const seen = new Map()

    // ② state 里的原始路径（可靠）
    try {
      const state = await loadState(this.dshHome())
      for (const key of Object.keys(state?.sessionOverlays ?? {})) {
        if (!key.startsWith('ws:')) continue
        const path = key.slice(3)
        if (path !== '') seen.set(path, { path, source: 'state' })
      }
    } catch {}

    /**
     * ① 从会话文件里读**真实 cwd**。
     *
     * 不能靠 slug 反解——slug 把路径里的 `-` 和分隔符混在一起，有损。
     * 例：`--C-Users-...-deepseek-harness-default-workspace--` 反解成
     * `deepseek\harness` 就不存在了（实测 9 个目录只认出 5 个）。
     * 会话文件第一行里带着 `cwd` 原文，直接读它。
     */
    try {
      const { readdir, readFile, stat } = await import('node:fs/promises')
      const { join } = await import('node:path')
      const zlib = await import('node:zlib')
      const dir = join(this.dshHome(), 'sessions')
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (!entry.name.startsWith('--') || !entry.name.endsWith('--')) continue
        const slugDir = join(dir, entry.name)
        let subs
        try {
          subs = await readdir(slugDir, { withFileTypes: true })
        } catch {
          continue
        }
        // 每个 slug 下取最新的一个会话文件即可（同一 slug 的 cwd 都一样）
        for (const sub of subs) {
          if (!sub.isDirectory()) continue
          const f = join(slugDir, sub.name, 'session.v4.jsonl.zstd')
          try {
            await stat(f)
          } catch {
            continue
          }
          let text = ''
          try {
            const buf = await readFile(f)
            text = zlib.zstdDecompressSync(buf).toString('utf8')
          } catch {
            continue
          }
          const m = /"(?:cwd|workingDirectory)":"((?:[^"\\]|\\.)+)"/.exec(text)
          if (m === null) continue
          let path
          try {
            path = JSON.parse('"' + m[1] + '"')
          } catch {
            continue
          }
          if (typeof path !== 'string' || path === '') continue
          // 目录真存在才收（工作区可能已被删）
          try {
            const st = await stat(path)
            if (!st.isDirectory()) continue
          } catch {
            continue
          }
          if (!seen.has(path)) seen.set(path, { path, source: 'session' })
          break // 同一个 slug 只要一个
        }
      }
    } catch {}

    const current = this.currentWorkspacePath()
    const list = [...seen.values()].map((w) => ({ ...w, current: w.path === current }))
    list.sort((a, b) => (a.current === b.current ? a.path.localeCompare(b.path) : a.current ? -1 : 1))
    return list
  }

  /** 全局启停。skill 改磁盘标记，MCP 改 state + 重施闸门。 */
  async toggle(payload) {
    const state = await loadState(this.dshHome())

    if (payload.kind === 'skill') {
      /**
       * ── 局部层（工作区 / 会话）：只能「藏」，不能「开」────────────────
       *
       * 2026-11-11 重新设计（方案 A）：
       *   全局关掉的 skill 磁盘上已改名，宿主根本扫不到，遮蔽没有对象可遮。
       *   所以这里**只接受 enabled === false**（记一条 off），
       *   `enabled === true` 的语义是「**清除本层的 off**，跟随全局」。
       *
       * 这杜绝了「假装能反向开」——以前记 `on` 只是个不起作用的摆设，
       * 还会在全局切回来时"诈尸"。
       */
      if (typeof payload.layerKey === 'string' && payload.layerKey !== '') {
        const row = this.sessionOverrides.get(payload.layerKey) ?? { skills: [], mcp: [] }
        row.skills = setOverride(row.skills, payload.name, payload.enabled === false ? false : null)
        this.sessionOverrides.set(payload.layerKey, row)
        this.sessionOverrides.set(payload.layerKey, row)
        await this.persistOverlays()
        /**
         * 推给运行时（2026-11-11 修「关了没反应」）。
         *
         * ① `syncAll()` —— 正常路径，只重注册 provider，成本低
         * ② **对本层对应的 agent 直接 `remount()`** —— 兜底。`holder.sync` 里
         *    有 `inside` 防重入标志，一旦那次推送被跳过就静默失效（关了没反应）。
         *
         * 只 remount 本层那个 agent，不碰其他会话。
         */
        try { this.shadow?.syncAll() } catch {}
        /**
         * 兜底重挂（2026-11-11）：`holder.sync` 的 `inside` 标志会静默跳过推送。
         *
         * **不单靠 `agents.get(id)`** —— 那个 id 的形态和 `listAgents()` 里
         * agent 对象的 `.id` 未必一致（实测 get 拿不到）。先从 listAgents 里按
         * id 找，找不到再退回 get。
         */
        try {
          if (typeof payload.layerKey === 'string' && payload.layerKey.startsWith('ss:')) {
            const sid = payload.layerKey.slice(3)
            const live = this.listAgents().find((a) => a !== null && typeof a === 'object' && a.id === sid)
            const agent = live ?? this.agentOf(sid)
            if (agent !== undefined && agent !== null) this.shadow?.remount(agent)
          }
        } catch (e) {
          warnOf(this.ctx, '重挂遮蔽失败：' + String(e))
        }
        return { ok: true, detail: payload.enabled === false ? 'hidden' : 'unhidden' }
      }

      /**
       * ── 全局：**唯一会改磁盘的层** ─────────────────────────────────
       *
       * 执行顺序不能变（2026-11-11 实测踩过）：
       *   ① 改文件名（磁盘真状态）
       *   ② 写 state（记住意图）
       *   ③ **重扫 diskEnabled**（否则缓存还是旧值）
       *   ④ **清掉各层对它的残留覆盖**（否则旧表态会诈尸）
       *   ⑤ **重施遮蔽**（否则已挂 provider 还按旧集合遮着）
       *   ⑥ **重算 gate**（MCP 侧联动）
       * 少任何一步都会出现「界面变了但实际没变」。
       */
      const { winners } = await scanSkills(this.skillRoots())
      const target = winners.find((item) => item.name === payload.name)
      if (target === undefined) return { ok: false, detail: '找不到该 skill' }
      if (target.disabledByFrontmatter) {
        return {
          ok: false,
          detail: '该 skill 用 frontmatter disable-model-invocation 停用，改名法改不回来；请直接改它的 SKILL.md。',
        }
      }
      try {
        const result = await setSkillEnabledGlobal(target.dir, payload.enabled)
        const meta = state.skills[payload.name] ?? {}
        state.skills[payload.name] = { ...meta, globalEnabled: payload.enabled === true }
        // 同步记进磁盘镜像，别只写 state
        this.diskEnabled = { ...(this.diskEnabled ?? {}), [payload.name]: payload.enabled === true }
        await saveState(this.dshHome(), state)

        // ③ 重扫（以磁盘为准，覆盖上面那行乐观写入）
        await this.refreshDisk()

        // ④ 清掉所有层对它的残留覆盖
        const cleared = this.clearOverridesEverywhere(payload.name)
        if (cleared.length > 0) await this.persistOverlays()

        // ⑤⑥ 重施 + 重算
        try { this.shadow?.syncAll() } catch {}
        try { this.resyncGate() } catch {}

        return { ok: true, detail: result.changed ? 'changed' : (result.reason ?? 'noop'), cleared }
      } catch (error) {
        return { ok: false, detail: String(error) }
      }
    }

    // ── MCP ────────────────────────────────────────────────────────
    // MCP 没有"磁盘改名"这一步，全局只是 state 里一个标记 + 运行时 restrict。
    // 但语义与 skill 对齐：局部层只能「关」，全局才是真正的开关。
    if (typeof payload.layerKey === 'string' && payload.layerKey !== '') {
      const row = this.sessionOverrides.get(payload.layerKey) ?? { skills: [], mcp: [] }
      // true 的语义是「清除本层 off」，不是「记一个 on」
      row.mcp = setOverride(row.mcp, payload.name, payload.enabled === false ? false : null)
      this.sessionOverrides.set(payload.layerKey, row)
      await this.persistOverlays()
      try { this.resyncGate() } catch {}
      return { ok: true, detail: payload.enabled === false ? 'hidden' : 'unhidden' }
    }

    const meta = state.mcp[payload.name] ?? {}
    state.mcp[payload.name] = { ...meta, globalEnabled: payload.enabled === true }
    await saveState(this.dshHome(), state)
    // 全局一动就清下层残留，避免"关不掉"
    const cleared = this.clearOverridesEverywhere(payload.name)
    if (cleared.length > 0) await this.persistOverlays()
    try {
      this.resyncGate()
      return { ok: true, detail: 'restrict', cleared }
    } catch (error) {
      return { ok: false, detail: String(error) }
    }
  }

  /** 别名 / 备注 / 分组。 */
  async annotate(payload) {
    const state = await loadState(this.dshHome())
    if (payload.kind === 'skill') {
      const meta = state.skills[payload.name] ?? { globalEnabled: true }
      if (payload.alias !== undefined) meta.alias = payload.alias
      if (payload.note !== undefined) meta.note = payload.note
      if (payload.group !== undefined) meta.group = payload.group
      state.skills[payload.name] = meta
    } else {
      const meta = state.mcp[payload.name] ?? { globalEnabled: true }
      if (payload.alias !== undefined) meta.alias = payload.alias
      if (payload.note !== undefined) meta.note = payload.note
      state.mcp[payload.name] = meta
    }
    await saveState(this.dshHome(), state)
    return { ok: true }
  }

  /**
   * 手动标注某个 MCP 的依赖（2026-11-11 加）。
   *
   * **为什么需要**：内置表只覆盖本机已知的那几个。换台机器、装了新 MCP、
   * 或者别的 AI 知道某条依赖关系时，得有个入口写进去，不该改代码。
   *
   * 存进 `state.mcp[名].dependents`，与内置表**合并**显示（橙色硬标）。
   *
   * @param payload.name - MCP serverName
   * @param payload.dependents - 依赖描述数组；传空数组 = 清空
   */
  async setDependents(payload) {
    if (typeof payload?.name !== 'string' || payload.name === '') {
      return { ok: false, detail: '缺少 name' }
    }
    const list = Array.isArray(payload.dependents)
      ? payload.dependents.filter((s) => typeof s === 'string' && s.trim() !== '').map((s) => s.trim())
      : []
    const state = await loadState(this.dshHome())
    const meta = state.mcp[payload.name] ?? { globalEnabled: true }
    if (list.length === 0) delete meta.dependents
    else meta.dependents = list
    state.mcp[payload.name] = meta
    await saveState(this.dshHome(), state)
    return { ok: true, dependents: list }
  }

  /** 新建/改名分组。 */
  async saveGroup(payload) {
    const state = await loadState(this.dshHome())
    if (typeof payload.id === 'string' && payload.id !== '') {
      const row = state.groups.find((g) => g.id === payload.id)
      if (row === undefined) return { ok: false, detail: '找不到该分组' }
      row.name = payload.name
      if (payload.color !== undefined) row.color = payload.color
    } else {
      state.groups.push({ id: 'g-' + randomUUID().slice(0, 8), name: payload.name, color: payload.color ?? '' })
    }
    await saveState(this.dshHome(), state)
    return { ok: true }
  }

  /** 删除分组（成员回落未分组）。 */
  async deleteGroup(payload) {
    const state = await loadState(this.dshHome())
    state.groups = state.groups.filter((g) => g.id !== payload.id)
    for (const meta of Object.values(state.skills)) {
      if (meta.group === payload.id) meta.group = ''
    }
    await saveState(this.dshHome(), state)
    return { ok: true }
  }

  /**
   * 读局部开关状态。能读三层里的任意一层，也能一次读「工作区 + 会话」的叠加结果。
   *
   * payload：
   *   · `{ layerKey }`        —— 只读该层
   *   · `{ workspaceKey }`    —— 读工作区层（自动加 ws: 前缀）
   *   · `{ sessionId }`       —— 读会话层（自动加 ss: 前缀）
   *   · `{ combined: true, workspaceKey, sessionId }` —— 返回两层并集，供输入栏显示真实生效状态
   */
  async sessionState(payload) {
    const norm = (value, prefix) => {
      if (typeof value !== 'string' || value === '') return ''
      return value.startsWith(prefix) ? value : prefix + value
    }

    if (payload?.combined === true) {
      const wsKey = norm(payload.workspaceKey, 'ws:')
      const ssKey = norm(payload.sessionId, 'ss:')
      const ws = this.layerOf(wsKey)
      const ss = this.layerOf(ssKey)
      /** 合并两层的覆盖记录（后者优先），旧的数组格式统一升级。 */
      const mergeLayers = (a, b) => ({ ...normalizeOverrides(a), ...normalizeOverrides(b) })
      const union = (a, b) => {
        const merged = mergeLayers(a, b)
        return Object.keys(merged).filter((k) => merged[k] === 'off')
      }
      return {
        workspaceKey: wsKey,
        sessionId: ssKey,
        disabledSkills: union(ws.skills, ss.skills),
        enabledSkills: Object.keys(mergeLayers(ws.skills, ss.skills)).filter((k) => mergeLayers(ws.skills, ss.skills)[k] === 'on'),
        disabledMcp: union(ws.mcp, ss.mcp),
        enabledMcp: Object.keys(mergeLayers(ws.mcp, ss.mcp)).filter((k) => mergeLayers(ws.mcp, ss.mcp)[k] === 'on'),
        workspaceOnly: { skills: normalizeOverrides(ws.skills), mcp: normalizeOverrides(ws.mcp) },
        sessionOnly: { skills: normalizeOverrides(ss.skills), mcp: normalizeOverrides(ss.mcp) },
      }
    }

    const explicit = typeof payload?.layerKey === 'string' ? payload.layerKey : ''
    const key = explicit !== '' ? explicit : norm(payload?.workspaceKey, 'ws:') || norm(payload?.sessionId, 'ss:')
    const row = this.layerOf(key)
    return {
      layerKey: key,
      disabledSkills: offNamesOf(row.skills),
      enabledSkills: onNamesOf(row.skills),
      disabledMcp: offNamesOf(row.mcp),
      enabledMcp: onNamesOf(row.mcp),
    }
  }

  /** 连接测试：独立握手。 */
  async testServer(payload) {
    const rows = await readMcpRows(this.patchPath())
    const row = rows.find((r) => r.serverName === payload.serverName)
    if (row === undefined) return { ok: false, toolCount: 0, elapsedMs: 0, error: 'patch 里找不到该 server' }
    return probeServer(row)
  }

  /** 自建服务器：只往自己的受管块写，块外内容逐字节不动。 */
  async addServer(payload) {
    const { upsertManagedServer } = await import('./managed.js')
    const result = await upsertManagedServer(this.patchPath(), payload)
    if (!result.ok) return result
    const state = await loadState(this.dshHome())
    state.mcp[payload.serverName] = {
      ...(state.mcp[payload.serverName] ?? {}),
      globalEnabled: true,
      builtin: true,
    }
    await saveState(this.dshHome(), state)
    return { ok: true, detail: result.detail }
  }

  /** 删除自建服务器（用户手写行拒绝删除）。 */
  async removeServer(payload) {
    const { removeManagedServer } = await import('./managed.js')
    return removeManagedServer(this.patchPath(), payload.serverName)
  }

  /** 调试：把当前判断结果吐出来（面板「诊断」按钮）。 */
  async diagnose() {
    const state = await loadState(this.dshHome())
    const roots = this.skillRoots()
    const { winners, shadowed } = await scanSkills(roots)
    return {
      dshHome: this.dshHome(),
      agentsHome: this.agentsHome(),
      profile: this.profileName(),
      patchPath: this.patchPath(),
      stateFile: statePath(this.dshHome()),
      skillRoots: roots,
      skillCount: winners.length,
      shadowed,
      disabledByRename: winners.filter((s) => s.disabledByRename).length,
      disabledByFrontmatter: winners.filter((s) => s.disabledByFrontmatter).length,
      mcpRows: (await readMcpRows(this.patchPath())).length,
      knownMcpTools: this.knownToolNames().filter((n) => serverOfTool(n) !== undefined).length,
      mountedAgents: this.listAgents().length,
      gateAlive: this.gate !== undefined,
      /** 会话级 skill 遮蔽：真的挂上了几个 agent —— P4 的可复核证据。 */
      shadowAlive: this.shadow !== undefined,
      shadowMountedAgents: this.shadow === undefined ? 0 : this.shadow.mounted.size,
      shadowMountedIds: this.shadow === undefined ? [] : [...this.shadow.mounted.keys()],
      globalDisabledMcp: [...this.globalDisabledMcp(state)],
      sessionOverrides: [...this.sessionOverrides.entries()].map(([k, v]) => ({
        sessionId: k,
        skills: v.skills ?? [],
        mcp: v.mcp ?? [],
      })),
    }
  }
}

// ── 插件入口 ──────────────────────────────────────────────────────────
export function apply(ctx) {
  const gateway = new SkillMcpHubGateway(ctx)

  /**
   * 装配清单：把「插件被加载了吗」拆成可复核的几项，写到
   * `<DSH_HOME>/skill-mcp-hub/last-load.json`。
   *
   * 为什么值得写：P1 第一次上线时浏览器端只报一句
   * `HTTP 404 for /api/skillMcpHub/list`，从外部看不出到底是
   * 「插件没加载」还是「加载了但 manifest 没登记」。有了这份清单，
   * 一条命令就能分清，不必靠猜。
   */
  const boot = {
    at: new Date().toISOString(),
    pid: process.pid,
    node: process.version,
    profile: gateway.profileName(),
    version: '0.1.0',
    typertRegistered: false,
    typertError: undefined,
    endpoints: [],
    gateReady: false,
  }

  const stampFile = join(gateway.dshHome(), 'skill-mcp-hub', 'last-load.json')
  const writeStamp = async () => {
    try {
      const { mkdir, writeFile } = await import('node:fs/promises')
      const { dirname } = await import('node:path')
      await mkdir(dirname(stampFile), { recursive: true })
      await writeFile(stampFile, JSON.stringify(boot, null, 2) + '\n', 'utf8')
    } catch (error) {
      warnOf(ctx, '写启动标记失败（不影响功能）：' + String(error))
    }
  }

  // **必须显式注册 manifest**，否则网关不认识 /api/skillMcpHub/* —— 浏览器端会收到
  // HTTP 404（不是路由写错，是 endpoint 压根没登记）。这条是 P1 实测踩出来的。
  try {
    ctx.effect(() => ctx.typert.register(HUB_MANIFEST), 'dsh-skill-mcp-hub: typert manifest')
    boot.typertRegistered = true
    boot.endpoints = HUB_MANIFEST.invocations.map((d) => `${d.namespace}/${d.method}`)
  } catch (error) {
    boot.typertRegistered = false
    boot.typertError = error !== null && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
    warnOf(ctx, 'typert manifest 注册失败（面板会 404）：' + boot.typertError)
  }
  void writeStamp()

  // 工具闸门：把「全局关 + 本会话额外关」翻译成 deny 列表，按 agent scope 施加。
  const gate = new ToolGateController(ctx, (agent) => {
    // resolveDeny 是同步的，state 用内存镜像（启动时读一次，改动时替换）
    return gateway.denyFor(agent, mirror.state)
  })
  gateway.gate = gate
  boot.gateReady = true

  /** state 的内存镜像：闸门是同步调用，不能每次 await 读盘。 */
  const mirror = { state: emptyState() }

  const refreshMirror = async () => {
    mirror.state = await loadState(gateway.dshHome())
    // 启动/重读时把持久化的会话层覆盖灌进内存（同步求值要用）
    gateway.hydrateOverlays(mirror.state)
    gate.syncAll()
    // 灌完要重施遮蔽，否则已挂的 provider 还是空集合
    try { gateway.shadow?.syncAll() } catch {}
  }

  // skill 的会话级遮蔽：挂在 agent 作用域上的 scoped provider，同名顶掉全局那条。
  // H1 已验（见 .diag/P0-探针结果-H1成立-20261110.md），只影响本会话、dispose 后自动恢复。
  const shadow = new SkillShadowController(ctx, (agent) => gateway.hiddenSkillsOf(agent, mirror.state))
  gateway.shadow = shadow


  /**
   * 给**已经存在**的 agent 补挂一次。
   *
   * 2026-11-11 实测的坑：插件只监听 `agent/created`，插件加载时**已经活着**的
   * 会话永远等不到那个事件 —— 遮蔽从没挂上，表现就是「开关点了、state 也写了、
   * 但技能清单纹丝不动」。
   */
  const attachExistingAgents = () => {
    let n = 0
    for (const agent of gateway.listAgents()) {
      if (agent === null || typeof agent !== 'object') continue
      try {
        gate.applyTo(agent)
        shadow.applyTo(agent)
        n += 1
      } catch (error) {
        warnOf(ctx, '给已有 agent 补挂遮蔽失败：' + String(error))
      }
    }
    return n
  }

  // 首次补挂放在读 state 之后（覆盖要先灌进内存），失败不影响启动
  void refreshMirror()
    .then(() => attachExistingAgents())
    .catch((error) => warnOf(ctx, '初始补挂失败：' + String(error)))

  ctx.on('agent/created', ({ agent }) => {
    gate.applyTo(agent)
    shadow.applyTo(agent)
  })

  ctx.on('agent/disposed', ({ agent }) => {
    const id = typeof agent?.id === 'string' ? agent.id : undefined
    if (id === undefined) return
    gate.release(id)
    shadow.release(id)
    // 只清**会话层**（ss:<id>）；工作区层（ws:<path>）是跨会话共享的，不能跟着删。
    const hadA = gateway.sessionOverrides.delete('ss:' + id)
    const hadB = gateway.sessionOverrides.delete(id) // 兼容旧的无前缀 key
    // 持久化层同步清掉，否则会话删了 state 里还留着孤儿条目
    if (hadA || hadB) void gateway.persistOverlays().catch(() => {})
  })

  ctx.effect(() => () => {
    gate.dispose()
    shadow.dispose()
    gateway.sessionOverrides.clear()
  }, 'skill-mcp-hub: teardown')

  // 暴露给面板：改完 state 后主动重施（否则要等下一次 tools/change）
  gateway.refreshFromDisk = refreshMirror

  return gateway
}

export { normalizeState }
export { normalizeOverrides, offNamesOf, onNamesOf, resolveHidden, setOverride, switchStateOf }




















