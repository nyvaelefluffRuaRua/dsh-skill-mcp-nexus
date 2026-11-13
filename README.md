# dsh-skill-mcp-nexus

DSH 面板：在一个界面里统一管理 **skill** 与 **MCP**。

侧边栏管全局和工作区，输入栏管当前会话。每条都能改名、加备注、分组，悬停看详情。

---

## 它解决什么

DSH 的 skill 和 MCP 分散在几处：`~/.dsh/skills` 下的文件、profile 的 `cordis.patch.yml`、会话级配置。想关掉某个 skill 得手动改文件名，想临时在某个会话里屏蔽某个 MCP 又没地方点。

这个插件把两件事合到一处：

- **一处开关** —— skill 和 MCP 在同一个列表里，点一下就行
- **三层隔离** —— 全局改磁盘、工作区改本目录、会话临时屏蔽，互不干扰

---

## 安装

```bash
# 从 npm
dsh plugin --profile default add npm:dsh-skill-mcp-nexus

# 从 GitHub
dsh plugin --profile default add github:nyvaelefluffRuaRua/dsh-skill-mcp-nexus

# 从本地目录
dsh plugin --profile default add <本仓库路径>
```

没有全局 `dsh` 命令的话，用 `npx @deepseek-ai/dsh` 代替 `dsh`。

装完**重启 DSH**。

要求 DSH `>=0.2.0-rc.1 <0.3.0`。
低于这个版本装不上是有意的——本插件用了 `ctx.typert` 服务，老版本没有它，装了会静默失效。

---

## 三层开关怎么理解

只有**全局**会真的动磁盘（把 `SKILL.md` 改名为 `SKILL.md.disabled`）。工作区和会话只能在全局的基础上做减法。

| 层 | 能做什么 | 存在哪 |
|---|---|---|
| **全局** | 真开真关（改文件名） | `state.json` 的 `globalEnabled` |
| **工作区** | 只能关，不能开 | `<工作区>/.dsh/skills/` 放同名壳 |
| **会话** | 只能关，不能开 | `sessionOverlays['ss:<会话id>']` |

**为什么下层不能反向开**：全局关掉的 skill，磁盘文件已经改名，宿主根本扫不到。此时在工作区点「开」没有对象可开——那只是假按钮。

**所以全局关掉的条目，在下层显示为灰色不可点。** 要开就去全局开。

### 开关的四种样子

| 样式 | 含义 |
|---|---|
| 蓝色、白点在右 | 开 |
| 灰色、白点在左 | 关 |
| **橙色、白点在中间** | 全局视图专用——这层关了，但别处还开着 |
| 灰色虚线、点不动 | 全局已关，本层无法操作 |

---

## 界面

**侧边栏面板**（`sidebar.panellist`）

```
[编辑层级] │ [列表 58%]              │ [详情 42%]
 全局  ●   │ 名称   来源   开关       │ 标题
 default   │ ─────────────────────    │ 完整描述
 qq-bridge │ skill-a  dsh    ●        │ 别名
 aa        │ skill-b  dsh    ○        │ 备注
           │                          │ 分组 / 路径
           │                          │ [测试] [删除] [保存]
```

左边每一行带自己的「全开/全关」聚合开关。点中间任意一条，右边显示它的详情——从哪来、干什么用、怎么改。

**输入栏按钮**（`conversation.input.right`）

一个 `skill&mcp` 胶囊，点开是本会话的开关浮层。有东西被关掉时显示 `skill&mcp · N`。这里的改动只影响当前会话。

---

## 其他功能

- **别名 / 备注** —— 长名字可以改成好认的，悬停 0.8 秒显示
- **分组** —— skill 可以归类，列表顶部切换
- **依赖提示** —— 关掉某个 MCP 后，正文里提到过它的 skill 会显示橙色 `⚠`
- **自建 MCP** —— 表单填名称/命令/参数/环境变量，写进插件自己的受管块，你手写的行不动
- **连接测试** —— 对某个 MCP 跑一次 `initialize` + `tools/list`，看它到底活没活

### 关于「连接测试」

点测试会**真的按配置里的 command 起一个子进程**（或向配置的 url 发 HTTP 请求），做一次独立的 MCP 握手，8 秒超时不回就杀掉。

这是有意的：借用宿主已有的连接测不出问题——那条链路可能是坏的，分不清是服务器有问题还是宿主有问题。独立起一个才知道这份配置本身能不能用。

**所以别对来路不明的 MCP 点测试。** 测试执行的就是你写进配置的那条命令。

---

## 已知限制

**`disable-model-invocation: true` 的 skill 开不了**

有些 skill 在 `SKILL.md` 的 frontmatter 里写死了 `disable-model-invocation: true`，作者主动关掉了模型调用。改名法改不回来，界面上会显示为「已停用」并归到折叠区。要恢复只能直接改它的 `SKILL.md`。

**全局关掉的 skill 在宿主里是真的不可见**

不是视觉上隐藏——文件名改了，宿主扫描时根本不会读到它。

**会话级关闭靠「读目录时过滤」，不是靠排名顶替**

会话/工作区层的关闭走的是另一条路：插件读宿主的技能目录时，把被关闭的名字从结果里剔掉。所以模型看不到它，你显式 `/名字` 用也会报 `unknown`。

早先试过「注册一个 rank 更靠前的同名 provider 顶掉原条目」，2026-11-13 确认行不通：`skill` 工具执行时宿主传的 scope 是 AgentLoop（没有父链），provider 候选进得了合并流程却进不了工具拿到的最终结果。排名、挂全局层、挂 `ctx.root` 都试过，都不生效。

**改 MCP 的配置需要完全退出 DSH**

`cordis.patch.yml` 只在进程启动时读一次，重载插件不会重读。

---

## 配置文件

状态存在 `~/.dsh/skill-mcp-nexus/state.json`：

```json
{
  "version": 1,
  "skills": { "<名>": { "alias": "", "note": "", "group": "", "globalEnabled": true } },
  "groups": [],
  "mcp": { "<serverName>": { "alias": "", "note": "", "globalEnabled": true, "dependents": [] } },
  "sessionOverlays": { "ws:<路径>": {...}, "ss:<会话id>": {...} }
}
```

**从旧名 `dsh-skill-mcp-hub` 升级的**：首次运行会把 `~/.dsh/skill-mcp-hub/` 整目录改名到 `skill-mcp-nexus/`，别名、备注、分组、开关全部保留。迁移成功会在 `last-load.json` 里记 `stateMigratedFrom: "skill-mcp-hub"`。

另有一份 `last-load.json`，记录插件上次加载的状态：

```json
{
  "typertBaseOk": true,
  "typertRegistered": true,
  "endpoints": ["skillMcpHub/list", "..."],
  "gateReady": true
}
```

面板打不开时先看这个文件——`typertBaseOk: false` 说明宿主包没解析到，`typertRegistered: false` 说明 manifest 没登记上，两种都是 404 的原因，但修法不同。

---

## 开发

```bash
node selftest.mjs         # 纯逻辑自检，66 项
node manifest-check.mjs   # manifest 合规，13 项
```

服务端改 `lib/index.js` 重载插件即可；客户端改 `lib/client.js` **必须重启应用**。

### 依赖说明

`@deepseek-ai/dsh-typert-protocol` 只随宿主发布，npm 上的版本对不上。插件加载时会依次尝试裸包名、`<execPath>/node_modules/…`、`<execPath>/resources/app/node_modules/…`，都失败就用一个最小桩类顶上——**插件照常加载，只是面板会 404**，而不是整个插件猝死。原因写进 `last-load.json`。

---

## License

[MIT](./LICENSE) © 2026 奈薇
