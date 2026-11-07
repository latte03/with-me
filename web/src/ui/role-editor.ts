import { createRole, deleteRole, updateRole } from '../store.ts'
import type { Role } from '../types.ts'
import { confirmModal, el, esc, openModal, toast } from './dom.ts'

export const ROLE_COLORS = ['#7c7cf8', '#f87c7c', '#f8b47c', '#f8e07c', '#8ef87c', '#7cf8e0', '#7cb4f8', '#e07cf8']

export function openRoleEditor(role: Role | null, onSaved?: (id: string) => void): void {
  const body = el('<form class="form role-form"></form>')
  const nameRow = el(`<label class="form-row"><span>名称</span><input name="name" value="${esc(role?.name ?? '')}" placeholder="随手记 / 灵感 / 情绪…" maxlength="30" aria-describedby="role-name-err"><span class="field-err" id="role-name-err" role="alert" hidden>请填写名称</span></label>`)
  body.appendChild(nameRow)
  const nameInput = nameRow.querySelector('input') as HTMLInputElement
  const nameErr = nameRow.querySelector('.field-err') as HTMLElement
  nameInput.addEventListener('input', () => {
    nameErr.hidden = true
    nameInput.removeAttribute('aria-invalid')
  })
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
      nameErr.hidden = false
      nameInput.setAttribute('aria-invalid', 'true')
      nameInput.focus()
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