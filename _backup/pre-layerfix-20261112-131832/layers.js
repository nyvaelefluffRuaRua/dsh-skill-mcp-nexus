/**
 * 局部层覆盖记录 —— 纯函数，**不依赖任何宿主包**。
 *
 * 为什么单独成文件：
 *   `index.js` 一开头就 import cordis / TypertRemoteService，那些只在
 *   app.asar 里，离线自检跑不起来。这几个函数是纯数据变换，抽出来
 *   就能单独测。
 *
 * ══════════════════════════════════════════════════════════════════
 * 2026-11-11 重新设计：全局独占磁盘，下层只做减法
 * ══════════════════════════════════════════════════════════════════
 *
 * 语义（方案 A）：
 *   · **全局**是唯一会改磁盘的层 —— `SKILL.md` ↔ `SKILL.md.disabled`
 *   · **工作区 / 会话**只能「藏」，不能「开」：
 *       - `off` = 本层关掉（即使全局开着）
 *       - 没有 `on`。想开回来 = **清除本层的 off**，跟随全局
 *
 * 为什么砍掉 `on`：
 *   全局关掉的 skill 磁盘上文件已改名，**宿主根本扫不到**。遮蔽
 *   （`modelInvocable:false`）的前提是"文件存在"，没有对象可遮。
 *   既然如此，暴露一个"开回来"的开关就是**做不到的承诺**。
 *
 * 存储格式：
 *   旧：`{名:'on'|'off'}` 或 `['名']`
 *   新：`{名:'off'}`（只记"本层关掉的"，等价于集合）
 *   `normalizeOverrides` 把两种旧格式都读成新语义，`on` 一律丢掉
 *   （它在新语义下没有意义，保留只会让残留覆盖"诈尸"）。
 */

/** 把任意形态的原始记录读成 `{ 名字: 'off' }`。`on` 被丢弃。 */
export function normalizeOverrides(raw) {
  const obj = {}
  if (Array.isArray(raw)) {
    for (const name of raw) if (typeof name === 'string' && name !== '') obj[name] = 'off'
    return obj
  }
  if (raw !== null && typeof raw === 'object') {
    for (const [name, value] of Object.entries(raw)) {
      if (typeof name !== 'string' || name === '') continue
      // 新语义只认 off；'on' 是历史残留，直接丢掉
      if (value === 'off') obj[name] = 'off'
    }
  }
  return obj
}

/**
 * 写入/清除一条覆盖。
 *
 * @param raw - 原始记录
 * @param name - 条目名
 * @param enabled - `false` ⇒ 记 `off`（本层关）；`true`/`null` ⇒ **清除**（跟随全局）
 *
 * 注意 `enabled === true` 现在是「去掉本层的 off」，不再是「记一个 on」。
 */
export function setOverride(raw, name, enabled) {
  const obj = normalizeOverrides(raw)
  if (typeof name !== 'string' || name === '') return obj
  if (enabled === false) obj[name] = 'off'
  else delete obj[name]
  return obj
}

/** 该层里所有被关掉的名字。 */
export function offNamesOf(raw) {
  return Object.keys(normalizeOverrides(raw))
}

/**
 * 该层里所有标成 `on` 的名字 —— **新语义下永远为空**。
 * 保留导出只为兼容旧调用点，别在新代码里用。
 */
export function onNamesOf(raw) {
  void raw
  return []
}

/**
 * 三层求值：全局基准 → 叠工作区 → 叠会话（后者只能继续关）。
 *
 * @param globalMap - `{ 名字: 全局是否开启 }`
 * @param layers - 从低到高的覆盖数组，如 `[wsRaw, ssRaw]`
 * @returns 最终**应当关闭**的名字数组
 *
 * 关键：下层只有"关"的能力，所以这里是**并集**（任一层的 off 都算数），
 * 不是"后层覆盖前层"。这正好也是安全方向 —— 下层没法把上层关掉的打开。
 */
export function resolveHidden(globalMap, ...layers) {
  const off = new Set()
  for (const [name, on] of Object.entries(globalMap ?? {})) {
    if (on === false) off.add(name)
  }
  for (const raw of layers) {
    for (const name of Object.keys(normalizeOverrides(raw))) off.add(name)
  }
  return [...off]
}

/**
 * 开关显示状态。
 *
 * @param overrides - 该条目的 `{ 层key: 'off' }`
 * @param layerKey - 当前编辑的层；空/undefined 表示全局视图
 * @param globalOn - 全局是否开启（**磁盘真实状态**）
 * @returns `{ state, effective, reason? }`
 *
 *   · `on`       —— 开着
 *   · `off`      —— 本层关着
 *   · `override` —— 全局开着，但有下层把它藏了（白点停中间）
 *   · `locked`   —— **全局关着，下层开不了**（灰、不可点，附原因）
 *
 * 不再有"全局关但本层开"这种形态 —— 新语义下做不到。
 */
export function switchStateOf(overrides, layerKey, globalOn) {
  const ov = overrides !== null && typeof overrides === 'object' ? overrides : {}
  const offKeys = Object.keys(ov).filter((k) => ov[k] === 'off')

  const inLayerView = layerKey !== undefined && layerKey !== null && layerKey !== ""

  /**
   * 全局关着时：
   *   · **层视图**（工作区/会话）⇒ locked —— 下层确实开不了（文件已改名）
   *   · **全局视图** ⇒ off 但**可点** —— 全局就是那个"真正的开关"，
   *     关着的时候用户正需要从这里打开它。
   *
   * 2026-11-11 实测踩过：一开始不分视图一律 locked，结果"关了开不回去"。
   */
  if (globalOn !== true) {
    if (inLayerView) return { state: "locked", effective: false, reason: "global-off" }
    return { state: "off", effective: false }
  }

  if (inLayerView) {
    const mine = ov[layerKey] === 'off'
    return { state: mine ? 'off' : 'on', effective: !mine }
  }

  // 全局视图：任何一层关了它 ⇒ 中间态（"这条被某层藏了"）
  if (offKeys.length > 0) {
    return { state: 'override', effective: false, byLayer: offKeys }
  }
  return { state: 'on', effective: true }
}

/** 某条目在哪些层被关掉了（给 UI 解释"为什么显示中间态"）。 */
export function layersHidingIt(overrides) {
  const ov = overrides !== null && typeof overrides === 'object' ? overrides : {}
  return Object.keys(ov).filter((k) => ov[k] === 'off')
}
