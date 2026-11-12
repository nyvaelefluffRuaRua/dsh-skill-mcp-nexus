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
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { strictCodec } from './codec.js'
import { emptyState, loadState, normalizeState, saveState, statePath } from './state.js'
import { scanSkills, setSkillEnabledGlobal } from './skills.js'
import {
  listWorkspaceShadows,
  setWorkspaceHidden,
  setWorkspaceVisible,
} from './workspace-layer.js'
import { readMcpRows, serverOfTool, toolsToDeny } from './mcp.js'
import { ToolGateController, warnOf } from './tool-gate.js'
import { SkillShadowController } from './skill-shadow.js'
import { probeServer } from './probe.js'
import { HUB_MANIFEST, NS as HUB_NS } from './manifest.js'
import { normalizeOverrides, offNamesOf, onNamesOf, resolveHidden, setOverride, switchStateOf } from './layers.js'

/**
 * **基类：多路径回退 + 桩类兜底**（2026-11-13）。
 *
 * 原来这是顶层静态 `import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'`。
 * 那个包只存在于宿主安装目录（`<app>/node_modules/`），**npm registry 上只有旧的
 * 0.1.0-rc.6，版本对不上装不了**，所以本机一直靠一条手工 junction 才能解析。
 *
 * 后果：pnpm 只要把那条 junction 当孤儿剪掉，静态 import 就在**模块求值第一行**
 * 抛 `ERR_MODULE_NOT_FOUND` ⇒ 插件启动即死 ⇒ 面板全挂且没有任何提示。
 * 2026-11-12 就是这么死的（另一个会话查了 13 分钟）。
 *
 * 现在按顺序试三条路，任何一条成功就用它：
 *   ① 裸包名 —— 走 node_modules 解析（junction 在就这条）
 *   ② 宿主真实绝对路径 —— **不依赖 junction**，pnpm 剪了也能用
 *   ③ 都不行 ⇒ 最小桩类顶上，插件照常加载
 *
 * 走 ③ 时 `typertRegistered` 会是 `false` + 原因写进 `last-load.json`：
 * **可诊断的降级，而不是静默猝死。** 工具闸门等其它功能不受影响。
 */
let TypertRemoteService = class {
  constructor(ctx, namespace) {
    this.ctx = ctx
    this.namespace = namespace
  }
}
let typertBaseError
/**
 * 依次尝试的候选来源。
 *
 * **不写死安装盘**：宿主的 Electron 主模块一定在 `process.execPath` 同目录，
 * 从它往上推 `<app>/node_modules`，所以 C 盘 / D 盘 / E 盘装都能用。
 *
 * 三路兜底，任一条能解析就行：
 *   ① 裸包名（junction 在时这条最快）
 *   ② `<execPath 目录>/node_modules/…`
 *   ③ `<execPath 目录>/resources/app/node_modules/…`（Electron 打包布局）
 *   ④ DSH_HOME 的自定义插件目录往上找（最后一道，防止 execPath 不可信）
 */
function hostModuleSpecs(pkg) {
  const specs = [pkg]
  const rel = 'node_modules/' + pkg.split('/').join('/')
  const guesses = []
  try {
    // process.execPath = <app>/DeepSeek Harness.exe（DSH 里）/ node.exe（独立 node）
    const exeDir = process.execPath.replace(/[\\/][^\\/]+$/, '')
    guesses.push(exeDir + '/' + rel)
    guesses.push(exeDir + '/resources/app/' + rel)
  } catch {}
  for (const abs of guesses) {
    try {
      specs.push(pathToFileURL(abs + '/lib/index.js').href)
    } catch {}
  }
  return specs
}
const TYPERT_CANDIDATES = hostModuleSpecs('@deepseek-ai/dsh-typert-protocol')
for (const spec of TYPERT_CANDIDATES) {
  try {
    const mod = await import(spec)
    if (process.env.HUB_TYPERT_DEBUG) {
      console.error('[hub] try', spec, '→ typeof =', typeof mod?.TypertRemoteService)
    }
    if (typeof mod?.TypertRemoteService === 'function') {
      TypertRemoteService = mod.TypertRemoteService
      typertBaseError = undefined
      break
    }
    typertBaseError = spec + ' 未导出 TypertRemoteService'
  } catch (error) {
    if (process.env.HUB_TYPERT_DEBUG) {
      console.error('[hub] fail', spec, String(error?.message ?? error).slice(0, 100))
    }
    typertBaseError = error !== null && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : String(error)
  }
}
if (process.env.HUB_TYPERT_DEBUG) {
  console.error('[hub] final base =', TypertRemoteService?.name, '| err =', typertBaseError)
}

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

  /**
   * 某工作区的 skill 根（`<projectRoot>/.dsh/skills`）。
   *
   * 与宿主 `dsh-skill-filesystem` 的 `roots()` 第一条同路径——
   * 这是 rank 100 的那一层，能盖住全局（rank 400）。
   *
   * @param workspacePath - 归一化后的工作区路径（`D:/DSH_Work/aa`）
   */
  wsSkillRootOf(workspacePath) {
    if (typeof workspacePath !== 'string' || workspacePath === '') return ''
    // 归一化用的是正斜杠，node 在 Windows 上两种都认，这里不转换
    return join(workspacePath, '.dsh', 'skills')
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
      if (typeof c === 'string' && c.trim() !== '') return 'ws:' + this.normalizeWorkspacePath(c)
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
    /**
     * key 迁移（2026-11-12 加）。
     *
     * `workspaceKeyOf` 现在产出**归一化**路径（`ws:D:/DSH_Work/aa`），而历史
     * 数据里存的是原始 cwd（`ws:D:\DSH_Work\aa`）。不迁移的话旧数据会变成
     * **孤儿层** —— 界面上看不到，但文件里还在，表现为「我配的覆盖不见了」。
     *
     * 规则：读入时把 `ws:` 键归一化；若归一后与已有键撞车，**做并集**（任一方
     * 关的就算关），与 `resolveHidden` 的并集语义一致，不丢任何一方的意图。
     */
    for (const [rawKey, row] of Object.entries(state?.sessionOverlays ?? {})) {
      let key = rawKey
      if (rawKey.startsWith('ws:')) {
        const norm = this.normalizeWorkspacePath(rawKey.slice(3))
        if (norm !== '') key = 'ws:' + norm
      }
      const skills = normalizeOverrides(row?.skills)
      const mcp = normalizeOverrides(row?.mcp)
      const prev = this.sessionOverrides.get(key)
      if (prev === undefined) {
        this.sessionOverrides.set(key, { skills, mcp })
      } else {
        // 撞车：并集，不丢任何一方
        this.sessionOverrides.set(key, {
          skills: normalizeOverrides({ ...prev.skills, ...skills }),
          mcp: normalizeOverrides({ ...prev.mcp, ...mcp }),
        })
      }
    }
    return this.sessionOverrides.size
  }

  /** 把内存 Map 写回 state 对象（调用方负责 saveState）。空层直接剔除。 */
  snapshotOverlays(state) {
    /**
     * **会话层的 MCP off 不落盘**（2026-11-13 第十六轮，主人要求）。
     *
     * 主人原话：「能不能把这个标注设计改到会话层里」
     * （背景：MCP 全局全开，但 skill 上还有 ⚠ —— 因为旧会话层记着 11 个 off）
     *
     * 语义上的道理：
     *   · **会话级本来就是临时的** —— 它表达"我这个会话暂时不用这个工具"，
     *     会话结束就该恢复默认，不该跟着磁盘天长地久。
     *   · 落盘会导致：几周前某个会话关过一次，今天的新会话读回来还带 ⚠，
     *     而全局明明是开着的 —— 用户完全无从理解这个警告从哪来。
     *   · **工作区层（`ws:`）仍然落盘** —— 那是持久配置，"这个项目不用 X"
     *     是长期意图，必须记住。
     *
     * ⇒ 规则：`ss:` 键只保留 `skills`，`mcp` 一律丢弃（内存里还在，本会话仍有效）。
     */
    const out = {}
    for (const [key, row] of this.sessionOverrides.entries()) {
      const skills = normalizeOverrides(row?.skills)
      const isSession = key.startsWith('ss:')
      // 会话层：mcp 一律不落盘；工作区层：照常保存
      const mcp = isSession ? {} : normalizeOverrides(row?.mcp)
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
    /**
     * 哪些 MCP **对当前查看者**是关的（2026-11-12 修）。
     *
     * 旧实现把 `state.sessionOverlays` 里**所有层**的 off 并起来 —— 后果是
     * 「A 会话关掉的 MCP，会让 B 会话的 skill 也带 ⚠」。而 ⚠ 的语义是
     * **「你要用的东西被关了」**，不是「有人在某处关过它」。
     *
     * 新实现与 `resolveHidden` 同一套语义，三层求值：
     *   · 全局关了       ⇒ 对谁都是关的
     *   · 本工作区关了   ⇒ 对本工作区所有会话是关的
     *   · 本会话关了     ⇒ 只对本会话是关的
     *   · **别的会话关了 ⇒ 不影响我**
     */
    const mcpOff = new Set()
    for (const name of patchServerNames) {
      if (state.mcp[name]?.globalEnabled === false) mcpOff.add(name)
    }
    {
      const viewerWs = this.currentWorkspaceKey()
      const viewerSs = this.currentSessionKey()
      for (const [key, row] of Object.entries(state.sessionOverlays ?? {})) {
        const layer = row?.mcp
        if (layer === undefined || layer === null) continue
        // 工作区层只认当前查看者的；会话层只认当前这个会话
        if (key.startsWith('ws:') && key !== viewerWs) continue
        if (key.startsWith('ss:') && key !== viewerSs) continue
        for (const name of Object.keys(layer)) mcpOff.add(name)
      }
    }


    /**
     * 先算工作区层（2026-11-12 重写）。
     *
     * 必须在构建 `skills` **之前**跑，因为每个 skill 行要带上 `hiddenIn`
     * （哪些工作区用壳遮住了它）。这是「状态回显与实际一致」的数据来源：
     * 判据是磁盘上有没有壳，不是内存里的 override。
     */
    const wsRows = await this.listWorkspaces()
    const wsShadows = new Map()
    for (const w of wsRows) {
      wsShadows.set(w.path, await listWorkspaceShadows(this.wsSkillRootOf(w.path)))
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
        /** 这是我们造的工作区壳，不是用户的真技能（前端据此不禁用开关）。 */
        isShadow: item.isShadow === true,
        /**
         * 不可用条目细分类型（2026-11-13 加）。
         * normal / forwarder / manual-only / author-off / disk-off / shadow
         * 前端据此把"永远点不亮"的分到折叠区并显示原因。
         */
        kind: item.kind ?? 'normal',
        why: item.why ?? '',
        bodyLength: item.bodyLength ?? 0,
        alias: meta.alias ?? '',
        note: meta.note ?? '',
        group: meta.group ?? '',
        /** 各层的显式覆盖：{ ws: {...}, ss: {...} }，供 UI 算三态。 */
        overrides: this.overridesFor(item.name, 'skills'),
        /**
         * 哪些工作区用壳遮住了它（2026-11-12 重写）。
         *
         * 与 `overrides` 的区别：`overrides` 是旧的遮蔽层记录（会话级还在用），
         * 这个是**磁盘事实**——工作区 `.dsh/skills/<name>/SKILL.md` 里带壳标记。
         * 界面按工作区视图显示状态时，应该看这个，不看 overrides。
         */
        hiddenIn: [...wsShadows.entries()]
          .filter(([, names]) => names.includes(item.name))
          .map(([path]) => path),
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
      /**
       * 每个工作区里**我们造的壳**（2026-11-12 重写）。
       *
       * 界面据此判断「这个 skill 在本工作区是开还是关」——
       * 判据不再是内存里的 override，而是**磁盘上有没有这个壳**。
       * 这就是「状态回显与实际一致」的实现方式。
       */
      workspaces: wsRows.map((w) => ({ ...w, shadows: wsShadows.get(w.path) ?? [] })),
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
  /**
   * 归一化工作区路径 → 层 key（2026-11-12 修「改别的层影响 aa」）。
   *
   * `agent.cwd` 可能是 `D:\DSH_Work\aa`，而 state 里存的是
   * `ws:D:\DSH_Work\aa` —— 若来源不同（正/反斜杠、大小写、尾斜杠）
   * 就会变成**两个不同的 key**，表现为「改了这层，那层不动」。
   *
   * 归一规则（Windows 语义）：
   *   · 反斜杠统一成正斜杠
   *   · 去掉尾部斜杠
   *   · 盘符字母统一大写（Windows 路径不分大小写）
   */
  normalizeWorkspacePath(p) {
    if (typeof p !== 'string') return ''
    let v = p.trim()
    if (v === '') return ''
    v = v.split(String.fromCharCode(92)).join('/')
    if (/^[a-zA-Z]:/.test(v)) v = v[0].toUpperCase() + v.slice(1)
    if (v.length > 3 && v.endsWith('/')) v = v.replace(/\/+$/, '')
    return v
  }

  /** 当前查看者的工作区层 key（`ws:<归一化路径>`，可能为空）。 */
  currentWorkspaceKey() {
    const p = this.currentWorkspacePath()
    return p === '' ? '' : 'ws:' + this.normalizeWorkspacePath(p)
  }

  /** 当前查看者的会话层 key（`ss:<id>`，可能为空）。 */
  currentSessionKey() {
    for (const agent of this.listAgents()) {
      if (agent === null || typeof agent !== 'object') continue
      if (typeof agent.id === 'string' && agent.id !== '') return 'ss:' + agent.id
    }
    return ''
  }

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
        /**
         * **归一化后再当 Map 键**（2026-11-12 第三轮修）。
         *
         * 原来直接 slice(3) 当键，而下面 ② 从会话读出的 cwd 是**原始**路径
         * （`D:\DSH_Work\aa`）。两来源斜杠/大小写不同 ⇒ 同一工作区被当成两个
         * ⇒ 界面重复出现「aa」「DSH_Work」「default-workspace」各两行。
         */
        const path = this.normalizeWorkspacePath(key.slice(3))
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
          // 同一个原因：会话里的 cwd 是原始路径，必须先归一化再当键
          const normPath = this.normalizeWorkspacePath(path)
          if (normPath !== '' && !seen.has(normPath)) seen.set(normPath, { path: normPath, source: 'session' })
          break // 同一个 slug 只要一个
        }
      }
    } catch {}

    // current 也归一化后比，否则「当前」标签永远标不上（原始 vs 归一化对不上）
    const current = this.normalizeWorkspacePath(this.currentWorkspacePath())
    const list = [...seen.values()].map((w) => ({ ...w, current: w.path === current }))
    list.sort((a, b) => (a.current === b.current ? a.path.localeCompare(b.path) : a.current ? -1 : 1))
    return list
  }

  /** 全局启停。skill 改磁盘标记，MCP 改 state + 重施闸门。 */
  async toggle(payload) {
    const state = await loadState(this.dshHome())
    /**
     * **layerKey 归一化（2026-11-12 第二轮修）**。
     *
     * 上一轮只在**读**侧（`workspaceKeyOf` / `hydrateOverlays`）做了归一化，
     * **写**侧漏了 —— 前端传来的 `ws:D:\\DSH_Work\\aa`（原始 cwd）被原样当 Map 键，
     * 于是同一工作区在内存里存在两个 key：
     *   · `hydrateOverlays` 建的是 `ws:D:/DSH_Work/aa`（归一化过的）
     *   · `toggle` 写的是 `ws:D:\\DSH_Work\\aa`（原始的）
     * ⇒ `snapshotOverlays` 落盘时两个都写，`listWorkspaces` 里出现两条同路径，
     *   界面上在一处改了开关、另一处看着不动 = 主人报的「改别的层影响 aa」。
     *
     * 归一化放在**入口**，所有下游（skill / mcp 两条分支）一起受益。
     */
    if (typeof payload?.layerKey === 'string' && payload.layerKey.startsWith('ws:')) {
      const norm = this.normalizeWorkspacePath(payload.layerKey.slice(3))
      payload = { ...payload, layerKey: norm === '' ? payload.layerKey : 'ws:' + norm }
    }

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
      /**
       * ── 局部层：skill 走**文件位置**（2026-11-12 重写）───────────────
       *
       * 旧实现把 skill 的局部开关也记进 `sessionOverrides` 的遮蔽层，
       * 实测三个硬伤（见 workspace-layer.js 头部注释）：
       *   · 全局关掉的，工作区**开不回来**
       *   · 层是空的时候开关全灰，看着"只能看不能改"
       *   · 要自己造宿主里不存在的状态
       *
       * 新做法：
       *   · **`ws:` 层** ⇒ 在工作区 `.dsh/skills/<name>/` 造一个带
       *     `disable-model-invocation: true` 的壳。宿主 rank 100 盖过全局
       *     400，模型就看不到它了。删壳 = 恢复。**不复制实体、不删原件。**
       *   · **`ss:` 层**（会话级）⇒ 保留原遮蔽逻辑。会话是运行时概念，
       *     没有对应的磁盘位置，遮蔽是唯一实现方式。
       */
      if (typeof payload.layerKey === 'string' && payload.layerKey !== '') {
        const isSkill = payload.kind !== 'mcp'
        const isWorkspaceLayer = payload.layerKey.startsWith('ws:')

        // ── skill + 工作区层：直接改磁盘 ──
        if (isSkill && isWorkspaceLayer) {
          const wsPath = payload.layerKey.slice(3)
          const wsRoot = this.wsSkillRootOf(wsPath)
          if (wsRoot === '') return { ok: false, detail: '工作区路径为空' }

          // 关的时候要带上 description，壳在列表里才不至于一片空白
          let desc = ''
          if (payload.enabled === false) {
            const { winners } = await scanSkills(this.skillRoots())
            const found = winners.find((item) => item.name === payload.name)
            desc = found?.description ?? ''
          }

          const result =
            payload.enabled === false
              ? await setWorkspaceHidden(wsRoot, payload.name, desc)
              : await setWorkspaceVisible(wsRoot, payload.name)

          // 改完清掉旧遮蔽层里对这条的残留（迁移期兼容）
          const cleared = this.clearOverridesEverywhere(payload.name)
          if (cleared.length > 0) await this.persistOverlays()

          // 让宿主重新扫描（watcher 可能有时延，主动推一次）
          try { this.shadow?.syncAll() } catch {}

          if (result.changed === false) {
            // 不报错，但要如实说为什么没动
            return { ok: true, detail: result.reason }
          }
          return { ok: true, detail: payload.enabled === false ? 'hidden' : 'visible' }
        }

        // ── 其余（会话层 skill / 所有层 MCP）：保留原遮蔽逻辑 ──
        const row = this.sessionOverrides.get(payload.layerKey) ?? { skills: [], mcp: [] }
        if (payload.kind === 'mcp') {
          row.mcp = setOverride(row.mcp, payload.name, payload.enabled === false ? false : null)
        } else {
          row.skills = setOverride(row.skills, payload.name, payload.enabled === false ? false : null)
        }
        this.sessionOverrides.set(payload.layerKey, row)
        await this.persistOverlays()
        try { this.shadow?.syncAll() } catch {}
        try {
          if (payload.layerKey.startsWith('ss:')) {
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

      /**
       * **关 MCP 时同步关掉依赖它的 skill**（2026-11-13 第二十轮，主人要求）。
       *
       * 主人原话：「会话层里**关 mcp 时会把其对应的 skill 同步关了**，
       *           **但 skill 不会反过来影响**」
       *
       * 方向是**单向**的：
       *   · 关 MCP ⇒ 把它服务的 skill 也关掉（那些 skill 依赖它，留着也跑不起来）
       *   · 关 skill ⇒ **不动 MCP**（skill 只是使用者，关它不影响 MCP 本身）
       *
       * 依赖关系来自 `scanSkillMcpRefs`（扫 SKILL.md 正文提到的 MCP 名）。
       * 只在**关闭**方向做同步；开启时不动 skill——用户可能只是想让 MCP 回来。
       */
      const affectedSkills = []
      if (payload.enabled === false) {
        try {
          const patchRows = await readMcpRows(this.patchPath())
          const serverNames = patchRows.map((r) => r.serverName).filter((n) => typeof n === 'string' && n !== '')
          const refs = await scanSkillMcpRefs(this.skillRoots(), serverNames)
          const dependents = refs[payload.name] ?? []
          for (const skillName of dependents) {
            const next = setOverride(row.skills, skillName, false)
            // 只有真的变了才记（避免无谓刷盘）
            if (JSON.stringify(next) !== JSON.stringify(normalizeOverrides(row.skills))) {
              row.skills = next
              affectedSkills.push(skillName)
            }
          }
        } catch (e) {
          warnOf(this.ctx, '同步关闭依赖 skill 失败：' + String(e))
        }
      }

      this.sessionOverrides.set(payload.layerKey, row)
      await this.persistOverlays()
      try { this.resyncGate() } catch {}
      try { this.shadow?.syncAll() } catch {}
      return {
        ok: true,
        detail: payload.enabled === false ? 'hidden' : 'unhidden',
        affectedSkills,
      }
    }

    const meta = state.mcp[payload.name] ?? {}
    state.mcp[payload.name] = { ...meta, globalEnabled: payload.enabled === true }
    await saveState(this.dshHome(), state)
    /**
     * **不清下层残留**（2026-11-12 修，主人报「侧边栏影响会话」）。
     *
     * 旧实现对 MCP 也调 `clearOverridesEverywhere` —— 后果是「在侧边栏把某个
     * MCP 的全局开关拨一下，所有会话层里对它的小开关意见全被擦掉」。
     *
     * 语义上站不住：skill 的全局关是**磁盘改名**，文件都没了，下层 off 自然
     * 失去对象（该清）；但 **MCP 没有磁盘动作**，全局只是运行时 restrict，
     * 会话层的「我这个会话不要用它」是独立有意义的意图，不该被抹。
     *
     * 全局开启后，原本被会话藏住的仍会被 hide —— 想恢复就在那个会话里点开，
     * 这是一次明确的操作，比"悄悄擦掉你的设置"可预期。
     */
    const cleared = []
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
    /** 基类有没有真加载到（2026-11-13 加）。false ⇒ 用的是桩类，面板会 404。 */
    typertBaseOk: typertBaseError === undefined,
    typertBaseError,
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

  /**
   * **基类没加载到就先喊一声**（2026-11-13）。
   *
   * 桩类能保证插件活着，但 `extends 桩` 意味着网关不认识我们的方法，
   * 面板必然 404。这时候最要紧的是**把原因直接打出来**，
   * 而不是让排查的人对着一句 `HTTP 404` 猜半天。
   */
  if (typertBaseError !== undefined) {
    warnOf(
      ctx,
      '@deepseek-ai/dsh-typert-protocol 解析失败，面板功能会 404（其它功能不受影响）。' +
        '多半是 node_modules 里那条指向宿主自带的 junction 被 pnpm 剪掉了。原因：' +
        typertBaseError,
    )
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





















