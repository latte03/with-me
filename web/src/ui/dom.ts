export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function el(html: string): HTMLElement {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstElementChild as HTMLElement
}

const PATHS: Record<string, string> = {
  back: 'M15 5l-7 7 7 7',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.8-4.8',
  plus: 'M12 5v14M5 12h14',
  chat: 'M4 5h16v11H9l-5 4V5z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2.5l1 2.6 2.7-.6 1 2.5 2.6 1-.6 2.7 2.1 1.8-2.1 1.8.6 2.7-2.6 1-1 2.5-2.7-.6-1 2.6-1-2.6-2.7.6-1-2.5-2.6-1 .6-2.7L2.5 12l2.1-1.8-.6-2.7 2.6-1 1-2.5 2.7.6z',
  image: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M9 9h.01',
  todo: 'M4 6.5l1.5 1.5L8 5.5M4 12.5l1.5 1.5L8 11.5M4 18.5l1.5 1.5L8 17.5M11 7h9M11 13h9M11 19h9',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  send: 'M4 12l16-8-6 16-2.5-6.5L4 12z',
  edit: 'M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1z',
  trash: 'M5 7h14M10 7V5h4v2M8 7l1 13h6l1-13M10 11v6M14 11v6',
  pin: 'M9 4h6l-1 7 3 3v2H7v-2l3-3-1-7zM12 16v5',
  eyeoff: 'M4 4l16 16M10 5.5A9 9 0 0 1 21 12a15 15 0 0 1-3 3.5M6.5 6.5A15 15 0 0 0 3 12a9 9 0 0 0 12 5.5M10 10a3 3 0 0 0 4 4',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  sync: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4',
  user: 'M12 5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM5 20a7 7 0 0 1 14 0',
  device: 'M7 3h10v18H7zM11 18h2',
  logout: 'M14 4H6v16h8M10 12h11M18 8l3 4-3 4',
  close: 'M6 6l12 12M18 6L6 18',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
}

export function icon(name: string, size = 18): string {
  const d = PATHS[name] ?? ''
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`
}

let toastTimer: number | undefined

export function toast(msg: string): void {
  document.querySelector('.toast')?.remove()
  const t = el(`<div class="toast" role="status">${esc(msg)}</div>`)
  document.body.appendChild(t)
  requestAnimationFrame(() => t.classList.add('show'))
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    t.classList.remove('show')
    window.setTimeout(() => t.remove(), 300)
  }, 2600)
}

export interface MenuItem {
  label: string
  icon?: string
  danger?: boolean
  onTap?: () => void
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.getClientRects().length > 0)
}

function activeOpener(): HTMLElement | null {
  const a = document.activeElement
  return a instanceof HTMLElement && a !== document.body ? a : null
}

let menuRestore: HTMLElement | null = null

export function openMenu(items: MenuItem[], anchor?: HTMLElement): void {
  closeMenu()
  menuRestore = activeOpener()
  const overlay = el('<div class="menu-overlay"></div>')
  const menu = el('<div class="menu" role="menu"></div>')
  for (const item of items) {
    const b = el(`<button class="menu-item${item.danger ? ' danger' : ''}" role="menuitem">${item.icon ? icon(item.icon, 18) : ''}<span>${esc(item.label)}</span></button>`)
    b.addEventListener('click', () => {
      closeMenu()
      item.onTap?.()
    })
    menu.appendChild(b)
  }
  overlay.appendChild(menu)
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) closeMenu()
  })
  overlay.addEventListener('keydown', (e) => {
    const entries = [...menu.querySelectorAll<HTMLElement>('.menu-item')]
    if (entries.length === 0) return
    const i = entries.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      closeMenu()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      entries[(i + 1) % entries.length].focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      entries[(i - 1 + entries.length) % entries.length].focus()
    }
  })
  document.body.appendChild(overlay)
  const mw = menu.offsetWidth
  const mh = menu.offsetHeight
  let x = window.innerWidth - mw - 12
  let y = 60
  if (anchor) {
    const r = anchor.getBoundingClientRect()
    x = Math.min(Math.max(8, r.right - mw), window.innerWidth - mw - 8)
    y = r.bottom + mh + 16 < window.innerHeight ? r.bottom + 8 : Math.max(8, r.top - mh - 8)
  } else {
    x = (window.innerWidth - mw) / 2
    y = window.innerHeight - mh - 90
  }
  menu.style.left = `${x}px`
  menu.style.top = `${y}px`
  menu.querySelector<HTMLElement>('.menu-item')?.focus()
}

export function closeMenu(): void {
  const overlay = document.querySelector('.menu-overlay')
  if (!overlay) return
  overlay.remove()
  const restore = menuRestore
  menuRestore = null
  if (restore?.isConnected) restore.focus()
}

export interface Modal {
  close: () => void
  root: HTMLElement
}

export function openModal(title: string, body: HTMLElement, foot?: HTMLElement, onClose?: () => void): Modal {
  const opener = activeOpener()
  const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`
  const overlay = el(`<div class="modal-overlay"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}"><div class="modal-head"><h3 id="${titleId}">${esc(title)}</h3><button class="icon-btn modal-x" aria-label="关闭">${icon('close', 18)}</button></div><div class="modal-body"></div></div></div>`)
  const root = overlay.querySelector('.modal') as HTMLElement
  ;(overlay.querySelector('.modal-body') as HTMLElement).appendChild(body)
  if (foot) {
    const f = el('<div class="modal-foot"></div>')
    f.appendChild(foot)
    root.appendChild(f)
    const form = body instanceof HTMLFormElement ? body : (body.querySelector('form') as HTMLFormElement | null)
    if (form) {
      if (!form.id) form.id = `modal-form-${Math.random().toString(36).slice(2, 8)}`
      f.querySelectorAll('button[type="submit"]').forEach((b) => b.setAttribute('form', form.id))
    }
  }
  const close = () => {
    overlay.remove()
    if (opener?.isConnected) opener.focus()
    onClose?.()
  }
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) close()
  })
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key !== 'Tab') return
    const entries = focusableIn(root)
    if (entries.length === 0) {
      e.preventDefault()
      root.focus()
      return
    }
    const first = entries[0]
    const last = entries[entries.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || !root.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !root.contains(active))) {
      e.preventDefault()
      first.focus()
    }
  })
  ;(overlay.querySelector('.modal-x') as HTMLElement).addEventListener('click', close)
  document.body.appendChild(overlay)
  const first = focusableIn(root)[0]
  if (first) first.focus()
  else {
    root.tabIndex = -1
    root.focus()
  }
  return { close, root }
}

export interface FieldSpec {
  key: string
  label: string
  type?: string
  value?: string
  placeholder?: string
}

export function formModal(title: string, fields: FieldSpec[], submitLabel = '保存'): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const body = el('<form class="form"></form>')
    for (const f of fields) {
      const row = el(`<label class="form-row"><span>${esc(f.label)}</span><input name="${esc(f.key)}" type="${esc(f.type ?? 'text')}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder ?? '')}" autocomplete="off"></label>`)
      body.appendChild(row)
    }
    const foot = el(`<div class="btn-row"><button type="button" class="btn ghost cancel">取消</button><button type="submit" class="btn primary">${esc(submitLabel)}</button></div>`)
    let settled = false
    const m = openModal(title, body, foot, () => finish(null))
    const finish = (v: Record<string, string> | null) => {
      if (settled) return
      settled = true
      m.close()
      resolve(v)
    }
    foot.querySelector('.cancel')?.addEventListener('click', () => finish(null))
    body.addEventListener('submit', (e) => {
      e.preventDefault()
      const fd = new FormData(body as HTMLFormElement)
      finish(Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)])))
    })
    const first = body.querySelector('input') as HTMLInputElement | null
    first?.focus()
  })
}

export function confirmModal(msg: string, okLabel = '确定'): Promise<boolean> {
  return new Promise((resolve) => {
    const body = el(`<p class="confirm-text">${esc(msg)}</p>`)
    const foot = el(`<div class="btn-row"><button class="btn ghost cancel">取消</button><button class="btn danger ok">${esc(okLabel)}</button></div>`)
    const m = openModal('确认', body, foot, () => finish(false))
    let settled = false
    const finish = (v: boolean) => {
      if (settled) return
      settled = true
      m.close()
      resolve(v)
    }
    foot.querySelector('.cancel')?.addEventListener('click', () => finish(false))
    foot.querySelector('.ok')?.addEventListener('click', () => finish(true))
  })
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
}