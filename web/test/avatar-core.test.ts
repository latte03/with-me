import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AVATAR_FALLBACK, ICON_SVG_OPEN, avatarInner } from '../src/avatar-core.ts'
import { ICON_CATALOG } from '../src/generated/icon-catalog.ts'
import { ICON_SVG } from '../src/generated/role-icons.ts'
import { iconAvatar, iconSvg, iconsLoaded, loadRoleIcons } from '../src/role-icons.ts'

// avatar 来自同步数据，属不可信输入：这些脏值一律只能变成转义文本或兜底，绝不能产出可执行 markup
const DIRTY = [
  'naive:<img src=x onerror=alert(1)>',
  'naive:"><script>alert(1)</script>',
  'naive:cat"onload="alert(1)',
  "naive:cat' style='background:url(x)",
  'naive:cat</svg><script>alert(1)</script>',
  'naive:<svg/onload=alert(1)>',
  'naive:cat&amp;dog',
  'naive:CAT',
  'naive:cat ',
  'naive:../etc/passwd',
  'naive:cat\u0000',
  'naive:',
  '<img src=x onerror=alert(1)>',
  '"><script>alert(1)</script>',
]

const assertTextOnly = (out: string, input: string): void => {
  assert.ok(!out.includes('<'), `${JSON.stringify(input)} 产出了裸 <：${out}`)
  assert.ok(!out.includes('>'), `${JSON.stringify(input)} 产出了裸 >：${out}`)
  assert.ok(!out.includes('"'), `${JSON.stringify(input)} 产出了裸引号：${out}`)
  assert.ok(!out.includes("'"), `${JSON.stringify(input)} 产出了裸单引号：${out}`)
  assert.ok(!out.startsWith('<svg'), `${JSON.stringify(input)} 不应被当成图标渲染`)
}

test('兜底常量与 emoji 原样输出', () => {
  assert.equal(AVATAR_FALLBACK, '💬')
  assert.equal(avatarInner('💬'), '💬')
  assert.equal(avatarInner('🔖'), '🔖')
  assert.equal(avatarInner('✏️'), '✏️')
  assert.equal(avatarInner('👨‍👩‍👧'), '👨‍👩‍👧')
  assert.equal(avatarInner(''), AVATAR_FALLBACK)
})

test('emoji 分支按 HTML 文本转义', () => {
  assert.equal(avatarInner('a&b'), 'a&amp;b')
  assert.equal(avatarInner('<b>'), '&lt;b&gt;')
  assert.equal(avatarInner('"\''), '&quot;&#39;')
  for (const dirty of DIRTY) assertTextOnly(avatarInner(dirty), dirty)
})

test('图标外壳是统一的 48×48 wrapper（描边近黑，配浅色纸底）', () => {
  assert.ok(ICON_SVG_OPEN.startsWith('<svg viewBox="0 0 48 48"'))
  assert.ok(ICON_SVG_OPEN.includes('fill="none"'))
  assert.ok(ICON_SVG_OPEN.includes('stroke="#2A2A2A"'))
  assert.ok(ICON_SVG_OPEN.includes('stroke-width="3.5"'))
  assert.ok(ICON_SVG_OPEN.includes('stroke-linecap="round"'))
  assert.ok(ICON_SVG_OPEN.includes('stroke-linejoin="round"'))
  assert.ok(ICON_SVG_OPEN.includes('aria-hidden="true"'))
  assert.ok(ICON_SVG_OPEN.endsWith('>'))
})

// 以下用例依赖模块加载状态，顺序不可调换：未加载 → 加载 → 已加载
test('注册表未加载时图标走兜底，脏值仍只产出文本', () => {
  assert.equal(iconsLoaded(), false)
  assert.equal(avatarInner('naive:cat'), AVATAR_FALLBACK)
  assert.equal(avatarInner('naive:penguin'), AVATAR_FALLBACK)
  for (const dirty of DIRTY) assertTextOnly(avatarInner(dirty), dirty)
})

test('加载注册表', async () => {
  await loadRoleIcons()
  assert.equal(iconsLoaded(), true)
})

test('加载后图标 = 统一外壳 + 注册表内部标记，全量 731 枚一致', () => {
  const cat = avatarInner('naive:cat')
  assert.ok(cat.startsWith('<svg viewBox="0 0 48 48"'), cat.slice(0, 60))
  assert.ok(cat.endsWith('</svg>'))
  assert.ok(cat.includes(iconSvg('cat') as string), '应原样嵌入注册表内部标记')
  assert.equal(cat, `${ICON_SVG_OPEN}${ICON_SVG['cat']}</svg>`)
  assert.equal((cat.match(/<svg/g) ?? []).length, 1, '只应有一层外层 svg')
  for (const meta of ICON_CATALOG) {
    const out = avatarInner(iconAvatar(meta.id))
    assert.equal(out, `${ICON_SVG_OPEN}${ICON_SVG[meta.id]}</svg>`, `${meta.id} 渲染与注册表不一致`)
    assert.ok(!out.includes('naive:'), `${meta.id} 不应把 avatar 原文拼进 markup`)
  }
})

test('未知 id 与原型链键仍走兜底', () => {
  for (const id of ['nope-not-here', 'constructor', 'tostring', 'valueof', 'cat2', 'zzz']) {
    assert.equal(avatarInner(`naive:${id}`), AVATAR_FALLBACK, `naive:${id} 应兜底`)
  }
  // 非法 id（含中文/下划线/大写）连图标分支都进不去，只能是转义文本
  assert.equal(avatarInner('naive:不存在的图标'), 'naive:不存在的图标')
  assert.equal(avatarInner('naive:__proto__'), 'naive:__proto__')
  assert.equal(avatarInner('naive:toString'), 'naive:toString')
})

test('注入防护：已加载后脏值不得产出可执行 markup', () => {
  for (const dirty of DIRTY) {
    const out = avatarInner(dirty)
    assertTextOnly(out, dirty)
    assert.ok(!out.includes('<svg'), `${JSON.stringify(dirty)} 不应渲染成图标`)
  }
  // 合法 id 后面挂尾巴 / 大小写变体都不能借道注册表
  assert.equal(avatarInner('naive:cat<script>alert(1)</script>'), 'naive:cat&lt;script&gt;alert(1)&lt;/script&gt;')
  assert.equal(avatarInner('naive:CAT'), 'naive:CAT')
  assert.equal(avatarInner('naive:cat"'), 'naive:cat&quot;')
})