/**
 * dsh-conversation-manager · client（DSH 0.2.x web 客户端模块格式）
 *
 * 客户端模块约定：window.__ModuleLoader__.load({ id, factory(require) { ... return { inject, apply } } })
 *   - id 必须等于包名；React 来自浏览器模块表（require('react')）；
 *   - 返回的插件对象注入 ['slots', 'locale', 'uiWorkspace']。
 *
 * 注册的 UI：
 *   - settings.section                    设置页「会话管理」：会话列表（继续/删除）、
 *                                         已归档会话折叠区（恢复/删除）、回收站（恢复/彻底删除）；
 *   - conversation.session.header.utilities  对话顶部红色「删除本对话」；
 *   - sidebar.workspaces.session.menu.item 侧栏会话行「...」菜单「删除会话」（0.2.x 官方插槽）；
 *   - sidebar.footer.action               侧栏底部「批量删除」按钮；
 *   - shell.overlay                       批量删除勾选面板。
 */
window.__ModuleLoader__.load({
  id: 'dsh-conversation-manager',
  factory(require) {
    const React = require('react')
    const { createElement, useCallback, useEffect, useRef, useState } = React

    const NS = 'dsh-conversation-manager'
    const DELETE_ROUTE = '/dsh-conversation-manager/delete'
    const RESTORE_ROUTE = '/dsh-conversation-manager/restore'
    const PURGE_ROUTE = '/dsh-conversation-manager/purge'
    const TRASH_ROUTE = '/dsh-conversation-manager/trash'
    const ARCHIVED_ROUTE = '/dsh-conversation-manager/archived'

    /** localStorage：本浏览器已彻底删除的会话 id（让冷会话行从列表视图消失）。 */
    const REMOVED_KEY = 'dsh-conversation-manager.removed'
    /** 回收站上限的客户端兜底值（以 host 返回为准）。 */
    const TRASH_FALLBACK_LIMIT = 20

    const STYLE = `
[data-dsh-cm] {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0 8px;
  color: var(--dsw-alias-label-primary, #111827);
}
.dsh-cm__header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.dsh-cm__title { font-size: 13px; font-weight: 600; }
.dsh-cm__count { color: var(--dsw-alias-label-tertiary, #9ca3af); font-size: 12px; }
.dsh-cm__notice { border-radius: 8px; font-size: 12px; padding: 6px 10px; line-height: 1.5; }
.dsh-cm__notice--ok { background: rgba(34, 197, 94, .12); }
.dsh-cm__notice--error { background: rgba(239, 68, 68, .12); }
.dsh-cm__empty { color: var(--dsw-alias-label-tertiary, #9ca3af); font-size: 12px; padding: 4px 0; }
.dsh-cm__group { border-top: 1px solid var(--dsw-alias-line-border, rgba(127, 127, 127, .14)); margin-top: 10px; padding-top: 8px; }
.dsh-cm__group-toggle {
  align-items: center; background: transparent; border: 0; border-radius: 8px;
  color: var(--dsw-alias-label-secondary, #6b7280); cursor: pointer; display: flex;
  font: inherit; font-size: 12px; gap: 8px; justify-content: space-between; padding: 6px 8px; width: 100%;
}
.dsh-cm__group-toggle:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, .08)); }
.dsh-cm__group-toggle-label { font-weight: 600; }
.dsh-cm__group-toggle-chevron { color: var(--dsw-alias-label-tertiary, #9ca3af); }
.dsh-cm__group-hint { color: var(--dsw-alias-label-tertiary, #9ca3af); font-size: 11px; line-height: 1.5; margin: 6px 8px 0; }
.dsh-cm__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.dsh-cm__row { display: flex; align-items: center; gap: 10px; border: 1px solid var(--dsw-alias-line-border, rgba(127, 127, 127, .18)); border-radius: 10px; padding: 8px 10px; }
.dsh-cm__row[data-archived] { opacity: .75; }
.dsh-cm__row[data-trash] { opacity: .85; }
.dsh-cm__row-main { flex: 1 1 auto; min-width: 0; }
.dsh-cm__row-title { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 13px; line-height: 1.4; }
.dsh-cm__row-title-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-cm__row-meta { color: var(--dsw-alias-label-tertiary, #9ca3af); font-size: 11px; line-height: 1.4; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-cm__btn {
  flex: none; white-space: nowrap; font-size: 12px; line-height: 1; padding: 4px 8px;
  border: 1px solid #d1d5db; border-radius: 6px; background: transparent;
  color: var(--dsw-alias-label-secondary, #6b7280); cursor: pointer;
}
.dsh-cm__btn:hover:not(:disabled) { border-color: #3964fe; color: #3964fe; }
.dsh-cm__btn:disabled { opacity: .5; cursor: default; }
.dsh-cm__btn--danger, .dsh-cm__btn--danger:hover:not(:disabled) { border-color: #ef4444; color: #ef4444; }
[data-dsh-cm-delete-current] {
  align-items: center; appearance: none; background: rgba(239, 68, 68, .1); border: 0; border-radius: 8px;
  color: rgb(220, 38, 38); cursor: pointer; display: inline-flex; font: inherit; font-size: 12px;
  font-weight: 600; gap: 4px; height: 28px; justify-content: center; padding: 0 10px; white-space: nowrap;
}
[data-dsh-cm-delete-current]:hover { background: rgba(239, 68, 68, .2); }
[data-dsh-cm-menu-delete] {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 12px; border: none;
  background: transparent; color: var(--dsw-alias-state-error-primary, #e5484d); font: inherit;
  font-size: 13px; line-height: 20px; text-align: left; border-radius: 6px; cursor: pointer;
}
[data-dsh-cm-menu-delete]:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, .14)); }
[data-dsh-cm-footer-batch] {
  align-items: center; appearance: none; background: transparent; border: 1px solid var(--dsw-alias-line-border, rgba(127, 127, 127, .28));
  border-radius: 8px; color: var(--dsw-alias-label-secondary, #6b7280); cursor: pointer; display: inline-flex;
  font: inherit; font-size: 12px; gap: 4px; height: 28px; padding: 0 8px; white-space: nowrap;
}
[data-dsh-cm-footer-batch]:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, .1)); color: var(--dsw-alias-label-primary, #111827); }
.dsh-cm__batch-backdrop { background: rgba(0, 0, 0, .28); inset: 0; position: fixed; z-index: 1300; pointer-events: auto; }
.dsh-cm__batch-card {
  background: var(--dsw-alias-bg-base, #fff); border: 1px solid var(--dsw-alias-line-border, rgba(127, 127, 127, .18));
  border-radius: 12px; box-shadow: 0 16px 48px rgba(0, 0, 0, .22); display: flex; flex-direction: column;
  left: 50%; max-height: 72vh; max-width: calc(100vw - 40px); position: fixed; top: 50%;
  transform: translate(-50%, -50%); width: 440px; z-index: 1301;
}
.dsh-cm__batch-head { align-items: baseline; border-bottom: 1px solid var(--dsw-alias-line-border, rgba(127, 127, 127, .14)); display: flex; flex: none; gap: 8px; justify-content: space-between; padding: 12px 14px 10px; }
.dsh-cm__batch-head-title { font-size: 14px; font-weight: 650; }
.dsh-cm__batch-head-count { color: var(--dsw-alias-label-tertiary, #9ca3af); font-size: 12px; }
.dsh-cm__batch-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px 14px; }
.dsh-cm__batch-row { align-items: center; border-radius: 8px; display: flex; gap: 8px; min-width: 0; padding: 6px 8px; }
.dsh-cm__batch-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, .08)); }
.dsh-cm__batch-row input { accent-color: #3964fe; flex: none; }
.dsh-cm__batch-row-main { flex: 1 1 auto; min-width: 0; }
.dsh-cm__batch-row-title { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-cm__batch-row-meta { color: var(--dsw-alias-label-tertiary, #9ca3af); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-cm__batch-tag { color: var(--dsw-alias-label-tertiary, #9ca3af); flex: none; font-size: 11px; }
.dsh-cm__batch-tag--running { color: #f5a524; }
.dsh-cm__batch-foot { border-top: 1px solid var(--dsw-alias-line-border, rgba(127, 127, 127, .14)); display: flex; flex: none; gap: 8px; justify-content: flex-end; padding: 10px 14px 12px; }
.dsh-cm__batch-foot .dsh-cm__batch-selectall { margin-right: auto; }
`

    function isZh() {
      return typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('zh')
    }

    function stringsOf() {
      return isZh()
        ? {
            nav: '会话管理',
            title: '会话管理',
            count: (n) => `${n} 个会话`,
            continue: '继续',
            delete: '删除',
            deleting: '删除中…',
            confirm: '确定删除会话「{title}」吗？它将进入回收站，可在「设置 → 会话管理 → 回收站」中恢复或彻底删除。',
            deleted: '已删除会话「{title}」',
            deleteFailed: '删除会话「{title}」失败',
            liveError: '（会话正在运行，请先停止后再删）',
            restore: '恢复',
            restoreConfirm: '确定恢复会话「{title}」吗？它会回到会话列表。',
            restored: '已恢复会话「{title}」',
            restoreFailed: '恢复会话「{title}」失败',
            purge: '彻底删除',
            purgeConfirm: '确定彻底删除会话「{title}」吗？会话日志将被永久删除，无法恢复。',
            purged: '已彻底删除会话「{title}」',
            purgeFailed: '彻底删除会话「{title}」失败',
            archived: '已归档',
            archivedGroup: '已归档会话',
            archivedHint: '归档会话只被官方侧边栏隐藏，可在此恢复或移入回收站。',
            archivedEmpty: '当前没有已归档的会话。归档入口在侧边栏会话行「...」菜单中。',
            trashGroup: '回收站',
            trashHint: '保留最近 {limit} 条已删除会话，超出后最早一条会被自动清除。',
            trashEmpty: '回收站为空。',
            trashLoadFailed: '回收站加载失败',
            expand: '展开',
            collapse: '收起',
            empty: '没有可管理的会话。',
            noCwd: '(未知工作目录)',
            current: '当前会话',
            running: '运行中',
            deleteCurrent: '删除本对话',
            deleteCurrentConfirm: '确定删除当前对话吗？它将进入回收站，可在「设置 → 会话管理 → 回收站」中恢复或彻底删除。',
            deleteCurrentDone: '当前对话已移入回收站。',
            deleteCurrentFailed: '删除当前对话失败',
            deleteCurrentRunning: '（对话正在运行，请稍后再试）',
            menuDelete: '删除会话',
            menuNotFound: '未能找到该会话，请刷新后重试。',
            batchDelete: '批量删除',
            batchTitle: '批量删除会话',
            batchCount: (n) => `已选 ${n} 个`,
            selectAll: '全选',
            cancel: '取消',
            deleteSelected: (n) => `删除所选 (${n})`,
            deletingBatch: '删除中…',
            batchConfirm: (n) => `确定删除选中的 ${n} 个会话吗？它们将进入回收站，可在「设置 → 会话管理 → 回收站」中恢复或彻底删除。运行中的会话会被跳过。`,
            batchDone: (ok, failed) => `已删除 ${ok} 个会话${failed > 0 ? `，${failed} 个失败（可能是运行中）` : ''}`,
            batchEmpty: '没有可删除的会话。',
            deletedAt: (ms) => {
              const d = new Date(ms)
              const pad = (n) => String(n).padStart(2, '0')
              return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
            },
          }
        : {
            nav: 'Conversation Manager',
            title: 'Conversation Manager',
            count: (n) => `${n} sessions`,
            continue: 'Continue',
            delete: 'Delete',
            deleting: 'Deleting…',
            confirm: 'Delete session "{title}"? It moves to the trash, where you can restore or permanently delete it from Settings → Conversation Manager → Trash.',
            deleted: 'Deleted session "{title}"',
            deleteFailed: 'Failed to delete session "{title}"',
            liveError: ' (the session is running; stop it before deleting)',
            restore: 'Restore',
            restoreConfirm: 'Restore session "{title}"? It will return to the session list.',
            restored: 'Restored session "{title}"',
            restoreFailed: 'Failed to restore session "{title}"',
            purge: 'Delete permanently',
            purgeConfirm: 'Permanently delete session "{title}"? Its logs cannot be recovered.',
            purged: 'Permanently deleted session "{title}"',
            purgeFailed: 'Failed to permanently delete session "{title}"',
            archived: 'archived',
            archivedGroup: 'Archived sessions',
            archivedHint: 'Archived sessions are only hidden from the official sidebar. Restore them here or move them to the trash.',
            archivedEmpty: 'No archived sessions right now. The archive entry lives in the sidebar session row "..." menu.',
            trashGroup: 'Trash',
            trashHint: 'Keeps the most recent {limit} deleted sessions; the oldest is cleared automatically.',
            trashEmpty: 'The trash is empty.',
            trashLoadFailed: 'Failed to load the trash',
            expand: 'Expand',
            collapse: 'Collapse',
            empty: 'No manageable sessions.',
            noCwd: '(unknown working directory)',
            current: 'current session',
            running: 'running',
            deleteCurrent: 'Delete this session',
            deleteCurrentConfirm: 'Delete this conversation? It moves to the trash, where you can restore or permanently delete it from Settings → Conversation Manager → Trash.',
            deleteCurrentDone: 'This conversation has been moved to the trash.',
            deleteCurrentFailed: 'Failed to delete this session',
            deleteCurrentRunning: ' (the conversation is running; try again later)',
            menuDelete: 'Delete session',
            menuNotFound: 'Could not find this session. Please refresh and try again.',
            batchDelete: 'Batch delete',
            batchTitle: 'Batch delete sessions',
            batchCount: (n) => `${n} selected`,
            selectAll: 'Select all',
            cancel: 'Cancel',
            deleteSelected: (n) => `Delete selected (${n})`,
            deletingBatch: 'Deleting…',
            batchConfirm: (n) => `Delete the ${n} selected sessions? They move to the trash, where you can restore or permanently delete them from Settings → Conversation Manager → Trash. Running sessions are skipped.`,
            batchDone: (ok, failed) => `Deleted ${ok} sessions${failed > 0 ? `, ${failed} failed (possibly running)` : ''}`,
            batchEmpty: 'No sessions to delete.',
            deletedAt: (ms) => {
              const d = new Date(ms)
              const pad = (n) => String(n).padStart(2, '0')
              return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
            },
          }
    }

    // ── 模块级共享状态 ─────────────────────────────────────────────────────

    /** uiWorkspace 客户端服务：打开会话、归档、取消归档。 */
    let uiWorkspaceSvc = null

    const batchState = { open: false, selection: new Set() }
    const batchListeners = new Set()
    function setBatch(patch) {
      Object.assign(batchState, patch)
      batchListeners.forEach((listener) => listener())
    }
    function useBatchState() {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => force((value) => value + 1)
        batchListeners.add(listener)
        return () => {
          batchListeners.delete(listener)
        }
      }, [])
      return batchState
    }

    function loadRemoved() {
      try {
        const raw = window.localStorage.getItem(REMOVED_KEY)
        if (raw !== null) return new Set(JSON.parse(raw))
      } catch {
        // 存储不可用：退回空集合。
      }
      return new Set()
    }

    function saveRemoved(removed) {
      try {
        window.localStorage.setItem(REMOVED_KEY, JSON.stringify([...removed]))
      } catch {
        // 存储不可用：内存过滤仍然有效。
      }
    }

    /** POST 一个 host 路由；成功返回 null，失败返回错误码。 */
    async function postAction(route, body) {
      try {
        const response = await fetch(route, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || data.ok !== true) return data.error ?? `HTTP ${response.status}`
        return null
      } catch (error) {
        return error instanceof Error ? error.message : 'network-error'
      }
    }

    async function loadTrash() {
      try {
        const response = await fetch(TRASH_ROUTE)
        const data = await response.json().catch(() => ({}))
        if (response.ok && data.ok) return { entries: data.entries ?? [], limit: data.limit ?? TRASH_FALLBACK_LIMIT }
      } catch {
        // 网络失败：调用方按失败处理。
      }
      return null
    }

    /** 从 host 读取归档集合（workspace 存储域的权威值）。 */
    async function loadArchivedIds() {
      try {
        const response = await fetch(ARCHIVED_ROUTE)
        const data = await response.json().catch(() => ({}))
        if (response.ok && data.ok && Array.isArray(data.archivedSessionIds)) {
          return data.archivedSessionIds.filter((id) => typeof id === 'string')
        }
      } catch {
        // 网络失败：退回客户端快照里的归档集合。
      }
      return []
    }

    /** 收敛侧栏会话行 → 统一的行模型（字段名对旧/新快照都兼容）。 */
    function rowOf(summary) {
      if (summary === null || summary === undefined) return undefined
      return {
        id: summary.id,
        title: summary.displayTitle ?? summary.title ?? summary.id,
        cwd: summary.cwd,
        updatedAt: typeof summary.updatedAt === 'number' ? summary.updatedAt : 0,
        running: summary.running === true,
        blank: summary.blank === true,
      }
    }

    // ── 设置页「会话管理」 ─────────────────────────────────────────────────

    function SessionManagerPanel(props) {
      const { useSessions, useWorkspaces, close } = props
      const list = useSessions((state) => state)
      const workspaces = useWorkspaces((state) => state)
      const strings = stringsOf()
      const [removed, setRemoved] = useState(() => loadRemoved())
      const [trash, setTrash] = useState(null)
      const [trashLimit, setTrashLimit] = useState(TRASH_FALLBACK_LIMIT)
      const [trashFailed, setTrashFailed] = useState(false)
      const [archivedFromHost, setArchivedFromHost] = useState([])
      const [archivedOpen, setArchivedOpen] = useState(true)
      const [trashOpen, setTrashOpen] = useState(false)
      const [busyId, setBusyId] = useState(null)
      const [notice, setNotice] = useState(null)
      const noticeTimer = useRef(undefined)

      const showNotice = useCallback((next) => {
        setNotice(next)
        window.clearTimeout(noticeTimer.current)
        noticeTimer.current = window.setTimeout(() => setNotice(null), 3500)
      }, [])
      useEffect(() => () => window.clearTimeout(noticeTimer.current), [])

      const refreshTrash = useCallback(async () => {
        const result = await loadTrash()
        if (result === null) {
          setTrashFailed(true)
          return
        }
        setTrash(result.entries)
        setTrashLimit(result.limit)
        setTrashFailed(false)
      }, [])
      useEffect(() => {
        void refreshTrash()
      }, [refreshTrash])

      const refreshArchived = useCallback(async () => {
        setArchivedFromHost(await loadArchivedIds())
      }, [])

      useEffect(() => {
        void refreshArchived()
      }, [refreshArchived])

      const markRemoved = useCallback((sessionId) => {
        setRemoved((previous) => {
          const next = new Set(previous)
          next.add(sessionId)
          saveRemoved(next)
          return next
        })
      }, [])

      const handleDelete = useCallback(async (sessionId, title) => {
        if (!window.confirm(strings.confirm.replace('{title}', title))) return
        setBusyId(sessionId)
        setNotice(null)
        const error = await postAction(DELETE_ROUTE, { sessionId, title })
        setBusyId(null)
        if (error !== null) {
          const friendly = error === 'session-live' ? strings.liveError : ''
          showNotice({ kind: 'error', text: strings.deleteFailed.replace('{title}', title) + friendly })
          return
        }
        await refreshTrash()
        await refreshArchived()
        showNotice({ kind: 'ok', text: strings.deleted.replace('{title}', title) })
      }, [strings, refreshTrash, refreshArchived, showNotice])

      const handleRestore = useCallback(async (sessionId, title) => {
        if (!window.confirm(strings.restoreConfirm.replace('{title}', title))) return
        setBusyId(sessionId)
        setNotice(null)
        const error = await postAction(RESTORE_ROUTE, { sessionId })
        setBusyId(null)
        if (error !== null) {
          showNotice({ kind: 'error', text: strings.restoreFailed.replace('{title}', title) + ` (${error})` })
          return
        }
        await refreshTrash()
        await refreshArchived()
        showNotice({ kind: 'ok', text: strings.restored.replace('{title}', title) })
      }, [strings, refreshTrash, refreshArchived, showNotice])

      const handlePurge = useCallback(async (sessionId, title) => {
        if (!window.confirm(strings.purgeConfirm.replace('{title}', title))) return
        setBusyId(sessionId)
        setNotice(null)
        const error = await postAction(PURGE_ROUTE, { sessionId })
        setBusyId(null)
        if (error !== null) {
          showNotice({ kind: 'error', text: strings.purgeFailed.replace('{title}', title) + ` (${error})` })
          return
        }
        markRemoved(sessionId)
        await refreshTrash()
        await refreshArchived()
        showNotice({ kind: 'ok', text: strings.purged.replace('{title}', title) })
      }, [strings, refreshTrash, refreshArchived, markRemoved, showNotice])

      const handleContinue = useCallback((sessionId) => {
        try {
          uiWorkspaceSvc?.openSession(sessionId)
        } catch {
          // 打开失败时保持面板打开。
          return
        }
        close()
      }, [close])

      const snapshotArchived = Array.isArray(workspaces?.archivedSessionIds) ? workspaces.archivedSessionIds : []
      const archivedSet = new Set([...snapshotArchived, ...archivedFromHost].filter((id) => typeof id === 'string'))
      const trashIds = new Set((trash ?? []).map((entry) => entry.sessionId))

      const summaries = []
      for (const id of list.ids ?? []) {
        const row = rowOf(list.byId?.[id])
        if (row === undefined || row.blank || removed.has(row.id)) continue
        summaries.push(row)
      }
      const sortNewest = (rows) => [...rows].sort((a, b) => b.updatedAt - a.updatedAt)
      const activeRows = sortNewest(summaries.filter((row) => !archivedSet.has(row.id) && !trashIds.has(row.id)))
      const archivedRows = sortNewest(summaries.filter((row) => archivedSet.has(row.id) && !trashIds.has(row.id)))

      const renderRow = (row, isArchived) => {
        const isCurrent = !isArchived && row.id === list.current
        const busy = busyId === row.id
        const metaParts = [row.cwd ?? strings.noCwd]
        if (isArchived) metaParts.push(strings.archived)
        if (isCurrent) metaParts.push(strings.current)
        if (row.running) metaParts.push(strings.running)
        return createElement('li', {
          key: row.id,
          className: 'dsh-cm__row',
          'data-archived': isArchived || undefined,
        },
          createElement('div', { className: 'dsh-cm__row-main' },
            createElement('div', { className: 'dsh-cm__row-title', title: row.title },
              createElement('span', { className: 'dsh-cm__row-title-text' }, row.title),
            ),
            createElement('div', { className: 'dsh-cm__row-meta', title: metaParts.join(' · ') }, metaParts.join(' · ')),
          ),
          createElement('button', {
            className: 'dsh-cm__btn',
            type: 'button',
            disabled: row.running || busy,
            title: row.running ? strings.running : strings.continue,
            onClick: () => handleContinue(row.id),
          }, strings.continue),
          isArchived && createElement('button', {
            className: 'dsh-cm__btn',
            type: 'button',
            disabled: busy,
            onClick: () => void handleRestore(row.id, row.title),
          }, strings.restore),
          createElement('button', {
            className: 'dsh-cm__btn dsh-cm__btn--danger',
            type: 'button',
            disabled: row.running || busy,
            title: row.running ? strings.running : strings.delete,
            onClick: () => void handleDelete(row.id, row.title),
          }, busy ? strings.deleting : strings.delete),
        )
      }

      const renderTrashRow = (entry) => {
        const busy = busyId === entry.sessionId
        const title = entry.title ?? entry.sessionId
        const metaParts = [strings.deletedAt(entry.deletedAt)]
        return createElement('li', {
          key: entry.sessionId,
          className: 'dsh-cm__row',
          'data-trash': true,
        },
          createElement('div', { className: 'dsh-cm__row-main' },
            createElement('div', { className: 'dsh-cm__row-title', title }, title),
            createElement('div', { className: 'dsh-cm__row-meta', title: metaParts.join(' · ') }, metaParts.join(' · ')),
          ),
          createElement('button', {
            className: 'dsh-cm__btn',
            type: 'button',
            disabled: busy,
            onClick: () => void handleRestore(entry.sessionId, title),
          }, strings.restore),
          createElement('button', {
            className: 'dsh-cm__btn dsh-cm__btn--danger',
            type: 'button',
            disabled: busy,
            onClick: () => void handlePurge(entry.sessionId, title),
          }, strings.purge),
        )
      }

      return createElement('div', { 'data-dsh-cm': '' },
        createElement('div', { className: 'dsh-cm__header' },
          createElement('span', { className: 'dsh-cm__title' }, strings.title),
          createElement('span', { className: 'dsh-cm__count' }, strings.count(activeRows.length)),
        ),
        notice !== null && createElement('div', {
          className: `dsh-cm__notice dsh-cm__notice--${notice.kind}`,
        }, notice.text),
        activeRows.length === 0
          ? createElement('div', { className: 'dsh-cm__empty' }, strings.empty)
          : createElement('ul', { className: 'dsh-cm__list' },
              ...activeRows.map((row) => renderRow(row, false))),
        // 已归档会话折叠区常显：没有归档会话时显示空态说明，避免用户找不到入口。
        createElement('div', { className: 'dsh-cm__group' },
          createElement('button', {
            type: 'button',
            className: 'dsh-cm__group-toggle',
            onClick: () => setArchivedOpen((open) => !open),
            'aria-expanded': archivedOpen || undefined,
          },
            createElement('span', { className: 'dsh-cm__group-toggle-label' },
              `${strings.archivedGroup} (${archivedRows.length})`),
            createElement('span', { className: 'dsh-cm__group-toggle-chevron' },
              archivedOpen ? strings.collapse : strings.expand),
          ),
          archivedOpen && (archivedRows.length === 0
            ? createElement('div', { className: 'dsh-cm__empty' }, strings.archivedEmpty)
            : createElement('ul', { className: 'dsh-cm__list' },
                ...archivedRows.map((row) => renderRow(row, true)))),
          createElement('div', { className: 'dsh-cm__group-hint' }, strings.archivedHint),
        ),
        trash !== null && createElement('div', { className: 'dsh-cm__group' },
          createElement('button', {
            type: 'button',
            className: 'dsh-cm__group-toggle',
            onClick: () => setTrashOpen((open) => !open),
            'aria-expanded': trashOpen || undefined,
          },
            createElement('span', { className: 'dsh-cm__group-toggle-label' },
              `${strings.trashGroup} (${trash.length}/${trashLimit})`),
            createElement('span', { className: 'dsh-cm__group-toggle-chevron' },
              trashOpen ? strings.collapse : strings.expand),
          ),
          trashFailed
            ? createElement('div', { className: 'dsh-cm__group-hint' }, strings.trashLoadFailed)
            : trashOpen && (trash.length === 0
                ? createElement('div', { className: 'dsh-cm__empty' }, strings.trashEmpty)
                : createElement('ul', { className: 'dsh-cm__list' },
                    ...trash.map((entry) => renderTrashRow(entry)))),
          createElement('div', { className: 'dsh-cm__group-hint' },
            strings.trashHint.replace('{limit}', String(trashLimit))),
        ),
      )
    }

    // ── 对话顶部「删除本对话」 ───────────────────────────────────────────────

    function DeleteCurrentButton(props) {
      const strings = stringsOf()
      const sessionId = props.sessionId
      const handleClick = () => {
        if (typeof sessionId !== 'string' || sessionId === '') return
        if (!window.confirm(strings.deleteCurrentConfirm)) return
        void (async () => {
          const error = await postAction(DELETE_ROUTE, { sessionId })
          if (error !== null) {
            const friendly = error === 'session-live' ? strings.deleteCurrentRunning : ''
            const suffix = friendly !== '' ? ` ${friendly}` : ` (${error})`
            window.alert(strings.deleteCurrentFailed + suffix)
            return
          }
          window.alert(strings.deleteCurrentDone)
        })()
      }
      return createElement('button', {
        type: 'button',
        'data-dsh-cm-delete-current': '',
        title: strings.deleteCurrent,
        'aria-label': strings.deleteCurrent,
        onClick: handleClick,
      }, strings.deleteCurrent)
    }

    // ── 侧栏会话行「...」菜单「删除会话」 ───────────────────────────────────

    function MenuDeleteItem(props) {
      const strings = stringsOf()
      const sessionId = props.sessionId
      const displayTitle = typeof props.displayTitle === 'string' ? props.displayTitle : ''
      const handleClick = () => {
        if (typeof sessionId !== 'string' || sessionId === '') return
        const title = displayTitle !== '' ? displayTitle : sessionId
        if (!window.confirm(strings.confirm.replace('{title}', title))) return
        void (async () => {
          const error = await postAction(DELETE_ROUTE, { sessionId, title })
          if (error !== null) {
            const friendly = error === 'session-live' ? strings.liveError : ` (${error})`
            window.alert(strings.deleteFailed.replace('{title}', title) + friendly)
          }
          // 成功时该行随归档从侧栏消失，菜单随之关闭。
        })()
      }
      return createElement('button', {
        type: 'button',
        role: 'menuitem',
        'data-dsh-cm-menu-delete': '',
        onClick: handleClick,
      },
        createElement('svg', {
          width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, style: { flex: 'none' },
        }, createElement('path', {
          d: 'M6.5 1.5h3l.5.5h2.5a.5.5 0 010 1H3.5a.5.5 0 010-1H6l.5-.5zM3 4.5h10l-.6 8.1a2 2 0 01-2 1.9H5.6a2 2 0 01-2-1.9L3 4.5zm2 1.5v6h1.5V6H5zm4.5 0v6H11V6H9.5z',
          fill: 'currentColor',
        })),
        createElement('span', null, strings.menuDelete),
      )
    }

    // ── 侧栏底部「批量删除」按钮 ───────────────────────────────────────────

    function FooterBatchButton(props) {
      const strings = stringsOf()
      const wide = props.wide === true
      return createElement('button', {
        type: 'button',
        'data-dsh-cm-footer-batch': '',
        title: strings.batchTitle,
        'aria-label': strings.batchTitle,
        onClick: () => setBatch({ open: true, selection: new Set() }),
      },
        createElement('svg', {
          width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, style: { flex: 'none' },
        }, createElement('path', {
          d: 'M6.5 1.5h3l.5.5h2.5a.5.5 0 010 1H3.5a.5.5 0 010-1H6l.5-.5zM3 4.5h10l-.6 8.1a2 2 0 01-2 1.9H5.6a2 2 0 01-2-1.9L3 4.5zm2 1.5v6h1.5V6H5zm4.5 0v6H11V6H9.5z',
          fill: 'currentColor',
        })),
        wide ? createElement('span', null, strings.batchDelete) : null,
      )
    }

    // ── 批量删除面板（shell.overlay） ───────────────────────────────────────

    function BatchPanel(props) {
      const { useSessions } = props
      const state = useBatchState()
      const list = useSessions((snapshot) => snapshot)
      const strings = stringsOf()
      const [busy, setBusy] = useState(false)

      if (!state.open) return null

      const rows = []
      for (const id of list.ids ?? []) {
        const row = rowOf(list.byId?.[id])
        if (row === undefined || row.blank) continue
        rows.push(row)
      }
      const selectable = rows.filter((row) => !row.running)
      const allSelected = selectable.length > 0 && selectable.every((row) => state.selection.has(row.id))

      const toggle = (sessionId) => {
        const next = new Set(state.selection)
        if (next.has(sessionId)) next.delete(sessionId)
        else next.add(sessionId)
        setBatch({ selection: next })
      }

      const toggleAll = () => {
        setBatch({ selection: allSelected ? new Set() : new Set(selectable.map((row) => row.id)) })
      }

      const deleteSelected = () => {
        const ids = [...state.selection]
        if (ids.length === 0 || busy) return
        if (!window.confirm(strings.batchConfirm(ids.length))) return
        setBusy(true)
        void (async () => {
          let ok = 0
          let failed = 0
          for (const sessionId of ids) {
            const row = rows.find((candidate) => candidate.id === sessionId)
            const error = await postAction(DELETE_ROUTE, { sessionId, title: row?.title })
            if (error === null) ok += 1
            else failed += 1
          }
          setBusy(false)
          setBatch({ open: false, selection: new Set() })
          window.alert(strings.batchDone(ok, failed))
        })()
      }

      return createElement('div', {
        className: 'dsh-cm__batch-backdrop',
        onClick: () => setBatch({ open: false }),
      },
        createElement('div', {
          className: 'dsh-cm__batch-card',
          role: 'dialog',
          'aria-label': strings.batchTitle,
          onClick: (event) => event.stopPropagation(),
        },
          createElement('div', { className: 'dsh-cm__batch-head' },
            createElement('span', { className: 'dsh-cm__batch-head-title' }, strings.batchTitle),
            createElement('span', { className: 'dsh-cm__batch-head-count' }, strings.batchCount(state.selection.size)),
          ),
          createElement('div', { className: 'dsh-cm__batch-body' },
            rows.length === 0
              ? createElement('div', { className: 'dsh-cm__empty' }, strings.batchEmpty)
              : rows.map((row) => createElement('label', { className: 'dsh-cm__batch-row', key: row.id },
                  createElement('input', {
                    type: 'checkbox',
                    checked: state.selection.has(row.id),
                    disabled: row.running || busy,
                    onChange: () => toggle(row.id),
                  }),
                  createElement('div', { className: 'dsh-cm__batch-row-main' },
                    createElement('div', { className: 'dsh-cm__batch-row-title' }, row.title),
                    createElement('div', { className: 'dsh-cm__batch-row-meta' }, row.cwd ?? strings.noCwd),
                  ),
                  row.running && createElement('span', { className: 'dsh-cm__batch-tag dsh-cm__batch-tag--running' }, strings.running),
                )),
          ),
          createElement('div', { className: 'dsh-cm__batch-foot' },
            createElement('label', { className: 'dsh-cm__batch-row dsh-cm__batch-selectall' },
              createElement('input', {
                type: 'checkbox',
                checked: allSelected,
                disabled: busy || selectable.length === 0,
                onChange: toggleAll,
              }),
              createElement('span', { className: 'dsh-cm__batch-row-title' }, strings.selectAll),
            ),
            createElement('button', {
              className: 'dsh-cm__btn',
              type: 'button',
              disabled: busy,
              onClick: () => setBatch({ open: false }),
            }, strings.cancel),
            createElement('button', {
              className: 'dsh-cm__btn dsh-cm__btn--danger',
              type: 'button',
              disabled: busy || state.selection.size === 0,
              onClick: deleteSelected,
            }, busy ? strings.deletingBatch : strings.deleteSelected(state.selection.size)),
          ),
        ),
      )
    }

    // ── apply ──────────────────────────────────────────────────────────────

    function apply(ctx) {
      uiWorkspaceSvc = ctx.uiWorkspace
      sessionsSvc = ctx.get('sessions')

      ctx.effect(() => {
        const style = document.createElement('style')
        style.id = 'dsh-conversation-manager-style'
        style.textContent = STYLE
        document.head.append(style)
        return () => style.remove()
      }, 'dsh-conversation-manager: styles')

      ctx.effect(
        () => ctx.locale.register(NS, { zh: { nav: '会话管理' }, en: { nav: 'Conversation Manager' } }),
        'dsh-conversation-manager: dictionaries',
      )
      const t = ctx.locale.bind(NS)

      // 设置页「会话管理」分栏。
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-conversation-manager',
        order: 60,
        label: () => t('nav'),
        locale: NS,
      }, SessionManagerPanel))

      // 对话顶部红色「删除本对话」（Session log 左侧）。
      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'dsh-conversation-manager-delete-current',
        order: -10,
      }, DeleteCurrentButton))

      // 侧栏会话行「...」菜单「删除会话」（官方 0.2.x 插槽，排在 shipped 行之后）。
      ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
        name: 'sidebar.workspaces.session.menu.item',
        id: 'dsh-conversation-manager-menu-delete',
        order: 500,
      }, MenuDeleteItem))

      // 侧栏底部「批量删除」按钮 + 勾选面板。
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'dsh-conversation-manager-batch-button',
        order: 10,
      }, FooterBatchButton))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'dsh-conversation-manager-batch',
        order: 90,
      }, BatchPanel))
    }

    return {
      inject: ['slots', 'locale', 'uiWorkspace'],
      apply,
    }
  },
})
