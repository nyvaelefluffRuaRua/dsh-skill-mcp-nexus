/**
 * dsh-skill-mcp-hub —— MCP 连接测试
 *
 * 独立握手（initialize + tools/list），不借用宿主已建立的连接：
 *   · 宿主那条连接可能是坏的/半死的，测它就分不清"服务器有问题"还是"宿主链路有问题"；
 *   · 独立进程起得来、工具数数得出，才是这条配置本身可用。
 *
 * 用《超时 + 强杀》兜底：服务器不回 initialize 就 8 秒放弃并杀掉子进程，
 * 绝不让一个哑巴 server 把面板卡死。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const PROBE_TIMEOUT_MS = 8000

/** 造 transport。stdio 要传 command/args/env/cwd；http 传 url/headers。 */
function makeTransport(row) {
  if (row.transport === 'streamable-http') {
    const url = typeof row.url === 'string' ? row.url.trim() : ''
    if (url === '') throw new Error('该 server 没有配置 url')
    return new StreamableHTTPClientTransport(new URL(url))
  }
  const command = typeof row.command === 'string' ? row.command.trim() : ''
  if (command === '') throw new Error('该 server 没有配置 command')
  return new StdioClientTransport({
    command,
    args: Array.isArray(row.args) ? row.args : [],
    env: { ...process.env, ...(row.env ?? {}) },
    cwd: row.cwd !== undefined && row.cwd !== '' ? row.cwd : undefined,
  })
}

/** 带超时的 Promise 竞速。 */
function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * 测一个 server。
 * @param {{transport:string, command?:string, url?:string, args?:string[], env?:object, cwd?:string}} row
 */
export async function probeServer(row) {
  const started = Date.now()
  let transport
  let client
  try {
    transport = makeTransport(row)
    client = new Client({ name: 'dsh-skill-mcp-hub-probe', version: '0.1.0' }, { capabilities: {} })
    await withTimeout(client.connect(transport), PROBE_TIMEOUT_MS, 'initialize')
    const listed = await withTimeout(client.listTools(), PROBE_TIMEOUT_MS, 'tools/list')
    const tools = Array.isArray(listed?.tools) ? listed.tools : []
    return { ok: true, toolCount: tools.length, elapsedMs: Date.now() - started }
  } catch (error) {
    return {
      ok: false,
      toolCount: 0,
      elapsedMs: Date.now() - started,
      error: error !== null && typeof error === 'object' && 'message' in error ? String(error.message) : String(error),
    }
  } finally {
    // 关连接不要影响结果上报；坏 transport 关不掉也无所谓，进程会随宿主退出。
    try {
      await client?.close?.()
    } catch {}
    try {
      await transport?.close?.()
    } catch {}
  }
}
