import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ICON_CATALOG } from '../src/generated/icon-catalog.ts'
import { ICON_SVG } from '../src/generated/role-icons.ts'
import {
  ICON_PREFIX,
  iconAvatar,
  iconId,
  iconSvg,
  iconsLoaded,
  loadIconCatalog,
  loadRoleIcons,
  onIconsLoaded,
} from '../src/role-icons.ts'

const COUNT = 731
// 顺序与 web/vendor/naive-icons/catalog.md 的 18 个分类标题一致
const CATS = [
  '界面基础', '操作', '文件与媒体', '导航方位', '通信', '自然天气', '动物', '食物饮品', '金融',
  '日常物品', '办公', '设备硬件', '建筑场所', '工具', '健康医疗', '运动', '交通工具', '表情',
]
const TAGS = new Set(['path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon', 'g'])

test('iconId 只认 naive: 前缀 + 合法 id', () => {
  assert.equal(ICON_PREFIX, 'naive:')
  assert.equal(iconId('naive:penguin'), 'penguin')
  assert.equal(iconId('naive:alarm-clock'), 'alarm-clock')
  assert.equal(iconId('naive:a1-b2'), 'a1-b2')
})

test('iconId 对 emoji、空 id 与脏字符串返回 null', () => {
  const bad = [
    '💬', '🔖', '', 'penguin', 'xnaive:penguin', 'NAIVE:penguin', 'naive', 'naive:',
    'naive: penguin', 'naive:penguin ', 'naive:pen guin', 'naive:pen\tguin', 'naive:pen\nguins',
    'naive:pen"guin', "naive:pen'guin", 'naive:pen<guin', 'naive:Penguin', 'naive:pen_guin',
    'naive:pen.guin', 'naive:企鹅', 'naive:../etc/passwd', 'naive:penguin?x=1',
  ]
  for (const avatar of bad) assert.equal(iconId(avatar), null, `应拒绝 ${JSON.stringify(avatar)}`)
})

test('iconAvatar 与 iconId 往返一致（含全量 731 个 id）', () => {
  assert.equal(iconAvatar('penguin'), 'naive:penguin')
  assert.equal(iconId(iconAvatar('penguin')), 'penguin')
  for (const meta of ICON_CATALOG) assert.equal(iconId(iconAvatar(meta.id)), meta.id)
})

test('生成数据：731 枚图标，目录与 svg 表 id 集合一致', () => {
  assert.equal(ICON_CATALOG.length, COUNT)
  const ids = Object.keys(ICON_SVG)
  assert.equal(ids.length, COUNT)
  assert.deepEqual(new Set(ids), new Set(ICON_CATALOG.map((m) => m.id)))
  assert.equal(new Set(ICON_CATALOG.map((m) => m.id)).size, COUNT, '目录 id 不应重复')
  for (const meta of ICON_CATALOG) {
    assert.ok(meta.name.trim(), `${meta.id} 中文名不应为空`)
    assert.ok(CATS.includes(meta.cat), `${meta.id} 分类未知：${meta.cat}`)
    assert.match(meta.id, /^[a-z0-9-]+$/)
    assert.notEqual(meta.keywords, '—', '目录占位符不应进检索词')
  }
  assert.deepEqual([...new Set(ICON_CATALOG.map((m) => m.cat))], CATS, '分类顺序应与 catalog.md 一致')
})

test('生成数据：内部标记不含外层 svg、脚本与事件属性', () => {
  for (const [id, markup] of Object.entries(ICON_SVG)) {
    assert.ok(markup.includes('<'), `${id} 内部标记为空`)
    assert.ok(!/<\/?svg/i.test(markup), `${id} 残留外层 svg 标签`)
    assert.ok(!/script/i.test(markup), `${id} 含 script`)
    assert.ok(!/\bon\w+\s*=/i.test(markup), `${id} 含事件属性`)
    assert.ok(!/href|xlink/i.test(markup), `${id} 含外链`)
    assert.ok(!/\s{2,}/.test(markup), `${id} 空白未折叠`)
    assert.equal(markup, markup.trim(), `${id} 首尾有多余空白`)
    for (const m of markup.matchAll(/<\s*\/?\s*([A-Za-z][\w:-]*)/g)) {
      assert.ok(TAGS.has(m[1]), `${id} 含不允许的标签 <${m[1]}>`)
    }
  }
})

// 以下三组用例依赖模块加载状态，顺序不可调换：未加载 → 加载 → 已加载
test('未加载时 iconsLoaded 为 false、iconSvg 为 null、回调不立即触发', () => {
  assert.equal(iconsLoaded(), false)
  assert.equal(iconSvg('penguin'), null)
  let calls = 0
  const off = onIconsLoaded(() => calls++)
  assert.equal(calls, 0)
  assert.equal(typeof off, 'function')
  off()
})

test('loadRoleIcons 并发共享同一 promise，只加载一次', async () => {
  let a = 0
  let b = 0
  let canceled = 0
  onIconsLoaded(() => a++)
  onIconsLoaded(() => b++)
  const off = onIconsLoaded(() => canceled++)
  off()

  const p1 = loadRoleIcons()
  const p2 = loadRoleIcons()
  const p3 = loadRoleIcons()
  assert.equal(p1, p2, '并发调用应共享同一 promise')
  assert.equal(p2, p3)
  await Promise.all([p1, p2, p3])

  assert.equal(iconsLoaded(), true)
  assert.equal(a, 1, '加载完成回调只触发一次')
  assert.equal(b, 1)
  assert.equal(canceled, 0, '已取消的回调不应触发')

  const svg = iconSvg('penguin')
  assert.ok(svg && svg.length > 0)
  assert.ok(svg.includes('<'))
  assert.equal(iconSvg('不存在'), null)
  assert.equal(iconSvg(''), null)
  assert.equal(iconSvg('constructor'), null, '原型链键不是图标')
  assert.equal(iconSvg('toString'), null)

  await loadRoleIcons()
  assert.equal(a, 1, '已加载后不应重复加载或重复通知')
  assert.equal(b, 1)
})

test('onIconsLoaded 已加载时立即同步回调，取消后不再回调', async () => {
  let calls = 0
  const off = onIconsLoaded(() => calls++)
  assert.equal(calls, 1, '注册时已加载应立即同步调用一次')
  off()
  off()
  await loadRoleIcons()
  assert.equal(calls, 1, '取消后不再回调')
})

test('loadIconCatalog 记忆化返回 731 条，首条是闹钟', async () => {
  const p1 = loadIconCatalog()
  const p2 = loadIconCatalog()
  assert.equal(p1, p2, '并发调用应共享同一 promise')
  const list = await p1
  assert.equal(list.length, COUNT)
  assert.deepEqual(list[0], { id: 'alarm-clock', name: '闹钟', keywords: '闹钟', cat: '界面基础' })
  assert.equal(await loadIconCatalog(), list, '已加载应返回同一份数据')
})
