import { getSession } from './api.ts'
import { closeDB, openDB } from './store.ts'
import { startSync } from './sync.ts'
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
let cleanup: (() => void) | null = null
const app = document.getElementById('app') as HTMLElement
const mq = window.matchMedia('(min-width: 1024px)')
let sideCleanup: (() => void) | null = null
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
  if (location.hash !== h) location.hash = h
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

function render(): void {
  cleanup?.()
  cleanup = null
  app.innerHTML = ''
  if (!getSession()) {
    cleanup = mountAuth(app, () => void boot())
    return
  }
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
  app.appendChild(shell)
  const main = shell.querySelector('.view') as HTMLElement
  const activeTab = route.view === 'chat' || route.view === 'search' || route.view === 'gallery' ? 'chats' : route.view
  shell.querySelectorAll('.tab').forEach((b) => {
    const t = (b as HTMLElement).dataset.tab as Route['view']
    b.classList.toggle('active', activeTab === t)
    b.addEventListener('click', () => nav({ view: t } as Route))
  })
  let viewCleanup: (() => void) | null = null
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
  cleanup = () => {
    viewCleanup?.()
    sideCleanup?.()
    sideCleanup = null
  }
}

export async function boot(): Promise<void> {
  route = routeFromHash()
  const s = getSession()
  if (s) {
    await openDB(s.user.id)
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