import { api, setSession } from '../api.ts'
import { device } from '../store.ts'
import type { Session } from '../types.ts'
import { el } from './dom.ts'

export function mountAuth(root: HTMLElement, onDone: () => void): () => void {
  let bootstrap = false
  const view = el(`
    <div class="auth">
      <div class="auth-card">
        <div class="auth-logo">💬</div>
        <h1>与我</h1>
        <p class="auth-sub">自己给自己发消息 · 本地优先记录</p>
        <form class="form">
          <label class="form-row"><span>用户名</span><input name="username" autocomplete="username" placeholder="用户名"></label>
          <label class="form-row"><span>密码</span><input name="password" type="password" autocomplete="current-password" placeholder="密码"></label>
          <button class="btn primary wide submit" type="submit">登录</button>
        </form>
        <button class="link toggle"></button>
        <p class="auth-err" hidden></p>
      </div>
    </div>`)
  root.appendChild(view)
  const form = view.querySelector('form') as HTMLFormElement
  const toggle = view.querySelector('.toggle') as HTMLButtonElement
  const submit = view.querySelector('.submit') as HTMLButtonElement
  const err = view.querySelector('.auth-err') as HTMLElement
  const paint = () => {
    toggle.textContent = bootstrap ? '已有账号？去登录' : '首次使用？初始化管理员'
    submit.textContent = bootstrap ? '创建管理员' : '登录'
    err.hidden = true
  }
  toggle.addEventListener('click', () => {
    bootstrap = !bootstrap
    paint()
  })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(form)
    const username = String(fd.get('username') ?? '').trim()
    const password = String(fd.get('password') ?? '')
    if (!username || !password) {
      err.textContent = '请输入用户名和密码'
      err.hidden = false
      return
    }
    submit.disabled = true
    try {
      const d = device()
      const path = bootstrap ? '/auth/bootstrap' : '/auth/login'
      const s = await api<Session>(path, {
        method: 'POST',
        body: { username, password, device_id: d.id, device_name: d.name },
      })
      setSession(s)
      onDone()
    } catch (ex) {
      err.textContent = (ex as Error).message || '网络错误'
      err.hidden = false
    } finally {
      submit.disabled = false
    }
  })
  paint()
  return () => view.remove()
}