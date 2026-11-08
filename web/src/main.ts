import './style.css'
import './clip.css'
import { boot } from './app.ts'
import { applyTheme } from './theme.ts'

applyTheme()

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
}

void boot()