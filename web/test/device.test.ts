import assert from 'node:assert/strict'
import { test } from 'node:test'
import { browserFamily, deviceFingerprint, deviceName, type DeviceEnv } from '../src/device.ts'

const env = (over: Partial<DeviceEnv> = {}): DeviceEnv => ({
  platform: 'iPhone',
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  screenWidth: 402,
  screenHeight: 874,
  timezone: 'Asia/Shanghai',
  language: 'zh-CN',
  cores: 6,
  touchPoints: 5,
  ...over,
})

const PWA_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'

test('Safari 与主屏 PWA 是同一台设备', () => {
  assert.equal(deviceFingerprint(env()), deviceFingerprint(env({ userAgent: PWA_UA })))
})

test('浏览器小版本升级不换身份', () => {
  const next = env({ userAgent: env().userAgent.replace('Version/26.0', 'Version/26.1').replace('OS 18_7', 'OS 18_8') })
  assert.equal(deviceFingerprint(env()), deviceFingerprint(next))
})

test('转屏不换身份', () => {
  assert.equal(deviceFingerprint(env()), deviceFingerprint(env({ screenWidth: 874, screenHeight: 402 })))
})

test('不同机型、不同浏览器、不同桌面环境各自独立', () => {
  const base = deviceFingerprint(env())
  assert.notEqual(base, deviceFingerprint(env({ screenWidth: 393, screenHeight: 852 })))
  assert.notEqual(base, deviceFingerprint(env({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0' })))
  assert.notEqual(base, deviceFingerprint(env({ timezone: 'Europe/Berlin' })))
  const win = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
  assert.notEqual(
    deviceFingerprint(env({ platform: 'Win32', userAgent: win })),
    deviceFingerprint(env({ platform: 'Win32', userAgent: `${win} Edg/140.0.0.0` })),
  )
})

test('browserFamily 归一化各平台 UA', () => {
  assert.equal(browserFamily(PWA_UA), 'Safari')
  assert.equal(browserFamily(env().userAgent), 'Safari')
  assert.equal(browserFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 CriOS/140.0 Mobile/15E148 Safari/604.1'), 'Chrome')
  assert.equal(browserFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 EdgiOS/140.0 Mobile/15E148 Safari/604.1'), 'Edge')
  assert.equal(browserFamily('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36'), 'Chrome')
  assert.equal(browserFamily('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'), 'Firefox')
  assert.equal(browserFamily('some-crawler/1.0'), 'Web')
})

test('设备名沿用平台称呼', () => {
  assert.equal(deviceName(env()), 'iPhone 浏览器')
  assert.equal(deviceName(env({ platform: '' })), 'Web 浏览器')
})