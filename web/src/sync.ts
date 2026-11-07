import { api, ApiError, getSession } from './api.ts'
import { onChange, notify } from './bus.ts'
import { applyBatch, metaGet, outboxOps } from './db.ts'
import { outboxCount, pendingBlobHashes, removeOutbox, uploadPendingBlobs } from './store.ts'
import type { PullResult, PushResult } from './types.ts'

export const syncState = {
  online: navigator.onLine,
  syncing: false,
  pending: 0,
  error: '',
  lastSync: 0,
}

type SyncListener = (s: typeof syncState) => void
const listeners = new Set<SyncListener>()

export function onSync(fn: SyncListener): () => void {
  listeners.add(fn)
  fn(syncState)
  return () => listeners.delete(fn)
}

function emit(): void {
  for (const fn of listeners) fn(syncState)
}

let kickTimer: number | undefined

export function kick(): void {
  window.clearTimeout(kickTimer)
  kickTimer = window.setTimeout(() => void syncNow(), 300)
}

export async function syncNow(): Promise<void> {
  if (!getSession()) return
  if (syncState.syncing || !navigator.onLine) {
    syncState.online = navigator.onLine
    emit()
    return
  }
  syncState.syncing = true
  syncState.online = true
  emit()
  try {
    try {
      await uploadPendingBlobs()
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) throw e
      syncState.error = `附件上传失败：${(e as Error).message}`
    }
    const blocked = await pendingBlobHashes()
    const queue = await outboxOps()
    const pushable = []
    for (const op of queue) {
      if (op.type === 'message.create' && op.payload.attachment_ref && blocked.has(op.payload.attachment_ref)) break
      pushable.push(op)
    }
    if (pushable.length > 0) {
      try {
        await api<PushResult>('/sync/push', { method: 'POST', body: { ops: pushable } })
        await removeOutbox(pushable.map((o) => o.op_id))
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) throw e
        if (e instanceof ApiError && e.status < 500) {
          await removeOutbox(pushable.map((o) => o.op_id))
          syncState.error = `同步被服务端拒绝：${e.message}`
        } else {
          syncState.error = `推送失败：${(e as Error).message}`
          return
        }
      }
    }
    let cursor = (await metaGet<number>('cursor')) ?? 0
    for (;;) {
      const r = await api<PullResult>(`/sync/pull?cursor=${cursor}&limit=500`)
      if (r.ops.length > 0) {
        cursor = r.ops[r.ops.length - 1].cursor
        await applyBatch(r.ops, cursor)
        notify()
      }
      if (!r.has_more || r.ops.length === 0) break
    }
    syncState.error = ''
    syncState.lastSync = Date.now()
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) syncState.error = `同步失败：${(e as Error).message}`
  } finally {
    try {
      syncState.pending = await outboxCount()
    } catch {
      syncState.pending = 0
    }
    syncState.syncing = false
    emit()
  }
}

let started = false

export function startSync(): void {
  if (started) return
  started = true
  window.setInterval(() => void syncNow(), 15000)
  window.addEventListener('online', () => {
    syncState.online = true
    emit()
    kick()
  })
  window.addEventListener('offline', () => {
    syncState.online = false
    emit()
  })
  window.addEventListener('focus', kick)
  onChange(kick)
  void syncNow()
}