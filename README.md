# dsh-conversation-manager

自研 DeepSeek Harness 会话管理插件：**删除对话 + 已归档对话管理 + 批量删除**。
支持 DSH 0.2.x（桌面端 / Web 端同一份 bundle，`settings.section` 等官方插槽 + `sidebar.workspaces.session.menu.item` 等 0.2 新插槽）。

- **删除对话**：对话顶部右侧红色「删除本对话」按钮；**侧栏会话行「...」菜单**里新增「删除会话」项；设置页会话列表每行也有「删除」。删除是**软删除**——会话归档隐藏并进入回收站，可恢复。
- **批量删除**：侧栏底部「批量删除」按钮 → 勾选面板，可一次删除多个会话（运行中的会话自动禁用勾选并跳过）。
- **回收站**：保留最近 20 条已删除会话，支持**恢复**（取消归档回到列表）或**彻底删除**（删除会话磁盘目录，不可恢复）。
- **已归档会话管理**：设置页「会话管理」分栏底部「已归档会话」折叠区（**常显**，无归档会话时显示空态说明），可**一键恢复**（取消归档）或删除（移入回收站）。
- 删除限制：**正在运行**的会话禁止删除（按钮禁用 + host 端 `archiveSession` 拒绝）。
- 中英文界面自适应（跟随页面语言）。

## 安装（DSH 0.2.x）

在 DSH 会话中让 Agent 调用 `plugin_manager` `install_bundle`，`target` 指向本包目录：

```
plugin_manager(action: "install_bundle", target: "D:\\DeepSeek Harness\\dsh-conversation-manager")
```

安装会写入当前 profile 的依赖与 bundle 层；`application`/`warnings` 之后重启 DSH 端使新 bundle 生效（已安装同名包时替换需要重启加载新模块代）。

> 旧版 DSH 0.1.0-rc.6 的安装方式（`dsh plugin --profile web add ...`）对应 GitHub 仓库的
> `v0.1.0` tag；本目录的 `v0.2.0` 起改用 0.2.x 持久插件格式（`dsh.bundle.patch` + `dsh.client` +
> `locale/*.json` + `icon.svg`）。

## 使用

1. **删除本对话**：任意对话页右上角（Session log 左侧）红色按钮，确认后移入回收站。
2. **侧栏行菜单删除**：侧栏会话行「...」菜单 →「删除会话」。
3. **批量删除**：侧栏底部「批量删除」按钮 → 勾选多个会话 →「删除所选」。
4. **会话管理面板**：设置（侧边栏齿轮）→「会话管理」分栏：
   - 主列表：未归档会话，每行「继续」（打开对话）/「删除」；
   - 「已归档会话」折叠区（常显）：恢复 / 删除；
   - 「回收站」折叠区：恢复 / 彻底删除。

## 卸载

```
plugin_manager(action: "remove_bundle", target: "dsh-conversation-manager")
```

回收站状态文件 `~/.dsh/storages/dsh_conversation_manager.json` 会保留，可手动删除。

## 工作原理（DSH 0.2.x）

| 层 | 实现 |
|---|---|
| Host | `index.js`：5 条路由 `POST /delete`、`/restore`、`/purge`，`GET /trash`、`/archived`。通过 `ctx.workspaceRegistry` 归档/取消归档（归档对运行中会话会拒绝，作为删除保护的第二道关卡）、`ctx.agents` 检测运行中会话、`ctx.sessionPersistence` 之外的自有 JSON 状态文件记录回收站条目。0.2.x 会话落盘为「每会话一个目录」`~/.dsh/sessions/<slug>/<sessionId>/`，彻底删除时按目录名扫描定位并删除。 |
| Client | `client.js`：0.2.x 客户端模块格式（`window.__ModuleLoader__.load({ id, factory })`，factory 返回 `{ inject, apply }`）。注册 `settings.section`（会话管理页）、`conversation.session.header.utilities`（删除本对话）、`sidebar.workspaces.session.menu.item`（行菜单删除）、`sidebar.footer.action` + `shell.overlay`（批量删除）。 |

兼容 DSH `0.2.1-rc.3`（依赖 `webServer` / `workspaceRegistry` / `agents` 服务与上述插槽）。
Host 端**零外部依赖**（纯 Node 内置模块）：插件源码目录不在 dsh 安装的模块解析链内，不能 import `@deepseek-ai/*` 包，因此 `dshHomePath` 自实现、回收站状态直接用原子 JSON 文件。

## 限制

- 不能删除**正在运行**的会话；当前打开的会话（空闲）可以删除（归档后依然可恢复）。
- 「删除」不移动磁盘文件（归档隐藏）；磁盘清理发生在「彻底删除」时。
- 已彻底删除的会话 id 会留在浏览器 localStorage（防止冷会话行残留显示）与归档集合中（无害残留）。
