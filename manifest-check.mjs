/**
 * 校验 HUB_MANIFEST 是否满足宿主 typert-registry 的 validateInvocation 全部约束。
 *
 * 规则来自 app.asar 内 @deepseek-ai/dsh-typert-registry/lib/index.js 的
 * `validatePackage` / `validateSchemas` / `validateInvocation` / `validateCodec`。
 * 在这里**复刻**它们（而不是 import，因为宿主那份不导出），逐条断言，
 * 目的是在重启宿主之前就把 manifest 的可拒项全部排掉。
 *
 * 用法：node manifest-check.mjs           正向
 *      node manifest-check.mjs negative   注入故障，应有 FAIL
 */
import { HUB_MANIFEST, NS } from './lib/manifest.js'

const negative = (process.argv[2] ?? 'positive') === 'negative'
let pass = 0
let fail = 0
function check(label, ok, detail) {
  if (ok) {
    pass += 1
    console.log('PASS  ' + label + (detail ? '  — ' + detail : ''))
  } else {
    fail += 1
    console.log('FAIL  ' + label + (detail ? '  — ' + detail : ''))
  }
}

// ── 复刻宿主的校验原语 ────────────────────────────────────────────────
const SEGMENT = /^[A-Za-z0-9_$.-]+$/
const WIRE = /^[^.]+$/ // 宿主 validateWireName 的实际约束（不含点即可）

function validSegment(v) {
  return typeof v === 'string' && v !== '.' && v !== '..' && SEGMENT.test(v)
}
function validWire(v) {
  return typeof v === 'string' && v.length > 0 && WIRE.test(v)
}
function validCodec(c) {
  return c !== null && typeof c === 'object' && typeof c.create === 'function' && typeof c.mode === 'string'
}

/** 返回错误消息数组（空数组＝全部合规）。 */
function validateManifest(m) {
  const errors = []
  if (!validSegment(m.package)) errors.push('package 不是合法 segment')
  if (m.face !== 'host' && m.face !== 'client') errors.push('face 必须是 host 或 client')
  if (!Array.isArray(m.schemas)) errors.push('schemas 必须是数组')
  if (!Array.isArray(m.invocations)) errors.push('invocations 必须是数组')

  const endpointSet = new Set()
  const idSet = new Set()
  for (const d of m.invocations ?? []) {
    const tag = d?.id ?? '(no id)'
    if (typeof d.id !== 'string' || d.id === '') errors.push(tag + ': id 为空')
    if (idSet.has(d.id)) errors.push(tag + ': id 重复')
    idSet.add(d.id)

    if (!validSegment(d.service)) errors.push(tag + ': service 不是合法 segment')
    if (!validWire(d.namespace)) errors.push(tag + ': namespace 不是合法 wire 名')
    if (!validWire(d.method)) errors.push(tag + ': method 不是合法 wire 名')

    const endpoint = `${d.namespace}/${d.method}`
    if (endpointSet.has(endpoint)) errors.push(tag + ': endpoint 重复 ' + endpoint)
    endpointSet.add(endpoint)

    if (!validCodec(d.result)) errors.push(tag + ': result codec 非法')
    if (!Array.isArray(d.parameters)) {
      errors.push(tag + ': parameters 必须是数组（无参也要写 []）')
      continue
    }

    const wires = new Set()
    for (const p of d.parameters) {
      if (!validWire(p?.name)) errors.push(tag + ': parameter.name 非法')
      if (!validWire(p?.wire)) errors.push(tag + ': parameter.wire 非法')
      if (wires.has(p?.wire)) errors.push(tag + ': wire 字段重复 ' + p?.wire)
      wires.add(p?.wire)
      if (p?.source !== 'json' && p?.source !== 'lookup') errors.push(tag + ': source 必须是 json 或 lookup')
      if (p?.source === 'lookup') {
        if (p.acceptsUndefined !== undefined) errors.push(tag + ': lookup 参数不能 acceptsUndefined')
        if (p.lookup === undefined) errors.push(tag + ': lookup 参数缺 lookup key')
      } else if (p?.lookup !== undefined) {
        errors.push(tag + ': json 参数不该声明 lookup key')
      }
      if (!validCodec(p?.codec)) errors.push(tag + ': parameter codec 非法')
    }

    if (d.cancellation !== undefined && d.cancellation.parameter !== 'signal') errors.push(tag + ': cancellation 参数必须叫 signal')
    if (d.mode !== undefined && d.mode !== 'stream') errors.push(tag + ': mode 只能是 stream')
    if (d.invocation === undefined || d.invocation?.kind === undefined) errors.push(tag + ': 缺 invocation.kind')
  }
  return errors
}

/** 宿主客户端会在 descriptor 上找 namespace/method，并要求 direct 有 invoke —— 这里只查契约关键点。 */
function checkClientShape(m) {
  const errors = []
  for (const d of m.invocations ?? []) {
    if (d.invocation?.kind !== 'direct') errors.push(`${d.id}: 客户端只处理 direct`)
    // 客户端 descriptor 需要 id 形如 `<package>#<namespace>/<method>`
    const want = `${m.package}#${d.namespace}/${d.method}`
    if (d.id !== want) errors.push(`${d.id}: id 应为 ${want}`)
  }
  return errors
}

// ── 用例 ──────────────────────────────────────────────────────────────
const base = validateManifest(HUB_MANIFEST)
check('manifest 通过宿主全部校验原语', base.length === (negative ? 99 : 0), base.join(' / ') || '0 处违规')

const shape = checkClientShape(HUB_MANIFEST)
check('客户端 descriptor 形状匹配（id / direct）', shape.length === 0, shape.join(' / ') || 'ok')

check('package 名与插件名一致', HUB_MANIFEST.package === 'dsh-skill-mcp-nexus', HUB_MANIFEST.package)
check('face 是 host', HUB_MANIFEST.face === 'host')
check('namespace 与 NS 常量一致', (HUB_MANIFEST.invocations[0]?.namespace) === NS, NS)
check('方法数与宿主类一致（11 个）', HUB_MANIFEST.invocations.length === (negative ? 10 : 11), String(HUB_MANIFEST.invocations.length))

// 关键三方法必须在
const names = new Set(HUB_MANIFEST.invocations.map((d) => d.method))
for (const need of ['list', 'toggle', 'testServer']) {
  check('含必需方法 ' + need, names.has(need))
}

// 无参方法必须是空数组而不是省略
const listDesc = HUB_MANIFEST.invocations.find((d) => d.method === 'list')
check('list 是空参数数组', Array.isArray(listDesc?.parameters) && listDesc.parameters.length === 0)

// codec 必须能真的 create 出带 parse 的 schema
try {
  const created = HUB_MANIFEST.invocations[0].result.create()
  check('result codec create() 产出可 parse 的 schema', typeof created?.parse === 'function')
} catch (error) {
  check('result codec create() 产出可 parse 的 schema', false, String(error))
}

// 参数 codec 同样要能 create
const toggleDesc = HUB_MANIFEST.invocations.find((d) => d.method === 'toggle')
try {
  const c = toggleDesc.parameters[0].codec.create()
  check('参数 codec create() 可用', typeof c?.parse === 'function')
} catch (error) {
  check('参数 codec create() 可用', false, String(error))
}

// 幂等：create() 连调两次不能抛（宿主用 ??= 缓存，但要保证不炸）
try {
  HUB_MANIFEST.invocations[0].result.create()
  HUB_MANIFEST.invocations[0].result.create()
  check('codec create() 幂等可重复调用', true)
} catch (error) {
  check('codec create() 幂等可重复调用', false, String(error))
}

console.log('')
console.log(`=== [${negative ? 'negative' : 'positive'}] 通过 ${pass} / 失败 ${fail} ===`)
if (negative) {
  console.log(fail > 0 ? '注入故障后如期变红 —— 校验有牙' : '！！注入故障却全绿 —— 校验无效')
  process.exitCode = fail > 0 ? 0 : 1
} else {
  console.log(fail === 0 ? '全部 PASS' : '有失败项')
  process.exitCode = fail === 0 ? 0 : 1
}


