import { clampTabbarExtra, DEV_PANEL_KEY, fmtNum, formatReadings, TABBAR_EXTRA_KEY, TABBAR_EXTRA_MAX, TABBAR_EXTRA_MIN, type Reading } from '../dev-panel-core.ts'
import { el, esc, icon, toast } from './dom.ts'
import './dev.css'

// dev-only 诊断面板：只有开闸（设置页「诊断」开关或 ?dev=1）时 app.ts 才动态 import 本模块，生产包默认不渲染也不下载这个 chunk。
// 职责只有两件：把真机视口真值读出来（headless 复现不了主屏 PWA 的底距问题），以及用滑杆调 --tabbar-extra
// （style.css 的 .tabbar margin-bottom 已引用该变量，这里不改任何默认样式）。夹取/格式化/开闸判定在 dev-panel-core.ts。

interface ReadingRow extends Reading {
  key: string
}

// 安全区 inset 没有 JS API：读探针元素的 computed padding（env() 解析后的真值）
function collectRows(probe: HTMLElement): ReadingRow[] {
  const vv = window.visualViewport
  const cs = getComputedStyle(probe)
  // navigator.standalone 是 iOS 私有属性，标准 lib.dom 里没有
  const ios = navigator as Navigator & { standalone?: boolean }
  return [
    { key: 'innerHeight', label: 'innerHeight', value: fmtNum(window.innerHeight) },
    { key: 'vvHeight', label: 'visualViewport.height', value: fmtNum(vv?.height) },
    { key: 'vvOffsetTop', label: 'visualViewport.offsetTop', value: fmtNum(vv?.offsetTop) },
    { key: 'vvScale', label: 'visualViewport.scale', value: fmtNum(vv?.scale) },
    { key: 'screenWidth', label: 'screen.width', value: fmtNum(screen.width) },
    { key: 'screenHeight', label: 'screen.height', value: fmtNum(screen.height) },
    { key: 'dpr', label: 'devicePixelRatio', value: fmtNum(window.devicePixelRatio) },
    { key: 'standalone', label: 'navigator.standalone', value: ios.standalone === undefined ? '—' : String(ios.standalone) },
    { key: 'displayMode', label: 'display-mode: standalone', value: String(window.matchMedia('(display-mode: standalone)').matches) },
    { key: 'insetTop', label: 'safe-area-inset-top', value: cs.paddingTop },
    { key: 'insetRight', label: 'safe-area-inset-right', value: cs.paddingRight },
    { key: 'insetBottom', label: 'safe-area-inset-bottom', value: cs.paddingBottom },
    { key: 'insetLeft', label: 'safe-area-inset-left', value: cs.paddingLeft },
    { key: 'href', label: 'location.href', value: location.href },
    { key: 'ua', label: 'userAgent', value: navigator.userAgent },
  ]
}

let current: (() => void) | null = null

export function mountDevPanel(): () => void {
  // 重复挂载（HMR / 再次调用）先卸掉上一份，免得 id 与监听器叠两份
  current?.()

  const probe = el('<div class="dev-probe" aria-hidden="true"></div>')
  document.body.appendChild(probe)
  const panel = el(`
    <section class="dev-panel" role="region" aria-label="开发诊断面板">
      <header class="dev-head">
        <button type="button" class="dev-toggle" aria-expanded="true" aria-controls="dev-panel-body">${icon('gear', 14)}<span>DEV 诊断</span></button>
        <button type="button" class="icon-btn dev-close" aria-label="关闭诊断面板">${icon('close', 16)}</button>
      </header>
      <div class="dev-body" id="dev-panel-body">
        <p class="dev-note dim small-text">仅诊断用：调整 tabbar 底距并记录真机视口真值</p>
        <div class="dev-field">
          <label class="dev-label" for="dev-tabbar-extra">tabbar 底距增量（--tabbar-extra）</label>
          <div class="dev-slider">
            <input id="dev-tabbar-extra" class="dev-range" type="range" min="${TABBAR_EXTRA_MIN}" max="${TABBAR_EXTRA_MAX}" step="1" value="0" aria-label="tabbar 底距增量，单位像素">
            <output class="dev-value" for="dev-tabbar-extra" aria-live="off">0px</output>
            <button type="button" class="btn ghost small dev-reset">重置</button>
          </div>
        </div>
        <div class="dev-readings-head">
          <span class="dev-label">真值读数</span>
          <button type="button" class="btn ghost small dev-copy">${icon('copy', 14)}<span>复制读数</span></button>
        </div>
        <dl class="dev-readings" aria-label="真机视口真值读数"></dl>
        <textarea class="dev-fallback" readonly hidden aria-label="读数文本，请手动复制"></textarea>
      </div>
    </section>`)
  document.body.appendChild(panel)

  const body = panel.querySelector('.dev-body') as HTMLElement
  const toggle = panel.querySelector('.dev-toggle') as HTMLButtonElement
  const range = panel.querySelector('.dev-range') as HTMLInputElement
  const valueOut = panel.querySelector('.dev-value') as HTMLElement
  const list = panel.querySelector('.dev-readings') as HTMLElement
  const fallback = panel.querySelector('.dev-fallback') as HTMLTextAreaElement
  const cells = new Map<string, HTMLElement>()
  const vv = window.visualViewport

  // 只更新值文本、不重建行：刷新时不会打断用户正在选中的读数
  function refresh(): void {
    const rows = collectRows(probe)
    for (const r of rows) {
      let cell = cells.get(r.key)
      if (!cell) {
        const row = el(`<div class="dev-row" data-key="${esc(r.key)}"><dt>${esc(r.label)}</dt><dd class="dev-val"></dd></div>`)
        cell = row.querySelector('.dev-val') as HTMLElement
        cells.set(r.key, cell)
        list.appendChild(row)
      }
      cell.textContent = r.value
    }
    if (!fallback.hidden) fallback.value = formatReadings(rows)
  }

  function applyExtra(v: number): void {
    const n = clampTabbarExtra(v)
    document.documentElement.style.setProperty('--tabbar-extra', `${n}px`)
    range.value = String(n)
    valueOut.textContent = `${n}px`
    try {
      localStorage.setItem(TABBAR_EXTRA_KEY, String(n))
    } catch {
      /* 存储不可写（隐私模式）时只本次会话生效 */
    }
  }

  async function copyReadings(): Promise<void> {
    const text = formatReadings(collectRows(probe))
    try {
      // 非安全上下文（http://NAS-IP）根本没有 navigator.clipboard；有也可能被权限拒绝
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(text)
      toast('读数已复制')
    } catch {
      fallback.value = text
      fallback.hidden = false
      fallback.focus()
      fallback.select()
      toast('已选中读数，请手动复制')
    }
  }

  function unmount(): void {
    vv?.removeEventListener('resize', refresh)
    vv?.removeEventListener('scroll', refresh)
    window.removeEventListener('resize', refresh)
    probe.remove()
    panel.remove()
    // 关掉面板就摘掉内联变量、恢复默认观感；数值留在 localStorage，下次打开继续用
    document.documentElement.style.removeProperty('--tabbar-extra')
    if (current === unmount) current = null
  }

  range.addEventListener('input', () => applyExtra(Number(range.value)))
  panel.querySelector('.dev-reset')?.addEventListener('click', () => applyExtra(0))
  panel.querySelector('.dev-copy')?.addEventListener('click', () => void copyReadings())
  // 关闭按钮 = 彻底关：走主开关同一条路径，清掉 stored 键，下次启动不再自动出现
  panel.querySelector('.dev-close')?.addEventListener('click', () => void setDevPanelEnabled(false))
  toggle.addEventListener('click', () => {
    body.hidden = !body.hidden
    toggle.setAttribute('aria-expanded', String(!body.hidden))
    panel.classList.toggle('collapsed', body.hidden)
  })
  // 主屏 PWA 的视口会随键盘/转屏/地址栏收放变化，真值必须跟着刷新
  vv?.addEventListener('resize', refresh)
  vv?.addEventListener('scroll', refresh)
  window.addEventListener('resize', refresh)

  let stored = 0
  try {
    stored = clampTabbarExtra(localStorage.getItem(TABBAR_EXTRA_KEY))
  } catch {
    /* 读不到存储就用默认 0 */
  }
  applyExtra(stored)
  refresh()

  current = unmount
  return unmount
}

// 主开关的唯一执行入口（app.ts 开闸 / 设置页勾选 / 面板关闭按钮都走这里）：
// on=true 幂等挂载；on=false 卸载 + 摘内联变量 + 清 stored 键，即「关闭=彻底关」。
// 滑杆数值键 TABBAR_EXTRA_KEY 不动，下次打开继续用上次的底距。
export async function setDevPanelEnabled(on: boolean): Promise<void> {
  if (on) {
    // 已挂载就不再重建 DOM：重复开闸不打断正在看的读数与滑杆
    if (!current) mountDevPanel()
    return
  }
  current?.()
  current = null
  // unmount 已摘过一次；这里兜住「没挂载却残留内联变量」的情况
  document.documentElement.style.removeProperty('--tabbar-extra')
  try {
    localStorage.removeItem(DEV_PANEL_KEY)
  } catch {
    /* 存储不可写（隐私模式）时至少本次会话已关闭 */
  }
}