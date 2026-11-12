import { AVATAR_FALLBACK } from '../avatar-core.ts'
import { iconId, loadIconCatalog } from '../role-icons.ts'
import { createRole, deleteRole, updateRole } from '../store.ts'
import type { Role } from '../types.ts'
import { avatarHtml, confirmModal, el, esc, openModal, toast } from './dom.ts'
import { openIconPicker } from './icon-picker.ts'

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
  let color = role?.color ?? ROLE_COLORS[0]
  // 头像改成本地状态（照 color 的写法）：左侧预览按钮开图标面板，右侧保留 emoji 输入，两者并存
  let avatar = role?.avatar ?? AVATAR_FALLBACK
  const avatarRow = el(`
    <div class="form-row">
      <span>头像</span>
      <div class="avatar-line">
        <button type="button" class="avatar-preview" aria-label="选择图标"></button>
        <input class="avatar-emoji" name="emoji" maxlength="8" aria-label="头像 emoji" placeholder="emoji" autocomplete="off">
      </div>
      <span class="small-text">点左侧选图标，或直接输入 emoji</span>
    </div>`)
  body.appendChild(avatarRow)
  const preview = avatarRow.querySelector('.avatar-preview') as HTMLButtonElement
  const emojiInput = avatarRow.querySelector('.avatar-emoji') as HTMLInputElement
  const paintPreview = () => {
    preview.innerHTML = avatarHtml(avatar, color)
  }
  // 图标中文名当 emoji 框的 placeholder；面板已加载过目录，这里命中记忆化缓存
  const showIconName = (id: string) => {
    emojiInput.placeholder = 'emoji'
    loadIconCatalog().then(
      (list) => {
        if (iconId(avatar) !== id) return // 状态已变，别覆盖用户新输入
        const meta = list.find((m) => m.id === id)
        if (meta) emojiInput.placeholder = meta.name
      },
      () => {},
    )
  }
  const startId = iconId(avatar)
  if (startId) showIconName(startId)
  else emojiInput.value = avatar
  paintPreview()
  emojiInput.addEventListener('input', () => {
    avatar = emojiInput.value
    emojiInput.placeholder = 'emoji'
    paintPreview()
  })
  preview.addEventListener('click', () => {
    openIconPicker(avatar, (next) => {
      avatar = next
      emojiInput.value = ''
      paintPreview()
      const id = iconId(next)
      if (id) showIconName(id)
    })
  })
  const colorRow = el(`<div class="form-row"><span>颜色</span><div class="swatches"></div></div>`)
  const swatches = colorRow.querySelector('.swatches') as HTMLElement
  const paintSwatches = () => {
    swatches.innerHTML = ''
    for (const c of ROLE_COLORS) {
      const b = el(`<button type="button" class="swatch${c === color ? ' on' : ''}" style="background:${c}" aria-label="${c}"></button>`)
      b.addEventListener('click', () => {
        color = c
        paintSwatches()
        paintPreview()
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
      avatar: avatar.trim() || AVATAR_FALLBACK,
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