/**
 * 包名与版本的**唯一真值源**：直接读上一级 `package.json`。
 *
 * 为什么需要这个文件（2026-11-14）：
 * `last-load.json` 的 `version`（`lib/index.js`）与连接测试的 clientInfo
 * （`lib/probe.js`）原来各自硬编码 `'0.1.0'`。`package.json` 抬到 0.1.2 之后，
 * 这两处仍写着 0.1.0 —— 排查时会看到「凭据说 0.1.0、包里说 0.1.2」的自相矛盾，
 * 而且没有任何断言能发现它。
 *
 * 只读一次、模块级求值，换版本时不需要再改代码。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

export const PKG_NAME = String(pkg.name)
export const PKG_VERSION = String(pkg.version)
