import { applyOp } from './projection.ts'
import type { BlobRec, Envelope, Message, Projection, PulledOp, Role } from './types.ts'

export type StoreName = 'roles' | 'messages' | 'outbox' | 'blobs' | 'meta' | 'applied'

let db: IDBDatabase | null = null

export function rq<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
  })
}

export async function openDB(userId: string): Promise<void> {
  if (db) db.close()
  db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(`with-me-${userId}`, 1)
    req.onupgradeneeded = () => {
      const d = req.result
      d.createObjectStore('roles', { keyPath: 'id' })
      const msgs = d.createObjectStore('messages', { keyPath: 'id' })
      msgs.createIndex('role_id', 'role_id')
      msgs.createIndex('created_at', 'created_at')
      const outbox = d.createObjectStore('outbox', { keyPath: 'op_id' })
      outbox.createIndex('seq', 'seq')
      d.createObjectStore('blobs', { keyPath: 'hash' })
      d.createObjectStore('meta', { keyPath: 'key' })
      d.createObjectStore('applied', { keyPath: 'op_id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function closeDB(): void {
  db?.close()
  db = null
}

function store(name: StoreName, mode: IDBTransactionMode = 'readonly'): IDBObjectStore {
  if (!db) throw new Error('db not open')
  return db.transaction(name, mode).objectStore(name)
}

export function getAll<T>(name: StoreName): Promise<T[]> {
  return rq(store(name).getAll() as IDBRequest<T[]>)
}

export function get<T>(name: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return rq(store(name).get(key) as IDBRequest<T | undefined>)
}

export function put(name: StoreName, value: unknown): Promise<IDBValidKey> {
  return rq(store(name, 'readwrite').put(value))
}

export function del(name: StoreName, key: IDBValidKey): Promise<void> {
  return rq(store(name, 'readwrite').delete(key))
}

export async function withTx<T>(names: StoreName[], fn: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  if (!db) throw new Error('db not open')
  const tx = db.transaction(names, 'readwrite')
  const done = txDone(tx)
  const result = await fn(tx)
  await done
  return result
}

export async function metaGet<T>(key: string): Promise<T | undefined> {
  const rec = await get<{ key: string; value: T }>('meta', key)
  return rec?.value
}

export function metaPut(key: string, value: unknown): Promise<IDBValidKey> {
  return put('meta', { key, value })
}

export async function outboxOps(): Promise<Envelope[]> {
  if (!db) return []
  return rq(db.transaction('outbox').objectStore('outbox').index('seq').getAll() as IDBRequest<Envelope[]>)
}

export async function projection(): Promise<Projection> {
  const [roles, messages] = await Promise.all([getAll<Role>('roles'), getAll<Message>('messages')])
  return {
    roles: Object.fromEntries(roles.map((r) => [r.id, r])),
    messages: Object.fromEntries(messages.map((m) => [m.id, m])),
  }
}

export async function applyBatch(ops: PulledOp[], cursor: number): Promise<void> {
  await withTx(['roles', 'messages', 'applied', 'meta'], async (tx) => {
    for (const op of ops) {
      const seen = await rq(tx.objectStore('applied').get(op.op_id))
      if (seen) continue
      const isRole = op.type.startsWith('role.')
      const name: StoreName = isRole ? 'roles' : 'messages'
      const id = (op.payload as { id: string }).id
      const existing = await rq(tx.objectStore(name).get(id))
      const p: Projection = { roles: {}, messages: {} }
      if (existing) (isRole ? p.roles : p.messages)[id] = existing as Role & Message
      applyOp(p, op)
      const ent = p.roles[id] ?? p.messages[id]
      if (ent) await rq(tx.objectStore(name).put(ent))
      await rq(tx.objectStore('applied').put({ op_id: op.op_id }))
    }
    await rq(tx.objectStore('meta').put({ key: 'cursor', value: cursor }))
  })
}

export type { BlobRec }