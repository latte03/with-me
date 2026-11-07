import { onChange } from '../bus.ts'
import { previewOf, shortDay, visibleMessages, visibleRoles } from '../projection.ts'
import { createRole, deleteRole, getAll, updateRole } from '../store.ts'
import { onSync } from '../sync.ts'
import type { Message, Role } from '../types.ts'
import { confirmModal, el, esc, icon, openMenu, openModal, toast } from './dom.ts'

export const ROLE_COLORS = ['#7c7cf8', '#f87c7c', '#f8b47c', '#f8e07c', '#8ef87c', '#7cf8e0', '#7cb4f8', '#e07cf8']

export function openRoleEditor(role: Role | null, onSaved?: (id: string) => void): void {
  const body = el('<form class="form role-form"></form>')
  body.appendChild(el(`<label class="form-row"><span>名称</span><input name="name" value="${esc(role?.name ?? '')}" placeholder="随手记 / 灵感 / 情绪…" maxlength="30"></label>`))
  body.appendChild(el(`<label class="form-row"><span>头像 emoji</span><input name="avatar" value="${esc(role?.avatar ?? '💬')}" maxlength="8"></label>`))
  const colorRow = el(`<div class="form-row"><span>颜色</span><div class="swatches"></div></div>`)
  let color = role?.color ?? ROLE_COLORS[0]
  const swatches = colorRow.querySelector('.swatches') as HTMLElement
  const paintSwatches = () => {
    swatches.innerHTML = ''
    for (const c of ROLE_COLORS) {
      const b = el(`<button type="button" class="swatch${c === color ? ' on' : ''}" style="background:${c}" aria-label="${c}"></button>`)
      b.addEventListener('click', () => {
        color = c
        paintSwatches()
      })
      swatches.appendChild(b)
    }
  }
  paintSwatches()
  body.appendChild(colorRow)
  const pinned = el(`<label class="check-row"><input type="checkbox" name="pinned" ${role?.pinned ? 'checked' : ''}><span>置顶会话</span></label>`)
  const hidden = el(`<label class="check-row"><input type="checkbox" name="hidden" ${role?.hidden ? 'checked' : ''}><span>在首页隐藏</span></label>`)
  body.appendChild(pinned)
  body.appendChild(hidden)
  const foot = el(`<div class="btn-row">${role ? '<button type="button" class="btn danger del">删除角色</button>' : ''}<span class="spacer"></span><button type="button" class="btn ghost cancel">取消</button><button type="submit" class="btn primary">保存</button></div>`)
  let closed = false
  const m = openModal(role ? '编辑角色' : '新角色', body, foot, () => {
    closed = true
  })
  foot.querySelector('.cancel')?.addEventListener('click', () => m.close())
  foot.querySelector('.del')?.addEventListener('click', async () => {
    if (!role) return
    if (await confirmModal(`删除角色「${role.name}」及其全部消息？`, '删除')) {
      await deleteRole(role.id)
      m.close()
      toast('角色已删除')
    }
  })
  body.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (closed) return
    const fd = new FormData(body as HTMLFormElement)
    const name = String(fd.get('name') ?? '').trim()
    if (!name) {
      toast('请填写名称')
      return
    }
    const fields = {
      name,
      avatar: String(fd.get('avatar') ?? '').trim() || '💬',
      color,
      pinned: fd.get('pinned') === 'on',
      hidden: fd.get('hidden') === 'on',
    }
    if (role) {
      await updateRole(role.id, fields)
      onSaved?.(role.id)
    } else {
      const env = await createRole(fields)
      onSaved?.((env.payload as { id: string }).id)
    }
    m.close()
  })
}

export function mountChats(root: HTMLElement, nav: (r: { view: 'chat'; roleId: string } | { view: 'search' }) => void): () => void {
  const view = el(`
    <div class="page">
      <header class="page-head">
        <h1 class="head-title">聊天</h1>
        <span class="sync-dot" hidden></span>
        <span class="spacer"></span>
        <button class="pill search-pill">${icon('search', 18)}<span class="pill-dots">${icon('dots', 18)}</span></button>
      </header>
      <div class="role-list"></div>
    </div>`)
  root.appendChild(view)
  const list = view.querySelector('.role-list') as HTMLElement
  const pill = view.querySelector('.search-pill') as HTMLElement
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
  pill.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.pill-dots')) menu(dots)
    else nav({ view: 'search' })
  })

  async function openManager() {
    const roles = visibleRoles(await getAll<Role>('roles'))
    const body = el('<div class="manager-list"></div>')
    if (roles.length === 0) body.appendChild(el('<p class="empty">还没有角色</p>'))
    for (const r of roles) {
      const row = el(`<div class="manager-row"><span class="avatar" style="background:${esc(r.color)}22;color:${esc(r.color)}">${esc(r.avatar)}</span><span class="manager-name">${esc(r.name)}${r.hidden ? '<em class="tag">隐藏</em>' : ''}${r.pinned ? '<em class="tag">置顶</em>' : ''}</span><button class="btn ghost small">编辑</button></div>`)
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
        <button class="role-row">
          <span class="avatar" style="background:${esc(r.color)}22">${esc(r.avatar)}</span>
          <span class="role-main">
            <span class="role-name">${esc(r.name)}${r.pinned ? `<i class="pin-ico">${icon('pin', 12)}</i>` : ''}</span>
            <span class="role-preview">${last ? esc(previewOf(last)) : '开始记录…'}</span>
          </span>
          <span class="role-time">${last ? esc(shortDay(last.created_at)) : ''}</span>
        </button>`)
      row.addEventListener('click', () => nav({ view: 'chat', roleId: r.id }))
      list.appendChild(row)
    }
  }

  const offChange = onChange(() => void paint())
  const offSync = onSync((s) => {
    dot.hidden = s.pending === 0 && !s.syncing && s.error === ''
    dot.textContent = s.syncing ? '同步中…' : s.error ? '同步异常' : `${s.pending} 待传`
    dot.className = `sync-dot${s.error ? ' bad' : ''}`
  })
  void paint()
  return () => {
    offChange()
    offSync()
    view.remove()
  }
}