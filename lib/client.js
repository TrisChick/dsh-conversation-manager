/**
 * dsh-conversation-manager · client 端（web）
 *
 * 以经典脚本形式注册进客户端模块系统（与官方 client-modules 的约定一致）：
 *   - 设置页「会话管理」分栏：会话列表（继续/删除）、已归档会话折叠区（恢复/删除，
 *     无归档会话时也常显并给出空态提示）、回收站折叠区（恢复/彻底删除）；
 *   - 对话顶部右侧红色「删除本对话」按钮（确认后移入回收站）；
 *   - 侧栏会话列表顶部「批量删除」按钮（DOM 注入 sectionHeader）→ 打开批量删除
 *     面板（shell.overlay，勾选后一次删除多个会话）；
 *   - 侧栏会话行「...」菜单注入「删除会话」项（DOM 注入，rc.6 无官方插槽）。
 *
 * 依赖：react（客户端模块系统 shell 自有模块）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-conversation-manager',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { createElement, useCallback, useEffect, useRef, useState, useSyncExternalStore } = React

    const name = 'dsh-conversation-manager/client'
    const inject = ['slots', 'locale', 'sessions']
    const NS = 'dsh-conversation-manager'

    const DELETE_ROUTE = '/dsh-conversation-manager/delete'
    const RESTORE_ROUTE = '/dsh-conversation-manager/restore'
    const PURGE_ROUTE = '/dsh-conversation-manager/purge'
    const TRASH_ROUTE = '/dsh-conversation-manager/trash'

    /** localStorage：本浏览器已彻底删除的会话 id（防止 live 会话删除后刷新“复活”）。 */
    const REMOVED_KEY = 'dsh-conversation-manager.removed'
    /** localStorage：删除时记住的标题，回收站条目在列表里消失后仍能显示名称。 */
    const TITLES_KEY = 'dsh-conversation-manager.titles'
    /** 回收站上限的客户端兜底值（以 host 返回为准）。 */
    const TRASH_FALLBACK_LIMIT = 20

    const STYLE_ID = 'dsh-conversation-manager-style'
    const STYLE = `
[data-dsh-cm] {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0 8px;
  color: var(--dsw-alias-label-primary, #111827);
}
.dsh-cm__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.dsh-cm__title {
  font-size: 13px;
  font-weight: 600;
}
.dsh-cm__count {
  color: var(--dsw-alias-label-tertiary, #9ca3af);
  font-size: 12px;
}
.dsh-cm__notice {
  border-radius: 8px;
  font-size: 12px;
  padding: 6px 10px;
  line-height: 1.5;
}
.dsh-cm__notice--ok { background: rgba(34, 197, 94, .12); }
.dsh-cm__notice--error { background: rgba(239, 68, 68, .12); }
.dsh-cm__empty {
  color: var(--dsw-alias-label-tertiary, #9ca3af);
  font-size: 12px;
  padding: 4px 0;
}
.dsh-cm__group {
  border-top: 1px solid var(--dsw-alias-line-border, rgba(127, 127, 127, .14));
  margin-top: 10px;
  padding-top: 8px;
}
.dsh-cm__group-toggle {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary, #6b7280);
  cursor: pointer;
  display: flex;
  font: inherit;
  font-size: 12px;
  gap: 8px;
  justify-content: space-between;
  padding: 6px 8px;
  width: 100%;
}
.dsh-cm__group-toggle:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, .08));
}
.dsh-cm__group-toggle-label { font-weight: 600; }
.dsh-cm__group-toggle-chevron { color: var(--dsw-alias-label-tertiary, #9ca3af); }
.dsh-cm__group-hint {
  color: var(--dsw-alias-label-tertiary, #9ca3af);
  font-size: 11px;
  line-height: 1.5;
  margin: 6px 8px 0;
}
.dsh-cm__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dsh-cm__row {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--dsw-alias-line-border, rgba(127, 127, 127, .18));
  border-radius: 10px;
  padding: 8px 10px;
}
.dsh-cm__row[data-archived] { opacity: .75; }
.dsh-cm__row[data-trash] { opacity: .85; }
.dsh-cm__row-main { flex: 1 1 auto; min-width: 0; }
.dsh-cm__row-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
  line-height: 1.4;
}
.dsh-cm__row-title-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-cm__row-meta {
  color: var(--dsw-alias-label-tertiary, #9ca3af);
  font-size: 11px;
  line-height: 1.4;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-cm__btn {
  flex: none;
  white-space: nowrap;
  font-size: 12px;
  line-height: 1;
  padding: 4px 8px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #6b7280);
  cursor: pointer;
}
.dsh-cm__btn:hover:not(:disabled) { border-color: #3964fe; color: #3964fe; }
.dsh-cm__btn:disabled { opacity: .5; cursor: default; }
.dsh-cm__btn--danger,
.dsh-cm__btn--danger:hover:not(:disabled) {
  border-color: #ef4444;
  color: #ef4444;
}
[data-dsh-cm-delete-current] {
  align-items: center;
  appearance: none;
  background: rgba(239, 68, 68, .1);
  border: 0;
  border-radius: 8px;
  color: rgb(220, 38, 38);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  gap: 4px;
  height: 28px;
  justify-content: center;
  padding: 0 10px;
  white-space: nowrap;
}
[data-dsh-cm-delete-current]:hover { background: rgba(239, 68, 68, .2); }
/* 侧栏会话列表顶部的「批量删除」按钮（DOM 注入 sectionHeader）。 */
[data-dsh-cm-batch] {
  align-items: center;
  appearance: none;
  background: transparent;
  border: 1px solid var(--dsw-alias-line-border, rgba(127, 127, 127, .28));
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary, #6b7280);
  cursor: pointer;
  display: inline-flex;
  flex: none;
  font: inherit;
  font-size: 12px;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  white-space: nowrap;
}
[data-dsh-cm-batch]:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, .1));
  color: var(--dsw-alias-label-primary, #111827);
}
/* 侧栏会话行「...」菜单里的「删除会话」项。 */
[data-dsh-cm-menudel] {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--dsw-alias-state-error-primary, #e5484d);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  border-radius: 6px;
  cursor: pointer;
}
[data-dsh-cm-menudel]:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, .14));
}
/* 批量删除面板（shell.overlay）。 */
.dsh-cm__batch-backdrop {
  background: rgba(0, 0, 0, .28);
  inset: 0;
  position: fixed;
  z-index: 1300;
}
.dsh-cm__batch-card {
  background: var(--dsw-alias-bg-base, #fff);
  border: 1px solid var(--dsw-alias-line-border, rgba(127, 127, 127, .18));
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, .22);
  display: flex;
  flex-direction: column;
  left: 50%;
  max-height: 72vh;
  max-width: calc(100vw - 40px);
  position: fixed;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 440px;
  z-index: 1301;
}
.dsh-cm__batch-head {
  align-items: baseline;
  border-bottom: 1px solid var(--dsw-alias-line-border, rgba(127, 127, 127, .14));
  display: flex;
  flex: none;
  gap: 8px;
  justify-content: space-between;
  padding: 12px 14px 10px;
}
.dsh-cm__batch-head-title { font-size: 14px; font-weight: 650; }
.dsh-cm__batch-head-count { color: var(--dsw-alias-label-tertiary, #9ca3af); font-size: 12px; }
.dsh-cm__batch-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 14px;
}
.dsh-cm__batch-row {
  align-items: center;
  border-radius: 8px;
  display: flex;
  gap: 8px;
  min-width: 0;
  padding: 6px 8px;
}
.dsh-cm__batch-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, .08)); }
.dsh-cm__batch-row input { accent-color: #3964fe; flex: none; }
.dsh-cm__batch-row-main { flex: 1 1 auto; min-width: 0; }
.dsh-cm__batch-row-title {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-cm__batch-row-meta {
  color: var(--dsw-alias-label-tertiary, #9ca3af);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-cm__batch-tag {
  color: var(--dsw-alias-label-tertiary, #9ca3af);
  flex: none;
  font-size: 11px;
}
.dsh-cm__batch-tag--running { color: #f5a524; }
.dsh-cm__batch-foot {
  border-top: 1px solid var(--dsw-alias-line-border, rgba(127, 127, 127, .14));
  display: flex;
  flex: none;
  gap: 8px;
  justify-content: flex-end;
  padding: 10px 14px 12px;
}
.dsh-cm__batch-foot .dsh-cm__batch-selectall { margin-right: auto; }
`

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

    function loadTitles() {
      try {
        const raw = window.localStorage.getItem(TITLES_KEY)
        if (raw !== null) {
          const parsed = JSON.parse(raw)
          if (typeof parsed === 'object' && parsed !== null) return parsed
        }
      } catch {
        // 存储不可用：退回空表。
      }
      return {}
    }

    function saveTitle(sessionId, title) {
      try {
        const next = { ...loadTitles(), [sessionId]: title }
        window.localStorage.setItem(TITLES_KEY, JSON.stringify(next))
      } catch {
        // 存储不可用：标题显示退化为会话 id。
      }
    }

    function isZh() {
      return typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('zh')
    }

    function stringsOf() {
      return isZh()
        ? {
            title: '会话管理',
            nav: '会话管理',
            count: (n) => `${n} 个会话`,
            activeGroup: '会话',
            continue: '继续',
            delete: '删除',
            deleting: '删除中…',
            confirm: '确定删除会话「{title}」吗？它会移入回收站，可在回收站中恢复或彻底删除。',
            deleted: '已删除会话「{title}」',
            deleteFailed: '删除会话「{title}」失败',
            liveError: '（会话正在运行，请先停止后再删）',
            restore: '恢复',
            restoreConfirm: '确定恢复会话「{title}」吗？它会回到会话列表。',
            restored: '已恢复会话「{title}」',
            restoreFailed: '恢复会话「{title}」失败',
            purge: '彻底删除',
            purgeConfirm: '确定彻底删除会话「{title}」吗？日志与记录将永久清除，无法恢复。',
            purged: '已彻底删除会话「{title}」',
            purgeFailed: '彻底删除会话「{title}」失败',
            archived: '已归档',
            archivedGroup: '已归档会话',
            archivedHint: '归档会话只被官方侧边栏隐藏，可在此恢复或移入回收站。',
            archivedEmpty: '当前没有已归档的会话。归档入口在侧边栏会话行「...」菜单中。',
            trashGroup: '回收站',
            trashHint: '保留最近 {limit} 条已删除会话，超出后最早一条会被自动彻底删除。',
            trashEmpty: '回收站为空。',
            trashLoadFailed: '回收站加载失败',
            expand: '展开',
            collapse: '收起',
            empty: '没有可管理的会话。',
            noCwd: '(未知工作目录)',
            current: '当前会话',
            running: '运行中',
            deleteCurrent: '删除本对话',
            deleteCurrentConfirm: '确定删除当前对话吗？它将移入回收站，可在「设置 → 会话管理 → 回收站」中恢复或彻底删除。',
            deleteCurrentDone: '当前对话已移入回收站。',
            deleteCurrentFailed: '删除当前对话失败',
            deleteCurrentRunning: '（对话正在运行，请稍后再试）',
            batchDelete: '批量删除',
            batchTitle: '批量删除会话',
            batchCount: (n) => `已选 ${n} 个`,
            selectAll: '全选',
            clearAll: '清空',
            cancel: '取消',
            deleteSelected: (n) => `删除所选 (${n})`,
            deletingBatch: '删除中…',
            batchConfirm: (n) => `确定删除选中的 ${n} 个会话吗？它们会移入回收站，可在「设置 → 会话管理 → 回收站」中恢复或彻底删除。运行中的会话会被跳过。`,
            batchDone: (ok, failed) => `已删除 ${ok} 个会话${failed > 0 ? `，${failed} 个失败（可能是运行中）` : ''}`,
            batchEmpty: '没有可删除的会话。',
            menuDelete: '删除会话',
            menuNotFound: '未能找到该会话（可能已被删除或列表尚未刷新），请刷新后重试。',
            deletedAt: (ms) => {
              const d = new Date(ms)
              const pad = (n) => String(n).padStart(2, '0')
              return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
            },
          }
        : {
            title: 'Conversation Manager',
            nav: 'Conversation Manager',
            count: (n) => `${n} sessions`,
            activeGroup: 'Sessions',
            continue: 'Continue',
            delete: 'Delete',
            deleting: 'Deleting…',
            confirm: 'Delete session "{title}"? It moves to the trash, where you can restore or permanently delete it.',
            deleted: 'Deleted session "{title}"',
            deleteFailed: 'Failed to delete session "{title}"',
            liveError: ' (the session is running; stop it before deleting)',
            restore: 'Restore',
            restoreConfirm: 'Restore session "{title}"? It will return to the session list.',
            restored: 'Restored session "{title}"',
            restoreFailed: 'Failed to restore session "{title}"',
            purge: 'Delete permanently',
            purgeConfirm: 'Permanently delete session "{title}"? Its logs and records cannot be recovered.',
            purged: 'Permanently deleted session "{title}"',
            purgeFailed: 'Failed to permanently delete session "{title}"',
            archived: 'archived',
            archivedGroup: 'Archived sessions',
            archivedHint: 'Archived sessions are only hidden from the official sidebar. Restore them here or move them to the trash.',
            archivedEmpty: 'No archived sessions right now. The archive entry lives in the sidebar session row "..." menu.',
            trashGroup: 'Trash',
            trashHint: 'Keeps the most recent {limit} deleted sessions; the oldest is purged automatically when the limit is exceeded.',
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
            batchDelete: 'Batch delete',
            batchTitle: 'Batch delete sessions',
            batchCount: (n) => `${n} selected`,
            selectAll: 'Select all',
            clearAll: 'Clear',
            cancel: 'Cancel',
            deleteSelected: (n) => `Delete selected (${n})`,
            deletingBatch: 'Deleting…',
            batchConfirm: (n) => `Delete the ${n} selected sessions? They move to the trash, where you can restore or permanently delete them from Settings → Conversation Manager → Trash. Running sessions are skipped.`,
            batchDone: (ok, failed) => `Deleted ${ok} sessions${failed > 0 ? `, ${failed} failed (possibly running)` : ''}`,
            batchEmpty: 'No sessions to delete.',
            menuDelete: 'Delete session',
            menuNotFound: 'Could not find this session (it may have been deleted or the list has not refreshed yet). Please refresh and try again.',
            deletedAt: (ms) => {
              const d = new Date(ms)
              const pad = (n) => String(n).padStart(2, '0')
              return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
            },
          }
    }

    // ── 模块级共享状态：sessions 服务 + 批量删除面板状态 ─────────────────────

    let sessionsSvc = null

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

    function normalizeTitle(t) {
      return String(t || '').trim().replace(/\s+/g, ' ')
    }
    function stripForkSuffix(t) {
      return normalizeTitle(t).replace(/\s*\(\d+\)\s*$/, '')
    }

    /** 按标题在客户端会话 store 里解析会话（侧栏 DOM 里没有会话 id）。 */
    function resolveSessionByTitle(want) {
      const svc = sessionsSvc
      if (!svc || !svc.list) return null
      try {
        const snap = svc.list.getSnapshot()
        const byId = (snap && snap.byId) || {}
        const ids = Object.keys(byId)
        const wantNorm = normalizeTitle(want)
        const wantBase = stripForkSuffix(wantNorm)
        for (const id of ids) {
          const s = byId[id]
          if (!s || s.blank) continue
          const t = normalizeTitle(s.displayTitle ?? s.title)
          if (t === wantNorm || (wantBase !== '' && stripForkSuffix(t) === wantBase)) {
            return { sessionId: id, title: s.displayTitle ?? s.title, running: s.running === true }
          }
        }
        for (const id of ids) {
          const s = byId[id]
          if (!s || s.blank) continue
          const t = normalizeTitle(s.displayTitle ?? s.title)
          if (t !== '' && (t.indexOf(wantNorm) >= 0 || wantNorm.indexOf(t) >= 0)) {
            return { sessionId: id, title: s.displayTitle ?? s.title, running: s.running === true }
          }
        }
      } catch {
        // store 不可用：返回 null。
      }
      return null
    }

    /** POST /delete；成功返回 null，失败返回错误码字符串。 */
    async function postDelete(sessionId) {
      try {
        const response = await fetch(DELETE_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || data.ok !== true) return data.error ?? `HTTP ${response.status}`
        return null
      } catch (error) {
        return error instanceof Error ? error.message : 'network-error'
      }
    }

    /** 删除后刷新客户端会话镜像（官方不会为冷会话广播移除帧）。 */
    async function refreshSessionList() {
      try {
        const done = typeof sessionsSvc?.refreshList === 'function'
          ? sessionsSvc.refreshList()
          : typeof sessionsSvc?.refresh === 'function' ? sessionsSvc.refresh() : undefined
        await Promise.resolve(done).catch(() => {})
      } catch {
        // 尽力而为；下一次列表刷新会自动重基线。
      }
    }

    /** 若被删除的是当前打开的会话，跳到第一个剩余会话。 */
    function openNextIfCurrentDeleted(deletedId) {
      try {
        if (!sessionsSvc || !sessionsSvc.list || typeof sessionsSvc.open !== 'function') return
        const snap = sessionsSvc.list.getSnapshot()
        if (snap && snap.current === deletedId) {
          const next = (snap.ids || []).find((id) => id !== deletedId)
          if (next) sessionsSvc.open(next)
        }
      } catch {
        // 尽力而为。
      }
    }

    // ── 设置页「会话管理」面板 ─────────────────────────────────────────────

    /**
     * 设置页「会话管理」面板。
     * 标准插槽 props：useSessions / useWorkspaces / close；注入 props：sessions。
     */
    function SessionManagerPanel({ useSessions, useWorkspaces, sessions, close }) {
      const list = useSessions((state) => state)
      const workspaces = useWorkspaces((state) => state)
      const strings = stringsOf()
      const [removed, setRemoved] = useState(() => loadRemoved())
      const [trash, setTrash] = useState(null)
      const [trashLimit, setTrashLimit] = useState(TRASH_FALLBACK_LIMIT)
      const [trashFailed, setTrashFailed] = useState(false)
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

      const loadTrash = useCallback(async () => {
        try {
          const response = await fetch(TRASH_ROUTE)
          const data = await response.json().catch(() => ({}))
          if (response.ok && data.ok) {
            setTrash(data.entries)
            setTrashLimit(data.limit)
            setTrashFailed(false)
          } else {
            setTrashFailed(true)
          }
        } catch {
          setTrashFailed(true)
        }
      }, [])
      useEffect(() => {
        void loadTrash()
      }, [loadTrash])

      const markRemoved = useCallback((sessionId) => {
        setRemoved((previous) => {
          const next = new Set(previous)
          next.add(sessionId)
          saveRemoved(next)
          return next
        })
      }, [])

      /** 调用 host 路由；成功返回 null，失败返回错误码。 */
      const postAction = useCallback(async (route, sessionId) => {
        const response = await fetch(route, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || data.ok !== true) return data.error ?? `HTTP ${response.status}`
        return null
      }, [])

      const refreshSessions = useCallback(() => {
        void Promise.resolve(sessions.refreshList?.() ?? sessions.refresh?.()).catch(() => {})
      }, [sessions])

      const handleDelete = useCallback(async (sessionId, title) => {
        if (!window.confirm(strings.confirm.replace('{title}', title))) return
        saveTitle(sessionId, title)
        setBusyId(sessionId)
        setNotice(null)
        const error = await postAction(DELETE_ROUTE, sessionId).catch((e) => e instanceof Error ? e.message : 'error')
        setBusyId(null)
        if (error !== null) {
          const friendly = error === 'session-live' ? strings.liveError : ''
          showNotice({ kind: 'error', text: strings.deleteFailed.replace('{title}', title) + friendly })
          return
        }
        await loadTrash()
        refreshSessions()
        showNotice({ kind: 'ok', text: strings.deleted.replace('{title}', title) })
      }, [strings, postAction, loadTrash, refreshSessions, showNotice])

      const handleRestore = useCallback(async (sessionId, title) => {
        if (!window.confirm(strings.restoreConfirm.replace('{title}', title))) return
        setBusyId(sessionId)
        setNotice(null)
        const error = await postAction(RESTORE_ROUTE, sessionId).catch((e) => e instanceof Error ? e.message : 'error')
        setBusyId(null)
        if (error !== null) {
          showNotice({ kind: 'error', text: strings.restoreFailed.replace('{title}', title) + ` (${error})` })
          return
        }
        await loadTrash()
        refreshSessions()
        showNotice({ kind: 'ok', text: strings.restored.replace('{title}', title) })
      }, [strings, postAction, loadTrash, refreshSessions, showNotice])

      const handlePurge = useCallback(async (sessionId, title) => {
        if (!window.confirm(strings.purgeConfirm.replace('{title}', title))) return
        setBusyId(sessionId)
        setNotice(null)
        const error = await postAction(PURGE_ROUTE, sessionId).catch((e) => e instanceof Error ? e.message : 'error')
        setBusyId(null)
        if (error !== null) {
          showNotice({ kind: 'error', text: strings.purgeFailed.replace('{title}', title) + ` (${error})` })
          return
        }
        markRemoved(sessionId)
        await loadTrash()
        refreshSessions()
        showNotice({ kind: 'ok', text: strings.purged.replace('{title}', title) })
      }, [strings, postAction, loadTrash, markRemoved, refreshSessions, showNotice])

      const handleContinue = useCallback((sessionId) => {
        sessions.open(sessionId)
        close()
      }, [sessions, close])

      const archivedSet = new Set(workspaces.archivedSessionIds ?? [])
      const trashIds = new Set((trash ?? []).map((entry) => entry.sessionId))
      // 空白会话（创建后从未发言）与官方侧边栏一致地隐藏。
      const summaries = list.ids
        .map((id) => list.byId[id])
        .filter((session) => session !== undefined && !removed.has(session.id) && !session.blank)
      const sortNewest = (rows) => [...rows].sort((a, b) => b.updatedAt - a.updatedAt)
      const activeRows = sortNewest(summaries.filter((session) => !archivedSet.has(session.id) && !trashIds.has(session.id)))
      const archivedRows = sortNewest(summaries.filter((session) => archivedSet.has(session.id) && !trashIds.has(session.id)))

      const renderRow = (session, isArchived) => {
        const isCurrent = !isArchived && session.id === list.current
        const isRunning = session.running
        const busy = busyId === session.id
        const metaParts = [session.cwd ?? strings.noCwd]
        if (isArchived) metaParts.push(strings.archived)
        if (isCurrent) metaParts.push(strings.current)
        if (isRunning) metaParts.push(strings.running)
        return createElement('li', {
          key: session.id,
          className: 'dsh-cm__row',
          'data-archived': isArchived || undefined,
        },
          createElement('div', { className: 'dsh-cm__row-main' },
            createElement('div', { className: 'dsh-cm__row-title', title: session.displayTitle },
              createElement('span', { className: 'dsh-cm__row-title-text' }, session.displayTitle),
            ),
            createElement('div', { className: 'dsh-cm__row-meta', title: metaParts.join(' · ') }, metaParts.join(' · ')),
          ),
          createElement('button', {
            className: 'dsh-cm__btn',
            type: 'button',
            disabled: isRunning || busy,
            title: isRunning ? strings.running : strings.continue,
            onClick: () => handleContinue(session.id),
          }, strings.continue),
          isArchived && createElement('button', {
            className: 'dsh-cm__btn',
            type: 'button',
            disabled: busy,
            onClick: () => void handleRestore(session.id, session.displayTitle),
          }, strings.restore),
          createElement('button', {
            className: 'dsh-cm__btn dsh-cm__btn--danger',
            type: 'button',
            disabled: isRunning || busy,
            title: isRunning ? strings.running : strings.delete,
            onClick: () => void handleDelete(session.id, session.displayTitle),
          }, busy ? strings.deleting : strings.delete),
        )
      }

      const renderTrashRow = (entry) => {
        const busy = busyId === entry.sessionId
        const liveTitle = list.byId[entry.sessionId]?.displayTitle
        const title = liveTitle ?? loadTitles()[entry.sessionId] ?? entry.sessionId
        const metaParts = [entry.cwd ?? strings.noCwd, strings.deletedAt(entry.deletedAt)]
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
              ...activeRows.map((session) => renderRow(session, false))),
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
                ...archivedRows.map((session) => renderRow(session, true)))),
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

    /** 对话顶部右侧的红色「删除本对话」按钮（conversation.session.header.utilities）。 */
    function DeleteCurrentButton({ sessionId }) {
      const strings = stringsOf()
      const handleClick = () => {
        if (!window.confirm(strings.deleteCurrentConfirm)) return
        void (async () => {
          const error = await postDelete(sessionId)
          if (error !== null) {
            const friendly = error === 'session-live' ? strings.deleteCurrentRunning : ''
            const suffix = friendly !== '' ? ` ${friendly}` : ` (${error})`
            window.alert(strings.deleteCurrentFailed + suffix)
            return
          }
          await refreshSessionList()
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

    // ── 批量删除面板（shell.overlay） ──────────────────────────────────────

    /** 批量删除面板：勾选会话后一次删除多个（运行中的禁用勾选，host 端也会拒绝）。 */
    function BatchDeletePanel() {
      const state = useBatchState()
      const strings = stringsOf()
      const snap = sessionsSvc && sessionsSvc.list
        ? useSyncExternalStore((cb) => sessionsSvc.list.subscribe(cb), () => sessionsSvc.list.getSnapshot())
        : null
      const [busy, setBusy] = useState(false)

      if (!state.open) return null

      const rows = snap && snap.ids
        ? snap.ids.map((id) => snap.byId[id]).filter((session) => session !== undefined && !session.blank)
        : []
      const selectable = rows.filter((session) => !session.running)
      const allSelected = selectable.length > 0 && selectable.every((session) => state.selection.has(session.id))

      const toggle = (sessionId) => {
        const next = new Set(state.selection)
        if (next.has(sessionId)) next.delete(sessionId)
        else next.add(sessionId)
        setBatch({ selection: next })
      }

      const toggleAll = () => {
        setBatch({ selection: allSelected ? new Set() : new Set(selectable.map((session) => session.id)) })
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
            const error = await postDelete(sessionId)
            if (error === null) ok += 1
            else failed += 1
          }
          await refreshSessionList()
          try {
            if (sessionsSvc && sessionsSvc.list) {
              const deletedIds = new Set(ids)
              const snapAfter = sessionsSvc.list.getSnapshot()
              if (snapAfter && deletedIds.has(snapAfter.current)) {
                const next = (snapAfter.ids || []).find((id) => !deletedIds.has(id))
                if (next) sessionsSvc.open(next)
              }
            }
          } catch {
            // 尽力而为。
          }
          setBusy(false)
          setBatch({ open: false, selection: new Set() })
          window.alert(strings.batchDone(ok, failed))
        })()
      }

      return createElement('div', { className: 'dsh-cm__batch-backdrop', onClick: () => setBatch({ open: false }) },
        createElement('div', {
          className: 'dsh-cm__batch-card',
          role: 'dialog',
          'aria-label': strings.batchTitle,
          onClick: (e) => e.stopPropagation(),
        },
          createElement('div', { className: 'dsh-cm__batch-head' },
            createElement('span', { className: 'dsh-cm__batch-head-title' }, strings.batchTitle),
            createElement('span', { className: 'dsh-cm__batch-head-count' }, strings.batchCount(state.selection.size)),
          ),
          createElement('div', { className: 'dsh-cm__batch-body' },
            rows.length === 0
              ? createElement('div', { className: 'dsh-cm__empty' }, strings.batchEmpty)
              : rows.map((session) => {
                  const metaParts = [session.cwd ?? strings.noCwd]
                  return createElement('label', { className: 'dsh-cm__batch-row', key: session.id },
                    createElement('input', {
                      type: 'checkbox',
                      checked: state.selection.has(session.id),
                      disabled: session.running || busy,
                      onChange: () => toggle(session.id),
                    }),
                    createElement('div', { className: 'dsh-cm__batch-row-main' },
                      createElement('div', { className: 'dsh-cm__batch-row-title' }, session.displayTitle),
                      createElement('div', { className: 'dsh-cm__batch-row-meta' }, metaParts.join(' · ')),
                    ),
                    session.running && createElement('span', { className: 'dsh-cm__batch-tag dsh-cm__batch-tag--running' }, strings.running),
                  )
                }),
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

    // ── 侧栏 DOM 注入：批量删除按钮 + 行菜单删除项 ──────────────────────────

    const TRASH_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex:none"><path d="M6.5 1.5h3l.5.5h2.5a.5.5 0 010 1H3.5a.5.5 0 010-1H6l.5-.5zM3 4.5h10l-.6 8.1a2 2 0 01-2 1.9H5.6a2 2 0 01-2-1.9L3 4.5zm2 1.5v6h1.5V6H5zm4.5 0v6H11V6H9.5z" fill="currentColor"/></svg>'

    /** 会话列表顶部的 sectionHeader（内含搜索框）——批量删除按钮的挂载点。 */
    function findSessionListHeader() {
      const headers = document.querySelectorAll('[class*=sectionHeader]')
      for (let i = 0; i < headers.length; i++) {
        if (headers[i].querySelector('[class*=searchInput]')) return headers[i]
      }
      return null
    }

    function ensureBatchButton() {
      const header = findSessionListHeader()
      if (!header) return
      if (header.querySelector('[data-dsh-cm-batch]')) return
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.setAttribute('data-dsh-cm-batch', '1')
      btn.title = stringsOf().batchTitle
      btn.innerHTML = TRASH_SVG + '<span></span>'
      btn.querySelector('span').textContent = stringsOf().batchDelete
      btn.addEventListener('click', () => setBatch({ open: true, selection: new Set() }))
      header.appendChild(btn)
    }

    /** 当前打开了「...」菜单的会话行。 */
    function findOpenSessionRow() {
      const rows = document.querySelectorAll('[class*=sessionRow]')
      for (let i = 0; i < rows.length; i++) {
        if (String(rows[i].className || '').indexOf('menuOpen') >= 0) return rows[i]
      }
      return null
    }

    function ensureMenuDeleteItem() {
      const menu = document.querySelector('[role=menu]')
      if (!menu || menu.querySelector('[data-dsh-cm-menudel]')) return
      const row = findOpenSessionRow()
      if (!row) return // 不是会话行菜单（可能是其它菜单）
      const titleEl = row.querySelector('[class*=title]')
      const title = titleEl ? normalizeTitle(titleEl.textContent) : ''
      if (!title) return
      const sep = document.createElement('div')
      sep.style.cssText = 'height:1px;margin:4px 8px;background:var(--dsw-alias-border-l1,rgba(128,128,128,.2))'
      const item = document.createElement('button')
      item.type = 'button'
      item.setAttribute('role', 'menuitem')
      item.setAttribute('data-dsh-cm-menudel', '1')
      item.innerHTML = TRASH_SVG + '<span></span>'
      item.querySelector('span').textContent = stringsOf().menuDelete
      item.addEventListener('click', () => {
        const target = resolveSessionByTitle(title)
        if (target === null) {
          window.alert(stringsOf().menuNotFound)
          return
        }
        if (!window.confirm(stringsOf().confirm.replace('{title}', target.title))) return
        saveTitle(target.sessionId, target.title)
        void (async () => {
          const error = await postDelete(target.sessionId)
          if (error !== null) {
            const friendly = error === 'session-live' ? stringsOf().liveError : ` (${error})`
            window.alert(stringsOf().deleteFailed.replace('{title}', target.title) + friendly)
            return
          }
          await refreshSessionList()
          openNextIfCurrentDeleted(target.sessionId)
        })()
      })
      menu.appendChild(sep)
      menu.appendChild(item)
    }

    let sidebarObserver = null
    function installSidebarInjections() {
      try {
        ensureBatchButton()
      } catch {
        // 注入失败不阻塞插件。
      }
      try {
        ensureMenuDeleteItem()
      } catch {
        // 注入失败不阻塞插件。
      }
      if (sidebarObserver !== null) return
      sidebarObserver = new MutationObserver(() => {
        try {
          ensureBatchButton()
        } catch {
          // 忽略。
        }
        try {
          ensureMenuDeleteItem()
        } catch {
          // 忽略。
        }
      })
      sidebarObserver.observe(document.body, { childList: true, subtree: true })
    }

    function uninstallSidebarInjections() {
      if (sidebarObserver !== null) {
        sidebarObserver.disconnect()
        sidebarObserver = null
      }
      document.querySelectorAll('[data-dsh-cm-batch], [data-dsh-cm-menudel]').forEach((el) => el.remove())
    }

    // ── apply ──────────────────────────────────────────────────────────────

    function apply(ctx) {
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = STYLE
      document.head.append(style)

      sessionsSvc = ctx.sessions

      ctx.effect(
        () => ctx.locale.register(NS, { zh: { nav: '会话管理' }, en: { nav: 'Conversation Manager' } }),
        'dsh-conversation-manager: dictionaries',
      )
      const t = ctx.locale.bind(NS)

      // 设置页独立分栏「会话管理」。
      ctx.slots.inject('settings.section', () => {
        const disposeRegistration = ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-conversation-manager',
          order: 60,
          label: () => t('nav'),
          locale: NS,
          inject: () => ({ sessions: sessionsSvc }),
        }, SessionManagerPanel)
        return () => {
          disposeRegistration()
          style.remove()
        }
      })

      // 对话顶部右侧工具行（Session log 左侧）：红色「删除本对话」按钮。
      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'dsh-conversation-manager-delete-current',
        order: -10,
        inject: () => ({}),
      }, DeleteCurrentButton))

      // 批量删除面板：帧级浮层（打开时显示，关闭时渲染 null）。
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'dsh-conversation-manager-batch',
        order: 90,
        inject: () => ({}),
      }, BatchDeletePanel))

      // 侧栏 DOM 注入（批量删除按钮 + 行菜单删除项），随插件生命周期清理。
      ctx.effect(() => {
        installSidebarInjections()
        return uninstallSidebarInjections
      }, 'dsh-conversation-manager: sidebar injections')

      // 语言切换时刷新已注入按钮的文案（行菜单项在每次打开菜单时重建，无需处理）。
      try {
        ctx.on('locale/change', () => {
          document.querySelectorAll('[data-dsh-cm-batch] span').forEach((span) => {
            span.textContent = stringsOf().batchDelete
          })
        })
      } catch {
        // locale 事件不可用时忽略；按钮文案在下次注入时自动更新。
      }
    }

    exports.name = name
    exports.inject = inject
    exports.apply = apply
    exports.NS = NS
    return module.exports
  },
})
