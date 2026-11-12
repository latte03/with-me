// 图标检索纯逻辑（无 DOM，便于单测）：中文名子串 / keywords 切词子串 / id 小写子串，可与分类叠加。
import type { IconMeta } from './role-icons.ts'

export const ALL_CATEGORIES = '全部'

// keywords 用「、」/中英文逗号/空白分隔；空串切出 []（而不是 ['']），空查询另有短路，不会误命中
export function keywordTokens(keywords: string): string[] {
  return keywords.split(/[、,，\s]+/).filter((t) => t !== '')
}

export function matchIcon(meta: IconMeta, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  if (meta.name.toLowerCase().includes(q)) return true
  if (meta.id.toLowerCase().includes(q)) return true
  return keywordTokens(meta.keywords).some((t) => t.toLowerCase().includes(q))
}

// cat 为「全部」或空串时不限分类；查询与分类是 AND 关系
export function filterIcons(list: readonly IconMeta[], query: string, cat: string = ALL_CATEGORIES): IconMeta[] {
  const anyCat = cat === '' || cat === ALL_CATEGORIES
  return list.filter((m) => (anyCat || m.cat === cat) && matchIcon(m, query))
}

// 分类按目录原顺序去重（生成数据已按官方目录排序）
export function iconCategories(list: readonly IconMeta[]): string[] {
  return [...new Set(list.map((m) => m.cat))]
}