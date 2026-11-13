/**
 * dsh-skill-mcp-hub —— P1 自检
 *
 * 只测**纯逻辑**（不依赖宿主）：
 *   · state 归一化与原子读写
 *   · skill 双标记识别（.disabled 改名法 + frontmatter disable-model-invocation）
 *   · 缺根容忍（工作区技能根不存在不能报错）
 *   · MCP 行解析（块外行不能被误认，disabled 要读对）
 *   · 工具名 → serverName 反解 + deny 列表生成
 *   · 受管块增删（绝不能碰块外内容）
 *
 * 用法：node selftest.mjs            # 正向，应全 PASS
 *       node selftest.mjs negative   # 注入故障，应有 FAIL（证明断言有牙）
 */
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { emptyState, loadState, saveState, normalizeState, statePath } from './lib/state.js'
import { scanSkills, setSkillEnabledGlobal } from './lib/skills.js'
import { parseMcpRows, serverOfTool, toolsToDeny } from './lib/mcp.js'
import { upsertManagedServer, removeManagedServer, renderRow } from './lib/managed.js'
import { resolveHidden, setOverride } from './lib/layers.js'

const mode = process.argv[2] ?? 'positive'
const negative = mode === 'negative'

let pass = 0
let fail = 0
function check(label, ok, detail) {
  if (ok) {
    pass += 1
    console.log('PASS  ' + label + (detail === undefined ? '' : '  — ' + detail))
  } else {
    fail += 1
    console.log('FAIL  ' + label + (detail === undefined ? '' : '  — ' + detail))
  }
}

/** 造一个假技能目录。 */
async function makeSkill(root, name, opts = {}) {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  const front = [
    '---',
    `name: ${name}`,
    `description: hello ${name}`,
    ...(opts.disableModel === true ? ['disable-model-invocation: true'] : []),
    '---',
    'body',
  ].join('\n')
  const fileName = opts.renamed === true ? 'SKILL.md.disabled' : 'SKILL.md'
  await writeFile(join(dir, fileName), front, 'utf8')
  return dir
}

const work = await mkdtemp(join(tmpdir(), 'hub-selftest-'))

try {
  // ── 1. state 往返 ────────────────────────────────────────────────────
  const home = join(work, 'home')
  await mkdir(home, { recursive: true })
  const s0 = emptyState()
  s0.skills['alpha'] = { alias: '甲', note: '备注A', group: 'g1', globalEnabled: false }
  s0.groups.push({ id: 'g1', name: '组一', color: '#123456' })
  s0.mcp['fetch'] = { alias: '', note: '抓网页', globalEnabled: true, builtin: false }
  await saveState(home, s0)
  const s1 = await loadState(home)
  check('state 往返保持字段', s1.skills.alpha?.alias === (negative ? 'WRONG' : '甲'), s1.skills.alpha?.alias)
  check('state 保存 globalEnabled=false', s1.skills.alpha?.globalEnabled === false)
  check('state 分组保留', s1.groups.length === 1 && s1.groups[0].name === '组一')
  check('state 文件落在 skill-mcp-nexus/state.json', statePath(home).endsWith(join('skill-mcp-nexus', 'state.json')))

  // 损坏文件 → 回落空状态，不抛
  await writeFile(statePath(home), '{ 坏掉的 json', 'utf8')
  const broken = await loadState(home)
  check('损坏的 state 回落空状态而非抛错', broken.skills !== undefined && Object.keys(broken.skills).length === 0)

  const weird = normalizeState({ skills: { x: { globalEnabled: 'nope' } }, groups: 'notarray', mcp: null })
  check('normalizeState 收敛非法类型', typeof weird.skills.x.globalEnabled === 'boolean' && Array.isArray(weird.groups))

  // ── 2. skill 扫描与双标记 ───────────────────────────────────────────
  const userRoot = join(work, 'skills')
  const agentsRoot = join(work, 'agents-skills')
  const missingRoot = join(work, 'does-not-exist')
  await mkdir(userRoot, { recursive: true })
  await mkdir(agentsRoot, { recursive: true })

  await makeSkill(userRoot, 'plain-on')
  await makeSkill(userRoot, 'renamed-off', { renamed: true })
  await makeSkill(userRoot, 'front-off', { disableModel: true })
  await makeSkill(agentsRoot, 'plain-on') // 同名，rank 更高的 user-dsh 应胜出
  await mkdir(join(userRoot, '.system'), { recursive: true })

  const scan = await scanSkills([missingRoot, missingRoot, userRoot, agentsRoot])
  const byName = new Map(scan.winners.map((s) => [s.name, s]))

  check('缺根不报错且能扫出条目', scan.winners.length === 3, 'winners=' + scan.winners.length)
  check('.disabled 改名法识别为停用', byName.get('renamed-off')?.disabledByRename === true)
  check('.disabled 条目 enabled=false', byName.get('renamed-off')?.enabled === (negative ? true : false))
  check('frontmatter 标记识别为停用', byName.get('front-off')?.disabledByFrontmatter === true)
  check('frontmatter 条目 enabled=false', byName.get('front-off')?.enabled === (negative ? true : false))
  check('普通条目 enabled=true', byName.get('plain-on')?.enabled === true)
  check('同名按 rank 取 user-dsh（不是 agents）', byName.get('plain-on')?.root === 'user-dsh', byName.get('plain-on')?.root)
  check('.system 被跳过', [...byName.keys()].every((n) => n !== '.system'))

  // 全局启停：改名往返
  const dir = byName.get('plain-on').dir
  const off = await setSkillEnabledGlobal(dir, false)
  check('停用改名为 .disabled', off.changed === true)
  const offExists = await readFile(join(dir, 'SKILL.md.disabled'), 'utf8').then(() => true).catch(() => false)
  check('磁盘上出现 SKILL.md.disabled', offExists === true)
  const back = await setSkillEnabledGlobal(dir, true)
  check('启用改回 SKILL.md', back.changed === true)
  const onExists = await readFile(join(dir, 'SKILL.md'), 'utf8').then(() => true).catch(() => false)
  check('磁盘上恢复 SKILL.md', onExists === true)
  const noop = await setSkillEnabledGlobal(dir, true)
  check('已启用时重复启用是 no-op', noop.changed === false, noop.reason)

  // ── 3. MCP 行解析 ──────────────────────────────────────────────────
  const patch = [
    'plugins:',
    '  - group: core',
    '    entries:',
    "    - id: mcp-fetch",
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        transport: stdio',
    '        serverName: fetch',
    '        command: C:\\tools\\fetch.exe',
    '        args:',
    "          - '--mcp'",
    "    - id: mcp-github",
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        transport: streamable-http',
    '        serverName: github',
    '        url: https://example.com/mcp',
    '        disabled: true',
    "    - id: unrelated-row",
    "      name: 'some-other-plugin'",
    '      config:',
    '        serverName: not-a-mcp',
    '',
  ].join('\n')

  const rows = parseMcpRows(patch)
  check('只解析出 MCP 行（无关行被跳过）', rows.length === 2, 'rows=' + rows.length)
  const fetchRow = rows.find((r) => r.serverName === 'fetch')
  const ghRow = rows.find((r) => r.serverName === 'github')
  check('stdio 行字段正确', fetchRow?.transport === (negative ? 'streamable-http' : 'stdio'), fetchRow?.transport)
  check('http 行字段正确', ghRow?.transport === 'streamable-http')
  check('disabled: true 读到', ghRow?.disabled === true)
  check('未标 disabled 的行不算停用', fetchRow?.disabled === false)

  // ── 4. 工具名反解与 deny 生成 ───────────────────────────────────────
  check('mcp__fetch__search → fetch', serverOfTool('mcp__fetch__search') === 'fetch')
  check('非 MCP 工具返回 undefined', serverOfTool('read') === undefined)
  check('畸形名返回 undefined', serverOfTool('mcp__noseperator') === undefined)

  const known = ['mcp__fetch__get', 'mcp__fetch__post', 'mcp__time__now', 'read', 'write']
  const deny = toolsToDeny(known, new Set(['fetch']))
  check('deny 只含目标 server 的工具', deny.length === (negative ? 1 : 2) && deny.every((n) => n.startsWith('mcp__fetch__')), JSON.stringify(deny))
  check('deny 不含非 MCP 工具', deny.includes('read') === false)

  // ── 5. 受管块增删（块外一个字节都不能动）──────────────────────────
  const patchPath = join(work, 'cordis.patch.yml')
  await writeFile(patchPath, patch, 'utf8')

  const add = await upsertManagedServer(patchPath, {
    serverName: 'mine',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
  })
  check('自建 server 写入成功', add.ok === true, add.detail)
  const afterAdd = await readFile(patchPath, 'utf8')
  check('受管块出现', afterAdd.includes('dsh-skill-mcp-hub:mcp:begin'))
  check('块外原文一字未动', afterAdd.slice(0, patch.length) === (negative ? 'CHANGED' : patch), '前 ' + patch.length + ' 字节比对')
  check('新行落进块内', parseMcpRows(afterAdd).some((r) => r.serverName === 'mine'))

  const conflict = await upsertManagedServer(patchPath, {
    serverName: 'fetch',
    transport: 'stdio',
    command: 'evil',
    args: [],
  })
  check('拒绝覆盖用户手写行', conflict.ok === false, conflict.detail)

  const bad = await upsertManagedServer(patchPath, { serverName: 'has space', transport: 'stdio', command: 'x', args: [] })
  check('拒绝非法 serverName', bad.ok === false, bad.detail)

  const refused = await removeManagedServer(patchPath, 'fetch')
  check('拒删用户手写行', refused.ok === false, refused.detail)

  const removed = await removeManagedServer(patchPath, 'mine')
  check('删除自建行成功', removed.ok === true, removed.detail)
  const afterRemove = await readFile(patchPath, 'utf8')
  check('删完块外仍一字未动', afterRemove.slice(0, patch.length) === patch)
} finally {
  await rm(work, { recursive: true, force: true }).catch(() => {})
}

// ── 运行时参数写进受管块的 YAML 是否正确 ─────────────────────────────
// 宿主 mcp-client 的 Config 支持 toolCallTimeoutMs / failOnStartupError /
// reconnect{enabled, initialDelayMs, maxDelayMs, maxAttempts}，这里验证生成结果。
{
  const yaml = renderRow({
    serverName: 'rt',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'pkg'],
    toolCallTimeoutMs: 90000,
    failOnStartupError: true,
    reconnect: { enabled: false, initialDelayMs: 1000, maxAttempts: 3 },
  })
  check('运行时参数：超时写入', yaml.includes('toolCallTimeoutMs: 90000'), '')
  check('运行时参数：失败报错写入', yaml.includes('failOnStartupError: true'), '')
  check('运行时参数：reconnect 块存在', yaml.includes('reconnect:'), '')
  check('运行时参数：reconnect.enabled 写入', yaml.includes('enabled: false'), '')
  check('运行时参数：initialDelayMs 写入', yaml.includes('initialDelayMs: 1000'), '')
  check('运行时参数：maxAttempts 写入', yaml.includes('maxAttempts: 3'), '')

  // 默认值不该写进去（免得受管块白白变长）
  const plain = renderRow({ serverName: 'p', transport: 'stdio', command: 'npx', toolCallTimeoutMs: 60000, reconnect: { initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 } })
  check('默认超时不写入', !plain.includes('toolCallTimeoutMs'), '')
  check('默认重连值不写入', !plain.includes('reconnect'), '')
  check('默认不写 failOnStartupError', !plain.includes('failOnStartupError'), '')
}


/**
 * ── 全局改名 → 缓存刷新 → 遮蔽重算 → 残留清理 全链路 ──────────────
 *
 * 2026-11-11 主人实测：「改工作区 → 测会话 → 动全局，出问题了」。
 * 这里把那条链路拆开逐段验，避免再出现「界面变了但实际没变」。
 */
{
  const { mkdtemp: mk2, mkdir: mkdir2, writeFile: wf2, rm: rm2 } = await import('node:fs/promises')
  const { tmpdir: td2 } = await import('node:os')
  const base2 = await mk2(join(td2(), 'chain-'))
  const root2 = join(base2, 'skills')
  const dir2 = join(root2, 'chain-skill')
  try {
    await mkdir2(dir2, { recursive: true })
    await wf2(join(dir2, 'SKILL.md'), '---\nname: chain-skill\ndescription: d\n---\nbody\n', 'utf8')

    // ① 同一根下扫描两次，确认名字稳定
    const scanA = await scanSkills([root2])
    const nameA = scanA.winners.find((w) => w.dir === dir2)?.name
    check('链路①：初始扫描拿到名字', nameA === 'chain-skill', String(nameA))
    check('链路①：初始为启用', scanA.winners.find((w) => w.dir === dir2)?.enabled === true)

    // ② 改名（全局关）
    const off2 = await setSkillEnabledGlobal(dir2, false)
    check('链路②：改成 .disabled', off2.changed === true)
    const scanB = await scanSkills([root2])
    check('链路②：重扫后 enabled=false', scanB.winners.find((w) => w.dir === dir2)?.enabled === false)
    check('链路②：标记为 disabledByRename', scanB.winners.find((w) => w.dir === dir2)?.disabledByRename === true)

    // ③ 改回来（全局开）
    const on2 = await setSkillEnabledGlobal(dir2, true)
    check('链路③：改回 SKILL.md', on2.changed === true)
    const scanC = await scanSkills([root2])
    check('链路③：重扫后 enabled=true（缓存必须跟着刷）', scanC.winners.find((w) => w.dir === dir2)?.enabled === true)

    // ④ 残留清理的语义：全局一动，下层 off 必须消失
    const row = { skills: { 'chain-skill': 'off' }, mcp: {} }
    const cleared = setOverride(row.skills, 'chain-skill', null)
    check('链路④：全局变动后清掉下层 off', Object.keys(cleared).length === 0, JSON.stringify(cleared))

    // ⑤ 三层叠加：全局开 + 下层无 off ⇒ 不隐藏
    check('链路⑤：清完后三层叠加=可见', resolveHidden({ 'chain-skill': true }, cleared, {}).length === 0)
    // ⑤b 反过来：下层 off 在 ⇒ 隐藏
    check('链路⑤b：留着 off ⇒ 隐藏', resolveHidden({ 'chain-skill': true }, { 'chain-skill': 'off' }, {}).includes('chain-skill'))
    // ⑤c 全局关 + 下层开不了（新语义核心）
    check('链路⑤c：全局关时下层 off/on 都无意义', resolveHidden({ 'chain-skill': false }, {}, {}).includes('chain-skill'))
  } finally {
    await rm2(base2, { recursive: true, force: true }).catch(() => {})
  }
}


/**
 * ── 会话层覆盖持久化（2026-11-11）────────────────────────────────
 *
 * 原来 sessionOverrides 是纯内存 Map，进程重启就清零 —— 用户会看到
 * 「关了又自己开」。现在写进 state.json 的 sessionOverlays。
 */
{
  // ① 空 state 带 sessionOverlays 字段
  const s0 = emptyState()
  check('空 state 有 sessionOverlays', s0.sessionOverlays !== undefined)

  // ② normalizeState 能收进来，且只认 off
  const s1 = normalizeState({
    sessionOverlays: {
      'ss:abc': { skills: { 'a-skill': 'off', 'b-skill': 'on' }, mcp: {} },
      'ws:/x': { skills: {}, mcp: { 'a-mcp': 'off' } },
      'ss:empty': { skills: {}, mcp: {} },
    },
  })
  check('持久化的会话覆盖被读回', s1.sessionOverlays['ss:abc'] !== undefined)
  check('只认 off（on 被丢弃）', s1.sessionOverlays['ss:abc']?.skills?.['a-skill'] === 'off' && s1.sessionOverlays['ss:abc']?.skills?.['b-skill'] === undefined, JSON.stringify(s1.sessionOverlays['ss:abc']))
  check('工作区层也能存', s1.sessionOverlays['ws:/x']?.mcp?.['a-mcp'] === 'off')
  check('空层被剔除', s1.sessionOverlays['ss:empty'] === undefined)

  // ③ 坏数据不炸
  const s2 = normalizeState({ sessionOverlays: { 'ss:bad': null, 'ss:x': 'nonsense' } })
  check('坏数据被跳过不炸', Object.keys(s2.sessionOverlays).length === 0, JSON.stringify(s2.sessionOverlays))

  // ④ 存盘再读回（模拟重启）
  const dir2 = await mkdtemp(join(tmpdir(), 'persist-'))
  try {
    const st = emptyState()
    st.sessionOverlays['ss:sess1'] = { skills: { 'my-skill': 'off' }, mcp: {} }
    await saveState(dir2, st)
    const back = await loadState(dir2)
    check('存盘后读回还在（重启不丢）', back.sessionOverlays['ss:sess1']?.skills?.['my-skill'] === 'off', JSON.stringify(back.sessionOverlays))
    // 叠加求值仍正确
    check('读回的覆盖能参与三层求值', resolveHidden({ 'my-skill': true }, back.sessionOverlays['ss:sess1'].skills, {}).includes('my-skill'))
  } finally {
    await rm(dir2, { recursive: true, force: true }).catch(() => {})
  }
}

console.log('')
console.log(`=== [${mode}] 通过 ${pass} / 失败 ${fail} ===`)
if (negative) {
  console.log(fail > 0 ? '注入故障后如期变红 —— 自检有牙' : '！！注入故障却全绿 —— 自检无效')
  process.exitCode = fail > 0 ? 0 : 1
} else {
  console.log(fail === 0 ? '全部 PASS' : '有失败项')
  process.exitCode = fail === 0 ? 0 : 1
}






