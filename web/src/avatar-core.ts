// 头像值 → 内部 HTML 的纯逻辑（无 DOM，node 单测可直接 import）。
// 安全红线：avatar 来自同步数据，属不可信输入。图标分支只注入 iconSvg() 返回的注册表常量，
// 任何情况下都不把 avatar 字符串本身拼进 markup；非图标分支一律转义成文本。
import { iconId, iconSvg } from './role-icons.ts'

export const AVATAR_FALLBACK = '💬'

// 生成数据只存外层 <svg> 内部的标记，外壳由渲染方统一补齐。
// 描边是库自带的近黑 #2A2A2A，必须配浅色纸底（见 style.css 的 --icon-paper）才在深色主题下可见。
export const ICON_SVG_OPEN =
  '<svg viewBox="0 0 48 48" fill="none" stroke="#2A2A2A" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'

// 与 ui/dom.ts 的 esc 等价的纯函数：dom.ts 是 UI 原语模块，纯逻辑不反向依赖它（也避免循环 import）
function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// 图标 → 注册表 svg；emoji → 转义文本；空值 / 未知 id / 注册表未加载 → 兜底
export function avatarInner(avatar: string): string {
  const id = iconId(avatar)
  if (id !== null) {
    const inner = iconSvg(id)
    return inner === null ? AVATAR_FALLBACK : `${ICON_SVG_OPEN}${inner}</svg>`
  }
  return avatar === '' ? AVATAR_FALLBACK : escText(avatar)
}