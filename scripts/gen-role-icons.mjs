// 从 web/vendor/naive-icons 生成角色图标数据（web/src/generated/*.ts）。
// 纯 Node、零依赖、确定性输出：同样的 vendor 输入永远产出同样的字节。
// 用法：node scripts/gen-role-icons.mjs（dev/build/test 脚本已显式串上）
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendorDir = join(repoRoot, 'web', 'vendor', 'naive-icons')
const svgDir = join(vendorDir, 'svg')
const outDir = join(repoRoot, 'web', 'src', 'generated')

const EXPECTED_COUNT = 731
const ALLOWED_TAGS = new Set(['path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon', 'g'])
const ID_RE = /^[a-z0-9-]+$/
// 第三方数据边界：内部标记里出现这些一律拒绝（事件属性、脚本、外链、命名空间引用）
const FORBIDDEN = [
  [/\bon\w+\s*=/i, '事件属性 on*='],
  [/<\s*script/i, '<script'],
  [/href/i, 'href'],
  [/xlink/i, 'xlink'],
]

function fail(msg) {
  console.error(`[gen-role-icons] ${msg}`)
  process.exit(1)
}

// 单引号字面量：svg 属性用双引号，无需转义，比 JSON 双引号省约 12% 字节。
// 万一出现单引号/反斜杠/换行则退回 JSON.stringify 的转义，保证产物永远是合法 TS。
function tsString(s) {
  return /['\\\r\n]/.test(s) ? JSON.stringify(s) : `'${s}'`
}

function readVersion() {
  const version = readFileSync(join(vendorDir, 'VERSION'), 'utf8').trim()
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`VERSION 内容不是语义化版本号：${JSON.stringify(version)}`)
  return version
}

// catalog.md：18 个「## 分类名（N 枚）」标题 + markdown 表格，四列 id/中文名/组件名/检索关键词。
// 分类顺序与行顺序原样保留；组件名列不进产物。
function parseCatalog(text) {
  const rows = []
  const cats = []
  const seenIds = new Set()
  let cat = null
  let declared = 0
  let count = 0
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '')
    const heading = /^##\s+(.+)$/.exec(line)
    if (heading) {
      if (cat !== null && count !== declared) fail(`分类「${cat}」标题声明 ${declared} 枚，实际 ${count} 行`)
      const m = /^(.*?)（(\d+)\s*枚）$/.exec(heading[1].trim())
      if (!m) fail(`catalog.md 第 ${i + 1} 行分类标题缺少「（N 枚）」后缀：${heading[1]}`)
      cat = m[1].trim()
      declared = Number(m[2])
      count = 0
      cats.push(cat)
      continue
    }
    if (!line.startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length !== 4) fail(`catalog.md 第 ${i + 1} 行不是四列表格：${line}`)
    if (cells[0] === 'id' || /^[-:\s]+$/.test(cells[0])) continue // 表头与分隔行
    if (cat === null) fail(`catalog.md 第 ${i + 1} 行出现在任何分类标题之前`)
    const id = cells[0].replace(/^`|`$/g, '')
    if (!ID_RE.test(id)) fail(`catalog.md 第 ${i + 1} 行 id 非法：${JSON.stringify(cells[0])}`)
    if (seenIds.has(id)) fail(`catalog.md id 重复：${id}`)
    if (!cells[1]) fail(`catalog.md 第 ${i + 1} 行中文名为空：${id}`)
    seenIds.add(id)
    count++
    // 「—」是目录里的「无关键词」占位符，不是检索词，归一成空串
    rows.push({ id, name: cells[1], keywords: cells[3] === '—' ? '' : cells[3], cat })
  }
  if (cat !== null && count !== declared) fail(`分类「${cat}」标题声明 ${declared} 枚，实际 ${count} 行`)
  return { rows, cats }
}

function assertSafe(file, markup, label) {
  for (const [re, what] of FORBIDDEN) {
    if (re.test(markup)) fail(`${file}: ${label}含${what}`)
  }
}

// 取外层 <svg …> 与 </svg> 之间的内部标记：渲染方统一补外层标签，这里不保留。
function innerMarkup(file, raw) {
  const m = /^\s*(<svg\b[^>]*>)([\s\S]*)<\/svg>\s*$/.exec(raw)
  if (!m) fail(`${file}: 不是单个外层 <svg>…</svg> 结构`)
  assertSafe(file, m[1], '外层标签')
  const inner = m[2].replace(/\s+/g, ' ').trim()
  if (!inner) fail(`${file}: 内部标记为空`)
  const tags = [...inner.matchAll(/<\s*\/?\s*([A-Za-z][A-Za-z0-9:_-]*)/g)]
  const ltCount = (inner.match(/</g) || []).length
  if (tags.length !== ltCount) fail(`${file}: 含无法识别的「<」标记（注释、声明或畸形标签）`)
  for (const t of tags) {
    if (!ALLOWED_TAGS.has(t[1])) fail(`${file}: 不允许的标签 <${t[1]}>`)
  }
  assertSafe(file, inner, '内部标记')
  return inner
}

const version = readVersion()
const { rows, cats } = parseCatalog(readFileSync(join(vendorDir, 'catalog.md'), 'utf8'))

const entries = readdirSync(svgDir).sort()
const stray = entries.filter((f) => !f.endsWith('.svg'))
if (stray.length) fail(`svg 目录含非 .svg 文件：${stray.join(', ')}`)
const svgIds = entries.map((f) => f.slice(0, -4))
if (svgIds.length !== EXPECTED_COUNT) fail(`svg 文件数 ${svgIds.length}，应为 ${EXPECTED_COUNT}`)
if (rows.length !== EXPECTED_COUNT) fail(`catalog 行数 ${rows.length}，应为 ${EXPECTED_COUNT}`)
const svgIdSet = new Set(svgIds)
const catalogIdSet = new Set(rows.map((r) => r.id))
const missingSvg = rows.filter((r) => !svgIdSet.has(r.id)).map((r) => r.id)
const extraSvg = svgIds.filter((id) => !catalogIdSet.has(id))
if (missingSvg.length) fail(`catalog 有 id 但缺 svg 文件：${missingSvg.join(', ')}`)
if (extraSvg.length) fail(`svg 文件不在 catalog 中：${extraSvg.join(', ')}`)

const svgById = new Map()
for (const id of svgIds) {
  const file = `${id}.svg`
  svgById.set(id, innerMarkup(file, readFileSync(join(svgDir, file), 'utf8')))
}

// 全部校验通过后才序列化并落盘，避免写出半成品
const header = `// 由 scripts/gen-role-icons.mjs 生成，勿手改。源：naive-icons v${version} (MIT)`
const svgBody = rows.map((r) => `  ${tsString(r.id)}: ${tsString(svgById.get(r.id))},`).join('\n')
const svgOut = `${header}\nexport const ICON_SVG: Record<string, string> = {\n${svgBody}\n}\n`
const catalogBody = rows
  .map(
    (r) =>
      `  { id: ${tsString(r.id)}, name: ${tsString(r.name)}, keywords: ${tsString(r.keywords)}, cat: ${tsString(r.cat)} },`,
  )
  .join('\n')
const catalogOut =
  `${header}\n` +
  'export interface IconMeta { id: string; name: string; keywords: string; cat: string }\n\n' +
  `export const ICON_CATALOG: readonly IconMeta[] = [\n${catalogBody}\n]\n`

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'role-icons.ts'), svgOut, 'utf8')
writeFileSync(join(outDir, 'icon-catalog.ts'), catalogOut, 'utf8')
console.log(
  `role-icons: ${rows.length} 枚图标 / ${cats.length} 个分类 → generated/role-icons.ts ${Buffer.byteLength(svgOut, 'utf8')} B, generated/icon-catalog.ts ${Buffer.byteLength(catalogOut, 'utf8')} B`,
)
