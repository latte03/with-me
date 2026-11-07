import { api, apiBlob } from './api.ts'
import { notify } from './bus.ts'
import { del, get, getAll, metaGet, metaPut, put, rq, withTx } from './db.ts'
import { applyOp } from './projection.ts'
import type { BlobRec, Envelope, Message, MessageFields, OpInput, Projection, Role, RoleFields } from './types.ts'

export const MAX_ATTACHMENT = 20 * 1024 * 1024
const DEVICE_KEY = 'with-me.device'

export interface Device {
  id: string
  name: string
}

export function device(): Device {
  try {
    const raw = localStorage.getItem(DEVICE_KEY)
    if (raw) return JSON.parse(raw) as Device
  } catch {
    /* regenerate */
  }
  const d: Device = {
    id: crypto.randomUUID(),
    name: `${navigator.platform || 'Web'} 浏览器`,
  }
  localStorage.setItem(DEVICE_KEY, JSON.stringify(d))
  return d
}

export const nowIso = (): string => new Date().toISOString()

export async function localWrite(input: OpInput): Promise<Envelope> {
  const env = await withTx(['roles', 'messages', 'outbox', 'applied', 'meta'], async (tx) => {
    const seqRec = await rq<{ key: string; value: number } | undefined>(tx.objectStore('meta').get('seq'))
    const seq = (seqRec?.value ?? 0) + 1
    const e = {
      op_id: crypto.randomUUID(),
      device_id: device().id,
      seq,
      client_created_at: nowIso(),
      type: input.type,
      payload: input.payload,
    } as Envelope
    const id = (input.payload as { id: string }).id
    const isRole = input.type.startsWith('role.')
    const name = isRole ? 'roles' : 'messages'
    const existing = await rq(tx.objectStore(name).get(id))
    const p: Projection = { roles: {}, messages: {} }
    if (existing) (isRole ? p.roles : p.messages)[id] = existing as Role & Message
    applyOp(p, e)
    const ent = p.roles[id] ?? p.messages[id]
    if (ent) await rq(tx.objectStore(name).put(ent))
    await rq(tx.objectStore('outbox').put(e))
    await rq(tx.objectStore('applied').put({ op_id: e.op_id }))
    await rq(tx.objectStore('meta').put({ key: 'seq', value: seq }))
    return e
  })
  notify()
  return env
}

export function createRole(fields: { name: string; avatar: string; color: string }): Promise<Envelope> {
  const t = nowIso()
  return localWrite({
    type: 'role.create',
    payload: { id: crypto.randomUUID(), name: fields.name, avatar: fields.avatar, color: fields.color, pinned: false, hidden: false, created_at: t, updated_at: t },
  })
}

export function updateRole(id: string, fields: RoleFields): Promise<Envelope> {
  return localWrite({ type: 'role.update', payload: { id, updated_at: nowIso(), fields } })
}

export function deleteRole(id: string): Promise<Envelope> {
  return localWrite({ type: 'role.delete', payload: { id, updated_at: nowIso() } })
}

export function createMessage(roleId: string, opts: { type?: Message['type']; text?: string; attachmentRef?: string }): Promise<Envelope> {
  const t = nowIso()
  return localWrite({
    type: 'message.create',
    payload: {
      id: crypto.randomUUID(),
      role_id: roleId,
      type: opts.type ?? 'text',
      text: opts.text ?? '',
      attachment_ref: opts.attachmentRef ?? '',
      side: 'right',
      todo_done: false,
      created_at: t,
      updated_at: t,
    },
  })
}

export function updateMessage(id: string, fields: MessageFields): Promise<Envelope> {
  return localWrite({ type: 'message.update', payload: { id, updated_at: nowIso(), fields } })
}

export function deleteMessage(id: string): Promise<Envelope> {
  return localWrite({ type: 'message.delete', payload: { id, updated_at: nowIso() } })
}

export function setTodoDone(id: string, done: boolean): Promise<Envelope> {
  return localWrite({ type: 'todo.set_done', payload: { id, done, updated_at: nowIso() } })
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function stashBlob(file: File): Promise<string> {
  const hash = await sha256Hex(await file.arrayBuffer())
  const existing = await get<BlobRec>('blobs', hash)
  if (!existing) await put('blobs', { hash, blob: file, thumb: null, mime: file.type, size: file.size, pending: true } satisfies BlobRec)
  return hash
}

const urlCache = new Map<string, string>()

export async function blobUrl(hash: string, variant: 'thumb' | 'original' = 'thumb'): Promise<string> {
  const key = `${hash}:${variant}`
  const hit = urlCache.get(key)
  if (hit) return hit
  const rec = await get<BlobRec>('blobs', hash)
  let blob: Blob | null = null
  if (variant === 'original') blob = rec?.blob ?? null
  else blob = rec?.thumb ?? (rec?.pending ? rec.blob : null)
  if (!blob) {
    try {
      blob = await apiBlob(`/blobs/${hash}${variant === 'thumb' ? '?variant=thumb' : ''}`)
      const base: BlobRec = rec ?? { hash, blob: null, thumb: null, mime: blob.type, size: blob.size, pending: false }
      await put('blobs', variant === 'thumb' ? { ...base, thumb: blob } : { ...base, blob })
    } catch {
      return ''
    }
  }
  const url = URL.createObjectURL(blob)
  urlCache.set(key, url)
  return url
}

export async function pendingBlobHashes(): Promise<Set<string>> {
  const recs = await getAll<BlobRec>('blobs')
  return new Set(recs.filter((r) => r.pending).map((r) => r.hash))
}

export async function uploadPendingBlobs(): Promise<void> {
  const recs = (await getAll<BlobRec>('blobs')).filter((r) => r.pending && r.blob)
  for (const rec of recs) {
    const fd = new FormData()
    fd.append('file', new File([rec.blob as Blob], rec.hash, { type: rec.mime }))
    fd.append('hash', rec.hash)
    await api('/blobs', { method: 'POST', body: fd })
    await put('blobs', { ...rec, pending: false })
  }
}

export async function removeOutbox(opIds: string[]): Promise<void> {
  for (const id of opIds) await del('outbox', id)
}

export async function outboxCount(): Promise<number> {
  return (await getAll('outbox')).length
}

export { getAll, get, metaGet, metaPut, put }
export { openDB, closeDB, applyBatch, outboxOps, projection } from './db.ts'