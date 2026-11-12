/**
 * dsh-skill-mcp-hub —— 浏览器半区
 *
 * 打包格式照宿主契约：`window.__ModuleLoader__.load({ id, factory })`，
 * 由宿主以 `/plugins/dsh-skill-mcp-hub/client.js` 提供；只能 require 外壳种子词
 * （react、react/jsx-runtime、@deepseek-ai/dsh-client-ui-primitives）。
 *
 * 设计取向（照主人「简洁实用」的口径）：
 *   · 一页只办一件事 —— 列表 + 行内展开，不搞三栏
 *   · 开关在最右侧固定位置，点一下就生效，不弹确认框
 *   · 说明文字一句能说完，不铺垫
 *   · 悬停显示「别名 — 备注」，两者都空则不显示
 */
window.__ModuleLoader__.load({
  id: 'dsh-skill-mcp-hub',
  factory: (require) => {
    const bundleModule = { exports: {} }
    Object.defineProperty(bundleModule.exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    // 用 React.createElement 而不是 react/jsx-runtime 的 jsx：
    // jsx(type, config, maybeKey) 的 children 必须放在 config.children 里，
    // 写成 h(type, props, '文本') 会让文本被当成 key 静默丢掉（渲染成空壳）。
    const h = React.createElement
    const Fragment = React.Fragment

    const NS = 'ui-skill-mcp-hub'
    const PANEL_ID = 'skill-mcp-hub'

    const zh = {
      nav: 'Skill / MCP Hub',
      title: 'Skill 与 MCP 管理',
      back: '返回会话',
      loading: '读取中…',
      loadError: '读取失败',
      tabSkills: '技能',
      tabMcp: 'MCP',
      allGroups: '全部',
      ungrouped: '未分组',
      searchPlaceholder: '搜索名称或描述…',
      on: '启用',
      off: '停用',
      empty: '没有条目',
      noMatch: '没有匹配的条目',
      alias: '别名',
      aliasPlaceholder: '显示用的名字，留空用原名',
      note: '备注',
      notePlaceholder: '给自己看的说明',
      group: '分组',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      path: 'SKILL.md',
      mcpNoteTitle: '这条要说明',
      toolCount: '工具',
      enableFailed: '切换失败',
      frontmatterOff: '被 SKILL.md 里的 frontmatter 关掉了，改名改不回来',
      test: '测试连接',
      testing: '测试中…',
      testOk: '连接成功',
      testFail: '连接失败',
      remove: '删除',
      addServer: '+ 新建服务器',
      addCancel: '取消',
      addSubmit: '写入配置',
      serverName: '名称',
      serverNameHint: '只允许字母数字下划线连字符',
      transport: '方式',
      command: '命令',
      argsLabel: '参数（空格分隔）',
      urlLabel: 'URL',
      patchDisabled: '配置文件里标了 disabled',
      addOk: '已写入，重启后生效',
      argsEachLine: '参数（每行一个）',
      argsEachLineHint: '一行一个，带空格的参数不会被切坏',
      advanced: '高级设置',
      envVars: '环境变量',
      httpHeaders: '请求头',
      envVarsHint: '一行一个 KEY=value',
      dependsSoftTag: '疑似依赖',
      dependsSoftHint: '扫到这些技能里提过它：',
      dependsSoftCaution: '仅供参考：只看了提没提名字，不代表真依赖',
      dependsHint: '关掉它，下面这些会失效：',      diskDisabledTag: '已停用',
      diskDisabledHint: '已停用（文件改成了 .disabled），这里开不了。去全局开',
      runtimeSection: '运行时参数',
      timeoutLabel: '单次调用超时（毫秒）',
      timeoutHint: '留空用默认 60000',
      failOnStartupLabel: '启动失败时报错',
      reconnectLabel: '自动重连',
      rcInitialLabel: '首次重连延迟（毫秒）',
      rcMaxLabel: '最大重连延迟（毫秒）',
      rcAttemptsLabel: '最大重连次数',
      runtimeHint: '留空就用默认值，平时不用动',
      serverNameBad: '只能用字母、数字、下划线、连字符',
      mcpOffHint: '这些 MCP 被关掉了，用到它们的技能可能跑不起来：',
      addNote: '只写进本插件的配置，你手写的一行都不动',
      enableAll: '全部开启',
      enablingAll: '正在开启…',
      enableAllCount: '已关闭',      enableAllSub: '清掉本层关闭',
      enableAllGlobalHint: '把本层关掉的都打开',
      enableAllWsHint: '把本工作区关掉的都打开，跟着全局走',
      enableAllPartial: '部分开启失败：',
      unusableLabel: '不可用',
      unusableHint: '转发壳 · 手动型 · 作者停用',
      kindForwarder: '转发壳',
      kindManualOnly: '手动触发型',
      kindAuthorOff: '作者停用',
      kindDiskOff: '磁盘停用',
      kindShadow: '遮蔽占位',
      detailEmpty: '点左边一条看详情',
      colDesc: '描述',
      colSource: '来源',
      colState: '开关',      levelTitle: '编辑层级',
      levelExplainShort: '全局管全部；工作区只管自己那份。白点在中间＝动过',
      wsCurrent: '当前',      levelGlobal: '全局',
      levelWorkspace: '工作区',
      levelDetail: '层级说明',
      globalHint: '全局关掉的，下面各层开了也不管用',
      workspaceHint: '只影响这个工作区，同目录的会话共用',
      lockedHint: '这个技能在全局被关掉了，得去全局开。\n本层改不了。',
      lockedAria: '全局已关闭，这里开不了',
      overrideAria: '本层已覆盖全局',
      levelExplain: '全局定基调。工作区只能关掉个别项，不能反过来开。白点在中间＝动过',
      levelWorkspaceActive: '现在改的是工作区',
      scopeOff: '作用全局',
      scopeHint: '勾上后，下面只改这个工作区，不动全局',
      noWorkspace: '当前没有活动会话',
      newGroup: '新建分组',
      groupNamePlaceholder: '分组名，回车确认',
      renameGroup: '重命名',
      deleteGroupHint: '只解散分组，里面的技能不会被删',
      confirm: '确认删除',
      cancel: '取消',
      deleteFailed: '删除分组失败',
      saveFailed: '保存失败',
      sessionDockLabel: 'skill&mcp',
      sessionDock: '本会话',
      sessionOff: '本会话已关',
      sessionDockTitle: '只作用于当前会话',
      sessionDockHint: '管理这个会话要关掉的东西',
      sessionDockFoot: '只影响这个会话，不动全局和工作区',
      dockSearchPlaceholder: '搜索名称或别名…',
      dockOffSummary: '本会话已关：',
      dockOnlyOff: '只看已关',
    }

    const en = {
      nav: 'Skill / MCP Hub',
      title: 'Skills & MCP',
      back: 'Back to session',
      loading: 'Loading…',
      loadError: 'Load failed',
      tabSkills: 'Skills',
      tabMcp: 'MCP',
      allGroups: 'All',
      ungrouped: 'Ungrouped',
      searchPlaceholder: 'Search name or description…',
      on: 'Enabled',
      off: 'Disabled',
      empty: 'Nothing here',
      noMatch: 'No matches',
      alias: 'Alias',
      aliasPlaceholder: 'Display name; empty uses the real name',
      note: 'Note',
      notePlaceholder: 'A note for yourself',
      group: 'Group',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      path: 'SKILL.md',
      mcpNoteTitle: 'Note',
      toolCount: 'tools',
      enableFailed: 'Toggle failed',
      frontmatterOff: 'Disabled by frontmatter in SKILL.md; renaming cannot re-enable it',
      test: 'Test',
      testing: 'Testing…',
      testOk: 'Connected',
      testFail: 'Failed',
      remove: 'Delete',
      addServer: '+ New server',
      addCancel: 'Cancel',
      addSubmit: 'Write config',
      serverName: 'Name',
      serverNameHint: 'letters, digits, underscore, hyphen',
      transport: 'Transport',
      command: 'Command',
      argsLabel: 'Args (space separated)',
      urlLabel: 'URL',
      patchDisabled: 'disabled: true in patch',
      addOk: 'Written; takes effect after restart',
      argsEachLine: 'Args (one per line)',
      argsEachLineHint: 'One arg per line — args containing spaces survive intact',
      advanced: 'Advanced',
      envVars: 'Environment',
      httpHeaders: 'Headers',
      envVarsHint: 'One KEY=value per line; empty values are written as-is',
      dependsSoftTag: 'maybe used',
      dependsSoftHint: 'Auto-scan found these skills mentioning it:',
      dependsSoftCaution: 'Reference only: it just checks the name appears, not real dependency',
      dependsHint: 'Turning it off breaks:',      diskDisabledTag: 'disabled',
      diskDisabledHint: 'Disabled (file renamed to .disabled). Cannot enable here — go to Global.',
      runtimeSection: 'Runtime',
      timeoutLabel: 'Tool call timeout (ms)',
      timeoutHint: 'Blank uses 60000',
      failOnStartupLabel: 'Fail loudly on startup error',
      reconnectLabel: 'Auto reconnect',
      rcInitialLabel: 'Initial delay (ms)',
      rcMaxLabel: 'Max delay (ms)',
      rcAttemptsLabel: 'Max attempts',
      runtimeHint: 'Blank fields keep the host defaults. Only touch these when needed.',      cwdLabel: 'Working directory (blank = default)',
      serverNameBad: 'Letters, digits, underscore, hyphen only',
      mcpOffHint: 'These MCP servers are off; skills using them may not work:',
      addNote: 'Only touches this plugin\x27s own config; your handwritten rows stay as-is',
      enableAll: 'Enable all',
      enablingAll: 'Enabling…',
      enableAllCount: 'closed',      enableAllSub: 'clear off here',
      enableAllGlobalHint: 'Turn everything back on in this level',
      enableAllWsHint: 'Clear the items this workspace turned off; follow global',
      enableAllPartial: 'Some failed:',
      unusableLabel: 'Unusable',
      unusableHint: 'forwarder · manual-only · author-off',
      kindForwarder: 'Forwarder',
      kindManualOnly: 'Manual-only',
      kindAuthorOff: 'Author-off',
      kindDiskOff: 'Disk-off',
      kindShadow: 'Shadow',
      detailEmpty: 'Pick an item on the left',
      colDesc: 'Description',
      colSource: 'Source',
      colState: 'On / Off',      levelTitle: 'Editing level',
      levelExplainShort: 'Global rules all; a workspace only turns items off. Middle knob = changed here',
      wsCurrent: 'now',      levelGlobal: 'Global',
      levelWorkspace: 'Workspace',
      levelDetail: 'Levels',
      globalHint: 'What global turns off stays off below',
      workspaceHint: 'This workspace only; shared by its sessions',
      lockedHint: 'Turned off at Global. Go there to turn it back on.\nCannot enable it here.',
      lockedAria: 'Off at global; cannot enable here',      overrideHint: 'This layer overrides global (the knob sits in the middle)',
      overrideAria: 'Overrides global',
      levelExplain: 'Global sets the baseline. A workspace can only turn items off, not back on. Knob in the middle = changed here',
      levelWorkspaceActive: 'Editing: this workspace',      scopeOn: 'This session only',
      scopeOff: 'Global',
      scopeHint: 'When checked, toggles below change only this workspace',
      noWorkspace: 'No active session',
      newGroup: 'New group',
      groupNamePlaceholder: 'Group name, Enter to confirm',
      renameGroup: 'Rename',
      deleteGroupHint: 'Only dissolves the group; skills inside are kept',
      confirm: 'Delete',
      cancel: 'Cancel',
      deleteFailed: 'Failed to delete group',
      saveFailed: 'Save failed',
      sessionDockLabel: 'skill&mcp',
      sessionDock: 'Session',
      sessionOff: 'Off here',
      sessionDockTitle: 'Applies to this session only',
      sessionDockHint: 'Manage what this session turns off',
      sessionDockFoot: 'This session only — globals and workspace untouched',
      dockSearchPlaceholder: 'Search name or alias…',
      dockOffSummary: 'Off in this session:',
      dockOnlyOff: 'Off only',
    }

    // ── 远程贡献 ────────────────────────────────────────────────────────
    // 客户端必须自己 $mount 过这些描述符才能调到；漏一条就是运行期
    // "remote[method] is not a function"。
    const codec = (typeSymbol) => ({
      mode: 'strict',
      typeSymbol,
      create: () => ({ parse: (value) => value }),
    })

    const NO_ARG = new Set(['list', 'diagnose'])
    const methods = ['list', 'toggle', 'annotate', 'saveGroup', 'deleteGroup', 'sessionState', 'testServer', 'addServer', 'removeServer', 'diagnose']

    const CONTRIBUTION = {
      package: 'dsh-skill-mcp-hub',
      descriptors: methods.map((method) => ({
        id: `dsh-skill-mcp-hub#skillMcpHub/${method}`,
        service: 'skillMcpHub',
        namespace: 'skillMcpHub',
        method,
        invocation: { kind: 'direct' },
        parameters: NO_ARG.has(method)
          ? []
          : [{ name: 'payload', wire: 'payload', source: 'json', acceptsUndefined: true, codec: codec('json') }],
        result: codec(`dsh-skill-mcp-hub#${method}Result`),
      })),
    }

    // ── 样式（尽量少而整齐）────────────────────────────────────────────
    const CSS = `
/* ── 统一视觉规范（跟宿主 UI 对齐）─────────────────────────────────
   字号：11 / 12 / 13 三档，来自 --dsw-font-xxx*-font-size
   圆角：xs 4 / sm 8 / md 12
   间距：4 的倍数
   颜色：一律走宿主 token，不写死
   ─────────────────────────────────────────────────────────────── */
.HUB_root{display:flex;flex-direction:column;height:100%;min-height:0;width:100%;box-sizing:border-box;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:var(--dsw-font-s-14-font-size,14px);
/* ── 尺寸令牌（2026-11-11 集中可调：下一轮只改这里）────────────────
   --hub-side-w        左栏「全局/工作区」宽度
   --hub-side-px/py    左栏容器左右/上下内边距
   --hub-item-px/py    左栏每个层级项左右/上下内边距
   --hub-body-px/py    右侧内容区左右/上下内边距
   节奏：所有内外边距取 4 的倍数，左右差值保持 2 的递增
   ──────────────────────────────────────────────────────────────── */
--hub-shell-w:1800px;--hub-col-name:150px;--hub-col-gap:8px;--hub-col-gapmid:160px;--hub-col-source:120px;--hub-side-w:212px;--hub-side-px:19px;--hub-side-py:26px;--hub-item-px:19px;--hub-item-py:16px;--hub-body-px:18px;--hub-body-py:15px}


/* ── 顶栏：一行装下，窄屏换行 ── */
.HUB_bar{display:flex;align-items:center;gap:8px;padding:12px var(--hub-body-px);border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;flex-wrap:wrap;width:100%;max-width:var(--hub-shell-w);margin:0 auto;box-sizing:border-box}
.HUB_back{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:4px 8px;border-radius:var(--dsw-radius-xs);font-size:var(--dsw-font-s-14-font-size,14px);white-space:nowrap}
.HUB_back:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.HUB_title{font-weight:600;font-size:var(--dsw-font-s-14-font-size,14px);white-space:nowrap}
.HUB_search{flex:1 1 180px;min-width:140px;max-width:340px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-sm);padding:5px 10px;font-size:var(--dsw-font-s-14-font-size,14px);outline:none;box-sizing:border-box}
.HUB_search:focus{border-color:var(--dsw-alias-border-l3)}
/* 页签：分段控件样式 */
.HUB_tabs{display:flex;gap:2px;margin-left:auto;padding:2px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover)}
.HUB_tab{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:4px 12px;border-radius:var(--dsw-radius-xs);font-size:var(--dsw-font-s-14-font-size,14px);white-space:nowrap;transition:background .12s,color .12s}
.HUB_tab[data-active=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:600}

/* ── 分组 chip 与操作行 ── */
.HUB_chips{display:flex;gap:6px;flex-wrap:wrap;padding:8px 16px 0;flex:none}
.HUB_chip{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:3px 10px;border-radius:999px;font-size:var(--dsw-font-s-14-font-size,14px);white-space:nowrap;transition:background .12s,border-color .12s,color .12s}
.HUB_chip:hover{border-color:var(--dsw-alias-border-l3)}
.HUB_chip[data-active=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}

/* ── 主体：左竖栏 + 右列表 ── */
.HUB_main{flex:auto;min-height:0;min-width:0;display:flex;align-items:stretch;width:100%;max-width:var(--hub-shell-w);margin:0 auto;box-sizing:border-box}
.HUB_side{flex:none;width:var(--hub-side-w);box-sizing:border-box;padding:var(--hub-side-py) var(--hub-side-px);border-right:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:6px;overflow:auto}
.HUB_sideTitle{font-size:var(--dsw-font-s-14-font-size,14px);color:var(--dsw-alias-label-tertiary);padding:0 8px 6px}
.HUB_sideItem{display:flex;flex-direction:column;align-items:flex-start;gap:3px;width:100%;box-sizing:border-box;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:var(--dsw-radius-md);padding:var(--hub-item-py) var(--hub-item-px);text-align:left;font-size:var(--dsw-font-s-14-font-size,14px);transition:background .14s,border-color .14s,color .14s}
.HUB_sideItem:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.HUB_sideItem[data-active=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);font-weight:600;box-shadow:inset 2px 0 0 var(--dsw-alias-button-info-fill,#4176e6)}
.HUB_sideName{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;min-width:0;flex:1 1 auto}
.HUB_sideSub{font-size:var(--dsw-font-s-14-font-size,14px);color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
/* 竖栏里的三态开关：比列表里的小一圈，右对齐 */
.HUB_sideAll{flex-direction:row;align-items:center;justify-content:space-between;gap:6px}
.HUB_swSide{justify-self:auto;width:32px;height:16px}
.HUB_swSide::after{top:2px;width:10px;height:10px}
.HUB_swSide[data-on=true]::after{left:18px}
.HUB_swSide[data-state=override]::after{left:11px}
/* 竖栏里的三态开关：和文字并排同一行，右对齐 */
.HUB_sideAll{flex-direction:row;align-items:center;justify-content:space-between;gap:8px}
.HUB_swSide{justify-self:auto;flex:none;width:36px;height:20px}
.HUB_swSide::after{top:2px;width:10px;height:10px}
.HUB_swSide[data-on=true]::after{left:18px}
.HUB_swSide[data-state=override]::after{left:11px}
/* 工作区名：允许截断，别把开关挤走 */
.HUB_sideWsName{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden}\n.HUB_sideWsName>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.HUB_sideCur{flex:none;font-size:11px;padding:1px 5px;border-radius:999px;background:color-mix(in srgb, var(--dsw-alias-button-info-fill,#4176e6) 16%, transparent);color:var(--dsw-alias-button-info-fill,#4176e6);line-height:13px;font-weight:600}/* ── 左列表 + 右详情（2026-11-11，参照模组管理器）── */
.HUB_split{display:flex;align-items:stretch;gap:0;flex:1;min-height:0;width:100%}
.HUB_listPane{flex:0 0 58%;min-width:0;display:flex;flex-direction:column;min-height:0;padding-right:12px;box-sizing:border-box}
.HUB_listScroll{flex:1;min-height:0;overflow:auto;overflow-x:hidden;display:flex;flex-direction:column;gap:6px;padding-bottom:8px}
        /* 不可用折叠条（2026-11-13）：默认收起，点开看原因 */
        .HUB_unusableBar{display:flex;align-items:center;gap:7px;width:100%;box-sizing:border-box;
          margin:2px 0 6px;padding:6px 10px;border:1px dashed var(--dsw-alias-border-l3,#2E3947);
          border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary,#83909F);
          font:inherit;font-size:12px;cursor:pointer;text-align:left}
        .HUB_unusableBar:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.04))}
        .HUB_unusableBar[data-open=true]{border-style:solid}
        .HUB_unusableArrow{flex:none;width:12px;font-size:11px;line-height:1}
        .HUB_unusableHint{margin-left:auto;font-size:11px;opacity:.7}
        /* 行内的「为什么不可用」小标签 */
        .HUB_kindTag{flex:none;margin-left:6px;padding:1px 6px;border-radius:999px;font-size:10.5px;
          line-height:1.5;background:var(--dsw-alias-bg-l3,#18202A);
          color:var(--dsw-alias-label-tertiary,#83909F);white-space:nowrap}
.HUB_detailPane{flex:1;min-width:0;min-height:0;overflow:auto;border-left:1px solid var(--dsw-alias-border-l1);padding-left:16px;box-sizing:border-box}
.HUB_detailEmpty{color:var(--dsw-alias-label-tertiary);font-size:var(--dsw-font-xxs-12-font-size,12px);padding:24px 0;text-align:center}
.HUB_detailHead{margin-bottom:4px}
.HUB_detailTitle{font-size:var(--dsw-font-base-16-font-size,16px);font-weight:600;color:var(--dsw-alias-label-primary);word-break:break-all;line-height:1.4}
.HUB_detailSub{font-size:var(--dsw-font-xxs-12-font-size,12px);color:var(--dsw-alias-label-tertiary);margin-top:2px;word-break:break-all}
.HUB_detailDesc{font-size:var(--dsw-font-xxs-12-font-size,12px);color:var(--dsw-alias-label-secondary);line-height:1.6;white-space:pre-wrap;word-break:break-word}
/* 行被选中：左侧强调线 + 底色 */
.HUB_row[data-active=true]{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3);box-shadow:inset 2px 0 0 var(--dsw-alias-button-info-fill,#4176e6)}.HUB_sideFoot{margin-top:auto;padding:10px 8px 0;font-size:var(--dsw-font-s-14-font-size,14px);line-height:1.6;color:var(--dsw-alias-label-tertiary);border-top:1px solid var(--dsw-alias-border-l1)}

/* ── 列表：卡片式 ── */
.HUB_body{flex:auto;min-height:0;min-width:0;overflow:auto;overflow-x:hidden;padding:var(--hub-body-py) var(--hub-body-px) 24px;box-sizing:border-box;display:flex;flex-direction:column;gap:6px}
.HUB_row{display:grid;grid-template-columns:var(--hub-col-name) var(--hub-col-gapmid) var(--hub-col-source) minmax(0,1fr) 50px;gap:var(--hub-col-gap);align-items:center;padding:11px 13px;border-radius:var(--dsw-radius-md);cursor:pointer;min-width:0;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);transition:background .14s,border-color .14s,box-shadow .14s}
.HUB_row>*{min-width:0}
.HUB_row:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2);box-shadow:var(--dsw-elevation-panel)}
.HUB_row[data-open=true]{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3);box-shadow:var(--dsw-elevation-panel)}
/* 表头不做卡片感 */
.HUB_head{color:var(--dsw-alias-label-tertiary);font-size:var(--dsw-font-s-14-font-size,14px);cursor:default;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);border-radius:0;padding:0 14px 9px;margin-bottom:4px;letter-spacing:.02em}
.HUB_head:hover{background:transparent;border-color:var(--dsw-alias-border-l1);box-shadow:none}
.HUB_nameWrap{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;flex:1 1 auto}
.HUB_caret{flex:none;width:10px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1}.HUB_name{min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dsw-font-s-14-font-size,14px);letter-spacing:.01em}
.HUB_spacer{ min-width:0 }
/* 依赖的 MCP 被关了：小号橙色 ⚠，不抢眼但能看见 */
.HUB_needWarn{flex:none;font-size:11px;line-height:1;color:var(--dsw-alias-state-warn-primary,#d29922);cursor:help}
.HUB_gapMid{ min-width:0 }
.HUB_desc{min-width:0;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:1.5}
.HUB_small{min-width:0;color:var(--dsw-alias-label-tertiary);font-size:var(--dsw-font-xxs-12-font-size,12px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ── 开关：38×18，三态 ── */
.HUB_sw{justify-self:end;flex:none;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:999px;width:44px;height:24px;padding:0;position:relative;transition:background .14s,border-color .14s;box-sizing:border-box}
.HUB_sw::after{content:'';position:absolute;top:4px;left:4px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary);transition:left .12s,background .12s}
.HUB_sw[data-on=true]{border-color:transparent;background:var(--dsw-alias-button-info-fill,#4176e6)}
.HUB_sw[data-on=true]::after{left:25px;background:#fff}
/* 中间态：本层与全局不同，白点停正中 */
.HUB_sw[data-state=override]{border-color:var(--dsw-alias-state-warn-primary,#d29922);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#d29922) 24%, transparent)}
.HUB_sw[data-state=override]::after{left:12px;background:var(--dsw-alias-state-warn-primary,#d29922)}
.HUB_sw:disabled{opacity:.45;cursor:not-allowed}
/* 全局关着 ⇒ 锁定态：虚线边框告诉用户"这不是本层能决定的事" */
.HUB_sw[data-state=locked]{border-style:dashed;border-color:var(--dsw-alias-border-l2);background:transparent;opacity:.5}
.HUB_sw[data-state=locked]::after{left:2px;background:var(--dsw-alias-label-tertiary);opacity:.6}

/* ── 行内展开编辑区 ── */
.HUB_detail{display:flex;flex-direction:column;gap:10px;padding:8px 2px 4px;border-top:1px solid var(--dsw-alias-border-l1);margin-top:8px;cursor:default}
.HUB_field{display:flex;flex-direction:column;gap:4px}
.HUB_label{color:var(--dsw-alias-label-tertiary);font-size:var(--dsw-font-s-14-font-size,14px)}
.HUB_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-xs);padding:5px 8px;font-size:var(--dsw-font-s-14-font-size,14px);outline:none;width:100%;box-sizing:border-box}
.HUB_input:focus{border-color:var(--dsw-alias-border-l3)}
.HUB_actions{grid-column:1/-1;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.HUB_btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:var(--dsw-radius-sm);padding:5px 14px;font-size:var(--dsw-font-s-14-font-size,14px);transition:border-color .12s}
.HUB_btn:hover{border-color:var(--dsw-alias-border-l3)}
.HUB_btn:disabled{opacity:.45;cursor:not-allowed}
.HUB_hint{color:var(--dsw-alias-label-tertiary);font-size:var(--dsw-font-s-14-font-size,14px)}
.HUB_warn{color:var(--dsw-alias-state-warn-primary,#d29922);font-size:var(--dsw-font-s-14-font-size,14px)}
.HUB_tip{margin-top:16px;padding:10px 12px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:var(--dsw-font-s-14-font-size,14px);line-height:1.65}
.HUB_err{color:var(--dsw-alias-state-error-primary);font-size:var(--dsw-font-s-14-font-size,14px);padding:8px 0}
.HUB_muted{color:var(--dsw-alias-label-tertiary);font-size:var(--dsw-font-s-14-font-size,14px);padding:16px 0}

/* ── 悬停浮层 ── */
.HUB_hover{position:fixed;z-index:200;max-width:320px;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-elevation-panel);pointer-events:none;font-size:var(--dsw-font-s-14-font-size,14px);line-height:1.55}
.HUB_hoverAlias{font-weight:600;margin-bottom:2px;word-break:break-word}
.HUB_hoverNote{color:var(--dsw-alias-label-secondary);word-break:break-word;white-space:pre-wrap}

/* ── 输入栏浮层（向 DSH 对齐）── */
.HUB_dockPanel{position:absolute;bottom:calc(100% + 8px);right:0;width:288px;max-height:min(52vh,420px);display:flex;flex-direction:column;overflow:hidden;padding:10px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-elevation-prominent);z-index:60;box-sizing:border-box;text-align:left}
.HUB_dockHead{font-size:var(--dsw-font-s-14-font-size,14px);font-weight:600;color:var(--dsw-alias-label-primary);padding:0 0 8px;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:4px}
.HUB_dockSearch{width:100%;box-sizing:border-box;margin:8px 0 0;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-xs);padding:4px 8px;font-size:var(--dsw-font-s-14-font-size,14px);outline:none}
.HUB_dockSearch:focus{border-color:var(--dsw-alias-border-l3)}
.HUB_dockTabs{display:flex;gap:2px;padding:9px 0 5px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:6px}
.HUB_dockTab{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:3px 10px;border-radius:var(--dsw-radius-xs);font-size:var(--dsw-font-s-14-font-size,14px);white-space:nowrap}
.HUB_dockTab[data-active=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}
.HUB_dockList{flex:1;min-height:0;overflow:auto;margin-top:2px}
.HUB_dockRow{display:flex;align-items:center;gap:9px;padding:5px 6px;border-radius:var(--dsw-radius-xs);cursor:default;transition:background .12s}
.HUB_dockRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.HUB_dockRow[data-off=true] .HUB_dockName{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}
.HUB_dockRow[data-locked=true] .HUB_dockName{color:var(--dsw-alias-label-tertiary);opacity:.75}
.HUB_dockName{flex:1;min-width:0;overflow:hidden;font-size:var(--dsw-font-s-14-font-size,14px);color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:7px}\n.HUB_dockName>:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.HUB_dockTag{flex:none;font-size:11px;padding:1px 5px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary);line-height:13px}
/* 「有依赖」标签：比"文件已关"更要紧，用警告色描边但不抢眼 */
.HUB_depTag{flex:none;font-size:11px;padding:1px 5px;border-radius:999px;background:color-mix(in srgb, var(--dsw-alias-state-warn-primary,#d29922) 14%, transparent);color:var(--dsw-alias-state-warn-primary,#d29922);line-height:13px}
/* 「疑似依赖」：虚线灰，视觉上明显轻于 hard 那档，避免误导 */
.HUB_depTagSoft{flex:none;font-size:11px;padding:1px 5px;border-radius:999px;border:1px dashed var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary);line-height:13px}
`

    /**
     * 注入样式（2026-11-12 改）。
     *
     * 原来「元素已存在就直接 return」⇒ 插件更新后**新样式不会生效**，
     * 界面看着像「改了代码没反应」。现在存在就更新内容。
     */
    function ensureStyle() {
      if (typeof document === 'undefined') return
      const id = 'hub-style-' + NS
      const existing = document.getElementById(id)
      if (existing !== null) {
        if (existing.textContent !== CSS) existing.textContent = CSS
        return
      }
      const el = document.createElement('style')
      el.id = id
      el.textContent = CSS
      document.head.appendChild(el)
    }

    /**
     * 侧栏图标（2026-11-11 主人要求换掉）。
     *
     * 原图标是个抽象的「云朵/鲸鱼尾」形状，跟「管理 skill 与 MCP」看不出关系。
     * 换成**层叠的三层方块 + 右侧开关点**，对应这个插件真正的语义：
     *   · 三层 = 全局 / 工作区 / 会话 的层级模型
     *   · 每层右侧的小实心圆 = 「每条可单独开关」
     *
     * 16×16 网格、1.3 描边、跟随 currentColor（浅/深主题自适应）。
     */
    function HubIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 16
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        // 三层**左边缘对齐**（2026-11-11 主人要求），宽度自上而下递增
        // 上层（会话层）：最窄
        h('rect', { x: 1, y: 2, width: 7, height: 3.2, rx: 1, stroke: 'currentColor', strokeWidth: 1.3 }),
        // 中层（工作区层）
        h('rect', { x: 1, y: 7, width: 11, height: 3.2, rx: 1, stroke: 'currentColor', strokeWidth: 1.3 }),
        // 下层（全局层）：最宽，代表基准
        h('rect', { x: 1, y: 12, width: 14, height: 3.2, rx: 1, stroke: 'currentColor', strokeWidth: 1.3 }),
        // 开关点：贴各自层条的右端（左对齐后右端呈阶梯）
        h('circle', { cx: 6.8, cy: 3.6, r: 0.75, fill: 'currentColor' }),
        h('circle', { cx: 10.8, cy: 8.6, r: 0.75, fill: 'currentColor' }),
        h('circle', { cx: 13.8, cy: 13.6, r: 0.75, fill: 'currentColor' })
      )
    }

    /**
     * 悬停提示内容（需求⑤）：别名 + 备注。
     *
     * 返回 `undefined` 表示「这个条目没设过任何东西」—— 此时不显示浮层，
     * 不能弹一个空框出来（那是噪音，不是信息）。
     */
    function tipPartsOf(row) {
      if (row === null || typeof row !== 'object') return undefined
      const alias = typeof row.alias === 'string' ? row.alias.trim() : ''
      const note = typeof row.note === 'string' ? row.note.trim() : ''
      if (alias === '' && note === '') return undefined
      return { alias, note }
    }

    /** 拼成一行文本（给 title 兜底 / 测试断言用）。 */
    function tipOf(row) {
      const parts = tipPartsOf(row)
      if (parts === undefined) return undefined
      if (parts.alias !== '' && parts.note !== '') return parts.alias + ' — ' + parts.note
      return parts.alias !== '' ? parts.alias : parts.note
    }

    /**
     * 自定义悬停浮层。
     *
     * 为什么不用原生 `title`：深色主题下它弹的是系统浅色方块、不能换行、
     * 长备注被截断，出现延迟也不可控。这里自己控延迟（450ms），
     * 移开立刻消失，样式跟随宿主令牌。
     */
    function HoverTip(props) {
      const parts = props?.parts
      if (parts === undefined) return null
      return h(
        'div',
        {
          className: 'HUB_hover',
          /**
           * 位置夹取（2026-11-12）：提示要留在视口内。
           * 浮层在右侧时，`x + 16` 可能超出窗口右边界 → 往左翻。
           * 简单估算：最大宽 320px，留 16px 边距。
           */
          style: {
            left: Math.max(8, Math.min(props.x ?? 8, (typeof window !== 'undefined' ? window.innerWidth : 1920) - 340)) + 'px',
            top: Math.max(8, props.y ?? 0) + 'px',
          },
          role: 'tooltip',
        },
        parts.alias !== '' ? h('div', { className: 'HUB_hoverAlias' }, parts.alias) : null,
        parts.note !== '' ? h('div', { className: 'HUB_hoverNote' }, parts.note) : null
      )
    }

    /** 行内编辑区：别名 / 备注 / 分组 + 保存。 */
    function RowDetail(props) {
      const { t, row, groups, onSave, saving, saved } = props
      const [alias, setAlias] = React.useState(row.alias ?? '')
      const [note, setNote] = React.useState(row.note ?? '')
      const [group, setGroup] = React.useState(row.group ?? '')

      const dirty = alias !== (row.alias ?? '') || note !== (row.note ?? '') || group !== (row.group ?? '')

      const input = (labelKey, value, onChange, placeholderKey) =>
        h(
          'label',
          { className: 'HUB_field' },
          h('span', { className: 'HUB_label' }, t(labelKey)),
          h('input', {
            className: 'HUB_input',
            value,
            placeholder: t(placeholderKey),
            onChange: (event) => onChange(event.target.value),
            onClick: (event) => event.stopPropagation(),
          })
        )

      return h(
        'div',
        { className: 'HUB_detail', onClick: (event) => event.stopPropagation() },
        /**
         * 详情头部 + 完整描述（2026-11-11 主人要求「描述放到右栏里」）。
         *
         * 列表里的描述是**截断版**（负责"认出是哪条"），
         * 这里给**完整版**（负责"看清是什么"）——两者都要，不是二选一。
         */
        h(
          'div',
          { className: 'HUB_detailHead' },
          h('div', { className: 'HUB_detailTitle' }, row.alias || row.name || row.serverName || '')
        ),
        h(
          'div',
          { className: 'HUB_field' },
          h('span', { className: 'HUB_label' }, t('colDesc')),
          h('div', { className: 'HUB_detailDesc' }, row.description || row.command || row.url || '—')
        ),
        input('alias', alias, setAlias, 'aliasPlaceholder'),
        input('note', note, setNote, 'notePlaceholder'),
        h(
          'label',
          { className: 'HUB_field' },
          h('span', { className: 'HUB_label' }, t('group')),
          h(
            'select',
            {
              className: 'HUB_input',
              value: group,
              onChange: (event) => setGroup(event.target.value),
            },
            h('option', { value: '' }, t('ungrouped')),
            groups.map((g) => h('option', { key: g.id, value: g.id }, g.name))
          )
        ),
        h(
          'div',
          { className: 'HUB_field' },
          h('span', { className: 'HUB_label' }, t('path')),
          h('span', { className: 'HUB_small' }, row.dir ?? '')
        ),
        row.disabledByFrontmatter === true && row.isShadow !== true
          ? h('div', { className: 'HUB_actions' }, h('span', { className: 'HUB_warn' }, t('frontmatterOff')))
          : null,
        /** MCP 专属动作：测试连接 / 删除（2026-11-11 从行内挪到右栏详情）。 */
        props.onTest !== undefined
          ? h(
              'div',
              { className: 'HUB_actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'HUB_btn',
                  disabled: props.testing === true,
                  onClick: () => void props.onTest(),
                },
                props.testing === true ? t('testing') : t('test')
              ),
              props.testResult !== undefined && props.testResult.key === undefined
                ? null
                : null
            )
          : null,
        props.testResult !== undefined && props.testResult.text !== undefined
          ? h('div', { className: props.testResult.ok === true ? 'HUB_hint' : 'HUB_warn' }, props.testResult.text)
          : null,
        props.onRemove !== undefined
          ? h(
              'div',
              { className: 'HUB_actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'HUB_btn',
                  onClick: () => void props.onRemove(),
                },
                t('remove')
              )
            )
          : null,
        h(
          'div',
          { className: 'HUB_actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'HUB_btn',
              disabled: saving === true || dirty === false,
              onClick: () => onSave({ alias, note, group }),
            },
            saving === true ? t('saving') : t('save')
          ),
          saved === true ? h('span', { className: 'HUB_hint' }, t('saved')) : null,
          dirty === true && saved !== true ? h('span', { className: 'HUB_hint' }, '•') : null
        )
      )
    }

    /** 新建 MCP 服务器的小表单（只写自己的受管块）。 */
    /**
     * 添加 MCP 服务器（2026-11-11 主人给了已装插件的对话框作参照）。
     *
     * 对齐它的结构：名称 / 调用方式（STDIO·HTTP）/ 命令 / 参数（每行一个）/ 环境变量 / 工作目录。
     * **刻意做的三处区别**：
     *   ① 参数是「每行一个」而不是空格分隔 —— 带空格的参数不会被切坏
     *   ② 环境变量与 headers 放同一个折叠区（HTTP 用 headers，STDIO 用 env）
     *   ③ 实时校验提示直接贴在字段下面，不是提交后才在顶上飘一行红字
     */
    function AddServerForm(props) {
      const { t, onSubmit, onCancel, busy, done, error } = props
      const [name, setName] = React.useState('')
      const [transport, setTransport] = React.useState('stdio')
      const [command, setCommand] = React.useState('')
      const [argsText, setArgsText] = React.useState('')
      const [url, setUrl] = React.useState('')
      const [envText, setEnvText] = React.useState('')
      const [cwd, setCwd] = React.useState('')
      const [advanced, setAdvanced] = React.useState(false)
      // 运行时参数（高级区）：宿主 mcp-client 支持的字段
      const [timeoutMs, setTimeoutMs] = React.useState('')
      const [failOnStartup, setFailOnStartup] = React.useState(false)
      const [rcEnabled, setRcEnabled] = React.useState(true)
      const [rcInitial, setRcInitial] = React.useState('')
      const [rcMax, setRcMax] = React.useState('')
      const [rcAttempts, setRcAttempts] = React.useState('')

      const nameOk = /^[A-Za-z0-9_-]+$/.test(name)
      const bodyOk = transport === 'stdio' ? command.trim() !== '' : url.trim() !== ''
      /** 参数按行拆，过滤空行 —— 这样参数里带空格也不会被切坏。 */
      const args = argsText
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s !== '')
      /** `KEY=value` 逐行解析；HTTP 下当 headers 用。 */
      const pairs = {}
      for (const line of envText.split('\n')) {
        const idx = line.indexOf('=')
        if (idx <= 0) continue
        const k = line.slice(0, idx).trim()
        const v = line.slice(idx + 1).trim()
        if (k !== '') pairs[k] = v
      }

      const field = (label, node, hint) =>
        h(
          'label',
          { className: 'HUB_field' },
          h('span', { className: 'HUB_label' }, label),
          node,
          hint !== undefined && hint !== '' ? h('span', { className: 'HUB_hint', style: { fontSize: '10px' } }, hint) : null
        )

      const textArea = (value, onChange, placeholder, rows) =>
        h('textarea', {
          className: 'HUB_input',
          value,
          placeholder,
          rows: rows ?? 3,
          style: { resize: 'vertical', fontFamily: 'inherit', lineHeight: '1.5' },
          onChange: (e) => onChange(e.target.value),
        })

      return h(
        'div',
        {
          className: 'HUB_detail',
          style: { borderTop: '1px solid var(--dsw-alias-border-l1)', marginTop: '8px', paddingTop: '10px', gridTemplateColumns: '1fr' },
        },
        field(
          t('serverName'),
          h('input', {
            className: 'HUB_input',
            value: name,
            placeholder: 'my-mcp-server',
            onChange: (e) => setName(e.target.value),
          }),
          name === '' ? '' : nameOk ? '' : t('serverNameBad')
        ),
        // 调用方式：两个按钮，不用下拉
        field(
          t('transport'),
          h(
            'div',
            { style: { display: 'flex', gap: '6px' } },
            ...['stdio', 'streamable-http'].map((mode) =>
              h(
                'button',
                {
                  key: mode,
                  type: 'button',
                  className: 'HUB_chip',
                  'data-active': transport === mode ? 'true' : 'false',
                  onClick: () => setTransport(mode),
                },
                mode === 'stdio' ? 'STDIO' : 'HTTP'
              )
            )
          )
        ),
        transport === 'stdio'
          ? field(
              t('command'),
              h('input', { className: 'HUB_input', value: command, placeholder: 'npx', onChange: (e) => setCommand(e.target.value) })
            )
          : field(
              t('urlLabel'),
              h('input', { className: 'HUB_input', value: url, placeholder: 'https://example.com/mcp', onChange: (e) => setUrl(e.target.value) })
            ),
        transport === 'stdio'
          ? field(
              t('argsEachLine'),
              textArea(argsText, setArgsText, '-y\n@modelcontextprotocol/server-github', 3),
              t('argsEachLineHint')
            )
          : null,
        // 高级区：环境变量 / headers / 工作目录
        h(
          'button',
          {
            type: 'button',
            className: 'HUB_chip',
            style: { alignSelf: 'flex-start', marginTop: '2px' },
            onClick: () => setAdvanced(!advanced),
          },
          (advanced ? '▾ ' : '▸ ') + t('advanced')
        ),
        advanced
          ? h(
              Fragment,
              null,
              field(
                transport === 'stdio' ? t('envVars') : t('httpHeaders'),
                textArea(envText, setEnvText, transport === 'stdio' ? 'GITHUB_TOKEN=ghp_xxx' : 'Authorization=Bearer xxx', 3),
                t('envVarsHint')
              ),
              transport === 'stdio'
                ? field(t('cwdLabel'), h('input', { className: 'HUB_input', value: cwd, placeholder: 'C:/projects/my-mcp-server', onChange: (e) => setCwd(e.target.value) }))
                : null,
              // ── 运行时参数（宿主 mcp-client 的 Config 里确实有这些字段）──
              h('div', { className: 'HUB_label', style: { marginTop: '4px' } }, t('runtimeSection')),
              field(
                t('timeoutLabel'),
                h('input', {
                  className: 'HUB_input',
                  value: timeoutMs,
                  placeholder: '60000',
                  inputMode: 'numeric',
                  onChange: (e) => setTimeoutMs(e.target.value.replace(/[^0-9]/g, '')),
                }),
                t('timeoutHint')
              ),
              h(
                'label',
                { className: 'HUB_field', style: { flexDirection: 'row', alignItems: 'center', gap: '6px' } },
                h('input', {
                  type: 'checkbox',
                  checked: failOnStartup,
                  style: { margin: 0, cursor: 'pointer' },
                  onChange: (e) => setFailOnStartup(e.target.checked),
                }),
                h('span', { className: 'HUB_label', style: { margin: 0 } }, t('failOnStartupLabel'))
              ),
              h(
                'label',
                { className: 'HUB_field', style: { flexDirection: 'row', alignItems: 'center', gap: '6px' } },
                h('input', {
                  type: 'checkbox',
                  checked: rcEnabled,
                  style: { margin: 0, cursor: 'pointer' },
                  onChange: (e) => setRcEnabled(e.target.checked),
                }),
                h('span', { className: 'HUB_label', style: { margin: 0 } }, t('reconnectLabel'))
              ),
              rcEnabled
                ? h(
                    'div',
                    { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } },
                    field(t('rcInitialLabel'), h('input', { className: 'HUB_input', value: rcInitial, placeholder: '500', inputMode: 'numeric', onChange: (e) => setRcInitial(e.target.value.replace(/[^0-9]/g, '')) })),
                    field(t('rcMaxLabel'), h('input', { className: 'HUB_input', value: rcMax, placeholder: '30000', inputMode: 'numeric', onChange: (e) => setRcMax(e.target.value.replace(/[^0-9]/g, '')) })),
                    field(t('rcAttemptsLabel'), h('input', { className: 'HUB_input', value: rcAttempts, placeholder: '10', inputMode: 'numeric', onChange: (e) => setRcAttempts(e.target.value.replace(/[^0-9]/g, '')) }))
                  )
                : null,
              h('div', { className: 'HUB_hint', style: { fontSize: '10px' } }, t('runtimeHint'))
            )
          : null,
        h(
          'div',
          { className: 'HUB_actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'HUB_btn',
              disabled: busy === true || nameOk === false || bodyOk === false,
              onClick: () =>
                onSubmit({
                  serverName: name.trim(),
                  transport,
                  command: command.trim(),
                  args,
                  url: url.trim(),
                  ...(transport === 'stdio' ? { env: pairs } : { headers: pairs }),
                  ...(cwd.trim() !== '' ? { cwd: cwd.trim() } : {}),
                  // 运行时参数：只在填了才带（空串表示用宿主默认）
                  ...(timeoutMs !== '' ? { toolCallTimeoutMs: Number(timeoutMs) } : {}),
                  ...(failOnStartup ? { failOnStartupError: true } : {}),
                  ...(rcEnabled === false || rcInitial !== '' || rcMax !== '' || rcAttempts !== ''
                    ? {
                        reconnect: {
                          ...(rcEnabled === false ? { enabled: false } : {}),
                          ...(rcInitial !== '' ? { initialDelayMs: Number(rcInitial) } : {}),
                          ...(rcMax !== '' ? { maxDelayMs: Number(rcMax) } : {}),
                          ...(rcAttempts !== '' ? { maxAttempts: Number(rcAttempts) } : {}),
                        },
                      }
                    : {}),
                }),
            },
            busy === true ? t('saving') : t('addSubmit')
          ),
          h('button', { type: 'button', className: 'HUB_btn', onClick: onCancel }, t('addCancel')),
          done === true ? h('span', { className: 'HUB_hint' }, t('addOk')) : null,
          error !== undefined ? h('span', { className: 'HUB_warn' }, error) : null
        ),
        h('div', { className: 'HUB_tip', style: { marginTop: '8px' } }, t('addNote'))
      )
    }

    /**
     * 从 sessions 快照里挑出「主视图正在看」的那个会话。
     *
     * 宿主没有 `current` / `sessionId` 字段（panel 踩过这个坑，实测恒为 undefined）。
     * 官方判据是 `byId[id].retainedBy.mainView > 0` —— settings-general、layout、
     * workspace 等宿主自己的代码用的都是这一条。
     */
    function selectMainSessionId(state) {
      const rows = state !== null && typeof state === 'object' ? state.byId : undefined
      if (rows === null || typeof rows !== 'object') return undefined
      for (const id of Object.keys(rows)) {
        const row = rows[id]
        if (((row && row.retainedBy && row.retainedBy.mainView) || 0) > 0) return id
      }
      return undefined
    }

    /**
     * 取「主视图正在看」那个会话的**工作区路径**。
     *
     * 语义从「会话级」升级成「工作区级」（主人 2026-11-11 要求）：
     * 同一工作区开几个会话共享一份设置，换工作区才是另一套。
     *
     * 宿主 session 行里确有 cwd（`session.create({cwd})` 会写进去）；
     * 都取不到就退到 `session:<id>`，保证隔离、不串到全局。
     */
    function selectMainWorkspace(state) {
      const rows = state !== null && typeof state === 'object' ? state.byId : undefined
      if (rows === null || typeof rows !== 'object') return undefined
      for (const id of Object.keys(rows)) {
        const row = rows[id]
        if (((row && row.retainedBy && row.retainedBy.mainView) || 0) <= 0) continue
        const cwd = row.cwd ?? row.workspace ?? row.workspacePath
        if (typeof cwd === 'string' && cwd.trim() !== '') return cwd.trim()
        return 'session:' + id
      }
      return undefined
    }

    /** 只取末段做显示（D:\DSH_Work\aa → aa）。 */
    /**
     * 工作区路径归一化（2026-11-12 第三轮修）。
     *
     * **必须与后端 `normalizeWorkspacePath` 完全一致**，否则前端拼的 layerKey
     * 与 state.json 里的 key 对不上：
     *   · 前端用原始 `D:\DSH_Work\hh`  ⇒ `ws:D:\DSH_Work\hh`
     *   · 后端存归一化 `D:/DSH_Work/hh`  ⇒ `ws:D:/DSH_Work/hh`
     * ⇒ `switchStateOf` 查不到 overrides，永远算 `on`
     * ⇒ 其他工作区开关点不动 + 开关后列表多一行。
     */
    function normalizePath(p) {
      if (typeof p !== 'string') return ''
      let v = p.trim()
      if (v === '') return ''
      v = v.split(String.fromCharCode(92)).join('/')
      if (/^[a-zA-Z]:/.test(v)) v = v[0].toUpperCase() + v.slice(1)
      if (v.length > 3 && v.endsWith('/')) v = v.replace(/\/+$/, '')
      return v
    }

    function workspaceLabelOf(path) {
      if (typeof path !== 'string' || path === '') return ''
      if (path.startsWith('session:')) return 'session'
      const trimmed = path.replace(/[/\\]+$/, '')
      const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
      return trimmed.slice(i + 1) || trimmed
    }

    /**
     * 算某条目的开关三态。
     *
     *   ① on       —— 与全局一致且开着（白点在右）
     *   ② off      —— 与全局一致且关着（白点在左）
     *   ③ override —— 本层覆盖了全局，与全局不同（**白点停在中间**）
     *
     * 谁能覆盖：面板只看工作区层（ws:），输入栏看会话层（ss:）。
     * 传 layerKey 就是看那一层；不传就是全局视角。
     */
    /**
     * 开关显示状态（2026-11-11 重新设计，与 layers.js 同源）。
     *
     *   · `on`       开着
     *   · `off`      本层关着
     *   · `override` 全局开着、但下层藏了它（白点停中间）
     *   · `locked`   **全局关着，下层开不了**（灰、不可点）
     *
     * 不再有"全局关但本层开"—— 新语义下做不到（文件已改名，宿主扫不到）。
     */
    /**
     * 算某条目的开关三态（2026-11-12 重写）。
     *
     * **工作区层不再看 `overrides`，看磁盘事实 `row.hiddenIn`。**
     *
     * 为什么改：旧做法靠内存里的 override 集合，实测三个问题——
     *   · 全局关掉的 skill，工作区开不回来（文件已改名，遮蔽没对象）
     *   · 工作区层是空的时候，全部算成 `on` ⇒ 按钮全灰，看着"只能看不能改"
     *   · 状态与磁盘可能不一致（改了文件但内存没刷新）
     *
     * 新做法：
     *   · **工作区视图** ⇒ 看 `row.hiddenIn` 里有没有这个工作区。
     *     有壳 = 本工作区关；没壳 = 本工作区开（跟随全局可见性）。
     *     **不再有 locked**：工作区和全局是两个独立开关，都能点。
     *   · **会话视图** ⇒ 仍看 `overrides`（会话是运行时概念，没有磁盘位置）。
     *   · **全局视图** ⇒ 看 `globalOn`，另有 override 时给"被某层藏了"的中间态。
     *
     * @param row - 条目（含 `hiddenIn` / `overrides`）
     * @param layerKey - `ws:<path>` / `ss:<id>` / undefined(全局)
     * @param globalOn - 全局是否可用（skill 传 enabled，mcp 传 globalEnabled）
     */
    function switchStateOf(row, layerKey, globalOn) {
      const inLayerView = layerKey !== undefined && layerKey !== null && layerKey !== ""
      const isWorkspaceView = inLayerView && String(layerKey).startsWith("ws:")

      // ── 工作区视图：看磁盘事实 ──
      if (isWorkspaceView) {
        const wsPath = String(layerKey).slice(3)
        /**
         * **MCP 行分流**（2026-11-12 第五轮修）。
         *
         * MCP 没有"文件位置"可言，不走壳这条路，仍由 `tools.restrict({deny})`
         * 在运行时遮蔽。它没有 `hiddenIn` 字段。
         *
         * 之前这里一刀切读 `hiddenIn`，MCP 行拿到恒 `[]`
         * ⇒ 工作区视图下永远算 `on` ⇒ **点不动**。
         * 判据：MCP 行必有 `serverName`，skill 行没有。
         */
        if (typeof row?.serverName === 'string' && row.serverName !== '') {
          const ovMcp = row?.overrides !== null && typeof row?.overrides === 'object' ? row.overrides : {}
          const mineMcp = ovMcp[layerKey] === 'off'
          return {
            state: mineMcp ? 'off' : 'on',
            effective: !mineMcp,
            ...globalOn !== true ? { reason: 'global-off' } : {},
          }
        }

        const hidden = Array.isArray(row?.hiddenIn) ? row.hiddenIn : []
        const shutHere = hidden.includes(wsPath)

        /**
         * **全局关着时，工作区层 locked**（2026-11-12 第七轮）。
         *
         * 理由：skill 的全局关 = 磁盘文件改名为 `.disabled`，宿主**根本扫不到**。
         * 此时在工作区点「开」只是删壳，但全局那份仍然不存在 ⇒ **操作无意义**，
         * 点完界面不变，用户只会觉得"点了没用"。
         *
         * 先开全局再开工作区，路径唯一且清晰。
         * （全局视图本身**不** locked，那里才是能解除它的入口。）
         */
        if (globalOn !== true) {
          return { state: "locked", effective: false, reason: "global-off" }
        }

        return {
          state: shutHere ? "off" : "on",
          effective: !shutHere,
        }
      }

      // ── 以下沿用旧语义（会话视图 / 全局视图）──
      const ov = row?.overrides !== null && typeof row?.overrides === "object" ? row.overrides : {}
      const offKeys = Object.keys(ov).filter((k) => ov[k] === "off")

      if (globalOn !== true) {
        if (inLayerView) return { state: "locked", effective: false, reason: "global-off" }
        return { state: "off", effective: false }
      }

      if (inLayerView) {
        const mine = ov[layerKey] === "off"
        return { state: mine ? "off" : "on", effective: !mine }
      }

      /**
       * 全局视图（2026-11-12 第八轮：**彻底去掉中间态**）。
       *
       * 主人原话：「skill和mcp那边**不应该有中间态**」
       *
       * 中间态（override）这个设计从一开始就是错的：
       *   · 它表达的是「全局开着，但某个工作区把它藏了」
       *   · 可**全局视图根本不该关心工作区的事**——那是另一个视图的问题
       *   · 前七轮反复因为它算错聚合值（整页全橙、总开关变灰）
       *   · 而用户点它也不知道该变成什么（第六轮那个"回不去"）
       *
       * 现在：**每个视图只回答一个问题——「这一层自己是开还是关」。**
       *   · 全局视图 ⇒ 只看 `globalOn`（全局这一层）
       *   · 工作区视图 ⇒ 只看该工作区有没有壳
       *   · 互不影响、各自独立、没有中间态
       *
       * 想知道「谁把全局那份藏了」⇒ 点进那个工作区看，或者看行上的 ⚠ 提示。
       */
      return { state: globalOn === true ? "on" : "off", effective: globalOn === true }
    }

    /** 主区整页。 */
    function HubPage(props) {
      const t = props.t
      const call = props.call
      const onBack = props.onBack
      const readWorkspaceKey = props.readWorkspaceKey
      const readSessionId = props.readSessionId
      const subscribeSessions = props.subscribeSessions
      const [tab, setTab] = React.useState('skills')
      /** 当前工作区路径（面板的工作区层用它）。 */
      const [workspaceKey, setWorkspaceKey] = React.useState(() => readWorkspaceKey?.())
      /** 会话 id：面板只管全局/工作区，这里留一份是为了显示「本会话另有覆盖」。 */
      const [sessionId, setSessionId] = React.useState(() => readSessionId?.())
      /** true = 本次操作只作用于当前会话（需求④）。 */
      const [scopeMode, setScopeMode] = React.useState(false)
      /** 「全部开启」执行中。 */
      const [busyAll, setBusyAll] = React.useState(false)
      /**
       * 用户从工作区列表里手动挑的那个（2026-11-11 加）。
       *
       * 不挑时跟随当前会话的工作区（`workspaceKey`）；挑了就以挑的为准，
       * 这样同一个面板能编辑**别的**工作区的层，不必切会话。
       */
      const [pickedWorkspace, setPickedWorkspace] = React.useState(undefined)
      /** 实际在编辑的工作区路径：手动挑的优先，否则当前会话的。 */
      const activeWorkspace = pickedWorkspace !== undefined ? pickedWorkspace : workspaceKey
      /** 当前编辑的层：undefined＝全局，'ws:<path>'＝某个工作区。 */
      const editLayerKey =
        scopeMode && typeof activeWorkspace === 'string' && activeWorkspace !== ''
          ? 'ws:' + normalizePath(activeWorkspace)
          : undefined

      React.useEffect(() => {
        if (typeof subscribeSessions !== 'function') return undefined
        return subscribeSessions((k, s) => { setWorkspaceKey(k); setSessionId(s) })
      }, [])
      const [data, setData] = React.useState(undefined)
      const [error, setError] = React.useState(undefined)
      const [query, setQuery] = React.useState('')
      const [groupFilter, setGroupFilter] = React.useState('')
      /**
       * 「不可用」折叠区是否展开（2026-11-13 加，主人要求「干净」）。
       *
       * 本机 42 个 skill 里有 10 个永远点不亮（转发壳 2 / 手动型 7 / 作者停用 1），
       * 平铺在主列表里既占地方又让人误以为"面板坏了"。
       * 默认折叠，顶部显示「不可用 10 ▸」，点开才逐条列出并附原因。
       */
      const [showUnusable, setShowUnusable] = React.useState(false)
      const [selectedKey, setSelectedKey] = React.useState(undefined)
      const [groupEdit, setGroupEdit] = React.useState(undefined)
      const [groupDelete, setGroupDelete] = React.useState(undefined)
      const [busyKey, setBusyKey] = React.useState(undefined)
      /** 悬停浮层：{parts, x, y} 或 undefined。 */
      const [hover, setHover] = React.useState(undefined)
      /** 延迟句柄：鼠标快速划过一串行时不应该每行都闪一下。 */
      const hoverTimer = React.useRef(undefined)

      /** 开始悬停：延迟 450ms 才出现；没有内容（别名备注都空）就完全不启动。 */
      const beginHover = (row, event) => {
        const parts = tipPartsOf(row)
        if (parts === undefined) return
        const x = event?.clientX ?? 0
        const y = event?.clientY ?? 0
        if (hoverTimer.current !== undefined) clearTimeout(hoverTimer.current)
        hoverTimer.current = setTimeout(() => setHover({ parts, x: x + 12, y: y + 16 }), 450)
      }

      const endHover = () => {
        if (hoverTimer.current !== undefined) clearTimeout(hoverTimer.current)
        hoverTimer.current = undefined
        setHover(undefined)
      }

      React.useEffect(() => () => {
        if (hoverTimer.current !== undefined) clearTimeout(hoverTimer.current)
      }, [])


      /** 提交分组新建 / 改名（id 为空 = 新建）。 */
      const submitGroup = async (edit) => {
        const name = String(edit.name ?? '').trim()
        if (name === '') {
          setGroupEdit(undefined)
          return
        }
        setGroupEdit(undefined)
        try {
          const payload = edit.id === '' ? { name } : { id: edit.id, name }
          const r = await call('saveGroup', payload)
          if (r?.ok === false) setError(r.detail ?? t('saveFailed'))
          await reload()
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }

      const [testingKey, setTestingKey] = React.useState(undefined)
      const [testResult, setTestResult] = React.useState(undefined)
      const [addOpen, setAddOpen] = React.useState(false)
      const [addBusy, setAddBusy] = React.useState(false)
      const [addDone, setAddDone] = React.useState(false)
      const [addError, setAddError] = React.useState(undefined)
      const [savingKey, setSavingKey] = React.useState(undefined)
      const [savedKey, setSavedKey] = React.useState(undefined)
      const [toggleError, setToggleError] = React.useState(undefined)

      const reload = React.useCallback(
        () =>
          call('list')
            .then((value) => {
              setData(value)
              setError(undefined)
            })
            .catch((err) => setError(err instanceof Error ? err.message : String(err))),
        [call]
      )

      React.useEffect(() => {
        let alive = true
        call('list')
          .then((value) => {
            if (alive) setData(value)
          })
          .catch((err) => {
            if (alive) setError(err instanceof Error ? err.message : String(err))
          })
        return () => {
          alive = false
        }
      }, [])

      /**
       * 「全部开启」：把**当前编辑层**里关着的条目一次翻回开。
       *
       * 实现选择：逐条调现有的 `toggle`，不新开一个批量接口——
       *   · 复用同一条写入路径，不会出现「批量接口和单条接口行为不一致」
       *   · 每条失败也能单独看到（失败的留在关态，不假装成功）
       *   · 代价是 N 次往返，但 skill/MCP 数量是几十级，可以接受
       */
      /**
       * 「全部开启」开关的三态（2026-11-11 主人要求：样式和层级开关一样有三态）。
       *
       * 语义按**当前编辑层**算：
       *   · `on`        —— 本层没有关闭项（全部开着）
       *   · `off`       —— 本层存在关闭项（点了 = 全部开启）
       *   · `override`  —— **有个别项关着**，但还没到"全关"；白点停中间提示"部分关闭"
       *
       * 为什么不是简单的开关：它是个**动作**（清掉本层关闭），不是持久状态。
       * 所以三态只是在描述"现在还有多少关着的"，点下去永远是"全开"。
       */
      /**
       * 算**某一层**的全开状态（2026-11-11 第二次改：主人要求两层各带一个开关）。
       *
       * @param key - 该层的 layerKey；`undefined` = 全局层
       * @returns `{ state, total, closed }`
       *   · on —— 该层全开
       *   · override —— 部分关闭
       * · off —— 全关
       */
      const layerAllState = (key) => {
        if (data === undefined) return { state: 'off', total: 0, closed: 0 }
        let total = 0
        let closed = 0
        for (const row of data.skills ?? []) {
          /**
           * **「改不了」的不计入统计**（2026-11-12 第十轮）。
           *
           * 主人问：「mcp全开，全局不应该是中间态吧？」
           *
           * 查出来根源：本机有 10 个 skill 天生开不了——
           *   · 6 个 SKILL.md 里写了 `disable-model-invocation: true`（作者自己停的）
           *   · 4 个文件名是 `SKILL.md.disabled`
           *
           * 它们 `enabled=false` ⇒ 全局视图算成 closed ⇒ 35 条里 10 条"关着"
           * ⇒ **全局永远显示中间态，哪怕用户一个都没关**。
           * 这是错的：那 10 条是**作者的意图**，不是用户的选择，
           * 不该让用户背这个"部分关闭"的锅。
           *
           * 判据与单条开关的 disabled 一致：**改不了的，不进分母也不进分子**。
           */
          if (row.disabledByFrontmatter === true && row.isShadow !== true) continue
          const sw = switchStateOf(row, key, row.enabled === true)
          if (sw.state === 'locked') continue
          total += 1
          if (sw.effective !== true) closed += 1
        }
        for (const row of data.mcp ?? []) {
          const sw = switchStateOf(row, key, row.globalEnabled === true)
          if (sw.state === 'locked') continue
          total += 1
          if (sw.effective !== true) closed += 1
        }
        /**
         * **层级行保留中间态**（2026-11-12 第九轮，按主人修正）。
         *
         * 第八轮我删过头了 —— 主人原话：「**我的意思是只保留层级的中间态**」
         *
         * 两者语义不同，不能一刀切：
         *   · **单条开关**（某一行的那个 toggle）⇒ 只有开/关。
         *     中间态在单条上毫无意义（用户问的是"这一条开没开"），
         *     而且点它不知道变成什么（第六轮那个"回不去"就是这么来的）。
         *   · **层级总开关**（左边「全局」「aa」那些圆形按钮）⇒ 需要中间态。
         *     它聚合了一整层几十条，本来就该能表达"部分开着"这个事实：
         *       全开 ⇒ on；全关 ⇒ off；**部分开 ⇒ override（橙）**
         */
        if (total === 0) return { state: 'off', total: 0, closed: 0 }
        if (closed === 0) return { state: 'on', total, closed: 0 }
        if (closed < total) return { state: 'override', total, closed }
        return { state: 'off', total, closed }
      }

      /**
       * 工作区层的 key（2026-11-12 修：**必须用 `activeWorkspace` 而不是 `workspaceKey`**）。
       *
       * `workspaceKey` 只是"当前会话所在的工作区"；`activeWorkspace` 才是
       * "用户从列表里点选的那个"。原来这里写错，导致：
       *   · 点其他工作区时高亮不动（active 判定永远对不上）
       *   · 全部开启的开关状态也算错层
       */
      const wsLayerKey =
        typeof activeWorkspace === 'string' && activeWorkspace !== '' ? 'ws:' + normalizePath(activeWorkspace) : undefined
      /** 全局层那份（第一项上显示） */
      const globalAllState = layerAllState(undefined)
      /** 工作区层那份（第二项上显示） */
      const workspaceAllState = wsLayerKey === undefined ? { state: 'off', total: 0, closed: 0 } : layerAllState(wsLayerKey)
      /** 当前编辑层那份（enableAll 用） */
      const enableAllState = scopeMode ? workspaceAllState : globalAllState

      /**
       * 全部开启（2026-11-11 第二次改：接受目标层参数）。
       *
       * @param targetScope - `true` = 针对**工作区层**，`false`/省略 = **全局层**
       *
       * 两个层级行上各有一个开关，点哪个就作用于那个层，**与当前编辑层无关**。
       */
      /**
       * 全部开启（指定工作区路径）。
       *
       * 与 `enableAllFor(true)` 的区别：那个用「当前编辑的工作区」，
       * 这个用**列表里点的那一个** —— 不必先切过去。
       */
      const toggleAllForWorkspace = async (path, enabled) => {
        if (busyAll) return
        const layerKey = typeof path === 'string' && path !== '' ? 'ws:' + normalizePath(path) : undefined
        await runToggleAll(layerKey, enabled)
      }

      /** 批量：当前编辑层的全部开/关。 */
      const toggleAllFor = async (targetScope, enabled) => {
        if (busyAll) return
        const useWs = targetScope === true && typeof activeWorkspace === 'string' && activeWorkspace !== ''
        const layerKey = useWs ? 'ws:' + normalizePath(activeWorkspace) : undefined
        await runToggleAll(layerKey, enabled)
      }

      /**
       * 真正的执行体：把某一层的条目**批量设成开或关**（2026-11-12 加关闭方向）。
       *
       * @param layerKey - `ws:<path>` / undefined(全局)
       * @param enabled - `true` = 全部开启；`false` = 全部关闭
       *
       * 两个方向的落地方式不同：
       *   · **skill 工作区层** ⇒ 开 = 删壳、关 = 造壳（磁盘操作）
       *   · **skill 全局层**  ⇒ 改磁盘 `.disabled` 后缀
       *   · **MCP 任意层**    ⇒ 写遮蔽层 `setOverride`（保留原有遮蔽设计）
       */
      const runToggleAll = async (layerKey, enabled) => {
        /**
         * 新语义下「全部开启」= **清掉本层的隐藏**，不是「把全局关的也打开」。
         *   · 全局层 ⇒ 对全局关着的做真开启（改磁盘）
         *   · 工作区层 ⇒ 只清本层的 off；全局关着的动不了（locked）
         */
        const targets = []
        const wantOn = enabled === true

        for (const row of data?.skills ?? []) {
          /**
           * 跳过「改不了」的（2026-11-12 修「全部开启按钮没反应」）。
           *
           * `disabledByFrontmatter` 的 skill 是 SKILL.md 里写了
           * `disable-model-invocation: true`，改名法改不回来——后端会直接拒绝。
           * 把它算进批量里，整批就报「部分开启失败 11/11」，用户看到的就是"点了没用"。
           */
          // 壳（isShadow）要算进来——'全部开启'正是要把它删掉的场合
          if (row.disabledByFrontmatter === true && row.isShadow !== true) continue
          const sw = switchStateOf(row, layerKey, row.enabled === true)
          if (sw.state === 'locked') continue
          // 开：收当前是关的；关：收当前是开的
          if (wantOn ? sw.effective !== true : sw.effective === true) targets.push({ kind: 'skill', name: row.name })
        }
        for (const row of data?.mcp ?? []) {
          const sw = switchStateOf(row, layerKey, row.globalEnabled === true)
          if (sw.state === 'locked') continue
          if (wantOn ? sw.effective !== true : sw.effective === true) targets.push({ kind: 'mcp', name: row.serverName })
        }
        if (targets.length === 0) return

        setBusyAll(true)
        setToggleError(undefined)
        const failed = []
        try {
          for (const item of targets) {
            try {
              const payload = { kind: item.kind, name: item.name, enabled: wantOn }
              if (layerKey !== undefined) payload.layerKey = layerKey
              const res = await call('toggle', payload)
              if (res !== null && typeof res === 'object' && res.ok === false) {
                failed.push(item.kind + '/' + item.name + '：' + (res.detail ?? 'failed'))
              }
            } catch (err) {
              failed.push(item.kind + '/' + item.name + '：' + (err instanceof Error ? err.message : String(err)))
            }
          }
        } finally {
          setBusyAll(false)
        }
        await reload()
        if (failed.length > 0) {
          setToggleError(t('enableAllPartial') + ' ' + String(failed.length) + ' / ' + String(targets.length) + ' —— ' + failed.slice(0, 3).join('；'))
        }
      }

      /** 热开关：乐观更新，失败再回滚并报错。 */
      const toggle = async (kind, name, nextEnabled, key) => {
        setBusyKey(key)
        setToggleError(undefined)
        try {
          // 面板只管两层：全局（不带 layerKey）或工作区（ws:<path>）。会话级归输入栏。
          const payload = { kind, name, enabled: nextEnabled }
          /**
           * **用 `activeWorkspace` 而不是 `workspaceKey`**（2026-11-12 第二轮修）。
           *
           * `workspaceKey` 是「当前会话所在的工作区」，`activeWorkspace` 才是
           * 「用户从左侧列表点选的那个」。原来这里写 workspaceKey，导致：
           *   · 点别的工作区 → 界面高亮切了（用的 activeWorkspace）
           *   · 但写入仍落到当前会话的工作区（用的 workspaceKey）
           * ⇒ **在 B 工作区点开关，实际改的是 aa** —— 主人报的第一个现象。
           */
          if (scopeMode && typeof activeWorkspace === 'string' && activeWorkspace !== '') {
            payload.layerKey = 'ws:' + normalizePath(activeWorkspace)
          }
          const res = await call('toggle', payload)
          if (res !== null && typeof res === 'object' && res.ok === false) {
            setToggleError(kind + ' / ' + name + '：' + (res.detail ?? t('enableFailed')))
          }
          await reload()
        } catch (err) {
          setToggleError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusyKey(undefined)
        }
      }

      const q = query.trim().toLowerCase()
      const groups = data?.groups ?? []

      const skills = (data?.skills ?? []).filter((row) => {
        if (groupFilter !== '') {
          const g = groupFilter === '__none__' ? '' : groupFilter
          if ((row.group ?? '') !== g) return false
        }
        if (q === '') return true
        const hay = (row.name + ' ' + (row.alias ?? '') + ' ' + (row.description ?? '') + ' ' + (row.note ?? '')).toLowerCase()
        return hay.includes(q)
      })

      const mcpRows = (data?.mcp ?? []).filter((row) => {
        if (q === '') return true
        const hay = (row.serverName + ' ' + (row.alias ?? '') + ' ' + (row.note ?? '')).toLowerCase()
        return hay.includes(q)
      })

      const groupName = (id) => {
        if (id === '' || id === undefined) return t('ungrouped')
        const g = groups.find((row) => row.id === id)
        return g === undefined ? id : g.name
      }

      /**
       * 技能行（2026-11-11 改：**点击选中，详情移到右栏**）。
       *
       * 参照 RimCrow 模组管理器的形态：左列表点一条，右栏显示它的全部信息。
       * 所以行内不再展开任何东西——行只负责「被点中」和「开关」两件事。
       */
      const skillRow = (row) => {
        const key = 'sk:' + row.name
        const active = selectedKey === key
        const title = tipOf(row)
        return h(
          'div',
          {
            key,
            className: 'HUB_row',
            'data-active': active ? 'true' : 'false',
            title,
            onMouseEnter: (e) => beginHover(row, e),
            onMouseLeave: endHover,
            onClick: () => {
              endHover()
              // 只选中，不取消：右栏一直有内容比空着好
              setSelectedKey(key)
            },
          },
          h(
            'span',
            { className: 'HUB_nameWrap' },
            h('span', { className: 'HUB_name' }, row.alias || row.name),
            /**
             * **「为什么不可用」小标签**（2026-11-13 加）。
             *
             * 展开折叠区后，每条旁边直接写原因，用户不用点进详情才知道：
             *   转发壳 / 手动触发型 / 作者停用 / 磁盘停用 / 遮蔽占位
             *
             * `normal` 不显示（那是绝大多数，标出来就是满屏噪音）。
             */
            (row.kind ?? 'normal') !== 'normal'
              ? h(
                  'span',
                  {
                    className: 'HUB_kindTag',
                    title: row.why || '',
                  },
                  t('kind' + ({
                    'manual-only': 'ManualOnly',
                    'author-off': 'AuthorOff',
                    'disk-off': 'DiskOff',
                    shadow: 'Shadow',
                  }[row.kind] ?? 'Forwarder'))
                )
              : null,
            /**
             * ⚠ 依赖的 MCP 被关了（2026-11-12 主人要求）。
             *
             * 只在这个 skill 真的引用了某个已关闭的 MCP 时出现——
             * 没依赖、或依赖都开着，都不显示，避免变成满屏警告。
             */
            Array.isArray(row.mcpOff) && row.mcpOff.length > 0
              ? h(
                  'span',
                  {
                    className: 'HUB_needWarn',
                    title: t('mcpOffHint') + '\n' + row.mcpOff.join('\n'),
                  },
                  '⚠'
                )
              : null
          ),
          h('span', { className: 'HUB_gapMid' }),
          h('span', { className: 'HUB_small' }, row.rootLabel + (row.group ? ' · ' + groupName(row.group) : '')),
          h('span', { className: 'HUB_spacer' }),
          (() => {
            const sw = switchStateOf(row, editLayerKey, row.enabled === true)
            const locked = sw.state === 'locked'
            return h('button', {
              type: 'button',
              className: 'HUB_sw',
              'data-on': sw.state === 'on' ? 'true' : 'false',
              'data-state': sw.state,
              title: locked ? t('lockedHint') : sw.state === 'override' ? t('overrideHint') : undefined,
              'aria-label': locked ? t('lockedAria') : sw.state === 'override' ? t('overrideAria') : sw.effective ? t('on') : t('off'),
              disabled: busyKey === key || locked || (row.disabledByFrontmatter === true && row.isShadow !== true),
              onClick: (event) => {
                event.stopPropagation()
                /**
                 * **中间态（override）点一下 = 开**（2026-11-12 第六轮修）。
                 *
                 * 旧代码写的是 `override ? false : ...` —— 强制关闭。后果：
                 *   · 全局开着、某层藏着 ⇒ 显示中间态
                 *   · 点它 ⇒ 只往「关」走，**永远回不到开**
                 *   · 用户看到的正是「只能关或者中间态」
                 *
                 * 正确语义：`override` 时 `effective` 已经是 false（确实被藏了），
                 * 而用户点开关的常规意图是「让它变成我要的样子」。
                 * 所以按 `!effective` 算 = true = **在本层开出来**。
                 *
                 * 这也是对称的：关着的点一下开、开着的点一下关，中间态点一下往「开」走
                 * （因为中间态视觉上是偏「关」的）。
                 */
                const next = sw.effective !== true
                void toggle('skill', row.name, next, key)
              },
            })
          })()
        )
      }

      /**
       * MCP 行（同上，点击选中，详情在右栏）。
       */
      const mcpRow = (row) => {
        const key = 'mc:' + row.serverName
        const active = selectedKey === key
        const title = tipOf(row)
        return h(
          'div',
          {
            key,
            className: 'HUB_row',
            'data-active': active ? 'true' : 'false',
            title,
            onMouseEnter: (e) => beginHover(row, e),
            onMouseLeave: endHover,
            onClick: () => {
              endHover()
              setSelectedKey(key)
            },
          },
          h(
            'span',
            { className: 'HUB_nameWrap' },
            h('span', { className: 'HUB_name' }, row.alias || row.serverName),
            /**
             * 依赖标签（2026-11-11）——分两级：
             *   · hard（手写运行时依赖）⇒ 橙色「有依赖」，关了真会断
             *   · soft（自动扫到的 skill 引用）⇒ 灰虚线「疑似依赖」，**仅供参考**
             */
            (() => {
              const hard = Array.isArray(row.dependentsHard) ? row.dependentsHard : []
              const soft = Array.isArray(row.dependentsSoft) ? row.dependentsSoft : []
              if (hard.length > 0) {
                return h('span', {
                  className: 'HUB_depTag',
                  title: t('dependsHint') + '\n' + hard.join('\n') + (soft.length > 0 ? '\n\n' + t('dependsSoftHint') + '\n' + soft.join('\n') : ''),
                }, t('dependsTag'))
              }
              if (soft.length > 0) {
                return h('span', {
                  className: 'HUB_depTagSoft',
                  title: t('dependsSoftHint') + '\n' + soft.join('\n') + '\n\n' + t('dependsSoftCaution'),
                }, t('dependsSoftTag'))
              }
              return null
            })()
          ),
          h('span', { className: 'HUB_gapMid' }),
          h('span', { className: 'HUB_small' }, t('toolCount') + ' ' + String(row.toolCount ?? 0)),
          h('span', { className: 'HUB_spacer' }),
          (() => {
            const sw = switchStateOf(row, editLayerKey, row.globalEnabled === true)
            const locked = sw.state === 'locked'
            return h('button', {
              type: 'button',
              className: 'HUB_sw',
              'data-on': sw.state === 'on' ? 'true' : 'false',
              'data-state': sw.state,
              title: locked ? t('lockedHint') : sw.state === 'override' ? t('overrideHint') : undefined,
              'aria-label': locked ? t('lockedAria') : sw.state === 'override' ? t('overrideAria') : sw.effective ? t('on') : t('off'),
              disabled: busyKey === key || locked,
              onClick: (event) => {
                event.stopPropagation()
                // 中间态 ⇒ 按当前生效值取反（同技能行，理由见上）
                const next = sw.effective !== true
                void toggle('mcp', row.serverName, next, key)
              },
            })
          })()
        )
      }

      /**
       * 当前选中的那一行（2026-11-11 加，配合「左列表 + 右详情」）。
       *
       * `selectedKey` 存 `sk:<name>` / `mc:<serverName>`；这里还原成 row 对象。
       * 找不到（条目被删了）就 undefined，右栏显示提示。
       */
      const selectedRow = (() => {
        if (selectedKey === undefined) return undefined
        const prefix = tab === 'skills' ? 'sk:' : 'mc:'
        if (!selectedKey.startsWith(prefix)) return undefined
        const id = selectedKey.slice(prefix.length)
        const all = tab === 'skills' ? skills : mcpRows
        return all.find((r) => (tab === 'skills' ? r.name === id : r.serverName === id))
      })()

      const allRows = tab === 'skills' ? skills : mcpRows

      /**
       * **按可用性拆两批**（2026-11-13）。
       *
       * `kind` 由后端 `skills.js` 算好：
       *   normal / forwarder / manual-only / author-off / disk-off / shadow。
       * MCP 行没有 kind，一律算可用。
       */
      const isUsable = (r) => tab !== 'skills' || (r.kind ?? 'normal') === 'normal'
      const usableRows = allRows.filter(isUsable)
      const unusableRows = allRows.filter((r) => !isUsable(r))

      // 折叠区关闭时，主列表只显示可用的那批
      const rows = showUnusable ? allRows : usableRows

      const chips = [
        h(
          'button',
          {
            key: '__all__',
            type: 'button',
            className: 'HUB_chip',
            'data-active': groupFilter === '' ? 'true' : 'false',
            onClick: () => setGroupFilter(''),
          },
          t('allGroups')
        ),
        h(
          'button',
          {
            key: '__none__',
            type: 'button',
            className: 'HUB_chip',
            'data-active': groupFilter === '__none__' ? 'true' : 'false',
            onClick: () => setGroupFilter('__none__'),
          },
          t('ungrouped')
        ),
        ...groups.map((g) =>
          h(
            Fragment,
            { key: g.id },
            h(
              'button',
              {
                type: 'button',
                className: 'HUB_chip',
                'data-active': groupFilter === g.id ? 'true' : 'false',
                onClick: () => setGroupFilter(g.id),
              },
              g.name
            ),
            // 选中某个分组后才出现「改名 / 删除」两个小动作，不占常驻位置
            groupFilter === g.id
              ? h(
                  Fragment,
                  null,
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'HUB_chip',
                      title: t('renameGroup'),
                      onClick: () => setGroupEdit({ id: g.id, name: g.name }),
                    },
                    '✎'
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'HUB_chip',
                      title: t('deleteGroupHint'),
                      onClick: () => setGroupDelete(g.id),
                    },
                    '✕'
                  )
                )
              : null
          )
        ),
        // 新建分组：行内输入，回车或点 + 提交
        groupEdit !== undefined
          ? h('input', {
              className: 'HUB_input',
              style: { width: '140px', padding: '2px 8px', fontSize: '11px', borderRadius: '999px' },
              value: groupEdit.name,
              placeholder: t('groupNamePlaceholder'),
              autoFocus: true,
              onChange: (e) => setGroupEdit({ ...groupEdit, name: e.target.value }),
              onKeyDown: (e) => {
                if (e.key === 'Enter') submitGroup(groupEdit)
                if (e.key === 'Escape') setGroupEdit(undefined)
              },
              onBlur: () => setGroupEdit(undefined),
            })
          : h(
              'button',
              {
                type: 'button',
                className: 'HUB_chip',
                title: t('newGroup'),
                onClick: () => setGroupEdit({ id: '', name: '' }),
              },
              '+ ' + t('newGroup')
            ),
        // 删除确认：就地显示，不弹窗
        groupDelete !== undefined
          ? h(
              Fragment,
              null,
              h('span', { className: 'HUB_warn', style: { alignSelf: 'center' } }, t('deleteGroupHint')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'HUB_chip',
                  onClick: async () => {
                    const id = groupDelete
                    setGroupDelete(undefined)
                    try {
                      const r = await call('deleteGroup', { id })
                      if (r?.ok === false) setError(r.detail ?? t('deleteFailed'))
                      if (groupFilter === id) setGroupFilter('')
                      await reload()
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err))
                    }
                  },
                },
                t('confirm')
              ),
              h('button', { type: 'button', className: 'HUB_chip', onClick: () => setGroupDelete(undefined) }, t('cancel'))
            )
          : null,
      ]

      return h(
        'div',
        { className: 'HUB_root' },
        h(
          'div',
          { className: 'HUB_bar' },
          h('button', { type: 'button', className: 'HUB_back', onClick: onBack }, '← ' + t('back')),
          h('span', { className: 'HUB_title' }, t('title')),
          h('input', {
            className: 'HUB_search',
            value: query,
            placeholder: t('searchPlaceholder'),
            onChange: (event) => setQuery(event.target.value),
          }),
          h(
            'div',
            { className: 'HUB_tabs' },
            h('button', {
              type: 'button',
              className: 'HUB_tab',
              'data-active': tab === 'skills' ? 'true' : 'false',
              onClick: () => {
                setTab('skills')
                setSelectedKey(undefined)
              },
            }, t('tabSkills') + ' ' + String(data?.skills?.length ?? 0)),
            h('button', {
              type: 'button',
              className: 'HUB_tab',
              'data-active': tab === 'mcp' ? 'true' : 'false',
              onClick: () => {
                setTab('mcp')
                setSelectedKey(undefined)
              },
            }, t('tabMcp') + ' ' + String(data?.mcp?.length ?? 0))
          )
        ),
        tab === 'skills' && data !== undefined ? h('div', { className: 'HUB_chips' }, chips) : null,
        /**
         * 层级控制条（2026-11-11 主人要求改成折叠式）。
         *
         * 语义：**全局是总控，工作区是它下面的细分。**
         *   · 全局关掉的条目，工作区开了也不生效（全局压制）
         *   · 全局全开时，工作区细分才有意义
         *
         * 交互：主行选层级（全局 › 本工作区），右侧 ▸ 展开说明与细分。
         */
        tab === 'mcp' && data !== undefined
          ? h(
              'div',
              { className: 'HUB_chips' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'HUB_chip',
                  'data-active': addOpen ? 'true' : 'false',
                  onClick: () => setAddOpen(!addOpen),
                },
                t('addServer')
              )
            )
          : null,
        addOpen && tab === 'mcp'
          ? h(AddServerForm, {
              t,
              busy: addBusy,
              done: addDone,
              error: addError,
              onCancel: () => {
                setAddOpen(false)
                setAddError(undefined)
                setAddDone(false)
              },
              onSubmit: async (input) => {
                setAddBusy(true)
                setAddError(undefined)
                try {
                  const r = await call('addServer', input)
                  if (r?.ok === false) {
                    setAddError(r.detail ?? 'failed')
                  } else {
                    setAddDone(true)
                    await reload()
                  }
                } catch (err) {
                  setAddError(err instanceof Error ? err.message : String(err))
                } finally {
                  setAddBusy(false)
                }
              },
            })
          : null,
        /**
         * 主体：**左侧竖向层级栏 + 右侧列表**（2026-11-11 主人要求把层级从顶部挪到侧边）。
         *
         * 为什么挪：层级是「当前在编辑哪一层」的全局状态，放顶部会跟搜索框、
         * 页签抢一行，而且每切一次层级视线要往上跳。竖排在左，跟列表同一视线高度。
         */
        h(
          'div',
          { className: 'HUB_main' },
          // ── 左侧：层级竖栏 ──
          data !== undefined
            ? h(
                'div',
                { className: 'HUB_side' },
                h('div', { className: 'HUB_sideTitle' }, t('levelTitle')),
                /**
                 * 层级项 = 文字 + 三态开关**并排同一行**（2026-11-11 第三次改）。
                 *
                 * 主人要求：
                 *   · 开关和文字并排（之前是上下堆叠）
                 *   · 下面列出**其他工作区**（不只当前这个）
                 *   · 「本工作区」改叫「工作区」
                 *
                 * 布局参考「全局设置」那套：每层一行，左边名字右边开关。
                 */
                h(
                  'div',
                  {
                    className: 'HUB_sideItem HUB_sideAll',
                    'data-active': scopeMode === false ? 'true' : 'false',
                    role: 'button',
                    tabIndex: 0,
                    title: t('globalHint') + '\n' + t('enableAllCount') + ' ' + String(globalAllState.closed) + ' / ' + String(globalAllState.total),
                    onClick: () => setScopeMode(false),
                  },
                  h('span', { className: 'HUB_sideName' }, t('levelGlobal')),
                  h('button', {
                    type: 'button',
                    className: 'HUB_sw HUB_swSide',
                    'data-on': globalAllState.state === 'on' ? 'true' : 'false',
                    'data-state': globalAllState.state,
                    'aria-label': t('levelGlobal') + ' ' + t('enableAll'),
                    disabled: busyAll === true,
                    onClick: (e) => {
                      e.stopPropagation()
                      if (busyAll !== true) void toggleAllFor(false, globalAllState.state !== 'on')
                    },
                  })
                ),
                /** 工作区列表：每个已知工作区一行（含当前），选中哪个就编辑哪层 */
                ...(Array.isArray(data?.workspaces) ? data.workspaces : []).map((w) => {
                  const wkey = 'ws:' + w.path
                  const active = scopeMode === true && wsLayerKey === wkey
                  const st = layerAllState(wkey)
                  return h(
                    'div',
                    {
                      key: wkey,
                      className: 'HUB_sideItem HUB_sideAll',
                      'data-active': active ? 'true' : 'false',
                      role: 'button',
                      tabIndex: 0,
                      title: w.path + '\n' + t('enableAllCount') + ' ' + String(st.closed) + ' / ' + String(st.total),
                      onClick: () => {
                        setPickedWorkspace(w.path)
                        setScopeMode(true)
                      },
                    },
                    h(
                      'span',
                      { className: 'HUB_sideName HUB_sideWsName' },
                      workspaceLabelOf(w.path) || w.path,
                      w.current === true ? h('span', { className: 'HUB_sideCur' }, t('wsCurrent')) : null
                    ),
                    h('button', {
                      type: 'button',
                      className: 'HUB_sw HUB_swSide',
                      'data-on': st.state === 'on' ? 'true' : 'false',
                      'data-state': st.state,
                      'aria-label': w.path + ' ' + t('enableAll'),
                      disabled: busyAll === true,
                      onClick: (e) => {
                        e.stopPropagation()
                        if (busyAll !== true) void toggleAllForWorkspace(w.path, st.state !== 'on')
                      },
                    })
                  )
                }),
                // 层级说明：竖栏底部，用小字常驻
                h('div', { className: 'HUB_sideFoot' }, t('levelExplainShort'))
              )
            : null,
          // ── 右侧：列表 ──
          h(
            'div',
            { className: 'HUB_body' },
            data === undefined && error === undefined ? h('div', { className: 'HUB_muted' }, t('loading')) : null,
            error !== undefined ? h('div', { className: 'HUB_err' }, t('loadError') + '：' + error) : null,
            toggleError !== undefined ? h('div', { className: 'HUB_err' }, t('enableFailed') + '：' + toggleError) : null,
            /**
             * 布局：**左列表 + 右详情**（2026-11-11 主人参照模组管理器要求）。
             *
             * 点左边一条 ⇒ 右边显示完整描述、来源、路径、别名、备注、分组。
             * 未选中时右边给一行提示，不留纯空白（空面板会让人以为坏了）。
             */
            data !== undefined
              ? h(
                  Fragment,
                  null,
                  h(
                    'div',
                    { className: 'HUB_split' },
                    // ── 左：列表 ──
                    h(
                      'div',
                      { className: 'HUB_listPane' },
                      h(
                        'div',
                        { className: 'HUB_row HUB_head' },
                        h('span', null, t('colName')),
                        h('span', null, ''),
                        h('span', null, tab === 'skills' ? t('colSource') : t('toolCount')),
                        h('span', null, ''),
                        h('span', { style: { textAlign: 'right' } }, t('colState'))
                      ),
                      /**
                       * **「不可用」折叠条**（2026-11-13 加）。
                       *
                       * 主人要求：「干净并且用户可以看到统计的所有 skill 和 mcp」。
                       *
                       * 所以不是隐藏，是**默认收起**：
                       *   · 收起时主列表只显示可用的（本机 32 个），干净
                       *   · 条上写明「不可用 10」，一个都没丢
                       *   · 点一下全部展开，每条后面附原因（转发到 X / 设计为手动触发 / …）
                       */
                      tab === 'skills' && unusableRows.length > 0
                        ? h(
                            'button',
                            {
                              type: 'button',
                              className: 'HUB_unusableBar',
                              'data-open': showUnusable ? 'true' : 'false',
                              onClick: () => setShowUnusable((v) => !v),
                            },
                            h('span', { className: 'HUB_unusableArrow' }, showUnusable ? '▾' : '▸'),
                            h('span', null, t('unusableLabel') + ' ' + String(unusableRows.length)),
                            h('span', { className: 'HUB_unusableHint' }, t('unusableHint'))
                          )
                        : null,

                      rows.length === 0
                        ? h('div', { className: 'HUB_muted' }, (data.skills?.length ?? 0) + (data.mcp?.length ?? 0) === 0 ? t('empty') : t('noMatch'))
                        : null,
                      h(
                        'div',
                        { className: 'HUB_listScroll' },
                        rows.map((row) => (tab === 'skills' ? skillRow(row) : mcpRow(row)))
                      )
                    ),
                    // ── 右：详情 ──
                    h(
                      'div',
                      { className: 'HUB_detailPane' },
                      selectedRow === undefined
                        ? h('div', { className: 'HUB_detailEmpty' }, t('detailEmpty'))
                        : h(RowDetail, {
                            t,
                            row: selectedRow,
                            groups: tab === 'skills' ? groups : [],
                            saving: savingKey === selectedKey,
                            saved: savedKey === selectedKey,
                            testing: tab === 'mcp' ? testingKey === selectedKey : false,
                            testResult: tab === 'mcp' ? testResult : undefined,
                            onTest: tab === 'mcp'
                              ? async () => {
                                  setTestingKey(selectedKey)
                                  setTestResult(undefined)
                                  try {
                                    const r = await call('testServer', { serverName: selectedRow.serverName })
                                    setTestResult({
                                      key: selectedKey,
                                      ok: r?.ok === true,
                                      text:
                                        r?.ok === true
                                          ? t('testOk') + ' · ' + String(r.toolCount ?? 0) + ' ' + t('toolCount') + ' · ' + String(r.elapsedMs ?? 0) + 'ms'
                                          : t('testFail') + '：' + String(r?.error ?? ''),
                                    })
                                  } catch (err) {
                                    setTestResult({ key: selectedKey, ok: false, text: t('testFail') + '：' + (err instanceof Error ? err.message : String(err)) })
                                  } finally {
                                    setTestingKey(undefined)
                                  }
                                }
                              : undefined,
                            onRemove: tab === 'mcp' && selectedRow.builtin === true
                              ? async () => {
                                  const r = await call('removeServer', { serverName: selectedRow.serverName })
                                  if (r?.ok === false) setError(r.detail ?? 'delete failed')
                                  setSelectedKey(undefined)
                                  await reload()
                                }
                              : undefined,
                            onSave: async (next) => {
                              setSavingKey(selectedKey)
                              try {
                                await call('annotate', {
                                  kind: tab === 'skills' ? 'skill' : 'mcp',
                                  name: tab === 'skills' ? selectedRow.name : selectedRow.serverName,
                                  ...next,
                                })
                                setSavedKey(selectedKey)
                                await reload()
                                setTimeout(() => setSavedKey(undefined), 1500)
                              } catch (err) {
                                setError(err instanceof Error ? err.message : String(err))
                              } finally {
                                setSavingKey(undefined)
                              }
                            },
                          })
                    )
                  ),
                  tab === 'mcp' && data.mcpNote !== undefined ? h('div', { className: 'HUB_tip' }, t('mcpNoteTitle') + '：' + data.mcpNote) : null
                )
              : null
          )
        ),
        hover !== undefined ? h(HoverTip, hover) : null
      )
    }

    // ── 插件入口 ────────────────────────────────────────────────────────
      const inject = ['slots', 'locale', 'remote', 'sessions', 'layout']

    function apply(ctx) {
      ensureStyle()
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-skill-mcp-hub: dictionaries')
      const t = ctx.locale.bind(NS)
      const mount = ctx.remote.$mount(CONTRIBUTION)

      const call = async (method, payload) => {
        await mount
        const remote = ctx.get('remote.skillMcpHub')
        if (remote === undefined || typeof remote[method] !== 'function') {
          throw new Error('remote.skillMcpHub.' + method + ' 不可用')
        }
        const result = payload === undefined ? await remote[method]() : await remote[method](payload)
        if (result !== null && typeof result === 'object' && result.ok === false) {
          throw new Error(result.detail ?? result.error?.message ?? '调用失败')
        }
        return result !== null && typeof result === 'object' && 'value' in result ? result.value : result
      }

      const onBack = () => {
        try {
          ctx.get('layout')?.selectPanel?.(null)
        } catch {}
      }

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL_ID, order: 2, label: () => t('nav'), locale: NS },
          HubIcon
        )
      )

      /**
       * 当前会话 id 的读取 + 订阅。
       *
       * 首选宿主的 `useSessions` hook（root 作用域槽位注入，响应式）；没有就退回
       * 自己订阅 `sessions.list` 快照。两者都拿不到时返回 undefined —— 此时会话级
       * 开关不可用，UI 会把它置灰并说明原因，不假装能用。
       */
      /** 读当前工作区键（会话级已升级为工作区级）。 */
      const readWorkspaceKey = () => {
        try {
          const sessions = ctx.get('sessions')
          const snap = typeof sessions?.list?.getSnapshot === 'function' ? sessions.list.getSnapshot() : undefined
          return selectMainWorkspace(snap)
        } catch {
          return undefined
        }
      }

      /** 读当前会话 id（输入栏按钮用它，走会话层）。 */
      const readSessionId = () => {
        try {
          const sessions = ctx.get('sessions')
          const snap = typeof sessions?.list?.getSnapshot === 'function' ? sessions.list.getSnapshot() : undefined
          return selectMainSessionId(snap)
        } catch {
          return undefined
        }
      }

      const subscribeSessions = (listener) => {
        try {
          const sessions = ctx.get('sessions')
          const subject = sessions?.list
          if (typeof subject?.subscribe === 'function') {
            return subject.subscribe(() => {
              try {
                listener(readWorkspaceKey(), readSessionId())
              } catch {}
            })
          }
          if (typeof subject?.onChange === 'function') {
            return subject.onChange(() => {
              try {
                listener(readWorkspaceKey(), readSessionId())
              } catch {}
            })
          }
        } catch {}
        return undefined
      }

    /**
     * 输入栏右侧的「本会话」按钮 + 浮层清单。
     *
     * 分工（照主人要求）：**侧边栏管全局，输入栏管本会话**。
     * 这里只显示「能影响当前会话」的两类条目并允许就地开关：
     *   · skill —— 走 scoped provider 遮蔽，只作用于本会话
     *   · MCP   —— 走 tools.restrict，只作用于本会话
     * 全局开关不放在这里，避免同一个开关在两条路上改出不同结果。
     */
    function SessionDock(props) {
      const t = props.t
      const call = props.call
      const sessionId = props.sessionId
      const [open, setOpen] = React.useState(false)
      const [data, setData] = React.useState(undefined)
      const [busy, setBusy] = React.useState(undefined)
      const [error, setError] = React.useState(undefined)
      const [tip, setTip] = React.useState(undefined)
      const [dockQuery, setDockQuery] = React.useState('')
      /** 只看本会话已关掉的条目。 */
      const [onlyOff, setOnlyOff] = React.useState(false)
      /** 分页：skill / mcp。 */
      const [dockTab, setDockTab] = React.useState('skill')
      const timer = React.useRef(undefined)

      const load = React.useCallback(async () => {
        try {
          const [all, sess] = await Promise.all([
            call('list'),
            typeof sessionId === 'string' && sessionId !== '' ? call('sessionState', { sessionId }) : Promise.resolve(undefined),
          ])
          setData({ all, sess })
          setError(undefined)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }, [call, sessionId])

      React.useEffect(() => {
        if (open) void load()
      }, [open, sessionId])

      React.useEffect(
        () => () => {
          if (timer.current !== undefined) clearTimeout(timer.current)
        },
        []
      )

      /** 该条目在本会话是否被关掉。 */
      const offInSession = (kind, name) => {
        const sess = data?.sess
        const arr = kind === 'skill' ? sess?.disabledSkills : sess?.disabledMcp
        return Array.isArray(arr) && arr.includes(name)
      }

      const flip = async (kind, name, currentlyOn) => {
        const key = kind + ':' + name
        setBusy(key)
        setError(undefined)
        try {
          const r = await call('toggle', { kind, name, enabled: !currentlyOn, layerKey: 'ss:' + sessionId })
          if (r?.ok === false) setError(r.detail ?? 'failed')
          await load()
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy(undefined)
        }
      }

      /**
       * 悬停提示（2026-11-12 主人要求「关闭在 skill 和 mcp 上停留一段时间会显示别名和备注」）。
       *
       * **关键修正**：原来没设别名/备注就直接 return ⇒ 一条提示都弹不出来（实测 state 里 0 条设过）。
       * 现在兜底显示**完整名称**——它本身有价值（列表里名字被省略号截断过）。
       */
      const beginTip = (row, event) => {
        const base = tipPartsOf(row)
        const fullName = row?.name ?? row?.serverName ?? ''
        /**
         * 内容优先级：
         *   ① 有别名/备注 ⇒ 显示它们（主人自己写的，最有用）
         *   ② 没有 ⇒ 显示**完整名称**（列表里常被截断成省略号）
         * 两种情况都补一行状态，让提示不只是"重复名字"。
         */
        const statusBits = []
        if (row?.disabledByRename === true) statusBits.push(t('diskDisabledTag'))
        if (row?.disabledByFrontmatter === true) statusBits.push(t('frontmatterOff'))
        const status = statusBits.join(' · ')

        let parts
        if (base !== undefined) {
          const note = base.note !== '' && status !== '' ? base.note + '\n' + status : base.note || status
          parts = { alias: base.alias !== '' ? base.alias : fullName, note }
        } else if (fullName !== '') {
          parts = { alias: fullName, note: status }
        }
        if (parts === undefined) return
        const x = event?.clientX ?? 0
        const y = event?.clientY ?? 0
        if (timer.current !== undefined) clearTimeout(timer.current)
        // 停留 450ms 才弹（防误触一眼扫过去就弹一堆）
        timer.current = setTimeout(() => setTip({ parts, x: x + 16, y: y + 14 }), 800)
      }
      const endTip = () => {
        if (timer.current !== undefined) clearTimeout(timer.current)
        timer.current = undefined
        setTip(undefined)
      }

      const offCount = (data?.sess?.disabledSkills?.length ?? 0) + (data?.sess?.disabledMcp?.length ?? 0)
      const disabled = typeof sessionId !== 'string' || sessionId === ''

      /**
       * 按钮样式（2026-11-11 主人要求「加边框、带圆角」）。
       *
       * 从「无边框透明文字」改成跟输入栏其他控件一致的**描边胶囊**：
       *   · 1px 边框 + 胶囊圆角 999px
       *   · 淡底色，让它在工具条里"是个按钮"而不是一段文字
       *   · 展开时边框加深 + 底色变深，给反馈
       *   · 有已关项时边框转橙色，跟浮层里的「中间态」呼应
       */
      const chipStyle = {
        border: '1px solid ' + (offCount > 0 && !open ? 'var(--dsw-alias-state-warn-primary,#d29922)' : open ? 'var(--dsw-alias-border-l3)' : 'var(--dsw-alias-border-l2)'),
        background: open ? 'var(--dsw-alias-interactive-bg-hover)' : 'var(--dsw-alias-bg-layer-1)',
        color: open ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: '3px 11px',
        borderRadius: '999px',
        fontSize: '12px',
        whiteSpace: 'nowrap',
        opacity: disabled ? 0.45 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        lineHeight: '17px',
        transition: 'border-color .14s, background .14s, color .14s',
      }

      const rowOf = (kind, row, on, locked) => {
        const name = kind === 'skill' ? row.name : row.serverName
        const label = row.alias || name
        const key = kind + ':' + name
        /** 悬停时把原名也带上，免得只看到别名不知道是哪个。 */
        const tipRow = row.alias && row.alias !== name ? { ...row, alias: label + ' · ' + name } : row
        return h(
          'div',
          {
            key,
            className: 'HUB_dockRow',
            'data-off': on ? 'false' : 'true',
            'data-locked': locked ? 'true' : 'false',
            onMouseEnter: (e) => beginTip(tipRow, e),
            onMouseLeave: endTip,
          },
          h(
            'span',
            { className: 'HUB_dockName', title: row.disabledByRename === true ? t('diskDisabledHint') : undefined },
            label,
            row.disabledByRename === true ? h('span', { className: 'HUB_dockTag' }, t('diskDisabledTag')) : null
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'HUB_sw',
              'data-on': on ? 'true' : 'false',
              'data-state': locked ? 'locked' : on ? 'on' : 'off',
              disabled: busy === key || locked,
              title: locked ? t('lockedHint') : undefined,
              'aria-label': locked ? t('lockedAria') : on ? t('on') : t('off'),
              onClick: (e) => {
                e.stopPropagation()
                void flip(kind, name, on)
              },
            }
          )
        )
      }

      /** 浮层开关状态（新语义）：locked = 全局关着，本层开不了。 */
      const skills = (data?.all?.skills ?? []).map((r) => {
        const locked = r.enabled !== true
        return { row: r, locked, on: !locked && !offInSession('skill', r.name) }
      })
      const mcpRows = (data?.all?.mcp ?? []).map((r) => {
        const locked = r.globalEnabled !== true
        return { row: r, locked, on: !locked && !offInSession('mcp', r.serverName) }
      })

      /** 搜索过滤：46 条不筛一眼扫不完。 */
      const needle = dockQuery.trim().toLowerCase()
      const keep = (item, name) => {
        // 「只看已关」：只想改回来时不必在 46 条里翻
        if (onlyOff && item.on !== false) return false
        if (needle === '') return true
        const alias = typeof item.row.alias === 'string' ? item.row.alias : ''
        return (name + ' ' + alias).toLowerCase().includes(needle)
      }
      const skillsShown = skills.filter((x) => keep(x, x.row.name))
      const mcpShown = mcpRows.filter((x) => keep(x, x.row.serverName))
      /** 本工作区已关掉的条目数（用于顶部提示）。 */
      const offSkills = skills.filter((x) => x.on === false).length
      const offMcp = mcpRows.filter((x) => x.on === false).length
      const offTotal = offSkills + offMcp

      return h(
        'span',
        { style: { position: 'relative', display: 'inline-flex' } },
        h(
          'button',
          {
            type: 'button',
            style: chipStyle,
            title: disabled ? t('noWorkspace') : t('sessionDockHint'),
            onClick: () => {
              if (disabled) return
              setOpen(!open)
            },
          },
          (offCount > 0 ? t('sessionDockLabel') + ' · ' + String(offCount) : t('sessionDockLabel'))
        ),
        open
          ? h(
              'div',
              { className: 'HUB_dockPanel' },
              h('div', { className: 'HUB_dockHead' }, t('sessionDockTitle')),
              // 搜索框：46 个 skill 不筛会翻很久
              h('input', {
                className: 'HUB_dockSearch',
                value: dockQuery,
                placeholder: t('dockSearchPlaceholder'),
                autoFocus: true,
                onChange: (e) => setDockQuery(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === 'Escape') setOpen(false)
                },
              }),
              /**
               * 工具条：一行装下「已关统计 + 只看已关」。
               * 46 条列表里想找「我把哪个关了」很难，这个筛选就是为了那件事。
               */
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0 0' } },
                h(
                  'span',
                  { className: 'HUB_hint', style: { fontSize: '10px', flex: '1' } },
                  t('dockOffSummary') + ' ' + String(offTotal)
                ),
                h(
                  'label',
                  {
                    className: 'HUB_chip',
                    'data-active': onlyOff ? 'true' : 'false',
                    style: { cursor: 'pointer', fontSize: '10px', padding: '1px 8px' },
                  },
                  h('input', {
                    type: 'checkbox',
                    checked: onlyOff,
                    style: { margin: '0 4px 0 0', cursor: 'pointer' },
                    onChange: (e) => setOnlyOff(e.target.checked),
                  }),
                  t('dockOnlyOff')
                )
              ),
              error !== undefined ? h('div', { className: 'HUB_err', style: { padding: '4px 0' } }, error) : null,
              /**
               * 分页（2026-11-11 主人：「改短一点，然后把 mcp 和 skill 分页，不然不好找」）。
               * 原来两段竖着堆，46 个 skill 之后才轮到 MCP，翻到底才能看到。
               * 现在页签切换 + 固定高度滚动区，任一类都能立刻定位。
               */
              h(
                'div',
                { className: 'HUB_dockTabs' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'HUB_dockTab',
                    'data-active': dockTab === 'skill' ? 'true' : 'false',
                    onClick: () => setDockTab('skill'),
                  },
                  t('tabSkills') + ' ' + String(skillsShown.length) + '/' + String(skills.length)
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'HUB_dockTab',
                    'data-active': dockTab === 'mcp' ? 'true' : 'false',
                    onClick: () => setDockTab('mcp'),
                  },
                  'MCP ' + String(mcpShown.length) + '/' + String(mcpRows.length)
                )
              ),
              data === undefined
                ? h('div', { className: 'HUB_muted', style: { padding: '6px 0' } }, t('loading'))
                : h(
                    'div',
                    { className: 'HUB_dockList' },
                    (dockTab === 'skill' ? skillsShown : mcpShown).length === 0
                      ? h('div', { className: 'HUB_muted', style: { padding: '4px 0' } }, t('noMatch'))
                      : null,
                    (dockTab === 'skill' ? skillsShown : mcpShown).map((x) =>
                      rowOf(dockTab === 'skill' ? 'skill' : 'mcp', x.row, x.on, x.locked)
                    )
                  )
            )
          : null,
        tip !== undefined ? h(HoverTip, tip) : null
      )
    }

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          { name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ t, call, onBack, readWorkspaceKey, readSessionId, subscribeSessions }) },
          HubPage
        )
      )

      /**
       * 输入栏右侧的会话级入口（主人要求：侧栏管全局，输入栏管本会话）。
       * 组件自己订阅会话切换，切会话时按钮上的「关了几个」会跟着变。
       */
      function SessionDockMount() {
        const [sid, setSid] = React.useState(() => readSessionId?.())
        React.useEffect(() => {
          const un = subscribeSessions((_k, s) => setSid(s))
          return () => {
            try {
              if (typeof un === 'function') un()
            } catch {}
          }
        }, [])
        return h(SessionDock, { t, call, sessionId: sid })
      }

      ctx.slots.inject('conversation.input.right', () =>
        ctx.slots.register(
          { name: 'conversation.input.right', id: 'skill-mcp-hub-session-dock', order: 48 },
          SessionDockMount
        )
      )
    }

    bundleModule.exports.NS = NS
    bundleModule.exports.apply = apply
    bundleModule.exports.inject = inject
    bundleModule.exports.HubPage = HubPage
    bundleModule.exports.HubIcon = HubIcon
    return bundleModule.exports
  },
})












































































































