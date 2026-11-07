import assert from 'node:assert/strict'
import { test } from 'node:test'
import { uuid } from '../src/uuid.ts'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test('uuid 是 v4 格式且不重复', () => {
  const set = new Set(Array.from({ length: 2000 }, () => uuid()))
  assert.equal(set.size, 2000)
  for (const id of set) assert.match(id, V4)
})

test('没有 crypto.randomUUID（非安全上下文）时退回 getRandomValues', () => {
  const proto = Object.getPrototypeOf(crypto)
  const desc = Object.getOwnPropertyDescriptor(proto, 'randomUUID')
  assert.ok(desc, 'Node 的 Crypto 应带 randomUUID，才能验证"取走它"的行为')
  delete (proto as { randomUUID?: unknown }).randomUUID
  try {
    assert.equal(typeof crypto.randomUUID, 'undefined')
    const id = uuid()
    assert.match(id, V4)
    assert.notEqual(uuid(), id)
  } finally {
    Object.defineProperty(proto, 'randomUUID', desc)
  }
  assert.equal(typeof crypto.randomUUID, 'function')
})
