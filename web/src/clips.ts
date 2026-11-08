import { ApiError, api } from './api.ts'
import { applyClipDownload, buildClipMeta, clipNeedsVideo, clipPendingIndices, clipSearchText } from './clip-core.ts'
import { createMessage, createRole, get, getAll, updateMessage, updateRole } from './store.ts'
import { kick } from './sync.ts'
import type { BuildClipOptions } from './clip-core.ts'
import type { ClipDownloadResponse, ClipMeta, ClipParseResponse, Message, ParsedClip, Role } from './types.ts'

export async function parseClip(url: string): Promise<ClipParseResponse> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 40000)
  try {
    return await api<ClipParseResponse>('/clips/parse', { method: 'POST', body: { url }, signal: ctrl.signal })
  } catch (err) {
    if (ctrl.signal.aborted) throw new ApiError(0, '解析超时，请稍后重试')
    throw err
  } finally {
    window.clearTimeout(timer)
  }
}

export function downloadClipMedia(parseId: string, imageIndices: number[], video: boolean): Promise<ClipDownloadResponse> {
  return api<ClipDownloadResponse>('/clips/download', {
    method: 'POST',
    body: { parse_id: parseId, image_indices: imageIndices, video },
  })
}

export async function ensureClipRole(): Promise<string> {
  const roles = (await getAll<Role>('roles')).filter((r) => !r.deleted)
  const byKind = roles.find((r) => r.kind === 'clips')
  if (byKind) return byKind.id
  const byName = roles.find((r) => r.name === '剪藏')
  if (byName) {
    if (!byName.kind) await updateRole(byName.id, { kind: 'clips' })
    return byName.id
  }
  const env = await createRole({
    name: '剪藏',
    avatar: '🔖',
    color: '#b9534b',
    pinned: true,
    kind: 'clips',
  })
  return (env.payload as { id: string }).id
}

export async function createClipMessage(parsed: ParsedClip, opts: BuildClipOptions): Promise<{ id: string; meta: ClipMeta }> {
  const roleId = await ensureClipRole()
  const meta = buildClipMeta(parsed, opts)
  const env = await createMessage(roleId, { type: 'clip', text: clipSearchText(meta), meta })
  kick()
  return { id: (env.payload as { id: string }).id, meta }
}

export async function updateClipMessage(messageId: string, parsed: ParsedClip, opts: BuildClipOptions): Promise<ClipMeta> {
  const meta = buildClipMeta(parsed, opts)
  await updateMessage(messageId, { text: clipSearchText(meta), meta })
  kick()
  return meta
}

export async function downloadAndApply(messageId: string, parseId: string, imageIndices: number[], video: boolean): Promise<ClipDownloadResponse> {
  const result = await downloadClipMedia(parseId, imageIndices, video)
  const fresh = await get<Message>('messages', messageId)
  if (!fresh?.meta) return result
  const updated = applyClipDownload(fresh.meta, result)
  await updateMessage(messageId, { meta: updated })
  kick()
  return result
}

export async function retryClipMedia(message: Message): Promise<void> {
  if (!message.meta) return
  const parsed = await parseClip(message.meta.source_url)
  const indices = clipPendingIndices(message.meta)
  const video = clipNeedsVideo(message.meta)
  if (indices.length === 0 && !video) return
  const result = await downloadClipMedia(parsed.parse_id, indices, video)
  const fresh = await get<Message>('messages', message.id)
  if (!fresh?.meta) return
  await updateMessage(message.id, { meta: applyClipDownload(fresh.meta, result) })
  kick()
}
