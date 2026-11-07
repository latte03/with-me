import { api } from '../api.ts'
import { searchLocal, timeLabel } from '../projection.ts'
import { getAll } from '../store.ts'
import type { Message, Role, SearchResult } from '../types.ts'
import { el, esc, icon } from './dom.ts'

export function mountSearch(root: HTMLElement, openMessage: (roleId: string, messageId: string) => void, back: () => void): () => void {
  const view = el(`
    <div class="page">
      <header class="page-head search-head">
        <button class="icon-btn back">${icon('back')}</button>
        <input class="search-input" placeholder="搜索全部记录…" autocomplete="off">
      </header>
      <div class="search-results"></div>
    </div>`)
  root.appendChild(view)
  const input = view.querySelector('.search-input') as HTMLInputElement
  const results = view.querySelector('.search-results') as HTMLElement
  view.querySelector('.back')?.addEventListener('click', back)
  let timer: number | undefined
  let seq = 0

  async function run(q: string) {
    const my = ++seq
    if (!q.trim()) {
      results.innerHTML = '<p class="empty">输入关键词搜索跨角色记录</p>'
      return
    }
    let list: SearchResult[]
    let offline = false
    try {
      if (!navigator.onLine) throw new Error('offline')
      list = (await api<{ results: SearchResult[] }>(`/search?q=${encodeURIComponent(q)}`)).results
    } catch {
      offline = true
      const msgs = await getAll<Message>('messages')
      const roles = Object.fromEntries((await getAll<Role>('roles')).map((r) => [r.id, r]))
      list = searchLocal(msgs, roles, q)
    }
    if (my !== seq) return
    results.innerHTML = ''
    if (offline) results.appendChild(el('<p class="search-note">离线模式：仅搜索本机记录</p>'))
    if (list.length === 0) {
      results.appendChild(el('<p class="empty">没有找到相关记录</p>'))
      return
    }
    for (const r of list) {
      const row = el(`
        <button class="search-row">
          <span class="search-top"><span class="day-role">${esc(r.role_name)}</span><span class="role-time">${esc(timeLabel(r.created_at))}</span></span>
          <span class="search-snippet">${esc(r.snippet)}</span>
        </button>`)
      row.addEventListener('click', () => openMessage(r.role_id, r.message_id))
      results.appendChild(row)
    }
  }

  input.addEventListener('input', () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void run(input.value), 300)
  })
  void run('')
  window.setTimeout(() => input.focus(), 50)
  return () => {
    window.clearTimeout(timer)
    view.remove()
  }
}