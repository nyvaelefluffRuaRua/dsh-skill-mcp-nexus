/**
 * dsh-skill-mcp-nexus —— 状态存储
 *
 * 唯一真源：`<DSH_HOME>/skill-mcp-nexus/state.json`。
 * **旧路径 `<DSH_HOME>/skill-mcp-hub/` 会自动迁移过来**（2026-11-13 改名时加），
 * 见 `ensureStateDir()`：新路径不存在、旧路径存在时整目录 rename 过去。
 * 这样老用户升级不会丢别名/备注/分组/开关。
 *
 * 用 tmp + rename 原子写；Windows 上 rename 覆盖已存在文件可能 EPERM/EACCES，
 * 退化成直接写（与 dsh-skill-mcp-panel 的成熟写法一致）。
 *
 * 结构：
 * {
 *   version: 1,
 *   skills: { "<skillName>": { alias, note, group, globalEnabled } },
 *   groups: [ { id, name, color } ],
 *   mcp:    { "<serverName>": { alias, note, globalEnabled, builtin } }
 * }
 *
 * 会话级的"关闭集合"不进这里 —— 那是运行时临时状态，随 agent 生命周期走，
 * 落盘只会让"上一次会话关掉的"污染"下一次会话"。见 host 的 sessionOverrides。
 */
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const STATE_VERSION = 1

/** 当前状态目录名（跟包名走）。 */
export const STATE_DIR = 'skill-mcp-nexus'
/** 改名前的旧目录名 —— 只用于一次性迁移，新代码不再写这里。 */
export const LEGACY_STATE_DIR = 'skill-mcp-hub'

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/** 这次启动有没有从旧目录迁过来（供 last-load.json 展示）。 */
let migratedFrom
export function stateMigratedFrom() {
  return migratedFrom
}

/**
 * 首次调用时做一次目录迁移。
 *
 * 用 `rename` 而不是复制：同盘原子，中途失败不留半个目录。
 * 跨盘抛 `EXDEV` 时放弃搬运——`loadState` 会回退到旧路径读取，功能不受影响。
 */
export async function ensureStateDir(dshHome) {
  const next = join(dshHome, STATE_DIR)
  const prev = join(dshHome, LEGACY_STATE_DIR)
  if (await exists(next)) return
  if (!(await exists(prev))) {
    await mkdir(next, { recursive: true })
    return
  }
  try {
    await rename(prev, next)
    migratedFrom = LEGACY_STATE_DIR
  } catch {
    // 跨盘或占用：不搬，读的时候回退旧路径
  }
}

/**
 * 状态文件路径。`dshHome` 由调用方传入（宿主 homePaths 或 $DSH_HOME）。
 *
 * 同步函数没法 await 迁移，所以迁移由 `loadState` / `saveState` 负责。
 */
export function statePath(dshHome) {
  return join(dshHome, STATE_DIR, 'state.json')
}

/** 旧路径 —— 只在迁移失败时兜底读。 */
export function legacyStatePath(dshHome) {
  return join(dshHome, LEGACY_STATE_DIR, 'state.json')
}

/** 空状态。 */
export function emptyState() {
  // sessionOverlays: { '<层key>': { skills: {名:'off'}, mcp: {名:'off'} } }
  // 2026-11-11 加：会话层原来只存内存，重启就清零，用户会看到「关了又自己开」。
  return { version: STATE_VERSION, skills: {}, groups: [], mcp: {}, sessionOverlays: {} }
}

/** 把任意读到的对象收敛成合法状态（字段缺失/类型错误一律按默认补）。 */
export function normalizeState(raw) {
  const base = emptyState()
  if (raw === null || typeof raw !== 'object') return base
  const out = base

  // 会话/工作区层覆盖（漂移容忍：坏数据直接跳过，不阻塞整体）
  if (raw.sessionOverlays !== null && typeof raw.sessionOverlays === 'object') {
    for (const [key, row] of Object.entries(raw.sessionOverlays)) {
      if (typeof key !== 'string' || key === '') continue
      if (row === null || typeof row !== 'object') continue
      const clean = {}
      for (const field of ['skills', 'mcp']) {
        const src = row[field]
        if (src === null || typeof src !== 'object' || Array.isArray(src)) continue
        const obj = {}
        for (const [name, v] of Object.entries(src)) {
          if (typeof name === 'string' && name !== '' && v === 'off') obj[name] = 'off'
        }
        if (Object.keys(obj).length > 0) clean[field] = obj
      }
      if (Object.keys(clean).length > 0) out.sessionOverlays[key] = clean
    }
  }

  if (raw.skills !== null && typeof raw.skills === 'object') {
    for (const [name, value] of Object.entries(raw.skills)) {
      if (typeof name !== 'string' || name === '') continue
      if (value === null || typeof value !== 'object') continue
      out.skills[name] = {
        alias: typeof value.alias === 'string' ? value.alias : '',
        note: typeof value.note === 'string' ? value.note : '',
        group: typeof value.group === 'string' ? value.group : '',
        globalEnabled: value.globalEnabled !== false,
      }
    }
  }

  if (Array.isArray(raw.groups)) {
    for (const g of raw.groups) {
      if (g === null || typeof g !== 'object') continue
      if (typeof g.id !== 'string' || g.id === '') continue
      out.groups.push({
        id: g.id,
        name: typeof g.name === 'string' ? g.name : g.id,
        color: typeof g.color === 'string' ? g.color : '',
      })
    }
  }

  if (raw.mcp !== null && typeof raw.mcp === 'object') {
    for (const [name, value] of Object.entries(raw.mcp)) {
      if (typeof name !== 'string' || name === '') continue
      if (value === null || typeof value !== 'object') continue
      out.mcp[name] = {
        alias: typeof value.alias === 'string' ? value.alias : '',
        note: typeof value.note === 'string' ? value.note : '',
        globalEnabled: value.globalEnabled !== false,
        builtin: value.builtin === true,
      }
    }
  }

  return out
}

/**
 * 读状态；文件缺失或损坏一律回落空状态（最坏情况只是配置丢失，不阻断启动）。
 *
 * 顺序：先确保目录（会做一次性迁移）→ 读新路径 → 读不到再试旧路径。
 * 旧路径兜底是给"跨盘迁移失败"留的后路，正常情况走不到。
 */
export async function loadState(dshHome) {
  try {
    await ensureStateDir(dshHome)
  } catch {}
  for (const path of [statePath(dshHome), legacyStatePath(dshHome)]) {
    try {
      return normalizeState(JSON.parse(await readFile(path, 'utf8')))
    } catch {}
  }
  return emptyState()
}

/** 原子写状态。 */
export async function saveState(dshHome, state) {
  try {
    await ensureStateDir(dshHome)
  } catch {}
  const path = statePath(dshHome)
  await mkdir(dirname(path), { recursive: true })
  const text = JSON.stringify(normalizeState(state), null, 2) + '\n'
  const temp = path + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8)
  await writeFile(temp, text, 'utf8')
  try {
    await rename(temp, path)
  } catch (error) {
    const code = error !== null && typeof error === 'object' ? error.code : ''
    if (!['EPERM', 'EEXIST', 'EACCES'].includes(code ?? '')) throw error
    // Windows 覆盖失败：退化为直接写（仍比半截文件强）。
    await writeFile(path, text, 'utf8')
  }
}

