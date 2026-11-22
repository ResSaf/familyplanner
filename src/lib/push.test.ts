import { describe, expect, it } from 'vitest'
import { deviceLabel, keyBytes, pushSupport } from './push'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
const none = { hasServiceWorker: true, hasPushManager: false, hasNotification: false, maxTouchPoints: 5, standalone: false }

describe('pushSupport (5.15)', () => {
  it('is ok wherever the browser offers push', () => {
    expect(pushSupport({ ...none, hasPushManager: true, hasNotification: true, userAgent: ANDROID })).toBe('ok')
  })
  it('on an iPhone or iPad in Safari, says to add it to the Home Screen', () => {
    expect(pushSupport({ ...none, userAgent: IPHONE })).toBe('ios-install')
    expect(pushSupport({ ...none, userAgent: IPAD_AS_MAC })).toBe('ios-install')
  })
  it('installed on an old iPhone without push, or a Mac without it, it is unsupported', () => {
    expect(pushSupport({ ...none, userAgent: IPHONE, standalone: true })).toBe('unsupported')
    expect(pushSupport({ ...none, userAgent: IPAD_AS_MAC, maxTouchPoints: 0 })).toBe('unsupported')
  })
})

describe('deviceLabel', () => {
  it('names only the kind of device', () => {
    expect(deviceLabel(IPHONE)).toBe('iPhone')
    expect(deviceLabel(IPAD_AS_MAC, 5)).toBe('iPad')
    expect(deviceLabel(IPAD_AS_MAC, 0)).toBe('Mac')
    expect(deviceLabel(ANDROID)).toBe('Android')
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows')
    expect(deviceLabel('curl/8')).toBe('Browser')
  })
})

describe('keyBytes', () => {
  it('decodes a base64url VAPID key', () => {
    expect([...keyBytes('AQID_-8')]).toEqual([1, 2, 3, 255, 239])
  })
})
