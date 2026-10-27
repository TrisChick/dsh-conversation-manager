# Changelog

## v0.2.0

- **移植到 DSH 0.2.x（桌面端与 Web 端同一 bundle）**：改用 0.2.x 持久插件格式
  （`dsh.bundle.patch` + `dsh.client` + `locale/*.json` + `icon.svg`），通过 `plugin_manager install_bundle` 安装。
- 侧栏会话行「...」菜单的「删除会话」改为官方插槽 `sidebar.workspaces.session.menu.item`（不再 DOM 注入）。
- 批量删除入口改为侧栏底部 `sidebar.footer.action` 按钮 + `shell.overlay` 面板（0.2.x 无列表头部插槽）。
- Host 端：`workspaceRegistry.unarchiveSession` 官方恢复 API（不再改写私有状态缓存）；回收站状态改为自有原子 JSON 文件；会话磁盘清理按「每会话一目录」的新布局扫描定位。
- 新增 `/archived` 路由（读取 workspace 存储域归档集合），「已归档会话」面板不再依赖客户端快照字段。

## v0.1.0（DSH 0.1.0-rc.6）

- 删除对话（对话顶部「删除本对话」按钮、侧栏会话行「...」菜单「删除会话」项、设置页会话管理面板行内删除），软删除进回收站。
- 回收站（保留最近 20 条，支持恢复 / 彻底清除）。
- 已归档会话管理（设置页「已归档会话」折叠区常显，支持恢复 / 删除）。
- 批量删除（侧栏会话列表顶部「批量删除」按钮 + 勾选面板，运行中的会话自动跳过）。
- 中英文界面自适应；Host 端零外部依赖（纯 Node 内置模块）。
