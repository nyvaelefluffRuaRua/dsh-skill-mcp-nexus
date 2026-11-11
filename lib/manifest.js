/**
 * dsh-skill-mcp-hub —— Typert wire manifest
 *
 * **这是网关认识我们方法的唯一凭据。** 只写一个 `extends TypertRemoteService` 的类、
 * 方法都定义好，是不够的：宿主 api-gateway 只分发在 manifest 的 `invocations` 里
 * 登记过的 endpoint。漏了登记，浏览器端就是一句
 * `client api skillMcpHub.list failed: transport failure for '/api/skillMcpHub/list' HTTP 404`
 * —— 404 不是路由写错，是网关根本没这条 endpoint。
 *
 * 结构照 `@deepseek-ai/dsh-api-gateway` 的 source-mode 发现逻辑：
 *   { package, face: 'host', schemas: [], invocations: [ { id, service, namespace, method,
 *     invocation: { kind: 'direct' }, parameters: [...], result: codec } ] }
 *
 * `parameters` 的每一项是 `{ name, wire, source: 'json', codec }`；
 * 没有参数的方法写空数组（**不能省略**，网关会做严格参数校验）。
 */
import { z } from 'zod'
import { strictCodec } from './codec.js'

const PKG = 'dsh-skill-mcp-hub'
const NS = 'skillMcpHub'

/** 边界 payload 一律放行任意 JSON，字段校验下沉到 handler（前端能拿到中文报错）。 */
const anyPayload = z.unknown()

const boolResult = z.object({ ok: z.boolean(), detail: z.string().optional() })
const jsonResult = z.unknown()

/** 造一个 invocation 条目。无参方法传空数组。 */
function method(name, { parameters = [], result }) {
  return {
    id: `${PKG}#${NS}/${name}`,
    service: NS,
    namespace: NS,
    method: name,
    invocation: { kind: 'direct' },
    parameters,
    result,
  }
}

/** 单个 payload 参数的简写。 */
function withPayload(name, resultCodec) {
  return method(name, {
    parameters: [{ name: 'payload', wire: 'payload', source: 'json', acceptsUndefined: true, codec: strictCodec(`${PKG}#${name}Payload`, anyPayload) }],
    result: resultCodec,
  })
}

export const HUB_MANIFEST = {
  package: PKG,
  face: 'host',
  schemas: [],
  invocations: [
    method('list', { result: strictCodec(`${PKG}#ListResult`, jsonResult) }),
    withPayload('toggle', strictCodec(`${PKG}#ToggleResult`, boolResult)),
    withPayload('annotate', strictCodec(`${PKG}#AnnotateResult`, boolResult)),
    withPayload('setDependents', strictCodec(`${PKG}#SetDependentsResult`, jsonResult)),
    withPayload('saveGroup', strictCodec(`${PKG}#SaveGroupResult`, boolResult)),
    withPayload('deleteGroup', strictCodec(`${PKG}#DeleteGroupResult`, boolResult)),
    withPayload('sessionState', strictCodec(`${PKG}#SessionStateResult`, jsonResult)),
    withPayload('testServer', strictCodec(`${PKG}#TestResult`, jsonResult)),
    withPayload('addServer', strictCodec(`${PKG}#AddServerResult`, boolResult)),
    withPayload('removeServer', strictCodec(`${PKG}#RemoveServerResult`, boolResult)),
    method('diagnose', { result: strictCodec(`${PKG}#DiagnoseResult`, jsonResult) }),
  ],
}

export { NS }
