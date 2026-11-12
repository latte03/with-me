import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clampTabbarExtra, DEV_PANEL_KEY, devPanelRequested, fmtNum, formatReadings, TABBAR_EXTRA_MAX, TABBAR_EXTRA_MIN } from '../src/dev-panel-core.ts'

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

test('面板主开关：stored 键与 ?dev 四种组合', () => {
  assert.equal(DEV_PANEL_KEY, 'with-me.dev.panel')
  // 都不给 = 生产默认，零痕迹
  assert.equal(devPanelRequested('', null), false)
  // 设置页勾选（主屏 PWA 无 query 也开）
  assert.equal(devPanelRequested('', '1'), true)
  // 旧的 URL 入口
  assert.equal(devPanelRequested('?dev=1', null), true)
  // 两者同时给不冲突
  assert.equal(devPanelRequested('?dev=1', '1'), true)
})

test('面板主开关：只认 dev 参数与 stored===1，其它参数/脏值/hash 都不算', () => {
  // 混在其它参数里也认，参数顺序无关
  assert.equal(devPanelRequested('?foo=bar&dev=1', null), true)
  assert.equal(devPanelRequested('?dev=1&foo=bar', null), true)
  // 契约是 has('dev')：dev=0 / 空值同样开闸
  assert.equal(devPanelRequested('?dev=0', null), true)
  assert.equal(devPanelRequested('?dev', null), true)
  // 名字里带 dev 不算
  assert.equal(devPanelRequested('?nodev=1', null), false)
  assert.equal(devPanelRequested('?devx=1', null), false)
  assert.equal(devPanelRequested('?foo=bar', null), false)
  // stored 只认字符串 '1'
  for (const stored of [null, '', '0', 'true', '1 ', 1]) {
    assert.equal(devPanelRequested('', stored as string | null), false)
  }
  // hash 路由不参与判定：#/chat/dev 之类不该开闸，query 才是入口
  assert.equal(devPanelRequested('#/settings', null), false)
  assert.equal(devPanelRequested('#/chat/dev', null), false)
  assert.equal(devPanelRequested('?x=1#/dev', null), false)
  assert.equal(devPanelRequested('#/settings', '1'), true)
  assert.equal(devPanelRequested('?dev=1#/chat/abc', null), true)
})