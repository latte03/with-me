import type { ClipDownloadResponse, ClipImage, ClipMedia, ClipMeta, ClipStats, ClipVideo, ParsedClip } from './types.ts'

export interface FoundXHSLink {
  url: string
  count: number
}

const XHS_URL_RE = /https?:\/\/(?:[a-z0-9-]+\.)?(?:xhslink\.cn|xhslink\.com|xiaohongshu\.com)\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*/gi

function trimLink(raw: string): string {
  let s = raw.trim()
  while (s && /[.,;:!?，。！？、；：）)\]】》”"']$/.test(s)) s = s.slice(0, -1)
  return s
}

export function extractXHSLink(text: string): FoundXHSLink | null {
  const found: string[] = []
  for (const m of text.matchAll(XHS_URL_RE)) {
    const url = trimLink(m[0])
    if (!url) continue
    try {
      const u = new URL(url)
      if (!/(^|\.)xhslink\.(cn|com)$|(^|\.)xiaohongshu\.com$/i.test(u.hostname)) continue
      if (!found.includes(url)) found.push(url)
    } catch {
      /* ignore malformed */
    }
  }
  if (found.length === 0) return null
  return { url: found[0], count: found.length }
}

export function clipSearchText(meta: ClipMeta): string {
  return [
    meta.title,
    meta.body,
    meta.author?.name ? `作者：${meta.author.name}` : '',
    meta.tags?.length ? `话题：${meta.tags.join(' ')}` : '',
    meta.source_url,
  ]
    .filter((s) => s && s.trim())
    .join('\n')
}

export interface BuildClipOptions {
  title: string
  body: string
  imageIndices: number[]
  video: boolean
}

export function buildClipMeta(parsed: ParsedClip, opts: BuildClipOptions): ClipMeta {
  const picked = new Set(opts.imageIndices)
  const media: ClipMedia[] = []
  const images = parsed.images ?? []
  images.forEach((img, index) => {
    if (!picked.has(index)) return
    media.push(imageMedia(img, index, parsed.note_type))
  })
  if (opts.video && parsed.video) media.push(videoMedia(parsed.video))
  return {
    platform: parsed.platform,
    note_id: parsed.note_id,
    source_url: parsed.source_url,
    note_type: parsed.note_type,
    title: opts.title.trim() || parsed.title,
    body: opts.body,
    author: parsed.author,
    published_at: parsed.published_at,
    note_updated_at: parsed.note_updated_at,
    stats: parsed.stats,
    tags: parsed.tags ?? [],
    content_declaration: parsed.content_declaration,
    chapters: parsed.chapters,
    media,
  }
}

function imageMedia(img: ClipImage, index: number, noteType: string): ClipMedia {
  return {
    kind: 'image',
    file_id: img.file_id,
    width: img.width,
    height: img.height,
    source_index: index,
    live: img.live,
    live_size: img.live_size,
    watermarked: img.watermarked,
    status: 'pending',
    ...(img.live ? { live_status: 'pending' as const } : {}),
    ...(noteType === 'video' ? { cover_file_id: img.file_id } : {}),
  }
}

function videoMedia(video: ClipVideo): ClipMedia {
  return {
    kind: 'video',
    file_id: video.file_id,
    width: video.width,
    height: video.height,
    duration_ms: video.duration_ms,
    size: video.size,
    cover_file_id: video.cover_file_id,
    cover_width: video.cover_width,
    cover_height: video.cover_height,
    watermarked: video.watermarked,
    status: 'pending',
  }
}

export function applyClipDownload(meta: ClipMeta, result: ClipDownloadResponse): ClipMeta {
  const media = meta.media.map((m) => ({ ...m }))
  for (const img of result.images) {
    const target = media.find((m) => m.kind === 'image' && m.source_index === img.index)
    if (!target) continue
    target.status = img.status
    target.hash = img.hash
    target.error = img.error
    if (img.live_status) target.live_status = img.live_status
    if (img.live_hash) target.live_hash = img.live_hash
  }
  if (result.video) {
    const target = media.find((m) => m.kind === 'video')
    if (target) {
      target.status = result.video.status
      target.hash = result.video.hash
      target.cover_hash = result.video.cover_hash
      target.error = result.video.error
    }
  }
  return { ...meta, media }
}

export function clipViewerItems(meta: ClipMeta): { hash: string; liveHash?: string }[] {
  return meta.media
    .filter((m) => m.kind === 'image' && m.hash)
    .map((m) => ({ hash: m.hash as string, liveHash: m.live_hash }))
}

export function clipPendingIndices(meta: ClipMeta): number[] {
  return meta.media
    .filter(
      (m) =>
        m.kind === 'image' &&
        (m.status === 'pending' ||
          m.status === 'failed' ||
          m.live_status === 'pending' ||
          m.live_status === 'failed') &&
        m.source_index !== undefined,
    )
    .map((m) => m.source_index as number)
}

export function clipHasPendingMedia(meta: ClipMeta): boolean {
  return meta.media.some(
    (m) =>
      m.status === 'pending' ||
      m.status === 'failed' ||
      m.live_status === 'pending' ||
      m.live_status === 'failed',
  )
}

export function clipNeedsVideo(meta: ClipMeta): boolean {
  return meta.media.some((m) => m.kind === 'video' && (m.status === 'pending' || m.status === 'failed'))
}

export function clipMediaCounts(meta: ClipMeta): { images: number; videos: number; live: number } {
  return {
    images: meta.media.filter((m) => m.kind === 'image').length,
    videos: meta.media.filter((m) => m.kind === 'video').length,
    live: meta.media.filter((m) => m.kind === 'image' && m.live).length,
  }
}

export function clipStatsText(stats: ClipStats): string {
  const parts: string[] = []
  if (stats.likes) parts.push(`赞 ${stats.likes}`)
  if (stats.collects) parts.push(`藏 ${stats.collects}`)
  if (stats.comments) parts.push(`评 ${stats.comments}`)
  if (stats.shares) parts.push(`转 ${stats.shares}`)
  return parts.join(' · ')
}

export function clipPreviewLabel(meta: ClipMeta): string {
  const kind = meta.note_type === 'video' ? '视频' : '图文'
  return `[剪藏·${kind}] ${meta.title || meta.note_id}`
}

export function formatPublished(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return ''
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`
}

export function formatSize(n: number): string {
  if (!n) return ''
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${n} B`
}
