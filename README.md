# dsh-conversation-manager

自研 DeepSeek Harness（Web）会话管理插件：**删除对话 + 已归档对话管理 + 批量删除**。

- **删除对话**：对话顶部右侧红色「删除本对话」按钮；设置页会话列表每行也有「删除」；**侧栏会话行「...」菜单**里新增「删除会话」项。删除是**软删除**——会话进入回收站，可恢复。
- **批量删除**：侧栏会话列表**顶部**新增「批量删除」按钮，打开勾选面板，可一次删除多个会话（运行中的会话自动禁用勾选并跳过）。
- **回收站**：保留最近 20 条已删除会话（超出自动彻底清除最早一条），支持**恢复**（回到会话列表）或**彻底删除**（永久清除日志，不可恢复）。
- **已归档会话管理**：设置页「会话管理」分栏底部「已归档会话」折叠区（**常显**，无归档会话时显示空态说明），可**一键恢复**（取消归档回到列表）或删除（移入回收站）。
- 删除限制：**正在运行**的会话禁止删除（按钮禁用 + host 端拒绝）。
- 中英文界面自适应（跟随页面语言）。

## 安装

### 从 GitHub（需本机安装 git）

```sh
dsh plugin --profile web add 'github:TrisChick/dsh-conversation-manager#v0.1.0'
```

> 本仓库为私有仓库，需要 git 凭据可访问该仓库（`gh auth login` 或配置 PAT）。
> 安装完成后**重启** `dsh web`，浏览器硬刷新。

### 从本地目录

源码目录路径**含空格**时 `dsh plugin add` 会把参数拆开，因此先建一个无空格路径的
junction（指向源码目录），再从 junction 安装：

```powershell
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\plugins\dsh-conversation-manager" `
  -Target "<源码目录>\dsh-conversation-manager"
dsh plugin --profile web add "$env:USERPROFILE\.dsh\plugins\dsh-conversation-manager"
```

安装完成后**重启** `dsh web`（host 插件与客户端 bundle 需重启加载），浏览器硬刷新。

## 使用

1. **删除本对话**：任意对话页右上角（Session log 左侧）红色按钮，确认后移入回收站。
2. **侧栏行菜单删除**：侧栏会话行「...」菜单 →「删除会话」，确认后移入回收站。
3. **批量删除**：侧栏会话列表顶部「批量删除」按钮 → 勾选多个会话 →「删除所选」，一次移入回收站。
4. **会话管理面板**：设置（侧边栏齿轮）→「会话管理」分栏：
   - 主列表：全部未归档会话，每行「继续」（打开对话）/「删除」；
   - 「已归档会话」折叠区（常显）：恢复 / 删除；
   - 「回收站」折叠区：恢复 / 彻底删除。

## 卸载

```powershell
dsh plugin --profile web remove dsh-conversation-manager
```

回收站目录 `~/.dsh/dsh-conversation-manager-trash/` 与存储域
`~/.dsh/storages/dsh_conversation_manager.json` 在卸载后保留，可手动删除。

## 工作原理

| 层 | 实现 |
|---|---|
| Host | `lib/index.js`：4 条路由 `POST /delete`、`POST /restore`、`POST /purge`、`GET /trash`。通过 `ctx.sessionPersistence` 定位会话、`ctx.workspaceRegistry` 归档/取消归档、`ctx.agents` 检测运行中会话、`ctx.storageDomain` 持久化回收站条目。删除时先走官方归档通道（侧边栏立即隐藏），再把非 live 会话的日志目录移入回收站。**零外部依赖**（只用 Node 内置模块）：插件源码在 profile 解析链之外，junction 会被 ESM 加载器真实化，故 `dshHomePath` 与存储域 spec（最小 zod 兼容 schema）自实现。 |
| Client | `lib/client.js`：官方 `settings.section` 插槽注册「会话管理」分栏（`useSessions`/`useWorkspaces` 标准数据源），`conversation.session.header.utilities` 插槽注册红色删除按钮，`shell.overlay` 插槽注册批量删除面板。侧栏「批量删除」按钮与行「...」菜单「删除会话」项因 rc.6 无对应官方插槽，通过 MutationObserver DOM 注入（锚点：含搜索框的 `sectionHeader`、带 `menuOpen` 的会话行与 `[role=menu]`），会话 id 按标题从客户端 sessions store 解析。 |

兼容 DSH `0.1.0-rc.6`（依赖 `settings.section` / `conversation.session.header.utilities` / `shell.overlay` 插槽与
`webServer` / `sessionPersistence` / `workspaceRegistry` / `agents` / `storageDomain` 服务）。
DSH 升级后如插槽或服务 API 变化，需要同步适配。

## 限制

- 不能删除**正在运行**的会话；当前打开的会话（空闲）可以删除。
- live 会话删除时不移动文件（还在原地写日志），文件在彻底删除时统一清理。
- 已彻底删除的会话 id 会留在浏览器 localStorage 与归档集合中（无害残留，不再显示）。
