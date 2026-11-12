import { avatarInner } from '../avatar-core.ts'
import { ALL_CATEGORIES, filterIcons, iconCategories } from '../icon-search.ts'
import { iconAvatar, iconId, loadIconCatalog, loadRoleIcons, type IconMeta } from '../role-icons.ts'
import { el, esc, openModal } from './dom.ts'

// 图标选择面板：单击即选中并关闭（与色板一致），Esc/取消/遮罩关闭不改任何东西。
// 匹配逻辑在 icon-search.ts（无 DOM），这里只负责渲染与交互。
export function openIconPicker(current: string, onPick: (avatar: string) => void): void {
  // iconId 只放行 [a-z0-9-]+，因此可以直接用作属性选择器
  const selectedId = iconId(current)
  let catalog: readonly IconMeta[] = []
  let query = ''
  let cat = ALL_CATEGORIES
  let closed = false
  let scrolled = false

  const body = el(`
    <div class="icon-picker">
      <input class="icon-search" type="search" placeholder="搜索图标，如「猫 / cat / 旅行」" aria-label="搜索图标" autocomplete="off">
      <div class="icon-cats" role="group" aria-label="图标分类" hidden></div>
      <div class="icon-grid-wrap" hidden><div class="icon-grid"></div></div>
      <div class="icon-state">
        <p class="icon-status" role="status">图标加载中…</p>
        <button type="button" class="btn ghost icon-retry" hidden>重试</button>
      </div>
    </div>`)
  const search = body.querySelector('.icon-search') as HTMLInputElement
  const cats = body.querySelector('.icon-cats') as HTMLElement
  const wrap = body.querySelector('.icon-grid-wrap') as HTMLElement
  const grid = body.querySelector('.icon-grid') as HTMLElement
  const state = body.querySelector('.icon-state') as HTMLElement
  const status = body.querySelector('.icon-status') as HTMLElement
  const retry = body.querySelector('.icon-retry') as HTMLButtonElement
  const foot = el('<div class="btn-row"><button type="button" class="btn ghost cancel">取消</button></div>')
  const m = openModal('选择图标', body, foot, () => {
    closed = true
  })
  m.root.classList.add('icon-modal')

  const cellHtml = (meta: IconMeta): string =>
    `<button type="button" class="icon-cell" data-id="${esc(meta.id)}" aria-label="${esc(meta.name)}" title="${esc(meta.name)}" aria-pressed="${meta.id === selectedId}">${avatarInner(iconAvatar(meta.id))}</button>`

  function paintCats(): void {
    cats.innerHTML = ''
    for (const c of [ALL_CATEGORIES, ...iconCategories(catalog)]) {
      const b = el(`<button type="button" class="icon-cat" aria-pressed="${c === cat}">${esc(c)}</button>`)
      b.addEventListener('click', () => {
        cat = c
        paintCats()
        paintGrid()
      })
      cats.appendChild(b)
    }
  }

  function paintGrid(): void {
    const hits = filterIcons(catalog, query, cat)
    if (hits.length === 0) {
      grid.innerHTML = '<p class="empty icon-empty">没有匹配的图标，换个词试试</p>'
      return
    }
    // 731 个 cell 一次性 innerHTML，点击走委托；离屏 cell 由 content-visibility 跳过布局/绘制
    grid.innerHTML = hits.map(cellHtml).join('')
    if (scrolled || !selectedId) return
    const cell = grid.querySelector<HTMLElement>(`[data-id="${selectedId}"]`)
    if (!cell) return
    scrolled = true
    wrap.scrollTop = Math.max(0, cell.offsetTop - (wrap.clientHeight - cell.offsetHeight) / 2)
  }

  function load(): void {
    state.hidden = false
    status.textContent = '图标加载中…'
    status.classList.remove('bad')
    retry.hidden = true
    Promise.all([loadRoleIcons(), loadIconCatalog()]).then(
      ([, list]) => {
        if (closed) return
        catalog = list
        state.hidden = true
        cats.hidden = false
        wrap.hidden = false
        paintCats()
        paintGrid()
      },
      () => {
        if (closed) return
        status.textContent = '图标加载失败，请检查网络后重试'
        status.classList.add('bad')
        retry.hidden = false
      },
    )
  }

  search.addEventListener('input', () => {
    query = search.value
    paintGrid()
  })
  grid.addEventListener('click', (e) => {
    const cell = (e.target as Element).closest<HTMLElement>('.icon-cell')
    const id = cell?.dataset.id
    if (!id) return
    onPick(iconAvatar(id))
    m.close()
  })
  retry.addEventListener('click', load)
  foot.querySelector('.cancel')?.addEventListener('click', () => m.close())
  load()
}