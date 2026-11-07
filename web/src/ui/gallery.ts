import { onChange } from '../bus.ts'
import { imageSections, visibleMessages } from '../projection.ts'
import { blobUrl, getAll } from '../store.ts'
import type { Message } from '../types.ts'
import { el, esc, icon } from './dom.ts'
import { openViewer } from './viewer.ts'

export function mountGallery(root: HTMLElement, roleId: string | undefined, nav: (r: { view: 'chat'; roleId: string } | { view: 'chats' }) => void): () => void {
  const view = el(`
    <div class="page gallery">
      <header class="page-head">
        <button class="icon-btn back" aria-label="返回">${icon('back')}</button>
        <h1 class="head-title">图片与视频</h1>
        <span class="spacer"></span>
        <span class="gal-count"></span>
      </header>
      <div class="gal-body"></div>
    </div>`)
  root.appendChild(view)
  const body = view.querySelector('.gal-body') as HTMLElement
  const countEl = view.querySelector('.gal-count') as HTMLElement
  view.querySelector('.back')?.addEventListener('click', () => nav(roleId ? { view: 'chat', roleId } : { view: 'chats' }))

  async function paint() {
    const all = visibleMessages(await getAll<Message>('messages'))
      .filter((m) => m.type === 'image' && m.attachment_ref && (!roleId || m.role_id === roleId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
    const indexById = new Map(all.map((m, k) => [m.id, k]))
    const items = all.map((m) => ({ hash: m.attachment_ref }))
    countEl.textContent = String(all.length)
    body.innerHTML = ''
    if (all.length === 0) {
      body.appendChild(el('<div class="empty-block"><p>还没有图片</p></div>'))
      return
    }
    const sections = imageSections(all, new Date())
    for (const s of sections) {
      const sec = el('<section class="gal-section"></section>')
      sec.appendChild(el(`<h2 class="day-title">${esc(s.label)}</h2>`))
      const grid = el('<div class="gal-grid"></div>')
      for (const m of s.msgs) {
        const cell = el(`<button class="gal-cell" aria-label="查看图片"><img alt="图片" data-hash="${esc(m.attachment_ref)}"></button>`)
        const img = cell.querySelector('img') as HTMLImageElement
        void blobUrl(m.attachment_ref, 'thumb').then((url) => {
          if (url) img.src = url
          else img.classList.add('broken')
        })
        cell.addEventListener('click', () => openViewer(items, indexById.get(m.id) ?? 0))
        grid.appendChild(cell)
      }
      sec.appendChild(grid)
      body.appendChild(sec)
    }
  }

  const off = onChange(() => void paint())
  void paint()
  return () => {
    off()
    view.remove()
  }
}