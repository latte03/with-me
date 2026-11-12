import { getSession } from './api.ts'
import { adoptDevice } from './device.ts'
import { iconId, loadRoleIcons } from './role-icons.ts'
import { closeDB, getAll, openDB, rebindOutbox } from './store.ts'
import { startSync } from './sync.ts'
import type { Role } from './types.ts'
import { mountAuth } from './ui/auth.ts'
import { mountCalendar } from './ui/calendar.ts'
import { mountChat } from './ui/chat.ts'
import { mountChats, mountRoleList } from './ui/chats.ts'
import { el, icon } from './ui/dom.ts'
import { mountGallery } from './ui/gallery.ts'
import { mountSearch } from './ui/search.ts'
import { mountSettings } from './ui/settings.ts'

export type Route =
  | { view: 'chats' }
  | { view: 'chat'; roleId: string; highlight?: string }
  | { view: 'gallery'; roleId?: string }
  | { view: 'calendar' }
  | { view: 'search' }
  | { view: 'settings' }

let route: Route = { view: 'chats' }
let shellEl: HTMLElement | null = null
let mainEl: HTMLElement | null = null
let viewCleanup: (() => void) | null = null
let sideCleanup: (() => void) | null = null
let authCleanup: (() => void) | null = null
const app = document.getElementById('app') as HTMLElement
const mq = window.matchMedia('(min-width: 1024px)')
mq.addEventListener('change', () => render())

function routeToHash(r: Route): string {
  if (r.view === 'chat') return `#/chat/${encodeURIComponent(r.roleId)}`
  if (r.view === 'gallery') return r.roleId ? `#/gallery/${encodeURIComponent(r.roleId)}` : '#/gallery'
  if (r.view === 'chats') return '#/'
  return `#/${r.view}`
}

function routeFromHash(): Route {
  const [view, id] = location.hash.replace(/^#\/?/, '').split('/')
  if (view === 'chat' && id) {
    try {
      return { view: 'chat', roleId: decodeURIComponent(id) }
    } catch {
      return { view: 'chats' }
    }
  }
  if (view === 'gallery') {
    if (!id) return { view: 'gallery' }
    try {
      return { view: 'gallery', roleId: decodeURIComponent(id) }
    } catch {
      return { view: 'gallery' }
    }
  }
  if (view === 'calendar' || view === 'search' || view === 'settings') return { view }
  return { view: 'chats' }
}

function sameRoute(a: Route, b: Route): boolean {
  if (a.view !== b.view) return false
  if (a.view === 'chat' && b.view === 'chat') return a.roleId === b.roleId
  if (a.view === 'gallery' && b.view === 'gallery') return a.roleId === b.roleId
  return true
}

export function nav(r: Route): void {
  route = r
  const h = routeToHash(r)
  // standalone PWA 里给 location.hash 赋值会走原生片段导航，切页会闪白；pushState 不触发重绘
  if (location.hash !== h) history.pushState(null, '', h)
  render()
}

// hashchange/popstate both fire on fragment navigation; the sameRoute guard keeps renders single
function onHashNav(): void {
  const r = routeFromHash()
  if (sameRoute(r, route)) return
  route = r
  render()
}
window.addEventListener('hashchange', onHashNav)
window.addEventListener('popstate', onHashNav)

function buildShell(): void {
  const shell = el(`
    <div class="shell" data-route="${route.view}">
      <aside class="side">
        <div class="brand"><span class="mark">${icon('chat', 18)}</span><span class="word">与我</span></div>
        <nav class="tabbar">
          <button class="tab" data-tab="chats">${icon('chat', 18)}<span>聊天</span></button>
          <button class="tab" data-tab="calendar">${icon('calendar', 18)}<span>日历</span></button>
          <button class="tab" data-tab="settings">${icon('gear', 18)}<span>设置</span></button>
        </nav>
        <div class="side-roles"></div>
      </aside>
      <main class="view"></main>
    </div>`)
  app.replaceChildren(shell)
  shell.querySelectorAll('.tab').forEach((b) => {
    const t = (b as HTMLElement).dataset.tab as Route['view']
    b.addEventListener('click', () => nav({ view: t } as Route))
  })
  shellEl = shell
  mainEl = shell.querySelector('.view') as HTMLElement
}

function unmountShell(): void {
  viewCleanup?.()
  viewCleanup = null
  sideCleanup?.()
  sideCleanup = null
  shellEl?.remove()
  shellEl = null
  mainEl = null
}

function render(): void {
  if (!getSession()) {
    unmountShell()
    authCleanup?.()
    authCleanup = null
    app.replaceChildren()
    authCleanup = mountAuth(app, () => void boot())
    return
  }
  authCleanup?.()
  authCleanup = null
  if (!shellEl) buildShell()
  const shell = shellEl as HTMLElement
  const main = mainEl as HTMLElement

  shell.dataset.route = route.view
  const activeTab = route.view === 'chat' || route.view === 'search' || route.view === 'gallery' ? 'chats' : route.view
  shell.querySelectorAll('.tab').forEach((b) => {
    const t = (b as HTMLElement).dataset.tab as Route['view']
    b.classList.toggle('active', activeTab === t)
  })

  viewCleanup?.()
  viewCleanup = null
  main.replaceChildren()
  main.scrollTop = 0

  sideCleanup?.()
  sideCleanup = null
  if (mq.matches) {
    const sideRoles = shell.querySelector('.side-roles') as HTMLElement
    sideCleanup = mountRoleList(sideRoles, (r) => nav(r), '会话', route.view === 'chat' ? route.roleId : undefined)
  }

  if (route.view === 'chats') viewCleanup = mountChats(main, (r) => nav(r), mq.matches)
  else if (route.view === 'chat') {
    const rid = route.roleId
    viewCleanup = mountChat(main, rid, route.highlight, () => nav({ view: 'chats' }), () => nav({ view: 'gallery', roleId: rid }))
  } else if (route.view === 'gallery') viewCleanup = mountGallery(main, route.roleId, (r) => nav(r))
  else if (route.view === 'search') viewCleanup = mountSearch(main, (roleId, messageId) => nav({ view: 'chat', roleId, highlight: messageId }), () => nav({ view: 'chats' }))
  else if (route.view === 'calendar') viewCleanup = mountCalendar(main, (roleId, messageId) => nav({ view: 'chat', roleId, highlight: messageId }))
  else viewCleanup = mountSettings(main, () => nav({ view: 'chats' }))
}

export async function boot(): Promise<void> {
  route = routeFromHash()
  const s = getSession()
  if (s) {
    await openDB(s.user.id)
    if (adoptDevice(s.device_id)) await rebindOutbox(s.device_id)
    // 只有真的用了图标头像才预载注册表，避免首屏闪兜底；纯 emoji 用户不下载图标 chunk
    const roles = await getAll<Role>('roles')
    if (roles.some((r) => !r.deleted && iconId(r.avatar) !== null)) {
      try {
        await loadRoleIcons()
      } catch {
        // 离线首访取不到 chunk：先渲染兜底，之后由 avatarHtml 触发重试
      }
    }
    void navigator.storage?.persist?.()
    startSync()
  }
  render()
}

window.addEventListener('with-me:unauthorized', () => {
  closeDB()
  route = { view: 'chats' }
  history.replaceState(null, '', location.pathname + location.search)
  render()
})