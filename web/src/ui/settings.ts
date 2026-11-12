import { api, apiBlob, clearSession, getSession } from '../api.ts'
import { DEV_PANEL_KEY } from '../dev-panel-core.ts'
import { fmtBytes } from '../projection.ts'
import { closeDB } from '../store.ts'
import { onSync, syncNow } from '../sync.ts'
import type { AdminUser, DeviceInfo, MeInfo } from '../types.ts'
import { confirmModal, download, el, esc, formModal, icon, toast } from './dom.ts'
import { setThemePref, themePref, type ThemePref } from '../theme.ts'
import { APP_VERSION } from '../version.ts'

export function mountSettings(root: HTMLElement, onLogout: () => void): () => void {
  const session = getSession()
  const view = el(`
    <div class="page settings">
      <header class="page-head"><h1 class="head-title">设置</h1></header>
      <div class="set-body">
        <section class="card">
          <h3>${icon('sync', 16)} 同步</h3>
          <p class="sync-line dim"></p>
          <div class="btn-row"><button class="btn ghost sync-now">立即同步</button><button class="btn ghost persist">保持离线可用</button></div>
          <p class="dim small-text">防止浏览器清理离线数据</p>
        </section>
        <section class="card">
          <h3>${icon('user', 16)} 账号</h3>
          <p class="acct-line"><strong>${esc(session?.user.username ?? '')}</strong>${session?.user.is_admin ? '<em class="tag">管理员</em>' : ''}</p>
          <div class="btn-row"><button class="btn ghost pwd">修改密码</button><button class="btn danger logout">退出登录</button></div>
        </section>
        <section class="card">
          <h3>${icon('sun', 16)} 外观</h3>
          <div class="seg theme-seg" role="group" aria-label="主题">
            <button data-pref="light">浅色</button><button data-pref="dark">深色</button><button data-pref="auto">自动</button>
          </div>
          <p class="dim small-text">自动跟随系统外观</p>
        </section>
        <section class="card dev-card">
          <h3>${icon('gear', 16)} 诊断</h3>
          <label class="check-row"><input type="checkbox" name="dev-panel"><span>视口诊断面板</span></label>
          <p class="dim small-text">显示视口真值与 tabbar 底距滑杆，仅排查用</p>
        </section>
        <section class="card">
          <h3>${icon('device', 16)} 设备</h3>
          <div class="device-list dim">加载中…</div>
        </section>
        <section class="card storage-card">
          <h3>${icon('download', 16)} 存储与导出</h3>
          <div class="quota"><div class="quota-bar"><i></i></div><p class="dim quota-text"></p></div>
          <div class="btn-row"><button class="btn ghost exp-json">JSON</button><button class="btn ghost exp-md">Markdown</button><button class="btn ghost exp-zip">ZIP（含附件）</button></div>
        </section>
        <section class="card admin-card" hidden>
          <h3>${icon('gear', 16)} 管理员</h3>
          <div class="user-list"></div>
          <div class="btn-row"><button class="btn ghost new-user">＋ 建账号</button></div>
        </section>
        <p class="about dim small-text">与我 · 版本 ${esc(APP_VERSION)}</p>
      </div>
    </div>`)
  root.appendChild(view)
  const syncLine = view.querySelector('.sync-line') as HTMLElement
  const themeSeg = view.querySelector('.theme-seg') as HTMLElement
  const paintTheme = () => {
    themeSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.pref === themePref()))
  }
  themeSeg.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      setThemePref((b as HTMLElement).dataset.pref as ThemePref)
      paintTheme()
    }),
  )
  paintTheme()
  // 诊断面板主开关：stored 键是唯一事实源（主屏 PWA 没有 query，?dev=1 只是附加入口）。
  // 勾选写键 + 懒加载面板 chunk；取消删键并卸载，刷新后不再自动出现。
  const devCheck = view.querySelector('.dev-card input[name="dev-panel"]') as HTMLInputElement
  try {
    devCheck.checked = localStorage.getItem(DEV_PANEL_KEY) === '1'
  } catch {
    /* 读不到存储就当未开 */
  }
  devCheck.addEventListener('change', () => {
    const checked = devCheck.checked
    try {
      if (checked) localStorage.setItem(DEV_PANEL_KEY, '1')
      else localStorage.removeItem(DEV_PANEL_KEY)
    } catch {
      /* 写不进（隐私模式）也本次会话生效 */
    }
    void import('./dev-panel.ts').then((m) => m.setDevPanelEnabled(checked))
  })
  view.querySelector('.sync-now')?.addEventListener('click', () => void syncNow())
  view.querySelector('.persist')?.addEventListener('click', () => {
    void navigator.storage?.persist?.().then((ok) => toast(ok ? '已允许长期保留离线数据' : '浏览器未授予，仍可能被清理'))
  })
  view.querySelector('.pwd')?.addEventListener('click', async () => {
    const v = await formModal('修改密码', [
      { key: 'old', label: '旧密码', type: 'password' },
      { key: 'new', label: '新密码', type: 'password' },
    ])
    if (!v) return
    try {
      await api('/auth/password', { method: 'POST', body: { old: v.old, new: v.new } })
      toast('密码已修改')
    } catch (e) {
      toast((e as Error).message)
    }
  })
  view.querySelector('.logout')?.addEventListener('click', async () => {
    if (await confirmModal('退出登录？未同步的记录保留在本机。', '退出')) {
      clearSession()
      closeDB()
      onLogout()
    }
  })

  const offSync = onSync((s) => {
    syncLine.textContent = `${s.online ? '在线' : '离线'} · 待传 ${s.pending} 条${s.lastSync ? ` · 上次同步 ${new Date(s.lastSync).toLocaleTimeString()}` : ''}${s.error ? ` · ${s.error}` : ''}`
    syncLine.classList.toggle('bad', !!s.error)
  })

  async function loadDevices() {
    const box = view.querySelector('.device-list') as HTMLElement
    try {
      const devices = await api<DeviceInfo[]>('/devices')
      box.innerHTML = ''
      box.classList.remove('dim')
      for (const d of devices) {
        const name = d.name || '未命名设备'
        const fpCode = !d.name && d.fingerprint ? `<span class="dim small-text">${esc(d.fingerprint.slice(0, 6))}</span>` : ''
        const row = el(`
          <div class="device-row${d.revoked ? ' revoked' : ''}">
            <span class="device-main"><span>${esc(name)}${fpCode}${d.current ? '<em class="tag">本机</em>' : ''}${d.revoked ? '<em class="tag">已撤销</em>' : ''}</span>
            <span class="dim small-text">最近活跃 ${esc(d.last_seen ? new Date(d.last_seen).toLocaleString() : '—')}</span></span>
            ${!d.current && !d.revoked ? '<button class="btn ghost small revoke">撤销</button>' : ''}
          </div>`)
        row.querySelector('.revoke')?.addEventListener('click', async () => {
          if (await confirmModal(`撤销设备「${name}」？其会话将失效。`, '撤销')) {
            try {
              await api(`/devices/${d.id}`, { method: 'DELETE' })
              toast('已撤销')
              void loadDevices()
            } catch (e) {
              toast((e as Error).message)
            }
          }
        })
        box.appendChild(row)
      }
    } catch (e) {
      box.textContent = `设备列表加载失败：${(e as Error).message}`
    }
  }

  async function loadQuota() {
    try {
      const me = await api<MeInfo>('/me')
      const pct = me.quota_bytes > 0 ? Math.min(100, (me.used_bytes / me.quota_bytes) * 100) : 0
      ;(view.querySelector('.quota-bar i') as HTMLElement).style.width = `${pct}%`
      ;(view.querySelector('.quota-text') as HTMLElement).textContent = `已用 ${fmtBytes(me.used_bytes)} / ${fmtBytes(me.quota_bytes)}`
    } catch (e) {
      ;(view.querySelector('.quota-text') as HTMLElement).textContent = `配额加载失败：${(e as Error).message}`
    }
  }

  for (const [cls, fmt, ext] of [
    ['.exp-json', 'json', 'json'],
    ['.exp-md', 'md', 'md'],
    ['.exp-zip', 'zip', 'zip'],
  ] as const) {
    view.querySelector(cls)?.addEventListener('click', () => {
      void (async () => {
        toast('正在导出…')
        try {
          const blob = await apiBlob(`/export?format=${fmt}`)
          download(blob, `with-me-${session?.user.username ?? 'export'}.${ext}`)
        } catch (e) {
          toast(`导出失败：${(e as Error).message}`)
        }
      })()
    })
  }

  async function loadUsers() {
    const card = view.querySelector('.admin-card') as HTMLElement
    if (!session?.user.is_admin) return
    card.hidden = false
    const box = view.querySelector('.user-list') as HTMLElement
    try {
      const users = await api<AdminUser[]>('/users')
      box.innerHTML = ''
      for (const u of users) {
        const row = el(`
          <div class="device-row">
            <span class="device-main"><span>${esc(u.username)}${u.is_admin ? '<em class="tag">管理员</em>' : ''}${u.disabled ? '<em class="tag">已停用</em>' : ''}</span></span>
            <span class="btn-row tight">
              <button class="btn ghost small reset">重置密码</button>
              ${u.id !== session.user.id ? `<button class="btn ghost small disable">${u.disabled ? '启用' : '停用'}</button>` : ''}
            </span>
          </div>`)
        row.querySelector('.reset')?.addEventListener('click', async () => {
          const v = await formModal(`重置 ${u.username} 的密码`, [{ key: 'password', label: '新密码', type: 'password' }])
          if (!v) return
          try {
            await api(`/users/${u.id}/reset`, { method: 'POST', body: { password: v.password } })
            toast('已重置')
          } catch (e) {
            toast((e as Error).message)
          }
        })
        row.querySelector('.disable')?.addEventListener('click', async () => {
          try {
            await api(`/users/${u.id}/disable`, { method: 'POST', body: { disabled: !u.disabled } })
            void loadUsers()
          } catch (e) {
            toast((e as Error).message)
          }
        })
        box.appendChild(row)
      }
    } catch (e) {
      box.textContent = `用户列表加载失败：${(e as Error).message}`
    }
  }

  view.querySelector('.new-user')?.addEventListener('click', async () => {
    const v = await formModal('新建账号', [
      { key: 'username', label: '用户名' },
      { key: 'password', label: '密码', type: 'password' },
    ], '创建')
    if (!v) return
    try {
      await api('/users', { method: 'POST', body: { username: v.username, password: v.password } })
      toast('已创建')
      void loadUsers()
    } catch (e) {
      toast((e as Error).message)
    }
  })

  void loadDevices()
  void loadQuota()
  void loadUsers()
  return () => {
    offSync()
    view.remove()
  }
}