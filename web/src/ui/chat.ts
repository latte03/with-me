import { onChange } from '../bus.ts'
import { extractXHSLink } from '../clip-core.ts'
import { dayKey, thumbSize, timeLabel, visibleMessages } from '../projection.ts'
import { blobUrl, createMessage, deleteMessage, getAll, imageDimensions, MAX_ATTACHMENT, setTodoDone, stashBlob, updateMessage } from '../store.ts'
import { kick } from '../sync.ts'
import type { Message, Role } from '../types.ts'
import { confirmModal, el, esc, formModal, icon, openMenu, toast } from './dom.ts'
import { openClipPreview } from './clip-preview.ts'
import { renderClipCard } from './clip-card.ts'
import { openRoleEditor } from './role-editor.ts'
import { openViewer } from './viewer.ts'

export function mountChat(root: HTMLElement, roleId: string, highlight: string | undefined, back: () => void, onOpenMedia?: () => void): () => void {
  const view = el(`
    <div class="chat">
      <header class="chat-head">
        <button class="icon-btn back" aria-label="返回">${icon('back')}</button>
        <h2 class="chat-title"><i class="title-dot" hidden></i><span class="title-text"></span></h2>
        <button class="icon-btn more" aria-label="更多操作">${icon('dots')}</button>
      </header>
      <div class="msg-list"><div class="msg-col"></div></div>
      <div class="composer">
        <div class="todo-chip" hidden>${icon('todo', 14)} 待办模式 <button class="chip-x" aria-label="退出待办模式">${icon('close', 14)}</button></div>
        <div class="composer-row">
          <button class="icon-btn plus" aria-label="附件与待办">${icon('plus')}</button>
          <textarea rows="1" placeholder="记一条"></textarea>
          <button class="icon-btn send" aria-label="发送">${icon('send')}</button>
        </div>
        <input type="file" accept="image/*" hidden>
      </div>
    </div>`)
  root.appendChild(view)
  const list = view.querySelector('.msg-list') as HTMLElement
  // 消息列内容 wrapper：桌面端收窄居中，滚动容器本身保持全宽
  const col = view.querySelector('.msg-col') as HTMLElement
  const titleText = view.querySelector('.title-text') as HTMLElement
  const titleDot = view.querySelector('.title-dot') as HTMLElement
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
    input.placeholder = on ? '记一件待办' : '记一条'
  }

  async function send() {
    const text = input.value.trim()
    if (!text) return
    const link = extractXHSLink(text)
    if (link) {
      if (link.count > 1) {
        toast('一次剪一条，其余请逐条发送')
        return
      }
      input.value = ''
      autosize()
      openClipPreview({
        url: link.url,
        onCancel: () => {
          input.value = text
          autosize()
          input.focus()
        },
      })
      return
    }
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
      const dims = await imageDimensions(file)
      await createMessage(roleId, { type: 'image', attachmentRef: hash, width: dims?.width, height: dims?.height })
      kick()
      await paint(true)
    })()
  })

  function maxEdge(): number {
    return window.matchMedia('(min-width: 1024px)').matches ? 240 : Math.min(240, Math.max(120, Math.round(window.innerWidth * 0.36)))
  }

  function sizeImage(img: HTMLImageElement, m: Message) {
    if (m.width && m.height) {
      const s = thumbSize(m.width, m.height, maxEdge())
      img.style.width = `${s.width}px`
      img.style.height = `${s.height}px`
    } else {
      img.addEventListener('load', () => {
        if (img.naturalWidth && img.naturalHeight) {
          const s = thumbSize(img.naturalWidth, img.naturalHeight, maxEdge())
          img.style.width = `${s.width}px`
          img.style.height = `${s.height}px`
        }
      })
    }
  }

  function attachImage(img: HTMLImageElement, m: Message) {
    sizeImage(img, m)
    void blobUrl(m.attachment_ref, 'thumb').then((url) => {
      if (url) img.src = url
      else img.classList.add('broken')
    })
  }

  function bubble(m: Message): HTMLElement {
    if (m.type === 'clip') return renderClipCard(m, { onOpenMedia })
    if (m.type === 'image' && !m.text) {
      const row = el(`
        <div class="msg-row ${m.side === 'left' ? 'left' : 'right'}" data-id="${esc(m.id)}">
          <button class="img-msg" aria-label="查看图片"><img class="msg-img" alt="图片" data-hash="${esc(m.attachment_ref)}"></button>
        </div>`)
      const img = row.querySelector('.msg-img') as HTMLImageElement
      attachImage(img, m)
      row.querySelector('.img-msg')?.addEventListener('click', () => void openImage(m))
      return row
    }
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
      attachImage(img, m)
      img.addEventListener('click', (e) => {
        e.stopPropagation()
        void openImage(m)
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

  async function openImage(m: Message) {
    const imgs = visibleMessages(await getAll<Message>('messages')).filter((x) => x.role_id === roleId && x.type === 'image' && x.attachment_ref)
    const list = imgs.map((x) => ({ hash: x.attachment_ref }))
    let idx = imgs.findIndex((x) => x.id === m.id)
    if (idx < 0) idx = 0
    openViewer(list, idx, onOpenMedia)
  }

  async function paint(forceBottom = false) {
    role = (await getAll<Role>('roles')).find((r) => r.id === roleId)
    titleText.textContent = role?.name ?? '会话'
    // 角色色圆点：role 还没加载出来时不占位
    titleDot.hidden = !role
    titleDot.style.background = role?.color ?? ''
    const msgs = visibleMessages(await getAll<Message>('messages')).filter((m) => m.role_id === roleId)
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80
    col.innerHTML = ''
    if (msgs.length === 0) {
      col.appendChild(el('<div class="empty-block"><p>还没有记录</p><p class="dim">像发消息一样，给自己记一条</p></div>'))
    }
    let lastKey = ''
    let lastTs = 0
    for (const m of msgs) {
      const ts = new Date(m.created_at).getTime()
      const k = dayKey(m.created_at)
      if (k !== lastKey || ts - lastTs > 10 * 60 * 1000) {
        col.appendChild(el(`<div class="time-sep">${esc(timeLabel(m.created_at))}</div>`))
        lastKey = k
      }
      lastTs = ts
      col.appendChild(bubble(m))
    }
    if (highlight && !highlighted) {
      const target = col.querySelector(`[data-id="${CSS.escape(highlight)}"]`) as HTMLElement | null
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