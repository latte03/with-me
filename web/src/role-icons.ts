// 角色图标头像（naive:<id>）的数据访问层：纯逻辑 + 懒加载，不依赖 DOM/浏览器 API。
// 图标数据由 scripts/gen-role-icons.mjs 从 web/vendor/naive-icons 生成，
// 走动态 import 单独分包：只用 emoji 头像的用户不会下载图标数据。
export const ICON_PREFIX = 'naive:'

export interface IconMeta { id: string; name: string; keywords: string; cat: string }

const ID_RE = /^[a-z0-9-]+$/

type Listener = () => void

let svgMap: Record<string, string> | null = null
let svgLoading: Promise<void> | null = null
let catalog: readonly IconMeta[] | null = null
let catalogLoading: Promise<readonly IconMeta[]> | null = null
const listeners = new Set<Listener>()

// avatar 形如 naive:penguin → penguin；emoji、空 id、含空白/引号等脏字符串一律 null
export function iconId(avatar: string): string | null {
  if (!avatar.startsWith(ICON_PREFIX)) return null
  const id = avatar.slice(ICON_PREFIX.length)
  return ID_RE.test(id) ? id : null
}

export function iconAvatar(id: string): string {
  return `${ICON_PREFIX}${id}`
}

// 记忆化：并发调用共享同一个 promise，已加载则立即 resolve
export function loadRoleIcons(): Promise<void> {
  if (svgMap) return Promise.resolve()
  if (!svgLoading) {
    svgLoading = import('./generated/role-icons.ts')
      .then((m) => {
        svgMap = m.ICON_SVG
        for (const fn of Array.from(listeners)) fn()
      })
      .catch((err: unknown) => {
        svgLoading = null // 失败不缓存，允许下次重试
        throw err
      })
  }
  return svgLoading
}

export function iconsLoaded(): boolean {
  return svgMap !== null
}

// 同步查表：未加载或 id 不存在 → null。
// hasOwn 挡掉 constructor/toString 这类原型链键，别把继承属性当图标返回。
export function iconSvg(id: string): string | null {
  if (!svgMap || !Object.hasOwn(svgMap, id)) return null
  return svgMap[id]
}

// 注册加载完成回调，返回取消函数；注册时已加载则立即同步调用一次
export function onIconsLoaded(fn: Listener): () => void {
  if (svgMap) {
    fn()
    return () => {}
  }
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function loadIconCatalog(): Promise<readonly IconMeta[]> {
  if (catalog) return Promise.resolve(catalog)
  if (!catalogLoading) {
    catalogLoading = import('./generated/icon-catalog.ts')
      .then((m) => {
        catalog = m.ICON_CATALOG
        return m.ICON_CATALOG
      })
      .catch((err: unknown) => {
        catalogLoading = null
        throw err
      })
  }
  return catalogLoading
}
