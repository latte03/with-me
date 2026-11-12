import { uuid } from './uuid.ts'

const DEVICE_KEY = 'with-me.device'

export interface Device {
  id: string
  name: string
}

export interface DeviceEnv {
  platform: string
  userAgent: string
  screenWidth: number
  screenHeight: number
  timezone: string
  language: string
  cores: number
  touchPoints: number
}

export function collectEnv(): DeviceEnv {
  return {
    platform: navigator.platform || 'Web',
    userAgent: navigator.userAgent,
    screenWidth: screen.width,
    screenHeight: screen.height,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    language: navigator.language ?? '',
    cores: navigator.hardwareConcurrency || 0,
    touchPoints: navigator.maxTouchPoints || 0,
  }
}

export function browserFamily(userAgent: string): string {
  if (/EdgiOS|Edg\//.test(userAgent)) return 'Edge'
  if (/CriOS/.test(userAgent)) return 'Chrome'
  if (/FxiOS/.test(userAgent)) return 'Firefox'
  if (/Chrome\//.test(userAgent)) return 'Chrome'
  if (/Firefox\//.test(userAgent)) return 'Firefox'
  // iOS 主屏 PWA 的 UA 没有 Safari 令牌，但它与 Safari 是同一台设备上的同一个浏览器
  if (/Safari\//.test(userAgent) || (/AppleWebKit/.test(userAgent) && /iPhone|iPad|iPod/.test(userAgent))) return 'Safari'
  return 'Web'
}

// 指纹只取硬件/系统级特征：存储被清空、换入口域名、Safari 与主屏 PWA 互换都不改变它。
// 不含 devicePixelRatio 与窗口尺寸，桌面缩放和转屏不会换身份。
export function deviceFingerprint(env: DeviceEnv): string {
  const [w, h] = [env.screenWidth, env.screenHeight].sort((a, b) => a - b)
  return [
    browserFamily(env.userAgent),
    env.platform,
    `${w}x${h}`,
    env.timezone,
    env.language,
    env.cores,
    env.touchPoints,
  ].join('|')
}

export function deviceName(env: DeviceEnv): string {
  return `${env.platform || 'Web'} 浏览器`
}

let cached: Device | null = null

function mint(): Device {
  return { id: uuid(), name: deviceName(collectEnv()) }
}

export function device(): Device {
  if (cached) return cached
  try {
    const raw = localStorage.getItem(DEVICE_KEY)
    if (raw) {
      const d = JSON.parse(raw) as Device
      if (d?.id) {
        cached = d
        return d
      }
    }
    const d = mint()
    localStorage.setItem(DEVICE_KEY, JSON.stringify(d))
    cached = d
    return d
  } catch {
    cached = mint()
    return cached
  }
}

export function deviceIdentity(): Device & { fingerprint: string } {
  return { ...device(), fingerprint: deviceFingerprint(collectEnv()) }
}

// 服务端可能把这台设备认到另一行（历史重复行被合并），本地身份要跟着改，否则 outbox 会被拒。
export function adoptDevice(id: string): boolean {
  if (!id || device().id === id) return false
  cached = { ...device(), id }
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(cached))
  } catch {
    /* 存储不可写时只保留本次会话的内存身份 */
  }
  return true
}