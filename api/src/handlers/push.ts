import { badRequest, notFound } from '../lib/errors'
import type { Handler } from '../lib/http'
import { pushConfigured, pushSubId, sendTo, vapidPublicKey } from '../lib/push'
import { parse, pushSubscriptionSchema } from '../lib/schemas'
import type { PushSub } from '../lib/types'
import { stamp, touch } from '../lib/util'

/**
 * Each person's phones for notifications (5.15). A subscription is a secret (S35): once saved, only its id,
 * label and date are ever sent back.
 */
const device = (s: PushSub) => ({ id: s.id, label: s.label, createdAt: s.createdAt })

/** The public half of the VAPID key, which the browser needs to subscribe. Null when notifications aren't set up. */
export const getPushKey: Handler = async () => ({ body: { key: pushConfigured() ? vapidPublicKey() : null } })

/** Saves this phone for the caller. The same phone saved again replaces itself, and moves to whoever is signed in on it now. */
export const saveSubscription: Handler = async ({ store, caller }, _p, _q, body) => {
  if (!pushConfigured()) throw badRequest('Notifications are not set up')
  const { endpoint, keys, label } = parse(pushSubscriptionSchema, body)
  const id = pushSubId(endpoint)
  const existing = await store.get<PushSub>(caller.familyId, id, 'pushSub')
  const fields = { memberId: caller.memberId, endpoint, keys, label }
  const saved: PushSub = existing ? touch(caller, existing, fields) : { ...stamp(caller, 'pushSub', fields, id), type: 'pushSub' }
  await store.upsert(saved)
  return { status: existing ? 200 : 201, body: device(saved) }
}

const mine = async ({ store, caller }: Parameters<Handler>[0]) =>
  (await store.byType<PushSub>(caller.familyId, 'pushSub')).filter((s) => s.memberId === caller.memberId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))

export const getDevices: Handler = async (ctx) => ({ body: (await mine(ctx)).map(device) })

/** Only the caller's own: anyone else's is not found. */
export const deleteDevice: Handler = async ({ store, caller }, params) => {
  const s = await store.get<PushSub>(caller.familyId, params.id, 'pushSub')
  if (!s || s.memberId !== caller.memberId) throw notFound('Device not found')
  await store.delete(caller.familyId, s.id)
  return { status: 204 }
}

/** A notification to each of the caller's phones, to check they arrive. */
export const sendTest: Handler = async (ctx) => {
  if (!(await mine(ctx)).length) throw badRequest('No phones have notifications turned on')
  const result = await sendTo(ctx.store, ctx.caller.familyId, [ctx.caller.memberId], { title: 'FamilyPlanner', body: 'Notifications are working on this phone.', tag: 'test', url: '/notifications', ttlSeconds: 600 }, ctx.now)
  return { body: result }
}
