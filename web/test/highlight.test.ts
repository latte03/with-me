import assert from 'node:assert/strict'
import { test } from 'node:test'
import { highlightHtml } from '../src/highlight.ts'

// 去掉我们自己插入的 mark 标签后，剩下的必须全是转义实体：不能出现裸 < >，否则就是 XSS
const assertSafe = (html: string) => {
  const rest = html.replaceAll('<mark>', '').replaceAll('</mark>', '')
  assert.ok(!rest.includes('<'), `裸 < : ${html}`)
  assert.ok(!rest.includes('>'), `裸 > : ${html}`)
}

test('中文命中：包裹 mark，其余原样', () => {
  assert.equal(highlightHtml('把阳台那盆薄荷换个盆', '薄荷'), '把阳台那盆<mark>薄荷</mark>换个盆')
})

test('英文大小写不敏感，输出保留原文大小写', () => {
  assert.equal(highlightHtml('Mint Tea and mint', 'mint'), '<mark>Mint</mark> Tea and <mark>mint</mark>')
  assert.equal(highlightHtml('MINT', 'mint'), '<mark>MINT</mark>')
})

test('多命中全部包裹，命中相邻也不重叠', () => {
  assert.equal(highlightHtml('薄荷薄荷', '薄荷'), '<mark>薄荷</mark><mark>薄荷</mark>')
  assert.equal(highlightHtml('ababab', 'ab'), '<mark>ab</mark><mark>ab</mark><mark>ab</mark>')
})

test('空查询与纯空白查询只转义不高亮', () => {
  assert.equal(highlightHtml('薄荷 <b>', ''), '薄荷 &lt;b&gt;')
  assert.equal(highlightHtml('薄荷', '   '), '薄荷')
})

test('无命中时原样转义返回', () => {
  assert.equal(highlightHtml('今天有点累', '薄荷'), '今天有点累')
})

test('<script> 注入：全文与查询词都被转义，mark 只包实体', () => {
  const html = highlightHtml('<script>alert(1)</script>', 'script')
  assert.equal(html, '&lt;<mark>script</mark>&gt;alert(1)&lt;/<mark>script</mark>&gt;')
  assertSafe(html)
  const whole = highlightHtml('<img src=x onerror=alert(1)>', '<img src=x onerror=alert(1)>')
  assert.equal(whole, '<mark>&lt;img src=x onerror=alert(1)&gt;</mark>')
  assertSafe(whole)
})

test('& 与引号：查询词转义后仍能命中，且不破坏实体', () => {
  assert.equal(highlightHtml('茶 & 咖啡', '&'), '茶 <mark>&amp;</mark> 咖啡')
  assert.equal(highlightHtml('他说 "你好"', '"你好"'), '他说 <mark>&quot;你好&quot;</mark>')
  assert.equal(highlightHtml("it's ok", "'"), 'it<mark>&#39;</mark>s ok')
  assertSafe(highlightHtml('a & b "c" <d>', '&'))
})

test('查询词含正则特殊字符不崩，按字面量命中', () => {
  for (const q of ['(', ')', '[', ']', '*', '+', '?', '\\', '^', '$', '.', '|', '{', '}']) {
    const html = highlightHtml(`前 ${q} 后`, q)
    assert.equal(html, `前 <mark>${q}</mark> 后`, `查询词 ${q}`)
    assertSafe(html)
  }
  assert.equal(highlightHtml('a.b 与 axb', 'a.b'), '<mark>a.b</mark> 与 axb')
  assert.equal(highlightHtml('成本 100+ 元', '100+'), '成本 <mark>100+</mark> 元')
})

test('命中点落在转义实体内部时跳过（查询 amp 不该切碎 &amp;）', () => {
  assert.equal(highlightHtml('a & b', 'amp'), 'a &amp; b')
  assert.equal(highlightHtml('amp & b', 'amp'), '<mark>amp</mark> &amp; b')
  assertSafe(highlightHtml('<a> & "b"', 'lt'))
})

test('toLowerCase 会变长的字符只转义不高亮，索引不错位', () => {
  const html = highlightHtml('İstanbul 薄荷', 'istanbul')
  assertSafe(html)
  assert.ok(html.includes('薄荷'))
  // 查询词本身含变长字符时同样退回纯转义，不产出错位的 mark
  assert.equal(highlightHtml('İstanbul', 'İ'), 'İstanbul')
})

test('首尾命中与超长文本不丢字符', () => {
  assert.equal(highlightHtml('薄荷', '薄荷'), '<mark>薄荷</mark>')
  const long = `${' filler '.repeat(200)}薄荷${' tail '.repeat(200)}`
  const html = highlightHtml(long, '薄荷')
  assert.equal(html.replaceAll('<mark>', '').replaceAll('</mark>', ''), long)
  assert.equal(html.match(/<mark>/g)?.length, 1)
})