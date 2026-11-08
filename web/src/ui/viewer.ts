import { blobUrl } from '../store.ts'
import { el, icon } from './dom.ts'
import { openVideoOverlay } from './media.ts'

export interface ViewerItem {
  hash: string
  liveHash?: string
}

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
const DUR = 240
const THRESHOLD = 70
const EDGE = 0.35

type SlotName = 'prev' | 'cur' | 'next'

interface Slot {
  img: HTMLImageElement
  fail: HTMLElement
  token: number
}

export function openViewer(items: ViewerItem[], index: number, onOpenMedia?: () => void): void {
  if (items.length === 0) return
  document.querySelector('.img-overlay')?.remove()
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let i = Math.min(Math.max(index, 0), items.length - 1)
  let closed = false
  let animating = false
  let dragging = false
  let pointerId = -1
  let startX = 0
  let dx = 0
  let timer: number | undefined

  const overlay = el(`
    <div class="img-overlay" role="dialog" aria-modal="true" aria-label="图片预览">
      <div class="img-count"></div>
      <div class="img-track">
        <div class="img-slide"><img class="slot img-slot" data-slot="prev" alt="" draggable="false"><div class="img-fail" hidden>图片加载失败</div></div>
        <div class="img-slide"><img class="slot img-slot" data-slot="cur" alt="原图" draggable="false"><div class="img-fail" hidden>图片加载失败</div></div>
        <div class="img-slide"><img class="slot img-slot" data-slot="next" alt="" draggable="false"><div class="img-fail" hidden>图片加载失败</div></div>
      </div>
      <button class="icon-btn img-x" aria-label="关闭图片">${icon('close')}</button>
      <button class="img-live" hidden>${icon('play', 16)} 实况</button>
    </div>`)
  const track = overlay.querySelector('.img-track') as HTMLElement
  const count = overlay.querySelector('.img-count') as HTMLElement
  const liveBtn = overlay.querySelector('.img-live') as HTMLButtonElement
  const slots = {} as Record<SlotName, Slot>
  for (const name of ['prev', 'cur', 'next'] as SlotName[]) {
    const img = overlay.querySelector(`img[data-slot="${name}"]`) as HTMLImageElement
    const fail = img.parentElement?.querySelector('.img-fail') as HTMLElement
    slots[name] = { img, fail, token: 0 }
    img.addEventListener('load', () => {
      if (closed) return
      img.hidden = false
      fail.hidden = true
    })
    img.addEventListener('error', () => {
      if (closed || !img.getAttribute('src')) return
      img.hidden = true
      if (name === 'cur') fail.hidden = false
    })
  }

  if (onOpenMedia) {
    const media = el(`<button class="fab" aria-label="图片与视频">${icon('grid', 20)}</button>`)
    media.addEventListener('click', () => {
      close()
      onOpenMedia()
    })
    overlay.appendChild(media)
  }

  function transitionOn(): string {
    return reduce ? 'none' : `transform ${DUR}ms ${EASE}`
  }

  function place(transform: string, animate: boolean): void {
    track.style.transition = animate ? transitionOn() : 'none'
    track.style.transform = transform
  }

  function updateCount(): void {
    count.textContent = `${i + 1} / ${items.length}`
  }

  async function loadSlot(name: SlotName, idx: number): Promise<void> {
    const s = slots[name]
    const token = ++s.token
    s.fail.hidden = true
    if (idx < 0 || idx >= items.length) {
      s.img.hidden = true
      s.img.removeAttribute('src')
      return
    }
    s.img.hidden = false
    const url = await blobUrl(items[idx].hash, 'original')
    if (closed || token !== s.token) return
    if (!url) {
      s.img.hidden = true
      s.img.removeAttribute('src')
      if (name === 'cur') s.fail.hidden = false
      return
    }
    s.img.src = url
  }

  function fill(): void {
    liveBtn.hidden = !items[i]?.liveHash
    void loadSlot('prev', i - 1)
    void loadSlot('cur', i)
    void loadSlot('next', i + 1)
  }

  function resetTrack(): void {
    track.style.transition = 'none'
    track.style.transform = 'translateX(-100vw)'
    void track.offsetWidth
  }

  function settle(next: number): void {
    i = next
    updateCount()
    fill()
    resetTrack()
    animating = false
  }

  function rebound(): void {
    animating = true
    place('translateX(-100vw)', true)
    if (reduce) {
      animating = false
      resetTrack()
      return
    }
    timer = window.setTimeout(() => {
      timer = undefined
      if (!closed) animating = false
    }, DUR)
  }

  function commit(delta: number): void {
    if (closed || animating) return
    const next = i + delta
    if (next < 0 || next >= items.length) {
      rebound()
      return
    }
    animating = true
    place(delta > 0 ? 'translateX(-200vw)' : 'translateX(0)', true)
    if (reduce) {
      settle(next)
      return
    }
    timer = window.setTimeout(() => {
      timer = undefined
      if (!closed) settle(next)
    }, DUR)
  }

  function onDragStart(e: Event): void {
    e.preventDefault()
  }

  function onPointerDown(e: PointerEvent): void {
    if (closed || animating) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    dragging = true
    pointerId = e.pointerId
    startX = e.clientX
    dx = 0
    overlay.setPointerCapture(e.pointerId)
    track.style.transition = 'none'
    e.preventDefault()
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging || e.pointerId !== pointerId) return
    let d = e.clientX - startX
    if ((i === 0 && d > 0) || (i === items.length - 1 && d < 0)) d *= EDGE
    dx = d
    track.style.transform = `translateX(calc(-100vw + ${Math.round(d)}px))`
  }

  function endDrag(e: PointerEvent): void {
    if (!dragging || e.pointerId !== pointerId) return
    dragging = false
    pointerId = -1
    if (overlay.hasPointerCapture(e.pointerId)) overlay.releasePointerCapture(e.pointerId)
    const d = dx
    dx = 0
    if (Math.abs(d) < 8) {
      close()
      return
    }
    if (Math.abs(d) > THRESHOLD && items.length > 1) commit(d < 0 ? 1 : -1)
    else rebound()
  }

  function close(): void {
    if (closed) return
    closed = true
    if (timer) window.clearTimeout(timer)
    document.removeEventListener('keydown', onKey)
    overlay.removeEventListener('pointerdown', onPointerDown)
    overlay.removeEventListener('pointermove', onPointerMove)
    overlay.removeEventListener('pointerup', endDrag)
    overlay.removeEventListener('pointercancel', endDrag)
    overlay.removeEventListener('dragstart', onDragStart)
    overlay.remove()
    if (opener?.isConnected) opener.focus()
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (!dragging) commit(1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (!dragging) commit(-1)
    }
  }

  overlay.querySelector('.img-x')?.addEventListener('click', close)
  liveBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    const cur = items[i]
    if (cur?.liveHash) openVideoOverlay(cur.liveHash, { posterHash: cur.hash, live: true })
  })
  overlay.addEventListener('pointerdown', onPointerDown)
  overlay.addEventListener('pointermove', onPointerMove)
  overlay.addEventListener('pointerup', endDrag)
  overlay.addEventListener('pointercancel', endDrag)
  overlay.addEventListener('dragstart', onDragStart)
  document.addEventListener('keydown', onKey)
  document.body.appendChild(overlay)
  updateCount()
  fill()
  resetTrack()
  ;(overlay.querySelector('.img-x') as HTMLElement).focus()
}
