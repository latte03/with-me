import { api, apiBlob, getSession } from './api.ts'
import { notify } from './bus.ts'
import { del, get, getAll, metaGet, metaPut, put, rq, withTx } from './db.ts'
import { device } from './device.ts'
import { sha256Hex } from './hash.ts'
import { applyOp } from './projection.ts'
import { uuid } from './uuid.ts'
import type { BlobRec, Envelope, Message, MessageFields, OpInput, Projection, Role, RoleFields } from './types.ts'

export const MAX_ATTACHMENT = 20 * 1024 * 1024

export const nowIso = (): string => new Date().toISOString()

export async function localWrite(input: OpInput): Promise<Envelope> {
  const env = await withTx(['roles', 'messages', 'outbox', 'applied', 'meta'], async (tx) => {
    const seqRec = await rq<{ key: string; value: number } | undefined>(tx.objectStore('meta').get('seq'))
    const seq = (seqRec?.value ?? 0) + 1
    const e = {
      op_id: uuid(),
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

export function createRole(fields: { name: string; avatar: string; color: string; pinned?: boolean; kind?: string }): Promise<Envelope> {
  const t = nowIso()
  return localWrite({
    type: 'role.create',
    payload: {
      id: uuid(), name: fields.name, avatar: fields.avatar, color: fields.color,
      kind: fields.kind ?? '', pinned: fields.pinned ?? false, hidden: false, created_at: t, updated_at: t,
    },
  })
}

export function updateRole(id: string, fields: RoleFields): Promise<Envelope> {
  return localWrite({ type: 'role.update', payload: { id, updated_at: nowIso(), fields } })
}

export function deleteRole(id: string): Promise<Envelope> {
  return localWrite({ type: 'role.delete', payload: { id, updated_at: nowIso() } })
}

export function createMessage(roleId: string, opts: { type?: Message['type']; text?: string; attachmentRef?: string; width?: number; height?: number; meta?: Message['meta'] }): Promise<Envelope> {
  const t = nowIso()
  return localWrite({
    type: 'message.create',
    payload: {
      id: uuid(),
      role_id: roleId,
      type: opts.type ?? 'text',
      text: opts.text ?? '',
      attachment_ref: opts.attachmentRef ?? '',
      ...(opts.meta ? { meta: opts.meta } : {}),
      ...(opts.width ? { width: opts.width } : {}),
      ...(opts.height ? { height: opts.height } : {}),
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

export async function stashBlob(file: File): Promise<string> {
  const hash = await sha256Hex(await file.arrayBuffer())
  const existing = await get<BlobRec>('blobs', hash)
  if (!existing) await put('blobs', { hash, blob: file, thumb: null, mime: file.type, size: file.size, pending: true } satisfies BlobRec)
  return hash
}

export async function imageDimensions(file: File): Promise<{ width: number; height: number } | undefined> {
  try {
    const bmp = await createImageBitmap(file)
    const d = { width: bmp.width, height: bmp.height }
    bmp.close()
    return d
  } catch {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file)
      const im = new Image()
      im.onload = () => {
        URL.revokeObjectURL(url)
        resolve({ width: im.naturalWidth, height: im.naturalHeight })
      }
      im.onerror = () => {
        URL.revokeObjectURL(url)
        resolve(undefined)
      }
      im.src = url
    })
  }
}

const urlCache = new Map<string, string>()

// Direct stream URL for <video>: blob GET also accepts the session token as a
// query parameter because a media element cannot set Authorization headers.
export function blobStreamUrl(hash: string): string {
  const token = getSession()?.token ?? ''
  return `/api/blobs/${encodeURIComponent(hash)}?token=${encodeURIComponent(token)}`
}

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

export async function rebindOutbox(deviceID: string): Promise<void> {
  const stale = (await getAll<Envelope>('outbox')).filter((o) => o.device_id !== deviceID)
  if (stale.length === 0) return
  await withTx(['outbox'], async (tx) => {
    for (const o of stale) await rq(tx.objectStore('outbox').put({ ...o, device_id: deviceID }))
  })
}

export async function outboxCount(): Promise<number> {
  return (await getAll('outbox')).length
}

export { getAll, get, metaGet, metaPut, put }
export { openDB, closeDB, applyBatch, outboxOps, projection } from './db.ts'