/**
 * dsh-skill-mcp-hub —— MCP 状态与工具名解析
 *
 * 本插件**不写 `cordis.patch.yml`**。原因有三：
 *   1. 那 11 个 MCP 全是用户手写的行，改写等于替他接管配置，出错就起不来；
 *   2. 宿主 `mcp-client` 没有 `disabled` 配置项（读 schema 确认），只能靠
 *      profile 里加/删行来控制"连不连"；
 *   3. 运行时 `ctx.tools.restrict({ deny })` 已经能把工具从模型面前收走，
 *      热生效且不动磁盘——这正是 skillhub 走通的那条路。
 *
 * 代价（必须对用户明说）：本插件的"全局关"只存在于 state.json + 运行时限制里，
 * **插件不在时那个 MCP 服务器仍会连接**。面板会在 MCP 卡片上标注这一点。
 */
import { readFile } from 'node:fs/promises'

/** MCP 工具公开名前缀：`mcp__<serverName>__<rawName>`（宿主 mcp-client 的 publicToolName）。 */
export const MCP_TOOL_PREFIX = 'mcp__'

/**
 * 从 `cordis.patch.yml` 里读出所有 MCP 服务器行，用于**只读展示**。
 *
 * 不引 yaml 依赖——这里只做行级扫描，够用且不会因格式差异炸掉：
 * 找 `- id: xxx` 起的块，向后看到 `name:` 是否为 `@deepseek-ai/dsh-mcp-client`，
 * 再抓同一块里的 serverName / command / url / disabled。
 *
 * @returns {Array<{id, serverName, transport, command?, url?, disabled}>}
 */
export function parseMcpRows(text) {
  const rows = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const idMatch = line.match(/^\s*-\s+id:\s*(\S+)\s*$/)
    if (idMatch === null) continue
    // 找这一块的边界：下一条 `- id:` 或文件末尾
    let end = lines.length
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^\s*-\s+id:/.test(lines[j])) {
        end = j
        break
      }
    }
    const block = lines.slice(i, end).join('\n')
    if (!/dsh-mcp-client/.test(block)) continue
    const serverName = (block.match(/^\s*serverName:\s*(.+)$/m) ?? [])[1]
    if (serverName === undefined) continue
    const transport = /transport:\s*streamable-http/.test(block)
      ? 'streamable-http'
      : /transport:\s*stdio/.test(block)
        ? 'stdio'
        : (block.match(/^\s*url:/m) ? 'streamable-http' : 'stdio')
    const disabled = /^\s*disabled:\s*true\s*$/m.test(block)
    const command = (block.match(/^\s*command:\s*(.+)$/m) ?? [])[1]
    const url = (block.match(/^\s*url:\s*(.+)$/m) ?? [])[1]
    rows.push({
      id: idMatch[1],
      serverName: serverName.trim().replace(/^["']|["']$/g, ''),
      transport,
      command: command === undefined ? undefined : command.trim(),
      url: url === undefined ? undefined : url.trim(),
      disabled,
    })
    i = end - 1
  }
  return rows
}

/** 读 profile 的 patch 文件并解析 MCP 行；文件缺失返回空数组。 */
export async function readMcpRows(patchPath) {
  try {
    return parseMcpRows(await readFile(patchPath, 'utf8'))
  } catch {
    return []
  }
}

/** 从一个工具公开名里取 serverName；不是 MCP 工具时返回 undefined。 */
export function serverOfTool(toolName) {
  if (typeof toolName !== 'string') return undefined
  if (toolName.startsWith(MCP_TOOL_PREFIX) === false) return undefined
  const rest = toolName.slice(MCP_TOOL_PREFIX.length)
  const sep = rest.indexOf('__')
  if (sep <= 0) return undefined
  return rest.slice(0, sep)
}

/**
 * 把「哪几个 server 要被关」翻译成「具体要 deny 哪些工具名」。
 *
 * 名字必须在施加时**已经存在**（restrict 对未知名字直接抛错），所以只能从
 * 当下这份 restrictableNames 里筛，不能凭 state 里的历史名硬写。
 */
export function toolsToDeny(knownToolNames, disabledServers) {
  const out = []
  for (const toolName of knownToolNames) {
    const server = serverOfTool(toolName)
    if (server !== undefined && disabledServers.has(server)) out.push(toolName)
  }
  return out
}
