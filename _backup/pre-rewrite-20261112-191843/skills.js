/**
 * dsh-skill-mcp-hub —— skill 扫描与启停标记
 *
 * 宿主只扫「目录里有 SKILL.md」的那些条目（`dsh-skill-filesystem` 的行为），
 * 所以本机两种停用姿势的表现完全不同：
 *
 *   1. `SKILL.md.disabled`（改名法，本机 20 个在用它）——宿主扫不到，等于停用；
 *      **但宿主本身并不认这个后缀**，它是靠"没有 SKILL.md"这个副作用生效的。
 *   2. frontmatter `disable-model-invocation: true`（本机 6 个）——宿主认，
 *      扫得到但不进模型目录。
 *
 * 所以判断"这个条目现在是否对模型可用"必须**两个条件都为假**：
 *   有 SKILL.md（没被改名） 且 frontmatter 没写 disable-model-invocation。
 *
 * 写的时候只用改名法（`.disabled`）：不碰用户的 frontmatter，可无损还原，
 * 且对宿主来说等价。
 */
import { readdir, readFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** 一个技能根：path + 展示名 + 优先级（与宿主 rank 同序，小的优先）。 */
export const SKILL_ROOTS = [
  { key: 'project-dsh', label: '项目 .dsh', rank: 100 },
  { key: 'project-agents', label: '项目 .agents', rank: 200 },
  { key: 'user-dsh', label: '用户 .dsh', rank: 400 },
  { key: 'user-agents', label: '用户 .agents', rank: 500 },
]

/** 从 frontmatter 里抽一个顶层标量字段（不引 yaml 依赖，够用即可）。 */
function frontmatterField(text, key) {
  if (!text.startsWith('---')) return undefined
  const end = text.indexOf('\n---', 3)
  if (end === -1) return undefined
  const head = text.slice(3, end)
  const re = new RegExp('^' + key.replace(/[-]/g, '\\-') + '\\s*:\\s*(.*)$', 'm')
  const m = head.match(re)
  if (m === null) return undefined
  return m[1].trim().replace(/^["']|["']$/g, '')
}

/** 读一个技能条目的元信息；两种文件名都认。 */
async function readEntry(dir) {
  // 优先 SKILL.md，其次 SKILL.md.disabled
  let disabledByRename = false
  let file = join(dir, 'SKILL.md')
  try {
    await stat(file)
  } catch {
    file = join(dir, 'SKILL.md.disabled')
    try {
      await stat(file)
      disabledByRename = true
    } catch {
      return undefined
    }
  }
  let text = ''
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return undefined
  }
  const disableModel = frontmatterField(text, 'disable-model-invocation')
  const byFrontmatter = disableModel === 'true'
  return {
    file,
    description: frontmatterField(text, 'description') ?? '',
    disabledByRename,
    disabledByFrontmatter: byFrontmatter,
    /** 对模型可用 = 没改名、且 frontmatter 没禁用。 */
    enabled: disabledByRename === false && byFrontmatter === false,
  }
}

/** 扫一个根，返回该根下的条目数组。根不存在时返回空数组（本机工作区技能根就不存在）。 */
async function scanRoot(root) {
  const out = []
  let entries
  try {
    entries = await readdir(root.path, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.isDirectory() === false) continue
    if (entry.name === '.system') continue
    const dir = join(root.path, entry.name)
    const meta = await readEntry(dir)
    if (meta === undefined) continue
    out.push({
      name: entry.name,
      root: root.key,
      rootLabel: root.label,
      rank: root.rank,
      dir,
      ...meta,
    })
  }
  return out
}

/**
 * 扫全部根并按名字去重（rank 小的胜出，与宿主一致）。
 * @param {string[]} roots 已解析好的根路径列表（顺序对应 SKILL_ROOTS）
 */
export async function scanSkills(rootPaths) {
  const all = []
  for (let i = 0; i < SKILL_ROOTS.length; i += 1) {
    const p = rootPaths[i]
    if (typeof p !== 'string' || p === '') continue
    const items = await scanRoot({ ...SKILL_ROOTS[i], path: p })
    all.push(...items)
  }
  all.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
  const seen = new Set()
  const winners = []
  for (const item of all) {
    if (seen.has(item.name)) continue
    seen.add(item.name)
    winners.push(item)
  }
  winners.sort((a, b) => a.name.localeCompare(b.name))
  return { winners, shadowed: all.length - winners.length, total: all.length }
}

/**
 * 全局启停：改名。启用 = SKILL.md.disabled → SKILL.md；
 * 停用 = SKILL.md → SKILL.md.disabled。
 * 已经是目标状态时直接返回，避免无谓的文件系统抖动。
 */
export async function setSkillEnabledGlobal(dir, enabled) {
  const on = join(dir, 'SKILL.md')
  const off = join(dir, 'SKILL.md.disabled')
  if (enabled) {
    try {
      await stat(off)
    } catch {
      return { changed: false, reason: 'already-enabled' }
    }
    await rename(off, on)
    return { changed: true }
  }
  try {
    await stat(on)
  } catch {
    return { changed: false, reason: 'already-disabled' }
  }
  await rename(on, off)
  return { changed: true }
}


