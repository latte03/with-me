import { blobStreamUrl, blobUrl } from '../store.ts'
import { el, icon } from './dom.ts'

interface VideoOpts {
  posterHash?: string
  title?: string
  live?: boolean
}

export function openVideoOverlay(hash: string, opts: VideoOpts = {}): void {
  document.querySelector('.video-overlay')?.remove()
  const overlay = el(`
    <div class="video-overlay" role="dialog" aria-modal="true" aria-label="${opts.live ? '实况' : '视频'}">
      <div class="video-shell">
        <button class="icon-btn video-x" aria-label="关闭">${icon('close', 20)}</button>
        ${opts.live ? '<span class="video-tag">实况</span>' : ''}
        <video class="video-el" ${opts.live ? 'autoplay loop muted' : 'controls autoplay'} playsinline webkit-playsinline preload="metadata"></video>
        <div class="video-fail" hidden>视频加载失败</div>
      </div>
    </div>`)
  const video = overlay.querySelector('.video-el') as HTMLVideoElement
  const fail = overlay.querySelector('.video-fail') as HTMLElement
  if (opts.posterHash) {
    void blobUrl(opts.posterHash, 'thumb').then((url) => {
      if (url && overlay.isConnected) video.poster = url
    })
  }
  video.src = blobStreamUrl(hash)
  video.addEventListener('error', () => {
    video.hidden = true
    fail.hidden = false
  })
  const close = () => {
    video.pause()
    video.removeAttribute('src')
    video.load()
    overlay.remove()
    document.removeEventListener('keydown', onKey)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }
  overlay.querySelector('.video-x')?.addEventListener('click', close)
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) close()
  })
  document.addEventListener('keydown', onKey)
  document.body.appendChild(overlay)
  ;(overlay.querySelector('.video-x') as HTMLElement).focus()
  void video.play().catch(() => {
    /* iOS may require an explicit tap; controls remain available */
  })
}
