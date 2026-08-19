/**
 * dsh-conversation-manager · host 端
 *
 * 自研会话管理插件，路由：
 *   POST /dsh-conversation-manager/delete   删除对话（移入回收站，可恢复）
 *   POST /dsh-conversation-manager/restore  恢复（回收站条目 / 已归档会话）
 *   POST /dsh-conversation-manager/purge    彻底清除回收站条目（不可恢复）
 *   GET  /dsh-conversation-manager/trash    回收站列表
 *
 * 删除流程（软删除）：
 *   1. 拒绝“正在运行”的会话；
 *   2. 走官方归档通道（所有客户端立即隐藏该行）；
 *   3. 非 live 会话的日志目录移入插件回收站目录；
 *   4. 条目（原路径 + 删除时间）持久化到插件存储域，超出上限自动彻底清除最早一条。
 *
 * 本文件只依赖 Node 内置模块：插件源码目录位于 profile 的 node_modules 解析链之外
 * （junction 链接会被 ESM 加载器真实化），因此不能 import @deepseek-ai/* 包；
 * dshHomePath 与存储域 spec（含最小 zod 兼容 schema）在此自实现。
 */
import { existsSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-conversation-manager'
export const inject = ['webServer', 'sessionPersistence', 'workspaceRegistry', 'agents', 'storageDomain']

const ROUTE_PREFIX = '/dsh-conversation-manager'
const MAX_BODY_BYTES = 64 * 1024
// 官方会话 id 的三种形态：session-<uuid>（web UI）、session-<n>（store 铸造）、<uuid>（子代理）。
// 限定字符集（十六进制 + 连字符 + 可选 session- 前缀），因为 id 会被拼进回收站路径。
const SESSION_ID_RE = /^(session-)?[0-9a-fA-F-]+$/
/** 回收站最多保留的条目数，超出后最早一条自动彻底删除。 */
export const TRASH_LIMIT = 20

/** dshHomePath 自实现：join(DSH_HOME 或 ~/.dsh, ...segments)。 */
function dshHomePath(...segments) {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), ...segments)
}

/** zod 兼容的最小 schema：存储域只在加载时调用 schema.parse()（defineDomain 的校验被跳过）。 */
function entryParse(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('entry must be an object')
  }
  const { sessionId, cwd, originalPath, deletedAt } = value
  if (typeof sessionId !== 'string' || sessionId === '') throw new Error('entry.sessionId must be a non-empty string')
  if (cwd !== undefined && typeof cwd !== 'string') throw new Error('entry.cwd must be a string')
  if (originalPath !== undefined && typeof originalPath !== 'string') throw new Error('entry.originalPath must be a string')
  if (typeof deletedAt !== 'number' || !Number.isFinite(deletedAt)) throw new Error('entry.deletedAt must be a number')
  return { sessionId, cwd, originalPath, deletedAt }
}

/** 插件自己的存储域：回收站条目。 */
const trashDomainSpec = {
  name: 'dsh_conversation_manager',
  version: 1,
  global: {
    schema: {
      parse(value) {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('global must be an object')
        }
        if (value.entries === undefined) return { entries: [] }
        if (!Array.isArray(value.entries)) throw new Error('global.entries must be an array')
        return { entries: value.entries.map((entry) => entryParse(entry)) }
      },
    },
    initial: { entries: [] },
  },
  tables: {},
}

function trashRoot() {
  return dshHomePath('dsh-conversation-manager-trash')
}

function trashSessionDir(sessionId) {
  return join(trashRoot(), sessionId)
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

/**
 * 官方没有公开的“取消归档”API；直接写 workspace 域会让 registry 的内存缓存失步，
 * 下一次 archiveSession 会按旧缓存幂等跳过。这里把域值与 registry 私有缓存一起更新，
 * 保证两者始终一致。（对 DSH 升级敏感，参考社区插件的成熟做法。）
 */
function syncRegistryState(ctx, next) {
  const registry = ctx.workspaceRegistry
  if (registry !== undefined && 'state' in registry) {
    registry.state = next
  }
}

/** 从 workspace 归档集合中移除一个会话 id（取消归档）。 */
async function unarchive(ctx, sessionId) {
  const workspace = ctx.storageDomain.get('workspace')
  if (workspace === undefined) return
  const state = workspace.global.get()
  if (!state.archivedSessionIds.includes(sessionId)) return
  const next = {
    ...state,
    archivedSessionIds: state.archivedSessionIds.filter((id) => id !== sessionId),
  }
  await workspace.global.set(next)
  syncRegistryState(ctx, next)
}

export function apply(ctx) {
  return ctx.storageDomain.open(trashDomainSpec).then((trash) => {
    const getEntries = () => trash.global.get().entries
    const setEntries = (entries) =>
      trash.global.set({ entries }).catch((error) => {
        ctx.logger.warn('[dsh-conversation-manager] 回收站持久化失败:', error)
        throw error
      })

    // POST /delete —— 软删除：归档 + 文件移入回收站 + 记录条目
    ctx.webServer.register({
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

        try {
          const headers = await ctx.sessionPersistence.list()
          const meta = headers.find((header) => header.id === id)
          const agent = ctx.agents.get(id)
          const live = agent !== undefined

          if (agent !== undefined && agent.status === 'running') {
            return respond(res, 409, { ok: false, error: 'session-live' })
          }

          // 先归档（官方通道，所有客户端立即隐藏该行）。归档失败则中止删除，
          // 避免“文件没了但会话还挂在列表里”的半删除状态。
          try {
            await ctx.workspaceRegistry.archiveSession(id)
          } catch (error) {
            ctx.logger.warn(`[dsh-conversation-manager] 归档失败，中止删除 ${id}:`, error)
            return respond(res, 500, { ok: false, error: 'archive-failed' })
          }
          // archiveSession 对缓存里已有的 id 会幂等跳过，可能与持久化域值不一致：
          // 校验域值并补齐，同时保持 registry 缓存同步。
          {
            const workspace = ctx.storageDomain.get('workspace')
            if (workspace !== undefined) {
              const current = workspace.global.get()
              if (!current.archivedSessionIds.includes(id)) {
                const next = { ...current, archivedSessionIds: [...current.archivedSessionIds, id] }
                await workspace.global.set(next)
                syncRegistryState(ctx, next)
              }
            }
          }

          // 只有非 live 会话才移动文件：live 会话还在原地写日志，移动目录会把历史
          // 切成两半；其文件在“彻底删除”时统一清理。
          let originalPath
          if (meta !== undefined) {
            const location = ctx.sessionPersistence.locate(meta)
            if (location === undefined) return respond(res, 500, { ok: false, error: 'no-artifact-location' })
            originalPath = dirname(location.path)
          }
          if (!live && originalPath !== undefined && existsSync(originalPath)) {
            await mkdir(trashRoot(), { recursive: true })
            await rm(trashSessionDir(id), { recursive: true, force: true })
            await rename(originalPath, trashSessionDir(id))
          }

          // 记录条目（幂等：同 id 刷新删除时间）；超出上限自动彻底清除最早一条。
          const entries = getEntries()
          const existingIndex = entries.findIndex((entry) => entry.sessionId === id)
          let next
          if (existingIndex >= 0) {
            next = entries.map((entry, index) =>
              index === existingIndex ? { ...entry, deletedAt: Date.now() } : entry)
          } else {
            next = [...entries, { sessionId: id, cwd: meta === undefined ? undefined : meta.cwd, originalPath, deletedAt: Date.now() }]
            if (next.length > TRASH_LIMIT) {
              const overflow = next.slice(0, next.length - TRASH_LIMIT)
              for (const entry of overflow) {
                await rm(trashSessionDir(entry.sessionId), { recursive: true, force: true }).catch(() => {})
              }
              next = next.slice(next.length - TRASH_LIMIT)
            }
          }
          await setEntries(next)

          respond(res, 200, { ok: true })
        } catch (error) {
          ctx.logger.warn('[dsh-conversation-manager] 删除失败:', error)
          respond(res, 500, { ok: false, error: 'delete-failed' })
        }
      },
    })

    // POST /restore —— 回收站恢复（文件移回 + 取消归档）或已归档会话直接取消归档
    ctx.webServer.register({
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
          const entries = getEntries()
          const entry = entries.find((candidate) => candidate.sessionId === id)

          // 没有回收站条目：这是“已归档会话”分组的恢复，只取消归档。
          if (entry === undefined) {
            const headers = await ctx.sessionPersistence.list()
            const meta = headers.find((header) => header.id === id)
            const agent = ctx.agents.get(id)
            if (meta === undefined && agent === undefined) {
              return respond(res, 404, { ok: false, error: 'trash-entry-not-found' })
            }
            await unarchive(ctx, id)
            return respond(res, 200, { ok: true })
          }

          const from = trashSessionDir(id)
          if (existsSync(from)) {
            if (entry.originalPath === undefined) {
              ctx.logger.warn(`[dsh-conversation-manager] 恢复 ${id}: 回收站里有文件但条目缺原路径`)
              return respond(res, 500, { ok: false, error: 'no-original-path' })
            }
            if (existsSync(entry.originalPath)) {
              // 原位置被重新创建（live 会话还在写）：保留新文件，丢弃回收站副本。
              await rm(from, { recursive: true, force: true })
            } else {
              await mkdir(dirname(entry.originalPath), { recursive: true })
              await rename(from, entry.originalPath)
            }
          }

          // 文件安全归位后才取消归档并删除条目。
          await unarchive(ctx, id)
          await setEntries(entries.filter((candidate) => candidate.sessionId !== id))
          respond(res, 200, { ok: true })
        } catch (error) {
          ctx.logger.warn('[dsh-conversation-manager] 恢复失败:', error)
          respond(res, 500, { ok: false, error: 'restore-failed' })
        }
      },
    })

    // POST /purge —— 彻底清除：删除回收站与原位置文件、移除条目（不可恢复）
    ctx.webServer.register({
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
          const entries = getEntries()
          const entry = entries.find((candidate) => candidate.sessionId === id)
          if (entry === undefined) return respond(res, 404, { ok: false, error: 'trash-entry-not-found' })

          await rm(trashSessionDir(id), { recursive: true, force: true })
          if (entry.originalPath !== undefined) {
            await rm(entry.originalPath, { recursive: true, force: true })
          }
          await setEntries(entries.filter((candidate) => candidate.sessionId !== id))
          respond(res, 200, { ok: true })
        } catch (error) {
          ctx.logger.warn('[dsh-conversation-manager] 彻底删除失败:', error)
          respond(res, 500, { ok: false, error: 'purge-failed' })
        }
      },
    })

    // GET /trash —— 回收站列表
    ctx.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/trash`,
      handler: async (_req, res) => {
        try {
          respond(res, 200, { ok: true, entries: getEntries(), limit: TRASH_LIMIT })
        } catch (error) {
          ctx.logger.warn('[dsh-conversation-manager] 回收站列表失败:', error)
          respond(res, 500, { ok: false, error: 'trash-list-failed' })
        }
      },
    })

    return () => trash.close()
  })
}
