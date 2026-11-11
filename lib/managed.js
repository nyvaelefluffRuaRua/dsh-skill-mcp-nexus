/**
 * dsh-skill-mcp-hub —— 自建 MCP 服务器的受管块
 *
 * 规则和 dsh-skill-mcp-panel 一致，但用自己的标记：
 *
 *   # >>> dsh-skill-mcp-hub:mcp:begin
 *   ...只放本插件加的行...
 *   # <<< dsh-skill-mcp-hub:mcp:end
 *
 * **块外的一切逐字节保留**——用户那 11 个手写行一个字节都不动。
 * 删除只允许删本插件加的行（id 前缀 `mcp-hub-`），用户手写行一律拒绝。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const BEGIN = '# >>> dsh-skill-mcp-hub:mcp:begin'
const END = '# <<< dsh-skill-mcp-hub:mcp:end'
const ID_PREFIX = 'mcp-hub-'

/** 生成一行 MCP 配置（YAML 缩进与宿主 patch 的既有风格一致）。 */
function renderRow(input) {
  const id = ID_PREFIX + input.serverName
  const lines = []
  lines.push(`    - id: ${id}`)
  lines.push(`      name: '@deepseek-ai/dsh-mcp-client'`)
  lines.push(`      config:`)
  if (input.transport === 'streamable-http') {
    lines.push(`        transport: streamable-http`)
    lines.push(`        serverName: ${input.serverName}`)
    lines.push(`        url: ${JSON.stringify(input.url ?? '')}`)
    const headers = input.headers ?? {}
    if (Object.keys(headers).length > 0) {
      lines.push(`        headers:`)
      for (const [k, v] of Object.entries(headers)) lines.push(`          ${k}: ${JSON.stringify(v)}`)
    }
  } else {
    lines.push(`        transport: stdio`)
    lines.push(`        serverName: ${input.serverName}`)
    lines.push(`        command: ${JSON.stringify(input.command ?? '')}`)
    const args = input.args ?? []
    if (args.length > 0) {
      lines.push(`        args:`)
      for (const a of args) lines.push(`          - ${JSON.stringify(a)}`)
    } else {
      lines.push(`        args: []`)
    }
    const env = input.env ?? {}
    if (Object.keys(env).length > 0) {
      lines.push(`        env:`)
      for (const [k, v] of Object.entries(env)) lines.push(`          ${k}: ${JSON.stringify(v)}`)
    }
    if (typeof input.cwd === 'string' && input.cwd !== '') {
      lines.push(`        cwd: ${JSON.stringify(input.cwd)}`)
    }
  }

  // ── 运行时参数（两种 transport 都有，宿主确实支持）──────────────────
  // 只在显式填了、且不等于宿主默认值时才写 —— 否则受管块白白变长。
  if (typeof input.toolCallTimeoutMs === 'number' && Number.isFinite(input.toolCallTimeoutMs) && input.toolCallTimeoutMs !== 60000) {
    lines.push(`        toolCallTimeoutMs: ${Math.trunc(input.toolCallTimeoutMs)}`)
  }
  if (input.failOnStartupError === true) {
    lines.push(`        failOnStartupError: true`)
  }
  const rc = input.reconnect
  if (rc !== null && typeof rc === 'object') {
    const rcLines = []
    if (rc.enabled === false) rcLines.push('          enabled: false')
    if (typeof rc.initialDelayMs === 'number' && Number.isFinite(rc.initialDelayMs) && rc.initialDelayMs !== 500) {
      rcLines.push(`          initialDelayMs: ${Math.trunc(rc.initialDelayMs)}`)
    }
    if (typeof rc.maxDelayMs === 'number' && Number.isFinite(rc.maxDelayMs) && rc.maxDelayMs !== 30000) {
      rcLines.push(`          maxDelayMs: ${Math.trunc(rc.maxDelayMs)}`)
    }
    if (typeof rc.maxAttempts === 'number' && Number.isFinite(rc.maxAttempts) && rc.maxAttempts !== 10) {
      rcLines.push(`          maxAttempts: ${Math.trunc(rc.maxAttempts)}`)
    }
    if (rcLines.length > 0) {
      lines.push('        reconnect:')
      for (const line of rcLines) lines.push(line)
    }
  }
  return lines.join('\n')
}

/** 从全文里切出受管块内的行文本（不含标记行）。 */
function blockBody(text) {
  const b = text.indexOf(BEGIN)
  const e = text.indexOf(END)
  if (b === -1 || e === -1 || e < b) return undefined
  return { body: text.slice(b + BEGIN.length, e).replace(/^\n/, ''), start: b, end: e + END.length }
}

/** 把受管块（整块）替换成给定行文本；没有块就在文件末尾追加。 */
function replaceBlock(text, rowsText) {
  const found = blockBody(text)
  const block = `${BEGIN}\n${rowsText}${rowsText.endsWith('\n') || rowsText === '' ? '' : '\n'}${END}`
  if (found === undefined) {
    const sep = text.endsWith('\n') ? '' : '\n'
    return `${text}${sep}\n${block}\n`
  }
  return text.slice(0, found.start) + block + text.slice(found.end)
}

/** 从块里按 serverName 切出各行（每行以 `- id: mcp-hub-<server>` 起）。 */
function splitRows(rowsText) {
  const out = []
  const lines = rowsText.split('\n')
  let current = []
  for (const line of lines) {
    if (/^\s*-\s+id:\s*mcp-hub-/.test(line)) {
      if (current.length > 0) out.push(current.join('\n'))
      current = [line]
    } else if (current.length > 0) {
      current.push(line)
    }
  }
  if (current.length > 0) out.push(current.join('\n'))
  return out
}

function serverOfRow(rowText) {
  const m = rowText.match(/^\s*serverName:\s*(.+)$/m)
  if (m === null) return undefined
  return m[1].trim().replace(/^["']|["']$/g, '')
}

/** 新建/更新一个自建 server。 */
export async function upsertManagedServer(patchPath, input) {
  if (/^[A-Za-z0-9_-]+$/.test(input.serverName) === false) {
    return { ok: false, detail: 'serverName 只能包含字母、数字、下划线与连字符' }
  }
  let text
  try {
    text = await readFile(patchPath, 'utf8')
  } catch (error) {
    return { ok: false, detail: '读不到 cordis.patch.yml：' + String(error) }
  }
  // 不允许覆盖用户手写行
  const rows = (await import('./mcp.js')).parseMcpRows(text)
  const existed = rows.find((r) => r.serverName === input.serverName)
  if (existed !== undefined && existed.id.startsWith(ID_PREFIX) === false) {
    return { ok: false, detail: '同名 server 已存在于你的手写配置里，本插件不改动它' }
  }

  const found = blockBody(text)
  const existingRows = found === undefined ? [] : splitRows(found.body)
  const kept = existingRows.filter((row) => serverOfRow(row) !== input.serverName)
  kept.push(renderRow(input))

  // 备份一次（只备份一次，避免每次改都堆文件）
  const backup = patchPath + '.bak-hub-' + Date.now()
  try {
    await mkdir(dirname(patchPath), { recursive: true })
    await writeFile(backup, text, 'utf8')
  } catch {}

  const next = replaceBlock(text, kept.join('\n') + '\n')
  await writeFile(patchPath, next, 'utf8')
  return { ok: true, detail: `已写入受管块（备份 ${backup}）` }
}

/** 删除一个自建 server；用户手写行拒绝。 */
export async function removeManagedServer(patchPath, serverName) {
  let text
  try {
    text = await readFile(patchPath, 'utf8')
  } catch (error) {
    return { ok: false, detail: '读不到 cordis.patch.yml：' + String(error) }
  }
  const rows = (await import('./mcp.js')).parseMcpRows(text)
  const existed = rows.find((r) => r.serverName === serverName)
  if (existed === undefined) {
    return { ok: false, detail: '找不到该 server' }
  }
  if (existed.id.startsWith(ID_PREFIX) === false) {
    return { ok: false, detail: '这是你手写的配置行，本插件不替你删——要删请自己改 cordis.patch.yml' }
  }
  const found = blockBody(text)
  if (found === undefined) return { ok: false, detail: '没有受管块，无需删除' }
  const kept = splitRows(found.body).filter((row) => serverOfRow(row) !== serverName)
  const backup = patchPath + '.bak-hub-' + Date.now()
  try {
    await writeFile(backup, text, 'utf8')
  } catch {}
  const next = replaceBlock(text, kept.length === 0 ? '' : kept.join('\n') + '\n')
  await writeFile(patchPath, next, 'utf8')
  return { ok: true, detail: `已删除（备份 ${backup}）` }
}


/** 导出给自检用：验证生成的 YAML 长什么样。 */
export { renderRow }

