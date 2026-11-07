import { getSession } from './api.ts'
import { closeDB, openDB } from './store.ts'
import { startSync } from './sync.ts'
import { mountAuth } from './ui/auth.ts'
import { mountCalendar } from './ui/calendar.ts'
import { mountChat } from './ui/chat.ts'
import { mountChats } from './ui/chats.ts'
import { el, icon } from './ui/dom.ts'
import { mountSearch } from './ui/search.ts'
import { mountSettings } from './ui/settings.ts'

export type Route =
  | { view: 'chats' }
  | { view: 'chat'; roleId: string; highlight?: string }
  | { view: 'calendar' }
  | { view: 'search' }
  | { view: 'settings' }

let route: Route = { view: 'chats' }
let cleanup: (() => void) | null = null
const app = document.getElementById('app') as HTMLElement

export function nav(r: Route): void {
  route = r
  render()
}

function render(): void {
  cleanup?.()
  cleanup = null
  app.innerHTML = ''
  if (!getSession()) {
    cleanup = mountAuth(app, () => void boot())
    return
  }
  if (route.view === 'chat') {
    cleanup = mountChat(app, route.roleId, route.highlight, () => nav({ view: 'chats' }))
    return
  }
  if (route.view === 'search') {
    cleanup = mountSearch(app, (roleId, messageId) => nav({ view: 'chat', roleId, highlight: messageId }), () => nav({ view: 'chats' }))
    return
  }
  const shell = el(`
    <div class="shell">
      <main class="view"></main>
      <nav class="tabbar">
        <button class="tab" data-tab="chats">${icon('chat', 22)}<span>聊天</span></button>
        <button class="tab" data-tab="calendar">${icon('calendar', 22)}<span>日历</span></button>
        <button class="tab" data-tab="settings">${icon('gear', 22)}<span>设置</span></button>
      </nav>
    </div>`)
  app.appendChild(shell)
  const main = shell.querySelector('.view') as HTMLElement
  shell.querySelectorAll('.tab').forEach((b) => {
    const t = (b as HTMLElement).dataset.tab as Route['view']
    b.classList.toggle('active', route.view === t)
    b.addEventListener('click', () => nav({ view: t } as Route))
  })
  if (route.view === 'chats') cleanup = mountChats(main, (r) => nav(r))
  else if (route.view === 'calendar') cleanup = mountCalendar(main, (roleId, messageId) => nav({ view: 'chat', roleId, highlight: messageId }))
  else cleanup = mountSettings(main, () => nav({ view: 'chats' }))
}

export async function boot(): Promise<void> {
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
  render()
})