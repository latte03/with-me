// 搜索命中高亮：纯字符串处理，无 DOM，可单测。
// 安全约定：先把全文与查询词整体转义，再在「转义后的串」上包裹 <mark>，
// 因此用户输入里的 < > & " ' 只会以实体形式出现，永远不会被当成标签解析。
// 转义规则与 ui/dom.ts 的 esc 一致；这里不 import 它，避免纯逻辑模块依赖 DOM 原语。
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// 大小写不敏感地把 text 中所有命中 query 的片段包上 <mark>，返回可直接 innerHTML 的字符串。
// 不用正则拼接查询词，所以 ( ) [ ] * + ? \ 等特殊字符不会崩也不会误匹配。
export function highlightHtml(text: string, query: string): string {
  const safe = escapeHtml(text)
  const needle = escapeHtml(query.trim())
  if (!needle) return safe
  const hay = safe.toLowerCase()
  const key = needle.toLowerCase()
  // 极少数 Unicode 字符 toLowerCase 会变长（如 İ），索引会错位；这时只转义不高亮，输出仍是安全 HTML
  if (hay.length !== safe.length || key.length !== needle.length) return safe
  let out = ''
  let from = 0
  let at = 0
  for (;;) {
    const i = hay.indexOf(key, at)
    if (i < 0) break
    at = i + needle.length
    // 命中点落在转义实体内部（查询 amp 撞上 &amp;）时跳过：那不是原文里真的字符
    if (i > 0 && safe.lastIndexOf('&', i - 1) > safe.lastIndexOf(';', i - 1)) continue
    out += `${safe.slice(from, i)}<mark>${safe.slice(i, i + needle.length)}</mark>`
    from = i + needle.length
  }
  return out + safe.slice(from)
}