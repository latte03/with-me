export type ThemePref = 'light' | 'dark' | 'auto'

const KEY = 'with-me.theme'
const mq = window.matchMedia('(prefers-color-scheme: dark)')

export function themePref(): ThemePref {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' ? v : 'auto'
}

export function applyTheme(): void {
  const pref = themePref()
  const dark = pref === 'dark' || (pref === 'auto' && mq.matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg)
}

export function setThemePref(p: ThemePref): void {
  localStorage.setItem(KEY, p)
  applyTheme()
}

mq.addEventListener('change', () => {
  if (themePref() === 'auto') applyTheme()
})