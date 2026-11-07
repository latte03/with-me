import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pureSha256Hex, sha256Hex } from '../src/hash.ts'

const hex = (s: string): string => pureSha256Hex(new TextEncoder().encode(s))
const encode = async (buf: ArrayBuffer): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('')

test('sha256 已知向量', () => {
  assert.equal(hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(
    hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  )
})

test('纯 JS 实现与 crypto.subtle 逐字节一致（含分块边界）', async () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 100_000]) {
    // getRandomValues 单次上限 64KB，这里用可复现的字节序列
    const data = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 0xff)
    const expect_ = await encode(data.buffer)
    assert.equal(pureSha256Hex(data), expect_, `n=${n}`)
    assert.equal(await sha256Hex(data.buffer), expect_, `sha256Hex n=${n}`)
  }
})
