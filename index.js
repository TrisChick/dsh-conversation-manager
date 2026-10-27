/**
 * dsh-conversation-manager · host（DSH 0.2.x 持久插件格式）
 *
 * 路由：
 *   POST /dsh-conversation-manager/delete   删除对话（归档隐藏 + 记入回收站，可恢复）
 *   POST /dsh-conversation-manager/restore  恢复（回收站条目 / 已归档会话 → 取消归档）
 *   POST /dsh-conversation-manager/purge    彻底清除（删除会话磁盘目录，不可恢复）
 *   GET  /dsh-conversation-manager/trash    回收站列表
 *
 * 删除流程（软删除）：
 *   1. 正在运行的会话拒绝删除（agent.status === 'running'，archiveSession 也会拒绝）；
 *   2. 通过 workspaceRegistry.archiveSession 归档（所有客户端立即隐藏该行）；
 *   3. 记录条目（会话磁盘目录 + 标题 + 删除时间）到插件自己的 JSON 状态文件。
 * 彻底清除流程：删除 0.2.x 的会话目录 <DSH_HOME>/sessions/<slug>/<sessionId>/ 并移除条目。
 *
 * 本文件只用 Node 内置模块：插件源码在 dsh 安装解析链之外，
 * 不能 import @deepseek-ai/* 包，故 dshHome 与路径扫描在此自实现。
 */
import { readFile, readdir, rename, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-conversation-manager'
export const inject = ['webServer', 'workspaceRegistry', 'agents']

const ROUTE_PREFIX = '/dsh-conversation-manager'
const TRASH_LIMIT = 20
const MAX_BODY_BYTES = 64 * 1024
// 官方会话 id 形态：session-<uuid> / session-<n> / <uuid>（子代理）。
const SESSION_ID_RE = /^(session-)?[0-9a-fA-F-]+$/

function dshHomePath(...segments) {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), ...segments)
}

function stateFile() {
  return dshHomePath('storages', 'dsh_conversation_manager.json')
}

function isTrashEntry(entry) {
  return entry !== null && typeof entry === 'object'
    && typeof entry.sessionId === 'string'
    && typeof entry.deletedAt === 'number'
}

async function readEntries() {
  try {
    const raw = await readFile(stateFile(), 'utf8')
    const data = JSON.parse(raw)
    const entries = data !== null && typeof data === 'object' && Array.isArray(data.entries) ? data.entries : []
    return entries.filter(isTrashEntry)
  } catch {
    return []
  }
}

/** workspace 存储域的归档集合（只读）：archived session ids。 */
async function readArchivedIds() {
  try {
    const raw = await readFile(dshHomePath('storages', 'workspace.json'), 'utf8')
    const data = JSON.parse(raw)
    const ids = data !== null && typeof data === 'object' && data.global !== null && typeof data.global === 'object'
      ? data.global.archivedSessionIds
      : undefined
    return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

async function writeEntries(entries) {
  const file = stateFile()
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
}

/**
 * 0.2.x 的会话落盘布局是「每个会话一个目录」：
 *   <DSH_HOME>/sessions/<workspace-slug>/<sessionId>/
 * 目录里是 zstd 压缩的会话日志。这里扫描所有 workspace-slug 目录找到该会话的目录，
 * 不做 cwd → slug 的编码推导（避免依赖实现细节）。
 */
async function findSessionDirs(sessionId) {
  const root = dshHomePath('sessions')
  const found = []
  let slugs
  try {
    slugs = await readdir(root)
  } catch {
    return found
  }
  for (const slug of slugs) {
    const candidate = join(root, slug, sessionId)
    try {
      const info = await stat(candidate)
      if (info.isDirectory()) found.push(candidate)
    } catch {
      // 该 slug 下没有这个会话。
    }
  }
  return found
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > MAX_BODY_BYTES) {
        req.destroy()
        reject(new Error('request body too large'))
      }
    })
    req.on('end', () => {
      if (data.length === 0) return resolve({})
      try {
        resolve(JSON.parse(data))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function respond(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function parseSessionId(body) {
  const sessionId = body !== null && typeof body === 'object' ? body.sessionId : undefined
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return undefined
  return sessionId
}

/** 运行中的会话（agent 是活着的运行时对象，status 由 agent-loop 维护）。 */
function isRunning(ctx, sessionId) {
  const agent = ctx.agents.get(sessionId)
  return agent !== undefined && agent.status === 'running'
}

async function deleteSession(ctx, sessionId, title) {
  if (isRunning(ctx, sessionId)) return { ok: false, status: 409, error: 'session-live' }
  try {
    // 不带 stopActivity：运行中的会话由 Host 拒绝（workspace/session-active）。
    await ctx.workspaceRegistry.archiveSession(sessionId)
  } catch (error) {
    const code = error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : ''
    const message = error instanceof Error ? error.message : String(error)
    if (/session-active|running|active/i.test(`${code} ${message}`)) {
      return { ok: false, status: 409, error: 'session-live' }
    }
    ctx.logger?.warn?.('[dsh-conversation-manager] archive failed, aborting delete:', error)
    return { ok: false, status: 500, error: 'archive-failed' }
  }
  const dirs = await findSessionDirs(sessionId)
  const entries = (await readEntries()).filter((entry) => entry.sessionId !== sessionId)
  entries.push({
    sessionId,
    title: typeof title === 'string' && title !== '' ? title : undefined,
    dirs,
    deletedAt: Date.now(),
  })
  while (entries.length > TRASH_LIMIT) entries.shift()
  await writeEntries(entries)
  return { ok: true }
}

async function restoreSession(ctx, sessionId) {
  try {
    await ctx.workspaceRegistry.unarchiveSession(sessionId)
  } catch (error) {
    // 会话可能已不在归档集合里：恢复动作对它仍然是幂等的。
    ctx.logger?.debug?.('[dsh-conversation-manager] unarchive skipped:', error)
  }
  const entries = (await readEntries()).filter((entry) => entry.sessionId !== sessionId)
  await writeEntries(entries)
  return { ok: true }
}

async function purgeSession(ctx, sessionId) {
  const entries = await readEntries()
  const entry = entries.find((candidate) => candidate.sessionId === sessionId)
  if (entry === undefined) return { ok: false, status: 404, error: 'trash-entry-not-found' }
  const dirs = Array.isArray(entry.dirs) && entry.dirs.length > 0 ? entry.dirs : await findSessionDirs(sessionId)
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true }).catch((error) => {
      ctx.logger?.warn?.(`[dsh-conversation-manager] failed to remove ${dir}:`, error)
    })
  }
  await writeEntries(entries.filter((candidate) => candidate.sessionId !== sessionId))
  return { ok: true }
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/delete`,
    handler: async (req, res) => {
      if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'method-not-allowed' })
      let body
      try {
        body = await readJsonBody(req)
      } catch {
        return respond(res, 400, { ok: false, error: 'bad-request' })
      }
      const id = parseSessionId(body)
      if (id === undefined) return respond(res, 400, { ok: false, error: 'invalid-session-id' })
      const title = body !== null && typeof body === 'object' && typeof body.title === 'string' ? body.title : undefined
      try {
        const result = await deleteSession(ctx, id, title)
        if (!result.ok) return respond(res, result.status, { ok: false, error: result.error })
        respond(res, 200, { ok: true })
      } catch (error) {
        ctx.logger?.warn?.('[dsh-conversation-manager] delete failed:', error)
        respond(res, 500, { ok: false, error: 'delete-failed' })
      }
    },
  }), 'dsh-conversation-manager: route /delete')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/restore`,
    handler: async (req, res) => {
      if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'method-not-allowed' })
      let body
      try {
        body = await readJsonBody(req)
      } catch {
        return respond(res, 400, { ok: false, error: 'bad-request' })
      }
      const id = parseSessionId(body)
      if (id === undefined) return respond(res, 400, { ok: false, error: 'invalid-session-id' })
      try {
        await restoreSession(ctx, id)
        respond(res, 200, { ok: true })
      } catch (error) {
        ctx.logger?.warn?.('[dsh-conversation-manager] restore failed:', error)
        respond(res, 500, { ok: false, error: 'restore-failed' })
      }
    },
  }), 'dsh-conversation-manager: route /restore')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/purge`,
    handler: async (req, res) => {
      if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'method-not-allowed' })
      let body
      try {
        body = await readJsonBody(req)
      } catch {
        return respond(res, 400, { ok: false, error: 'bad-request' })
      }
      const id = parseSessionId(body)
      if (id === undefined) return respond(res, 400, { ok: false, error: 'invalid-session-id' })
      try {
        const result = await purgeSession(ctx, id)
        if (!result.ok) return respond(res, result.status, { ok: false, error: result.error })
        respond(res, 200, { ok: true })
      } catch (error) {
        ctx.logger?.warn?.('[dsh-conversation-manager] purge failed:', error)
        respond(res, 500, { ok: false, error: 'purge-failed' })
      }
    },
  }), 'dsh-conversation-manager: route /purge')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/trash`,
    handler: async (_req, res) => {
      try {
        const entries = await readEntries()
        respond(res, 200, { ok: true, entries, limit: TRASH_LIMIT })
      } catch (error) {
        ctx.logger?.warn?.('[dsh-conversation-manager] trash list failed:', error)
        respond(res, 500, { ok: false, error: 'trash-list-failed' })
      }
    },
  }), 'dsh-conversation-manager: route /trash')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/archived`,
    handler: async (_req, res) => {
      try {
        respond(res, 200, { ok: true, archivedSessionIds: await readArchivedIds() })
      } catch (error) {
        ctx.logger?.warn?.('[dsh-conversation-manager] archived list failed:', error)
        respond(res, 500, { ok: false, error: 'archived-list-failed' })
      }
    },
  }), 'dsh-conversation-manager: route /archived')
}
