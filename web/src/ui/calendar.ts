import { onChange } from '../bus.ts'
import { clock, groupByDay, monthGrid, previewOf, visibleMessages, weekOf, weekdayName } from '../projection.ts'
import { getAll } from '../store.ts'
import type { Message, Role } from '../types.ts'
import { el, esc, icon } from './dom.ts'

const pad = (n: number) => String(n).padStart(2, '0')
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function mountCalendar(root: HTMLElement, openMessage: (roleId: string, messageId: string) => void): () => void {
  const view = el(`
    <div class="page cal">
      <header class="page-head">
        <div class="seg mode-seg"><button data-mode="day" class="on">日</button><button data-mode="month">月</button></div>
        <h1 class="head-title center">日历</h1>
        <span class="spacer"></span>
      </header>
      <div class="cal-body"></div>
    </div>`)
  root.appendChild(view)
  const body = view.querySelector('.cal-body') as HTMLElement
  let mode: 'day' | 'month' = 'day'
  let selected = new Date()
  let cursor = new Date()
  let days = new Map<string, Message[]>()
  let roles = new Map<string, Role>()

  view.querySelectorAll('.mode-seg button').forEach((b) =>
    b.addEventListener('click', () => {
      mode = (b as HTMLElement).dataset.mode as 'day' | 'month'
      view.querySelectorAll('.mode-seg button').forEach((x) => x.classList.toggle('on', x === b))
      paint()
    }),
  )

  async function load() {
    const msgs = visibleMessages(await getAll<Message>('messages'))
    days = new Map(groupByDay(msgs))
    roles = new Map((await getAll<Role>('roles')).map((r) => [r.id, r]))
  }

  function dayList(key: string): HTMLElement {
    const wrap = el('<div class="day-list"></div>')
    const d = new Date(`${key}T00:00:00`)
    wrap.appendChild(el(`<h2 class="day-title">${d.getMonth() + 1}月${d.getDate()}日 ${weekdayName(d)}</h2>`))
    const msgs = days.get(key) ?? []
    if (msgs.length === 0) {
      wrap.appendChild(el('<p class="empty">这天没有记录</p>'))
      return wrap
    }
    for (const m of msgs) {
      const r = roles.get(m.role_id)
      const row = el(`
        <button class="day-row">
          <span class="avatar small" style="background:${esc(r?.color ?? '#7c7cf8')}22">${esc(r?.avatar ?? '💬')}</span>
          <span class="day-main"><span class="day-role">${esc(r?.name ?? '已删除角色')}</span><span class="day-preview">${esc(previewOf(m))}</span></span>
          <span class="role-time">${esc(clock(m.created_at))}</span>
        </button>`)
      row.addEventListener('click', () => openMessage(m.role_id, m.id))
      wrap.appendChild(row)
    }
    return wrap
  }

  function paint() {
    body.innerHTML = ''
    const todayKey = keyOf(new Date())
    if (mode === 'day') {
      const week = weekOf(selected)
      const head = el(`
        <div class="cal-nav">
          <h2>${selected.getFullYear()}年${selected.getMonth() + 1}月</h2>
          <span class="spacer"></span>
          <button class="icon-btn prev" aria-label="上一周">${icon('back', 18)}</button>
          <button class="icon-btn next" aria-label="下一周">${icon('back', 18)}</button>
        </div>`)
      head.querySelector('.next')?.classList.add('flip')
      head.querySelector('.prev')?.addEventListener('click', () => {
        selected = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate() - 7)
        paint()
      })
      head.querySelector('.next')?.addEventListener('click', () => {
        selected = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate() + 7)
        paint()
      })
      body.appendChild(head)
      const strip = el('<div class="week-strip"></div>')
      strip.appendChild(el('<div class="week-names">' + '一二三四五六日'.split('').map((w) => `<span>${w}</span>`).join('') + '</div>'))
      const row = el('<div class="week-days"></div>')
      for (const k of week) {
        const d = new Date(`${k}T00:00:00`)
        const cell = el(`<button class="week-day${k === keyOf(selected) ? ' sel' : ''}${k === todayKey ? ' today' : ''}"><span>${d.getDate()}</span>${days.has(k) ? '<i class="dot"></i>' : '<i class="dot none"></i>'}</button>`)
        cell.addEventListener('click', () => {
          selected = d
          paint()
        })
        row.appendChild(cell)
      }
      strip.appendChild(row)
      body.appendChild(strip)
      body.appendChild(dayList(keyOf(selected)))
    } else {
      const y = cursor.getFullYear()
      const m0 = cursor.getMonth()
      const head = el(`
        <div class="cal-nav">
          <h2>${y}年${m0 + 1}月</h2>
          <span class="spacer"></span>
          <button class="icon-btn prev" aria-label="上个月">${icon('back', 18)}</button>
          <button class="icon-btn next flip" aria-label="下个月">${icon('back', 18)}</button>
        </div>`)
      head.querySelector('.prev')?.addEventListener('click', () => {
        cursor = new Date(y, m0 - 1, 1)
        paint()
      })
      head.querySelector('.next')?.addEventListener('click', () => {
        cursor = new Date(y, m0 + 1, 1)
        paint()
      })
      body.appendChild(head)
      const grid = el('<div class="month-grid"></div>')
      grid.appendChild(el('<div class="week-names">' + '一二三四五六日'.split('').map((w) => `<span>${w}</span>`).join('') + '</div>'))
      for (const week of monthGrid(y, m0)) {
        const row = el('<div class="month-week"></div>')
        for (const k of week) {
          if (!k) {
            row.appendChild(el('<div class="month-cell empty-cell"></div>'))
            continue
          }
          const msgs = days.get(k) ?? []
          const d = new Date(`${k}T00:00:00`)
          const cell = el(`
            <button class="month-cell${k === todayKey ? ' today' : ''}">
              <span class="cell-num">${d.getDate()}</span>
              ${msgs.slice(0, 2).map((m) => `<span class="cell-preview">${esc(previewOf(m))}</span>`).join('')}
              ${msgs.length > 2 ? `<span class="cell-more">+${msgs.length - 2}</span>` : ''}
            </button>`)
          cell.addEventListener('click', () => {
            selected = d
            mode = 'day'
            view.querySelectorAll('.mode-seg button').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.mode === 'day'))
            paint()
          })
          row.appendChild(cell)
        }
        grid.appendChild(row)
      }
      const split = el('<div class="cal-split"></div>')
      split.appendChild(grid)
      split.appendChild(dayList(keyOf(selected)))
      body.appendChild(split)
    }
  }

  const off = onChange(() => {
    void load().then(paint)
  })
  void load().then(paint)
  return () => {
    off()
    view.remove()
  }
}