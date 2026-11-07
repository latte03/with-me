import type { Session } from './types.ts'

const SESSION_KEY = 'with-me.session'

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function setSession(s: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s))
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY)
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request(path: string, method: string, body?: BodyInit, headers?: Record<string, string>): Promise<Response> {
  const h = new Headers(headers)
  const s = getSession()
  if (s) h.set('Authorization', `Bearer ${s.token}`)
  const res = await fetch(`/api${path}`, { method, body, headers: h })
  if (res.status === 401) {
    clearSession()
    window.dispatchEvent(new CustomEvent('with-me:unauthorized'))
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const j = (await res.json()) as { error?: string }
      if (j.error) msg = j.error
    } catch {
      /* keep status text */
    }
    throw new ApiError(res.status, msg)
  }
  return res
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let body: BodyInit | undefined
  const headers: Record<string, string> = {}
  if (opts.body instanceof FormData) body = opts.body
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body)
    headers['Content-Type'] = 'application/json'
  }
  const res = await request(path, opts.method ?? 'GET', body, headers)
  return (await res.json()) as T
}

export async function apiBlob(path: string): Promise<Blob> {
  const res = await request(path, 'GET')
  return res.blob()
}