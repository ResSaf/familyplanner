import { createHash } from 'node:crypto'
import webpush from 'web-push'
import type { Store } from './store'
import type { Member, NotifyChoices, PushSub } from './types'

/**
 * Web Push (5.15, S35). The payload is encrypted for the phone's own keys before it reaches the push service,
 * which sees only when a message is sent and how big it is. The VAPID private key lives only in app settings.
 * With no keys set, nothing is sent and the Notifications page says notifications aren't set up.
 */
export interface Notice {
  title: string
  body: string
  /** A later notice with the same tag replaces the earlier one on the phone, so a repeat is harmless. */
  tag: string
  /** The page to open when it's tapped. */
  url: string
  /** How long the push service should keep trying a phone that's offline. */
  ttlSeconds: number
}

export type PushTarget = Pick<PushSub, 'endpoint' | 'keys'>
/** Sends one notice to one phone. `gone` means the push service says the subscription no longer exists. */
export type Sender = (target: PushTarget, payload: string, ttlSeconds: number) => Promise<{ gone: boolean }>

export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY || null
export const pushConfigured = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)

const webPushSender: Sender = async (target, payload, ttlSeconds) => {
  try {
    await webpush.sendNotification(target, payload, {
      TTL: ttlSeconds,
      urgency: 'high',
      timeout: 10_000,
      vapidDetails: {
        subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
        publicKey: process.env.VAPID_PUBLIC_KEY!,
        privateKey: process.env.VAPID_PRIVATE_KEY!,
      },
    })
    return { gone: false }
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status === 404 || status === 410) return { gone: true }
    // The error can carry the endpoint, which is a secret (S35), so only the status is kept.
    throw new Error(`push failed: ${status ?? 'no response'}`)
  }
}

let sender: Sender = webPushSender
/** Tests send to a fake. */
export function setSender(s: Sender | undefined) {
  sender = s ?? webPushSender
}

/** The record id for a subscription: its endpoint hashed, so the same phone saved again replaces itself. */
export const pushSubId = (endpoint: string) => `pushsub:${createHash('sha256').update(endpoint).digest('hex')}`

export const notifyChoices = (m: Pick<Member, 'notify'>): NotifyChoices => ({ wash: m.notify?.wash ?? true, summary: m.notify?.summary ?? true })

/** Members who want this kind of notice: active people, never the wall. */
export async function membersWanting(store: Store, familyId: string, kind: keyof NotifyChoices): Promise<string[]> {
  const members = await store.byType<Member>(familyId, 'member')
  return members.filter((m) => m.active && m.role !== 'display' && notifyChoices(m)[kind]).map((m) => m.id)
}

/**
 * Sends a notice to every device of these members. A device the push service says is gone is removed.
 * Any other failure is logged without the endpoint and the device is kept for next time.
 */
export async function sendTo(store: Store, familyId: string, memberIds: string[], notice: Notice, now: Date): Promise<{ sent: number; removed: number }> {
  if (!pushConfigured() || !memberIds.length) return { sent: 0, removed: 0 }
  const wanted = new Set(memberIds)
  const subs = (await store.byType<PushSub>(familyId, 'pushSub')).filter((s) => wanted.has(s.memberId))
  const { ttlSeconds, ...shown } = notice
  const payload = JSON.stringify(shown)
  let sent = 0
  let removed = 0
  await Promise.all(
    subs.map(async (s) => {
      try {
        const { gone } = await sender({ endpoint: s.endpoint, keys: s.keys }, payload, ttlSeconds)
        if (gone) {
          await store.delete(familyId, s.id)
          removed++
        } else {
          sent++
          await store.upsert({ ...s, lastSentAt: now.toISOString() })
        }
      } catch (e) {
        console.warn(`notify: ${notice.tag} to ${s.id.slice(0, 16)}: ${(e as Error).message}`)
      }
    }),
  )
  return { sent, removed }
}
