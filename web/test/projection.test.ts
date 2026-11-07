import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyOp, dayKey, groupByDay, monthGrid, searchLocal, timeLabel, weekOf } from '../src/projection.ts'
import type { Envelope, Message, Projection, Role } from '../src/types.ts'

const empty = (): Projection => ({ roles: {}, messages: {} })
const env = (type: Envelope['type'], payload: unknown, seq = 1): Envelope =>
  ({ op_id: `op-${seq}`, device_id: 'd1', seq, client_created_at: '2026-11-07T00:00:00Z', type, payload }) as Envelope

const role = (id: string): Role => ({
  id,
  name: '随手记',
  avatar: '✏️',
  color: '#7c7cf8',
  pinned: false,
  hidden: false,
  created_at: '2026-11-07T01:00:00Z',
  updated_at: '2026-11-07T01:00:00Z',
})

const msg = (id: string, over: Partial<Message> = {}): Message => ({
  id,
  role_id: 'r1',
  type: 'text',
  text: '你好',
  attachment_ref: '',
  side: 'right',
  todo_done: false,
  created_at: '2026-11-07T01:50:00Z',
  updated_at: '2026-11-07T01:50:00Z',
  ...over,
})

test('role create/update/delete tombstone', () => {
  const p = empty()
  applyOp(p, env('role.create', role('r1')))
  applyOp(p, env('role.update', { id: 'r1', updated_at: 't2', fields: { name: '灵感', pinned: true } }, 2))
  assert.equal(p.roles.r1.name, '灵感')
  assert.equal(p.roles.r1.pinned, true)
  applyOp(p, env('role.delete', { id: 'r1', updated_at: 't3' }, 3))
  assert.equal(p.roles.r1.deleted, true)
})

test('LWW follows apply (cursor) order, not client clocks', () => {
  const p = empty()
  applyOp(p, env('message.create', msg('m1')))
  applyOp(p, env('message.update', { id: 'm1', updated_at: '2030-01-01T00:00:00Z', fields: { text: '早写但后接受' } }, 2))
  applyOp(p, env('message.update', { id: 'm1', updated_at: '2020-01-01T00:00:00Z', fields: { text: '晚写但先接受' } }, 3))
  assert.equal(p.messages.m1.text, '晚写但先接受')
})

test('todo set_done and delete tombstone', () => {
  const p = empty()
  applyOp(p, env('message.create', msg('m1', { type: 'todo' })))
  applyOp(p, env('todo.set_done', { id: 'm1', done: true, updated_at: 't2' }, 2))
  assert.equal(p.messages.m1.todo_done, true)
  applyOp(p, env('message.delete', { id: 'm1', updated_at: 't3' }, 3))
  assert.equal(p.messages.m1.deleted, true)
  applyOp(p, env('todo.set_done', { id: 'm1', done: false, updated_at: 't4' }, 4))
  assert.equal(p.messages.m1.deleted, true)
})

test('update of unknown id is ignored', () => {
  const p = empty()
  applyOp(p, env('message.update', { id: 'nope', updated_at: 't', fields: { text: 'x' } }))
  assert.deepEqual(p.messages, {})
})

test('groupByDay sorts days and filters tombstones', () => {
  const msgs = [
    msg('b', { created_at: '2026-11-08T02:00:00Z' }),
    msg('a', { created_at: '2026-11-07T02:00:00Z' }),
    msg('del', { deleted: true }),
  ]
  const groups = groupByDay(msgs)
  assert.equal(groups.length, 2)
  assert.equal(groups[0][1][0].id, 'a')
  assert.equal(groups[1][1][0].id, 'b')
})

test('monthGrid covers whole month monday-first', () => {
  const weeks = monthGrid(2026, 10)
  const flat = weeks.flat().filter((x): x is string => x !== null)
  assert.equal(flat.length, 30)
  assert.equal(flat[0], '2026-11-01')
  assert.equal(flat[29], '2026-11-30')
  assert.equal(weeks[0].filter((x) => x === null).length, 6)
  for (const w of weeks) assert.equal(w.length, 7)
})

test('weekOf returns monday..sunday containing date', () => {
  const week = weekOf(new Date(2026, 10, 7))
  assert.equal(week[0], '2026-11-02')
  assert.equal(week[6], '2026-11-08')
})

test('searchLocal substring chinese, deleted filtered, desc order', () => {
  const msgs = [
    msg('a', { text: '今天吃了火锅', created_at: '2026-11-07T01:00:00Z' }),
    msg('b', { text: '火锅真好吃', created_at: '2026-11-08T01:00:00Z' }),
    msg('c', { text: '火锅', deleted: true }),
    msg('d', { text: '无关' }),
  ]
  const res = searchLocal(msgs, { r1: role('r1') }, '火锅')
  assert.deepEqual(res.map((r) => r.message_id), ['b', 'a'])
  assert.equal(res[0].role_name, '随手记')
  assert.ok(res[0].snippet.includes('火锅'))
})

test('dayKey and timeLabel', () => {
  const iso = new Date(2026, 10, 7, 1, 50).toISOString()
  assert.equal(dayKey(iso), '2026-11-07')
  assert.equal(timeLabel(iso, new Date(2026, 10, 7, 9, 0)), '01:50')
  assert.equal(timeLabel(iso, new Date(2026, 10, 8, 9, 0)), '昨天 01:50')
  assert.equal(timeLabel(iso, new Date(2026, 10, 12, 9, 0)), '周六 01:50')
})