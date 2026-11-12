import {
  clipHasPendingMedia,
  clipMediaCounts,
  clipStatsText,
  clipViewerItems,
  formatDuration,
  formatPublished,
  formatSize,
} from '../clip-core.ts'
import { retryClipMedia } from '../clips.ts'
import { blobUrl, deleteMessage } from '../store.ts'
import { kick } from '../sync.ts'
import type { ClipMedia, ClipMeta, Message } from '../types.ts'
import { confirmModal, el, esc, icon, openMenu, toast } from './dom.ts'
import { openVideoOverlay } from './media.ts'
import { openClipPreview } from './clip-preview.ts'
import { openViewer } from './viewer.ts'

export interface ClipCardContext {
  onOpenMedia?: () => void
}

export function renderClipCard(m: Message, _ctx: ClipCardContext = {}): HTMLElement {
  const meta = m.meta
  if (!meta) {
    const fallback = el(`<div class="msg-row right" data-id="${esc(m.id)}"><div class="bubble"><span class="msg-text">${esc(m.text)}</span></div></div>`)
    return fallback
  }
  const counts = clipMediaCounts(meta)
  const row = el(`<div class="msg-row right clip-row" data-id="${esc(m.id)}"><article class="clip-card"></article></div>`)
  const card = row.querySelector('.clip-card') as HTMLElement

  const head = el(`
    <header class="clip-head">
      <span class="clip-platform">小红书</span>
      <span class="clip-kind">${meta.note_type === 'video' ? '视频' : '图文'}</span>
      ${counts.live ? `<span class="clip-kind live">实况 ${counts.live}</span>` : ''}
      ${meta.content_declaration ? `<span class="clip-ai">含AI内容</span>` : ''}
      <span class="spacer"></span>
      <span class="clip-date">${esc(formatPublished(meta.published_at))}</span>
    </header>`)
  card.appendChild(head)

  card.appendChild(el(`<h3 class="clip-title">${esc(meta.title || '未命名笔记')}</h3>`))
  if (meta.body) {
    const p = el(`<p class="clip-body">${esc(meta.body)}</p>`)
    card.appendChild(p)
    if (meta.body.length > 120) {
      const more = el('<button class="clip-expand" type="button">展开全文</button>')
      more.addEventListener('click', () => {
        p.classList.toggle('open')
        more.textContent = p.classList.contains('open') ? '收起' : '展开全文'
      })
      card.appendChild(more)
    }
  }

  // 发布日期只在卡片右上（clip-date）出现一次，作者行不再重复
  const author = el(`
    <div class="clip-author-row">
      ${meta.author?.avatar_url ? `<img class="clip-avatar" src="${esc(meta.author.avatar_url)}" alt="" referrerpolicy="no-referrer">` : `<span class="clip-avatar initial">${esc((meta.author?.name || '?').slice(0, 1))}</span>`}
      <div class="clip-author-main">
        <strong>${esc(meta.author?.name || '未知作者')}</strong>
        ${meta.note_type === 'video' ? '<span>视频</span>' : ''}
      </div>
    </div>`)
  card.appendChild(author)

  const stats = clipStatsText(meta.stats)
  if (stats) card.appendChild(el(`<div class="clip-stats">${esc(stats)}</div>`))

  if (meta.tags.length) {
    const tags = el('<div class="clip-tags"></div>')
    for (const tag of meta.tags.slice(0, 6)) tags.appendChild(el(`<span class="clip-tag">${esc(tag)}</span>`))
    if (meta.tags.length > 6) tags.appendChild(el(`<span class="clip-tag dim">+${meta.tags.length - 6}</span>`))
    card.appendChild(tags)
  }

  const images = meta.media.filter((x) => x.kind === 'image')
  const video = meta.media.find((x) => x.kind === 'video')
  if (images.length || video) {
    const media = el('<div class="clip-media"></div>')
    if (images.length) {
      const grid = el('<div class="clip-grid-view"></div>')
      if (images.length === 1) grid.classList.add('single')
      images.slice(0, 9).forEach((img) => grid.appendChild(renderThumb(img, meta)))
      if (images.length > 9) grid.appendChild(el(`<div class="clip-thumb more">+${images.length - 9}</div>`))
      media.appendChild(grid)
    }
    if (video) media.appendChild(renderVideoThumb(video))
    card.appendChild(media)
  }

  if (clipHasPendingMedia(meta)) {
    const retry = el(`<button class="clip-retry" type="button">${icon('sync', 14)} 有媒体未下载，点此重试</button>`)
    retry.addEventListener('click', () => {
      const btn = retry as HTMLButtonElement
      btn.disabled = true
      btn.textContent = '重试中…'
      void retryClipMedia(m)
        .then(() => toast('媒体已更新'))
        .catch(() => toast('重试失败，链接可能已失效，请重新复制分享链接'))
        .finally(() => {
          btn.disabled = false
          btn.innerHTML = `${icon('sync', 14)} 有媒体未下载，点此重试`
        })
    })
    card.appendChild(retry)
  }

  const actions = el(`
    <div class="clip-actions">
      <button type="button" data-act="open">${icon('link', 16)}<span>原文</span></button>
      <button type="button" data-act="copy">${icon('copy', 16)}<span>复制文案</span></button>
      <button type="button" data-act="more" class="clip-more">${icon('dots', 18)}</button>
    </div>`)
  actions.querySelector('[data-act="open"]')?.addEventListener('click', () => {
    if (!meta.source_url) return
    window.open(meta.source_url, '_blank', 'noopener')
  })
  actions.querySelector('[data-act="copy"]')?.addEventListener('click', () => {
    void copyText([meta.title, meta.body].filter(Boolean).join('\n\n'))
  })
  actions.querySelector('[data-act="more"]')?.addEventListener('click', (e) => {
    openMenu(
      [
        {
          label: '重新解析',
          icon: 'sync',
          onTap: () => openClipPreview({ url: meta.source_url, existingMessageId: m.id, onSaved: () => toast('剪藏已更新') }),
        },
        { label: '删除', icon: 'trash', danger: true, onTap: () => void removeClip(m) },
      ],
      e.currentTarget as HTMLElement,
    )
  })
  card.appendChild(actions)
  return row
}

function renderThumb(img: ClipMedia, meta: ClipMeta): HTMLElement {
  if (img.hash) {
    const btn = el(`
      <button type="button" class="clip-thumb" aria-label="查看图片">
        <img alt="" loading="lazy">
        ${img.live ? '<span class="clip-live-badge">实况</span>' : ''}
      </button>`)
    const elImg = btn.querySelector('img') as HTMLImageElement
    void blobUrl(img.hash, 'thumb').then((url) => {
      if (url) elImg.src = url
      else elImg.classList.add('broken')
    })
    btn.addEventListener('click', () => {
      const items = clipViewerItems(meta)
      const idx = items.findIndex((x) => x.hash === img.hash)
      if (idx >= 0) openViewer(items, idx)
    })
    return btn
  }
  const state = img.status === 'failed' ? '下载失败' : '待下载'
  return el(`<div class="clip-thumb state"><span>${state}</span></div>`)
}

function renderVideoThumb(v: ClipMedia): HTMLElement {
  if (v.hash) {
    const btn = el(`
      <button type="button" class="clip-video-thumb" aria-label="播放视频">
        <img alt="" loading="lazy">
        <span class="clip-play">${icon('play', 22)}</span>
        <span class="clip-video-duration">${esc(formatDuration(v.duration_ms ?? 0))}</span>
      </button>`)
    const img = btn.querySelector('img') as HTMLImageElement
    if (v.cover_hash) {
      void blobUrl(v.cover_hash, 'thumb').then((url) => {
        if (url) img.src = url
        else img.classList.add('broken')
      })
    } else {
      img.hidden = true
    }
    btn.addEventListener('click', () => openVideoOverlay(v.hash as string, { posterHash: v.cover_hash, title: '视频' }))
    return btn
  }
  const label = v.status === 'failed' ? '视频下载失败' : '视频待下载'
  return el(`<div class="clip-video-thumb state"><span>${label}</span>${v.size ? `<small>${esc(formatSize(v.size))}</small>` : ''}</div>`)
}

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      toast('文案已复制')
      return
    }
    throw new Error('clipboard unavailable')
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
      toast('文案已复制')
    } catch {
      toast('复制失败，请手动选择')
    }
  }
}

async function removeClip(m: Message): Promise<void> {
  if (!(await confirmModal('删除这条剪藏？', '删除'))) return
  await deleteMessage(m.id)
  kick()
  toast('已删除')
}
