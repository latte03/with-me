// dev 诊断面板的纯逻辑：开闸判定 + 滑杆取值夹取 + 读数格式化，不依赖 DOM（单测见 test/dev-panel-core.test.ts）。
// 面板本身（ui/dev-panel.ts）要 import CSS，node 跑不了，所以可测的部分留在这里。

export const TABBAR_EXTRA_KEY = 'with-me.dev.tabbarExtra'
export const TABBAR_EXTRA_MIN = -40
export const TABBAR_EXTRA_MAX = 80

// 面板主开关的持久化键：主屏 PWA 启动不带 query，?dev=1 进不去，所以设置页勾选写这里当唯一事实源。
export const DEV_PANEL_KEY = 'with-me.dev.panel'

// 开闸判定：stored 键（设置页开关，粘住）或 URL 显式带 dev 参数（旧入口，附加入口）。
// 只认 query，hash 路由（#/chat/...）里出现 dev 不算；search 传空串即无参数。
export function devPanelRequested(search: string, stored: string | null): boolean {
  return stored === '1' || new URLSearchParams(search).has('dev')
}

export interface Reading {
  label: string
  value: string
}

// localStorage 里可能是脏值（手改、带单位、空串）：非数字回 0，其余取整并夹到滑杆区间，避免 NaNpx 写进 CSS
export function clampTabbarExtra(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''))
  if (!Number.isFinite(n)) return 0
  return Math.min(TABBAR_EXTRA_MAX, Math.max(TABBAR_EXTRA_MIN, Math.round(n)))
}

// 视口真值常带小数（scale 会是 1.0000000001）或缺失（老浏览器无 visualViewport）：统一两位小数，缺值显示 —
export function fmtNum(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return String(Math.round(v * 100) / 100)
}

// 复制读数用的纯文本：一行一条 label: value
export function formatReadings(rows: readonly Reading[]): string {
  return rows.map((r) => `${r.label}: ${r.value}`).join('\n')
}