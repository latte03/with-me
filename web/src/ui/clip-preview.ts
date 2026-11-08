import { ApiError } from '../api.ts'
import { clipStatsText, formatDuration, formatPublished, formatSize } from '../clip-core.ts'
import { createClipMessage, downloadAndApply, parseClip, updateClipMessage } from '../clips.ts'
import { get } from '../store.ts'
import type { ClipImage, ClipMeta, Message, ParsedClip } from '../types.ts'
import { el, esc, icon, openModal, toast } from './dom.ts'

export interface ClipPreviewOptions {
  url: string
  existingMessageId?: string
  onCancel?: () => void
  onSaved?: (messageId: string, meta: ClipMeta) => void
}

export function openClipPreview(opts: ClipPreviewOptions): void {
  const body = el('<div><p class="clip-loading">正在解析小红书链接…</p></div>')
  const foot = el(`
    <div class="btn-row">
      <button type="button" class="btn ghost cancel">取消</button>
      <button type="button" class="btn primary confirm" disabled>确认剪藏</button>
    </div>`)
  const cancelBtn = foot.querySelector('.cancel') as HTMLButtonElement
  const confirmBtn = foot.querySelector('.confirm') as HTMLButtonElement
  let saved = false
  const modal = openModal('链接剪藏', body, foot, () => {
    if (!saved) opts.onCancel?.()
  })
  modal.root.classList.add('clip-modal')
  cancelBtn.addEventListener('click', () => modal.close())

  void (async () => {
    let parsed: Awaited<ReturnType<typeof parseClip>>
    try {
      parsed = await parseClip(opts.url)
    } catch (err) {
      toast(err instanceof ApiError ? err.message : '解析失败，请稍后重试')
      modal.close()
      return
    }
    const clip = parsed.clip
    const existingId = opts.existingMessageId || parsed.existing_message_id || ''
    const existing = existingId ? await get<Message>('messages', existingId) : undefined
    if (existingId && !existing) {
      toast('原剪藏记录不在本机，请先同步后再试')
      modal.close()
      return
    }
    body.replaceChildren(renderPreview(clip, existing, !!opts.existingMessageId))
    confirmBtn.disabled = false
    confirmBtn.textContent = existingId ? '更新已有' : '确认剪藏'
    const update = () => updateConfirmState(body, confirmBtn)
    body.addEventListener('change', update)
    update()

    confirmBtn.addEventListener('click', () => {
      const titleEl = body.querySelector('.clip-title') as HTMLInputElement
      const bodyEl = body.querySelector('.clip-body') as HTMLTextAreaElement
      const title = titleEl.value.trim()
      if (!title) {
        toast('标题不能为空')
        titleEl.focus()
        return
      }
      const imageIndices: number[] = []
      body.querySelectorAll<HTMLInputElement>('.clip-pick input[data-index]').forEach((input) => {
        if (input.checked) imageIndices.push(Number(input.dataset.index))
      })
      const videoInput = body.querySelector<HTMLInputElement>('.clip-video-pick input')
      const video = !!videoInput?.checked
      if (imageIndices.length === 0 && !video) {
        toast('至少选择一张图片或视频')
        return
      }
      confirmBtn.disabled = true
      confirmBtn.textContent = '保存中…'
      void (async () => {
        try {
          const payload = { title, body: bodyEl.value, imageIndices, video }
          let messageId = existingId
          if (existingId) {
            const meta = await updateClipMessage(existingId, clip, payload)
            saved = true
            modal.close()
            opts.onSaved?.(existingId, meta)
          } else {
            const created = await createClipMessage(clip, payload)
            messageId = created.id
            saved = true
            modal.close()
            opts.onSaved?.(created.id, created.meta)
          }
          toast(existingId ? '已更新剪藏，媒体下载中…' : '已剪藏到「剪藏」，媒体下载中…')
          try {
            const result = await downloadAndApply(messageId, parsed.parse_id, imageIndices, video)
            const failed =
              result.images.filter((x) => x.status !== 'ok').length +
              (result.video && result.video.status !== 'ok' ? 1 : 0)
            toast(failed > 0 ? '部分媒体未下载，可在剪藏卡片上重试' : existingId ? '剪藏已更新' : '剪藏完成')
          } catch {
            toast('媒体未下载，可在剪藏卡片上重试')
          }
        } catch (err) {
          confirmBtn.disabled = false
          confirmBtn.textContent = existingId ? '更新已有' : '确认剪藏'
          toast(err instanceof ApiError ? err.message : '保存失败，请稍后重试')
        }
      })()
    })
  })()
}

function renderPreview(clip: ParsedClip, existing: Message | undefined, reparse: boolean): HTMLElement {
  const root = el('<div class="clip-preview"></div>')
  const existingMeta = existing?.meta
  const title = existingMeta?.title ?? clip.title
  const body = existingMeta?.body ?? clip.body
  const images = clip.images ?? []
  const tags = clip.tags ?? []
  const existingImages = new Set(
    (existingMeta?.media ?? []).filter((m) => m.kind === 'image').map((m) => m.file_id),
  )
  const existingVideo = (existingMeta?.media ?? []).some((m) => m.kind === 'video')
  const pickAll = !existingMeta

  if (existing) {
    const notice = el(
      `<p class="clip-notice">${reparse ? '重新解析会保留当前标题与正文，只更新元数据与媒体。' : '这条笔记已剪藏过，确认后将更新已有条目。'}</p>`,
    )
    root.appendChild(notice)
  }

  const author = el(`
    <div class="clip-author-row">
      ${clip.author.avatar_url ? `<img class="clip-avatar" src="${esc(clip.author.avatar_url)}" alt="" referrerpolicy="no-referrer">` : `<span class="clip-avatar initial">${esc((clip.author.name || '?').slice(0, 1))}</span>`}
      <div class="clip-author-main">
        <strong>${esc(clip.author.name || '未知作者')}</strong>
        <span>${esc(formatPublished(clip.published_at))}${clip.note_type === 'video' ? ' · 视频' : ' · 图文'}</span>
      </div>
      <span class="clip-stats">${esc(clipStatsText(clip.stats))}</span>
    </div>`)
  root.appendChild(author)

  const titleRow = el(`<label class="clip-field"><span>标题</span><input class="clip-title" maxlength="200"></label>`)
  ;(titleRow.querySelector('input') as HTMLInputElement).value = title
  root.appendChild(titleRow)
  const bodyRow = el(`<label class="clip-field"><span>正文</span><textarea class="clip-body" rows="5"></textarea></label>`)
  ;(bodyRow.querySelector('textarea') as HTMLTextAreaElement).value = body
  root.appendChild(bodyRow)

  if (tags.length) {
    const tagsEl = el('<div class="clip-tags"></div>')
    for (const tag of tags.slice(0, 12)) tagsEl.appendChild(el(`<span class="clip-tag">${esc(tag)}</span>`))
    root.appendChild(tagsEl)
  }
  if (clip.content_declaration) {
    root.appendChild(el(`<p class="clip-declare">${esc(clip.content_declaration)}</p>`))
  }

  if (images.length) {
    const head = el(`<div class="clip-pick-head"><span>图片</span><span class="dim">共 ${images.length} 张，可取消勾选</span></div>`)
    root.appendChild(head)
    const grid = el('<div class="clip-grid"></div>')
    images.forEach((img, index) => {
      const checked = pickAll || existingImages.has(img.file_id)
      grid.appendChild(renderPick(img, index, checked))
    })
    root.appendChild(grid)
  }

  if (clip.video) {
    const v = clip.video
    const checked = pickAll || existingVideo
    const card = el(`
      <label class="clip-video-pick">
        <input type="checkbox" ${checked ? 'checked' : ''}>
        <span class="clip-video-cover">
          ${v.preview_url ? `<img src="${esc(v.preview_url)}" alt="" referrerpolicy="no-referrer">` : ''}
          <span class="clip-video-play">${icon('play', 18)}</span>
        </span>
        <span class="clip-video-meta">
          <strong>视频</strong>
          <span>${esc(formatDuration(v.duration_ms))}${v.size ? ` · ${esc(formatSize(v.size))}` : ''}</span>
        </span>
      </label>`)
    root.appendChild(card)
  }
  if (images.some((i) => i.watermarked) || clip.video?.watermarked) {
    root.appendChild(el('<p class="clip-warn">部分媒体只能获取 1080px 带水印版本。</p>'))
  }
  root.appendChild(el('<p class="clip-hint">确认后先写入剪藏，再在后台下载原图/视频；下载失败可在卡片上重试。</p>'))
  return root
}

function renderPick(img: ClipImage, index: number, checked: boolean): HTMLElement {
  return el(`
    <label class="clip-pick">
      <input type="checkbox" data-index="${index}" ${checked ? 'checked' : ''}>
      <span class="clip-pick-img">
        ${img.preview_url ? `<img src="${esc(img.preview_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="clip-thumb-fail">无预览</span>'}
        ${img.live ? '<span class="clip-live-badge">实况</span>' : ''}
      </span>
    </label>`)
}

function updateConfirmState(root: HTMLElement, btn: HTMLButtonElement): void {
  const images = root.querySelectorAll<HTMLInputElement>('.clip-pick input[data-index]')
  const video = root.querySelector<HTMLInputElement>('.clip-video-pick input')
  let count = 0
  images.forEach((i) => {
    if (i.checked) count++
  })
  if (video?.checked) count++
  btn.disabled = count === 0
  const head = root.querySelector('.clip-pick-head .dim')
  if (head) {
    const selected = [...images].filter((i) => i.checked).length
    head.textContent = `共 ${images.length} 张，已选 ${selected} 张`
  }
}
