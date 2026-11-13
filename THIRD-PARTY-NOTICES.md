# 第三方声明 / Third-Party Notices

本仓库 `dsh-skill-mcp-nexus` 自身以 MIT 许可发布，见 [LICENSE](./LICENSE)。

以下列出了本仓库借用或参考过的第三方作品。按其许可要求，在此保留原始版权声明与许可条款。

---

## dsh-skill-mcp-panel

- 项目：https://github.com/Fishquito7/dsh-skill-mcp-panel
- 许可证：MIT
- 版权：Copyright (c) 2026 dsh-skill-viewer contributors
- 借用范围：`lib/tool-gate.js` 的控制器骨架 —— 包含「重入守卫」「仅在受限集合真正发生变化时才重新施加限制」「监听器归控制器独占」三条约束，以及 `errorText()` / `warnOf()` 两个辅助函数，均参考自该项目 2.3.5 版的 `lib/tool-filter.js`。
- 本仓库在此基础上的改动：跨作用域隔离、结果级过滤、与技能遮蔽链路合并。本仓库是独立实现，不是该项目的分支（fork），也不分发其代码。

```
MIT License

Copyright (c) 2026 dsh-skill-viewer contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## dsh-skillhub

- 项目：https://github.com/vonweller/dsh-skillhub
- 许可证：MIT
- 致谢范围：本仓库「在运行时用宿主 `tools.restrict({ deny })` 屏蔽已注册工具」这一**接口用法**受其启发。调用公共 API 不复制其代码，未分发其任何源文件，故不构成版权客体，此处仅作致谢。

---

## 运行时依赖

以下依赖以 `dependencies` 形式引用，未打包进本仓库的发行物：

| 依赖 | 版本 | 许可证 |
|---|---|---|
| `@modelcontextprotocol/sdk` | 1.32.2 | MIT |
| `zod` | 4.6.7（锁文件解析） | MIT |

宿主 `@deepseek-ai/dsh` 亦为 MIT（Copyright (c) 2026 DeepSeek），本项目仅调用其公开插件接口。

`@deepseek-ai/dsh-typert-protocol` 不随本仓库分发，运行时从已安装的宿主里解析；解析不到时用桩类降级，不影响加载。
