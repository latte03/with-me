import type { Envelope, Message, Projection, Role, SearchResult } from './types.ts'

export function applyOp(p: Projection, env: Envelope): void {
  switch (env.type) {
    case 'role.create':
      p.roles[env.payload.id] = { ...env.payload }
      break
    case 'role.update': {
      const r = p.roles[env.payload.id]
      if (r) Object.assign(r, env.payload.fields, { updated_at: env.payload.updated_at })
      break
    }
    case 'role.delete': {
      const r = p.roles[env.payload.id]
      if (r) {
        r.deleted = true
        r.updated_at = env.payload.updated_at
      }
      break
    }
    case 'message.create':
      p.messages[env.payload.id] = { ...env.payload }
      break
    case 'message.update': {
      const m = p.messages[env.payload.id]
      if (m) Object.assign(m, env.payload.fields, { updated_at: env.payload.updated_at })
      break
    }
    case 'message.delete': {
      const m = p.messages[env.payload.id]
      if (m) {
        m.deleted = true
        m.updated_at = env.payload.updated_at
      }
      break
    }
    case 'todo.set_done': {
      const m = p.messages[env.payload.id]
      if (m) {
        m.todo_done = env.payload.done
        m.updated_at = env.payload.updated_at
      }
      break
    }
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

export function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function weekdayName(d: Date): string {
  return '周' + '日一二三四五六'[d.getDay()]
}

export function clock(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function timeLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(now) - startOf(d)) / 86400000)
  if (days === 0) return clock(iso)
  if (days === 1) return `昨天 ${clock(iso)}`
  if (days > 1 && days < 7) return `${weekdayName(d)} ${clock(iso)}`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${clock(iso)}`
}

export function shortDay(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86400000,
  )
  if (days === 0) return clock(iso)
  if (days === 1) return '昨天'
  if (days > 1 && days < 7) return weekdayName(d)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function previewOf(m: Message): string {
  if (m.type === 'image') return m.text ? `[图片] ${m.text}` : '[图片]'
  if (m.type === 'todo') return `${m.todo_done ? '✓' : '☐'} ${m.text}`
  return m.text
}

export function visibleMessages(msgs: Message[]): Message[] {
  return msgs.filter((m) => !m.deleted).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
}

export function visibleRoles(roles: Role[]): Role[] {
  return roles.filter((r) => !r.deleted)
}

export function groupByDay(msgs: Message[]): [string, Message[]][] {
  const map = new Map<string, Message[]>()
  for (const m of visibleMessages(msgs)) {
    const k = dayKey(m.created_at)
    const arr = map.get(k)
    if (arr) arr.push(m)
    else map.set(k, [m])
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

export function monthGrid(year: number, month0: number): (string | null)[][] {
  const first = new Date(year, month0, 1)
  const lead = (first.getDay() + 6) % 7
  const days = new Date(year, month0 + 1, 0).getDate()
  const cells: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= days; d++) cells.push(`${year}-${pad(month0 + 1)}-${pad(d)}`)
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

export function weekOf(d: Date): string[] {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
  })
}

export function snippetAround(text: string, q: string): string {
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return text.slice(0, 60)
  const start = Math.max(0, i - 20)
  return (start > 0 ? '…' : '') + text.slice(start, i + q.length + 40)
}

export function searchLocal(msgs: Message[], roles: Record<string, Role>, q: string): SearchResult[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return []
  return visibleMessages(msgs)
    .filter((m) => m.text.toLowerCase().includes(needle))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 50)
    .map((m) => ({
      message_id: m.id,
      role_id: m.role_id,
      role_name: roles[m.role_id]?.name ?? '',
      text: m.text,
      created_at: m.created_at,
      snippet: snippetAround(m.text, q.trim()),
    }))
}

export function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}