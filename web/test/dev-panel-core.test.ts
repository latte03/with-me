import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clampTabbarExtra, fmtNum, formatReadings, TABBAR_EXTRA_MAX, TABBAR_EXTRA_MIN } from '../src/dev-panel-core.ts'

test('滑杆区间是契约里的 -40…80，越界钉到端点', () => {
  assert.equal(TABBAR_EXTRA_MIN, -40)
  assert.equal(TABBAR_EXTRA_MAX, 80)
  assert.equal(clampTabbarExtra(24), 24)
  assert.equal(clampTabbarExtra(-24), -24)
  assert.equal(clampTabbarExtra(TABBAR_EXTRA_MIN - 1), TABBAR_EXTRA_MIN)
  assert.equal(clampTabbarExtra(TABBAR_EXTRA_MAX + 1), TABBAR_EXTRA_MAX)
  assert.equal(clampTabbarExtra(-9999), TABBAR_EXTRA_MIN)
  assert.equal(clampTabbarExtra(9999), TABBAR_EXTRA_MAX)
})

test('滑杆取值取整（step=1），字符串与带单位的旧值也认', () => {
  assert.equal(clampTabbarExtra('24'), 24)
  assert.equal(clampTabbarExtra(' 24 '), 24)
  assert.equal(clampTabbarExtra('24px'), 24)
  assert.equal(clampTabbarExtra(24.6), 25)
  assert.equal(clampTabbarExtra(-24.6), -25)
})

test('脏值回 0，绝不把 NaN/Infinity 写进 CSS', () => {
  for (const raw of [null, undefined, '', '   ', 'abc', NaN, Infinity, -Infinity, true, {}]) {
    assert.equal(clampTabbarExtra(raw), 0)
  }
})

test('读数格式化：最多两位小数，缺失/非有限值显示 —', () => {
  assert.equal(fmtNum(812), '812')
  assert.equal(fmtNum(0), '0')
  assert.equal(fmtNum(44.5), '44.5')
  assert.equal(fmtNum(0.125), '0.13')
  assert.equal(fmtNum(1.0000000001), '1')
  assert.equal(fmtNum(-34.25), '-34.25')
  assert.equal(fmtNum(undefined), '—')
  assert.equal(fmtNum(null), '—')
  assert.equal(fmtNum(NaN), '—')
  assert.equal(fmtNum(Infinity), '—')
})

test('复制文本一行一条 label: value', () => {
  const rows = [
    { label: 'innerHeight', value: '812' },
    { label: 'safe-area-inset-bottom', value: '34px' },
  ]
  assert.equal(formatReadings(rows), 'innerHeight: 812\nsafe-area-inset-bottom: 34px')
  assert.equal(formatReadings([]), '')
})