import { api } from '../api/client'
import type { PushDevice } from '../api/types'

/**
 * Phone notifications (5.15): turning them on for this phone, and keeping its subscription saved.
 * The pure parts are exported for tests; the rest needs a browser.
 */

export type Support = 'ok' | 'ios-install' | 'unsupported'

interface Env {
  hasServiceWorker: boolean
  hasPushManager: boolean
  hasNotification: boolean
  userAgent: string
  maxTouchPoints: number
  standalone: boolean
}

/** An iPad on iPadOS 13+ says it's a Mac, so touch is what gives it away. */
export const isIOS = (ua: string, maxTouchPoints: number) => /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)

/** Safari offers push only to an app on the Home Screen (iOS 16.4+), so outside it the page explains how to add it. */
export function pushSupport(env: Env): Support {
  if (env.hasServiceWorker && env.hasPushManager && env.hasNotification) return 'ok'
  if (isIOS(env.userAgent, env.maxTouchPoints) && !env.standalone) return 'ios-install'
  return 'unsupported'
}

/** What the device list calls this phone. Nothing more specific than the kind, so nothing identifying is stored. */
export function deviceLabel(ua: string, maxTouchPoints = 0): string {
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) return 'iPad'
  if (/iPhone|iPod/.test(ua)) return 'iPhone'
  if (/Android/.test(ua)) return 'Android'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Linux|CrOS/.test(ua)) return 'Linux'
  return 'Browser'
}

/** The VAPID public key comes as base64url; the browser wants its bytes. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function browserSupport(): Support {
  return pushSupport({
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: 'PushManager' in window,
    hasNotification: 'Notification' in window,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true,
  })
}

/** The service worker is registered only in a production build (main.tsx). */
async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined
  return (await navigator.serviceWorker.getRegistration()) ?? undefined
}

/** This phone's current subscription, if notifications are on for it. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration()
  return reg ? reg.pushManager.getSubscription() : null
}

/** The id the API gives this phone's record: its endpoint, hashed, as the server does. */
export async function deviceId(sub: PushSubscription): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sub.endpoint))
  return `pushsub:${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

function save(sub: PushSubscription) {
  const { endpoint, keys } = sub.toJSON()
  return api<PushDevice>('/push/subscription', { method: 'PUT', json: { endpoint, keys, label: deviceLabel(navigator.userAgent, navigator.maxTouchPoints ?? 0) } })
}

/** Must be called from a tap: browsers, Safari above all, only ask permission then. */
export async function turnOn(): Promise<'on' | 'denied' | 'not-set-up' | 'no-worker'> {
  const { key } = await api<{ key: string | null }>('/push/key')
  if (!key) return 'not-set-up'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  const reg = await registration()
  if (!reg) return 'no-worker'
  const existing = await reg.pushManager.getSubscription()
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }))
  await save(sub)
  return 'on'
}

/** Stops this phone's notifications and forgets it on the server. */
export async function turnOff(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  const id = await deviceId(sub)
  await sub.unsubscribe()
  await api<void>(`/push/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined)
}

/**
 * Saves this phone's subscription again each time the app opens. Browsers sometimes renew a subscription, and
 * Safari doesn't say when, so this keeps the server's copy current. Quietly does nothing if anything is missing.
 */
export async function refreshSubscription(): Promise<void> {
  try {
    if (browserSupport() !== 'ok' || Notification.permission !== 'granted') return
    const sub = await currentSubscription()
    if (sub) await save(sub)
  } catch {
    /* the next open tries again */
  }
}
