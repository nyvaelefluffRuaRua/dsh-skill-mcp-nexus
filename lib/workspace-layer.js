/**
 * dsh-skill-mcp-hub —— 工作区层（文件位置即唯一真源）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么不用「遮蔽层 / override」（2026-11-12 重写）
 * ══════════════════════════════════════════════════════════════════
 *
 * 旧方案在内存里维护 `global` / `ws:X` / `ss:Y` 三层 off 集合，运行时遮蔽。
 * 实测它做不到三件事：
 *   · 全局关掉的 skill，工作区**开不回来**（磁盘文件已改名 .disabled，
 *     宿主扫不到，遮蔽没有对象）
 *   · 工作区层是空的时候，所有开关算出来都是 `on` ⇒ 按钮全灰，
 *     看起来"只能看不能改"
 *   · 需要自己造一个宿主里不存在的状态（"B 工作区的配置"），
 *     而宿主 `roots(cwd)` 只吃一个 cwd
 *
 * ══════════════════════════════════════════════════════════════════
 * 新方案：让文件位置说话
 * ══════════════════════════════════════════════════════════════════
 *
 * 宿主（`dsh-skill-filesystem` + `dsh-skill`）的真实规则，逐条实测：
 *
 *  1. `roots(cwd)` 扫：`<projectRoot>/.dsh/skills`(rank 100)
 *                    → `<projectRoot>/.agents/skills`(200)
 *                    → `<dshHome>/skills`(400)
 *                    → `<agentsHome>/skills`(500)
 *
 *  2. **rank 小者胜**（`compareIndexedCandidates`: `left.rank - right.rank`）
 *     ⇒ 工作区同名自动盖过全局，不需要任何遮蔽代码。
 *
 *  3. **去重按 frontmatter 的 `name`，不是目录名**（`collectLayer` 里
 *     `seen.has(skill.name)`）。所以「壳」必须写同一个 name。
 *
 *  4. `parseSkillFile` 要求 frontmatter 有 `name` + `description`，
 *     差一个就 `return undefined`，条目**根本不进候选**
 *     ⇒ 空壳（没有 SKILL.md）遮不住任何东西，必须有合法 SKILL.md。
 *
 *  5. `disable-model-invocation: true` → `modelInvocable=false`，
 *     条目**仍在列表里**，只是模型调不到。
 *
 * 于是：
 *
 *   · **工作区「关」某 skill** = 在 `<ws>/.dsh/skills/<name>/SKILL.md`
 *     写一个 frontmatter 壳，带 `disable-model-invocation: true`。
 *     rank 100 赢过 400，模型就看到这个禁用的版本 ⇒ 等于关掉。
 *
 *   · **工作区「开」某 skill** = 删掉壳，回落到全局那份。
 *
 *   · **全局开/关** = 沿用改名法（SKILL.md ↔ SKILL.md.disabled），不改。
 *
 * 好处：零复制、零软链、零 junction —— 不占空间、不需要管理员权限、
 * 误删最多解除遮蔽而不丢原件、重启刷新天然持久、宿主升级也认（用的
 * 全是宿主自己的 frontmatter 字段）。
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 壳里写的标记行，用来识别"这个目录是我们造的壳"而不是用户真技能。 */
export const SHADOW_MARKER = 'dsh-skill-mcp-hub:workspace-shadow'

/**
 * 造一个壳的 SKILL.md 文本。
 *
 * frontmatter 必须有 `name` + `description`（宿主硬要求），
 * 正文写一句人话，万一用户点进来能看懂这是什么。
 *
 * @param name - 被遮蔽的 skill 名（必须与全局那份**完全一致**）
 * @param description - 沿用全局那份的 description，保持列表里可读
 */
export function shadowSkillText(name, description) {
  const desc = typeof description === 'string' && description !== '' ? description : '在工作区中被停用'
  // YAML 里冒号/引号容易坏，统一走双引号并把内部双引号转义
  const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
  return [
    '---',
    `name: ${name}`,
    `description: ${q(desc)}`,
    'disable-model-invocation: true',
    '---',
    '',
    `<!-- ${SHADOW_MARKER} -->`,
    '',
    '这个 skill 在**当前工作区**被停用。',
    '',
    '在本工作区里它只是占位：宿主按 rank 取到了这一份（工作区 rank 100 高于全局 rank 400），',
    '而这一份声明了 `disable-model-invocation: true`，所以模型看不到它。',
    '',
    '想在本工作区恢复：在 skill 面板里把它打开（会删掉这个占位）。',
    '想全局停用：在「全局」层关掉它。',
    '',
  ].join('\n')
}

/** 读一个目录里 SKILL.md 的 frontmatter name（读不到返回 undefined）。 */
export async function readSkillName(dir) {
  let text
  try {
    text = await readFile(join(dir, 'SKILL.md'), 'utf8')
  } catch {
    return undefined
  }
  if (!text.startsWith('---')) return undefined
  const end = text.indexOf('\n---', 3)
  if (end === -1) return undefined
  const head = text.slice(3, end)
  const m = /^name\s*:\s*(.*)$/m.exec(head)
  if (m === null) return undefined
  return m[1].trim().replace(/^["']|["']$/g, '')
}

/** 这个目录是不是我们造的壳（判据 = 正文里有标记）。 */
export async function isShadowDir(dir) {
  try {
    const text = await readFile(join(dir, 'SKILL.md'), 'utf8')
    return text.includes(SHADOW_MARKER)
  } catch {
    return false
  }
}

/**
 * 工作区层：让某个 skill 在本工作区不可见。
 *
 * @param wsSkillRoot - `<projectRoot>/.dsh/skills`
 * @param name - skill 名（与全局那份一致）
 * @param description - 沿用全局的 description
 * @returns `{ changed, reason }`
 */
export async function setWorkspaceHidden(wsSkillRoot, name, description) {
  if (typeof wsSkillRoot !== 'string' || wsSkillRoot === '') {
    return { changed: false, reason: 'no-workspace-root' }
  }
  const dir = join(wsSkillRoot, name)
  const file = join(dir, 'SKILL.md')

  // 已经是壳了就别重复写（避免每次点都刷盘）
  if (await isShadowDir(dir)) return { changed: false, reason: 'already-hidden' }

  // 目录里已经有**用户自己的**同名 skill ⇒ 不覆盖，如实告知
  let exists = false
  try {
    await stat(file)
    exists = true
  } catch {}
  if (exists) return { changed: false, reason: 'workspace-has-own-skill' }

  await mkdir(dir, { recursive: true })
  await writeFile(file, shadowSkillText(name, description), 'utf8')
  return { changed: true, reason: 'hidden' }
}

/**
 * 工作区层：恢复某个 skill 在本工作区可见（删掉壳）。
 *
 * 只删**自己造的壳**，用户自己的同名 skill 一个字节都不动。
 */
export async function setWorkspaceVisible(wsSkillRoot, name) {
  if (typeof wsSkillRoot !== 'string' || wsSkillRoot === '') {
    return { changed: false, reason: 'no-workspace-root' }
  }
  const dir = join(wsSkillRoot, name)
  if (!(await isShadowDir(dir))) {
    // 不是壳：要么本来就没有（已跟随全局），要么是用户的技能（不能碰）
    let has = false
    try {
      await stat(join(dir, 'SKILL.md'))
      has = true
    } catch {}
    return { changed: false, reason: has ? 'workspace-own-skill-kept' : 'already-visible' }
  }
  await rm(dir, { recursive: true, force: true })
  return { changed: true, reason: 'visible' }
}

/** 列出某工作区里我们造的壳（名字数组）。 */
export async function listWorkspaceShadows(wsSkillRoot) {
  const out = []
  if (typeof wsSkillRoot !== 'string' || wsSkillRoot === '') return out
  let entries
  try {
    entries = await readdir(wsSkillRoot, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(wsSkillRoot, entry.name)
    if (await isShadowDir(dir)) {
      const n = await readSkillName(dir)
      out.push(n !== undefined ? n : entry.name)
    }
  }
  return out
}
