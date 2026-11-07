import { onChange } from '../bus.ts'
import { dayKey, timeLabel, visibleMessages } from '../projection.ts'
import { blobUrl, createMessage, deleteMessage, getAll, MAX_ATTACHMENT, setTodoDone, stashBlob, updateMessage } from '../store.ts'
import { kick } from '../sync.ts'
import type { Message, Role } from '../types.ts'
import { openRoleEditor } from './chats.ts'
import { confirmModal, el, esc, formModal, icon, openMenu, toast } from './dom.ts'

export function mountChat(root: HTMLElement, roleId: string, highlight: string | undefined, back: () => void): () => void {
  const view = el(`
    <div class="chat">
      <header class="chat-head">
        <button class="icon-btn back">${icon('back')}</button>
        <h2 class="chat-title"></h2>
        <button class="icon-btn more">${icon('dots')}</button>
      </header>
      <div class="msg-list"></div>
      <div class="composer">
        <div class="todo-chip" hidden>☐ 待办模式 <button class="chip-x">${icon('close', 14)}</button></div>
        <div class="composer-row">
          <button class="icon-btn plus">${icon('plus')}</button>
          <textarea rows="1" placeholder="记录一下…"></textarea>
          <button class="icon-btn send">${icon('send')}</button>
        </div>
        <input type="file" accept="image/*" hidden>
      </div>
    </div>`)
  root.appendChild(view)
  const list = view.querySelector('.msg-list') as HTMLElement
  const title = view.querySelector('.chat-title') as HTMLElement
  const input = view.querySelector('textarea') as HTMLTextAreaElement
  const fileInput = view.querySelector('input[type=file]') as HTMLInputElement
  const chip = view.querySelector('.todo-chip') as HTMLElement
  let todoMode = false
  let role: Role | undefined
  let highlighted = false

  view.querySelector('.back')?.addEventListener('click', back)
  view.querySelector('.more')?.addEventListener('click', (e) =>
    openMenu([{ label: '角色设置', icon: 'gear', onTap: () => openRoleEditor(role ?? null) }], e.currentTarget as HTMLElement),
  )
  view.querySelector('.plus')?.addEventListener('click', (e) =>
    openMenu(
      [
        { label: todoMode ? '取消待办模式' : '发成待办', icon: 'todo', onTap: () => setTodoMode(!todoMode) },
        { label: '图片附件', icon: 'image', onTap: () => fileInput.click() },
      ],
      e.currentTarget as HTMLElement,
    ),
  )
  chip.querySelector('.chip-x')?.addEventListener('click', () => setTodoMode(false))
  function setTodoMode(on: boolean) {
    todoMode = on
    chip.hidden = !on
    input.placeholder = on ? '记一件待办…' : '记录一下…'
  }

  async function send() {
    const text = input.value.trim()
    if (!text) return
    input.value = ''
    autosize()
    await createMessage(roleId, { type: todoMode ? 'todo' : 'text', text })
    kick()
    await paint(true)
  }
  view.querySelector('.send')?.addEventListener('click', () => void send())
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void send()
    }
  })
  function autosize() {
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`
  }
  input.addEventListener('input', autosize)

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    fileInput.value = ''
    if (!file) return
    void (async () => {
      if (file.size > MAX_ATTACHMENT) {
        toast('图片超过 20MB 限制')
        return
      }
      const hash = await stashBlob(file)
      await createMessage(roleId, { type: 'image', attachmentRef: hash })
      kick()
      await paint(true)
    })()
  })

  function bubble(m: Message): HTMLElement {
    const node = el(`
      <div class="msg-row ${m.side === 'left' ? 'left' : 'right'}" data-id="${esc(m.id)}">
        <div class="bubble${m.type === 'todo' ? ' todo' : ''}${m.todo_done ? ' done' : ''}">
          ${m.type === 'todo' ? `<button class="todo-check">${icon('check', 14)}</button>` : ''}
          ${m.type === 'image' ? `<img class="msg-img" alt="图片" data-hash="${esc(m.attachment_ref)}">` : ''}
          ${m.text ? `<span class="msg-text">${esc(m.text)}</span>` : ''}
        </div>
      </div>`)
    const b = node.querySelector('.bubble') as HTMLElement
    if (m.type === 'todo') {
      node.querySelector('.todo-check')?.addEventListener('click', (e) => {
        e.stopPropagation()
        void setTodoDone(m.id, !m.todo_done).then(() => kick())
      })
    }
    if (m.type === 'image') {
      const img = node.querySelector('.msg-img') as HTMLImageElement
      void blobUrl(m.attachment_ref, 'thumb').then((url) => {
        if (url) img.src = url
        else img.classList.add('broken')
      })
      img.addEventListener('click', (e) => {
        e.stopPropagation()
        void openImage(m.attachment_ref)
      })
    }
    b.addEventListener('click', () => {
      if (m.type === 'image') return
      openMenu(
        [
          { label: '编辑', icon: 'edit', onTap: () => void editMessage(m) },
          { label: '删除', icon: 'trash', danger: true, onTap: () => void removeMessage(m) },
        ],
        b,
      )
    })
    return node
  }

  async function editMessage(m: Message) {
    const v = await formModal('编辑消息', [{ key: 'text', label: '内容', value: m.text }], '保存')
    if (v && v.text.trim() && v.text !== m.text) {
      await updateMessage(m.id, { text: v.text.trim() })
      kick()
    }
  }

  async function removeMessage(m: Message) {
    if (await confirmModal(`删除这条${m.type === 'todo' ? '待办' : '消息'}？`, '删除')) {
      await deleteMessage(m.id)
      kick()
    }
  }

  async function openImage(hash: string) {
    const overlay = el(`<div class="img-overlay"><img alt="原图"><button class="icon-btn img-x">${icon('close')}</button></div>`)
    const img = overlay.querySelector('img') as HTMLImageElement
    const url = await blobUrl(hash, 'original')
    if (url) img.src = url
    overlay.addEventListener('click', () => overlay.remove())
    document.body.appendChild(overlay)
  }

  async function paint(forceBottom = false) {
    role = (await getAll<Role>('roles')).find((r) => r.id === roleId)
    title.textContent = role?.name ?? '会话'
    const msgs = visibleMessages(await getAll<Message>('messages')).filter((m) => m.role_id === roleId)
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80
    list.innerHTML = ''
    if (msgs.length === 0) {
      list.appendChild(el('<div class="empty-block"><p>还没有记录</p><p class="dim">像发消息一样，给自己记一条</p></div>'))
    }
    let lastKey = ''
    let lastTs = 0
    for (const m of msgs) {
      const ts = new Date(m.created_at).getTime()
      const k = dayKey(m.created_at)
      if (k !== lastKey || ts - lastTs > 10 * 60 * 1000) {
        list.appendChild(el(`<div class="time-sep">${esc(timeLabel(m.created_at))}</div>`))
        lastKey = k
      }
      lastTs = ts
      list.appendChild(bubble(m))
    }
    if (highlight && !highlighted) {
      const target = list.querySelector(`[data-id="${CSS.escape(highlight)}"]`) as HTMLElement | null
      if (target) {
        highlighted = true
        target.scrollIntoView({ block: 'center' })
        target.classList.add('flash')
      }
    } else if (forceBottom || nearBottom) {
      list.scrollTop = list.scrollHeight
    }
  }

  const off = onChange(() => void paint())
  void paint(true)
  return () => {
    off()
    view.remove()
  }
}