import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ICON_CATALOG } from '../src/generated/icon-catalog.ts'
import { ALL_CATEGORIES, filterIcons, iconCategories, keywordTokens, matchIcon } from '../src/icon-search.ts'
import type { IconMeta } from '../src/role-icons.ts'

const ids = (list: readonly IconMeta[]): string[] => list.map((m) => m.id)
const find = (id: string): IconMeta => {
  const meta = ICON_CATALOG.find((m) => m.id === id)
  assert.ok(meta, `目录里应有 ${id}`)
  return meta
}
// 不依赖生成数据的合成条目：验证纯函数本身
const fake: IconMeta = { id: 'fake-thing', name: '假图标', keywords: '甲、乙、fake', cat: '合成分类' }

test('keywordTokens 按「、」/中英文逗号/空白切词，空串切出空数组', () => {
  assert.deepEqual(keywordTokens(''), [])
  assert.deepEqual(keywordTokens('   '), [])
  assert.deepEqual(keywordTokens('猫、宠物,cat，pet dog'), ['猫', '宠物', 'cat', 'pet', 'dog'])
  assert.deepEqual(keywordTokens('闹钟'), ['闹钟'])
})

test('空查询命中全部（含 keywords 为空串的条目）', () => {
  assert.equal(filterIcons(ICON_CATALOG, '').length, 731)
  assert.equal(filterIcons(ICON_CATALOG, '   ').length, 731)
  assert.equal(matchIcon(find('bell-ring'), ''), true)
  assert.equal(matchIcon(fake, ''), true)
})

test('中文名子串匹配', () => {
  assert.deepEqual(ids(filterIcons(ICON_CATALOG, '猫')), ['cat', 'owl'])
  assert.equal(matchIcon(find('cat'), '小'), true)
  assert.equal(matchIcon(find('owl'), '头鹰'), true)
  assert.equal(matchIcon(fake, '假图'), true)
  assert.equal(matchIcon(fake, '图标假'), false, '子串不是子序列')
})

test('keywords 切词后子串匹配，跨词不算命中', () => {
  assert.deepEqual(ids(filterIcons(ICON_CATALOG, '旅行')), ['map', 'airplane'])
  assert.deepEqual(ids(filterIcons(ICON_CATALOG, '宠物')), ['cat', 'dog'])
  const bell = find('bell')
  assert.equal(matchIcon(bell, '提醒'), true)
  assert.equal(matchIcon(bell, '铃'), true, '词内子串也算命中')
  assert.equal(matchIcon(bell, '通知提醒'), false, '跨两个词的拼接不应命中')
  assert.equal(matchIcon(bell, '、'), false, '分隔符本身不是检索词')
  assert.equal(matchIcon(fake, '乙'), true)
})

test('英文 id 子串匹配且大小写不敏感', () => {
  const lower = ids(filterIcons(ICON_CATALOG, 'cat'))
  assert.ok(lower.includes('cat'))
  assert.ok(lower.includes('location'), 'id 子串匹配不是全等')
  assert.deepEqual(ids(filterIcons(ICON_CATALOG, 'CAT')), lower)
  assert.deepEqual(ids(filterIcons(ICON_CATALOG, '  Penguin  ')), ids(filterIcons(ICON_CATALOG, 'penguin')))
  assert.deepEqual(ids(filterIcons(ICON_CATALOG, 'penguin')), ['penguin'])
  assert.equal(matchIcon(fake, 'FAKE'), true)
  assert.equal(matchIcon(find('cat'), '宠物猫'), false)
})

test('分类与查询可叠加（AND）', () => {
  assert.deepEqual(ids(filterIcons(ICON_CATALOG, '猫', '动物')), ['cat', 'owl'])
  assert.deepEqual(filterIcons(ICON_CATALOG, '猫', '食物饮品'), [])
  assert.deepEqual(ids(filterIcons(ICON_CATALOG, '旅行', '交通工具')), ['airplane'])
  assert.equal(filterIcons(ICON_CATALOG, '', '动物').length, 41)
  assert.ok(filterIcons(ICON_CATALOG, '', '动物').every((m) => m.cat === '动物'))
  assert.equal(filterIcons(ICON_CATALOG, '', ALL_CATEGORIES).length, 731)
  assert.equal(filterIcons(ICON_CATALOG, '', '').length, 731, '空分类等同全部')
  assert.deepEqual(filterIcons(ICON_CATALOG, '', '不存在的分类'), [])
})

test('无命中返回空数组', () => {
  assert.deepEqual(filterIcons(ICON_CATALOG, 'zzz没有这个词'), [])
  assert.deepEqual(filterIcons(ICON_CATALOG, '<script>'), [])
  assert.equal(matchIcon(fake, '丙'), false)
})

test('keywords 为空串的 29 条不会被非空查询误命中', () => {
  const empty = ICON_CATALOG.filter((m) => m.keywords === '')
  assert.equal(empty.length, 29)
  for (const meta of empty) {
    assert.equal(matchIcon(meta, '宠物'), false, `${meta.id} 空 keywords 不应命中`)
    assert.equal(matchIcon(meta, '、'), false, `${meta.id} 空 keywords 不应命中分隔符`)
    assert.equal(matchIcon(meta, ' '), true, `${meta.id} 纯空白查询等同空查询`)
    // 空 keywords 仍可按中文名 / id 检索
    assert.equal(matchIcon(meta, meta.name), true, `${meta.id} 中文名应可检索`)
    assert.equal(matchIcon(meta, meta.id), true, `${meta.id} id 应可检索`)
  }
  assert.deepEqual(ids(filterIcons(ICON_CATALOG, '龙虾')), ['lobster'])
})

test('iconCategories 按目录原顺序去重出 18 个分类', () => {
  const cats = iconCategories(ICON_CATALOG)
  assert.equal(cats.length, 18)
  assert.equal(cats[0], '界面基础')
  assert.equal(cats[6], '动物')
  assert.deepEqual(cats, [...new Set(ICON_CATALOG.map((m) => m.cat))])
  assert.deepEqual(iconCategories([]), [])
  assert.deepEqual(iconCategories([fake, { ...fake, id: 'other' }]), ['合成分类'])
})

test('filterIcons 不改动入参数组', () => {
  const before = ICON_CATALOG.length
  filterIcons(ICON_CATALOG, '猫', '动物')
  assert.equal(ICON_CATALOG.length, before)
  assert.deepEqual(ids(filterIcons([fake], '甲')), ['fake-thing'])
})