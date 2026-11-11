/**
 * dsh-skill-mcp-hub —— Typert strict codec 构造器
 *
 * 只实现 0.2.x 起的契约：registry / loader / gateway 一律读 `create()` 工厂，
 * 并在边界上执行 `create().parse(value)`。`create()` 必须幂等
 * （宿主用 `record.value ??= create()` 缓存）。
 */
export function strictCodec(typeSymbol, schema) {
  return {
    mode: 'strict',
    typeSymbol,
    create: () => schema,
  }
}
