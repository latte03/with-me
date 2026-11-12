import { onChange } from '../bus.ts'
import { previewOf, shortDay, visibleMessages, visibleRoles } from '../projection.ts'
import { getAll } from '../store.ts'
import { onSync } from '../sync.ts'
import type { Message, Role } from '../types.ts'
import { avatarHtml, el, esc, icon, openMenu, openModal } from './dom.ts'
import { openRoleEditor } from './role-editor.ts'

export function mountRoleList(container: HTMLElement, nav: (r: { view: 'chat'; roleId: string } | { view: 'search' }) => void, label?: string, activeId?: string): () => void {
  container.innerHTML = ''
  if (label) container.appendChild(el(`<p class="side-label">${esc(label)}</p>`))
  const list = el('<div class="role-list"></div>')
  container.appendChild(list)
  async function paint() {
    const roles = visibleRoles(await getAll<Role>('roles'))
    const msgs = visibleMessages(await getAll<Message>('messages'))
    const lastOf = new Map<string, Message>()
    for (const m of msgs) lastOf.set(m.role_id, m)
    const shown = roles.filter((r) => !r.hidden)
    shown.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (lastOf.get(b.id)?.created_at ?? b.created_at).localeCompare(lastOf.get(a.id)?.created_at ?? a.created_at))
    list.innerHTML = ''
    if (shown.length === 0) {
      const empty = el(`<div class="empty-block"><p>还没有会话</p><button class="btn primary">＋ 新角色</button></div>`)
      empty.querySelector('button')?.addEventListener('click', () => openRoleEditor(null, (id) => nav({ view: 'chat', roleId: id })))
      list.appendChild(empty)
      return
    }
    for (const r of shown) {
      const last = lastOf.get(r.id)
      const row = el(`
        <button class="role-row${r.id === activeId ? ' on' : ''}">
          ${avatarHtml(r.avatar, r.color)}
          <span class="role-main">
            <span class="role-name">${esc(r.name)}${r.pinned ? `<i class="pin-ico">${icon('pin', 14)}</i>` : ''}</span>
            <span class="role-preview">${last ? esc(previewOf(last)) : '开始记录…'}</span>
          </span>
          <span class="role-time">${last ? esc(shortDay(last.created_at)) : ''}</span>
        </button>`)
      row.addEventListener('click', () => nav({ view: 'chat', roleId: r.id }))
      list.appendChild(row)
    }
  }
  const off = onChange(() => void paint())
  void paint()
  return () => {
    off()
  }
}

export function mountChats(root: HTMLElement, nav: (r: { view: 'chat'; roleId: string } | { view: 'search' }) => void, desktop = false): () => void {
  const view = el(`
    <div class="page">
      <header class="page-head">
        <h1 class="head-title">聊天</h1>
        <span class="sync-dot" hidden></span>
        <span class="spacer"></span>
        <span class="pill search-group">
          <button class="search-pill" aria-label="搜索">${icon('search', 18)}</button>
          <button class="pill-dots" aria-label="角色菜单">${icon('dots', 18)}</button>
        </span>
      </header>
      <div class="chats-body"></div>
    </div>`)
  root.appendChild(view)
  const body = view.querySelector('.chats-body') as HTMLElement
  const searchBtn = view.querySelector('.search-pill') as HTMLElement
  const dots = view.querySelector('.pill-dots') as HTMLElement
  const dot = view.querySelector('.sync-dot') as HTMLElement

  const menu = (anchor: HTMLElement) =>
    openMenu(
      [
        { label: '新角色', icon: 'plus', onTap: () => openRoleEditor(null, (id) => nav({ view: 'chat', roleId: id })) },
        { label: '角色管理', icon: 'list', onTap: openManager },
      ],
      anchor,
    )
  searchBtn.addEventListener('click', () => nav({ view: 'search' }))
  dots.addEventListener('click', () => menu(dots))

  async function openManager() {
    const roles = visibleRoles(await getAll<Role>('roles'))
    const body = el('<div class="manager-list"></div>')
    if (roles.length === 0) body.appendChild(el('<p class="empty">还没有角色</p>'))
    for (const r of roles) {
      const row = el(`<div class="manager-row">${avatarHtml(r.avatar, r.color)}<span class="manager-name">${esc(r.name)}${r.hidden ? '<em class="tag">隐藏</em>' : ''}${r.pinned ? '<em class="tag">置顶</em>' : ''}</span><button class="btn ghost small">编辑</button></div>`)
      row.querySelector('button')?.addEventListener('click', () => {
        m.close()
        openRoleEditor(r)
      })
      body.appendChild(row)
    }
    const foot = el('<div class="btn-row"><button class="btn primary new">＋ 新角色</button></div>')
    const m = openModal('角色管理', body, foot)
    foot.querySelector('.new')?.addEventListener('click', () => {
      m.close()
      openRoleEditor(null, (id) => nav({ view: 'chat', roleId: id }))
    })
  }

  let offList: (() => void) | null = null
  if (desktop) {
    const empty = el(`<div class="empty-block"><p>从左侧选择一个会话，或新建一条</p><button class="btn primary">＋ 新角色</button></div>`)
    empty.querySelector('button')?.addEventListener('click', () => openRoleEditor(null, (id) => nav({ view: 'chat', roleId: id })))
    body.appendChild(empty)
  } else {
    offList = mountRoleList(body, nav)
  }
  const offSync = onSync((s) => {
    dot.hidden = s.pending === 0 && !s.syncing && s.error === ''
    dot.textContent = s.syncing ? '同步中…' : s.error ? '同步异常' : `${s.pending} 待传`
    dot.className = `sync-dot${s.error ? ' bad' : ''}`
  })
  return () => {
    offSync()
    offList?.()
    view.remove()
  }
}