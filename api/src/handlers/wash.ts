import { notFound } from '../lib/errors'
import type { Ctx, Handler } from '../lib/http'
import { notifyDue } from '../lib/notify'
import { parse, washAdjustSchema, washEmptiedSchema, washStartSchema } from '../lib/schemas'
import type { Programme, Wash } from '../lib/types'
import { stamp, touch } from '../lib/util'

/**
 * The washer-dryer (5.14). One machine, so one record. Members use these through /api/wash, and the wall
 * through /api/display/wash, its third, fourth and fifth writes (S34): start, adjust and empty, nothing else.
 */
const ID = 'wash'
const MINUTE = 60_000

/** A record saved before programmes said `dry: true` for wash & dry. */
type Legacy = { programme?: Programme; dry?: boolean }
const programmeOf = (w: Legacy): Programme => w.programme ?? (w.dry ? 'wash-dry' : 'wash')

/** The record, with any saved before programmes brought up to date. */
async function load({ store, caller }: Ctx) {
  const wash = await store.get<Wash>(caller.familyId, ID, 'wash')
  if (!wash) return undefined
  const { dry: _dry, ...rest } = wash as Wash & Legacy
  const usual: Wash['usual'] = {}
  for (const [l, u] of Object.entries(wash.usual ?? {}) as [keyof Wash['usual'], { minutes: number } & Legacy][]) usual[l] = { minutes: u.minutes, programme: programmeOf(u) }
  return { ...rest, load: wash.load ?? null, programme: programmeOf(wash as Wash & Legacy), usual } as Wash
}

/** What the app and wall show: the wash in the machine, if any, and each load's usual length. */
function view(wash: Wash | undefined, now: Date) {
  const current =
    wash && !wash.emptiedAt
      ? { load: wash.load, programme: wash.programme, minutes: wash.minutes, startsAt: wash.startsAt, endsAt: wash.endsAt, startedBy: wash.startedBy }
      : null
  // The server's clock, so a frame whose own clock is wrong still counts down to the right minute.
  return { wash: current, usual: wash?.usual ?? {}, now: now.toISOString() }
}

/**
 * The wall reads this every minute and the app every 30 seconds while open, so it is also what sends the
 * phone notifications that are due (5.15). There is no timer in the API to do it otherwise.
 */
export const getWash: Handler = async (ctx) => {
  const wash = await load(ctx)
  await notifyDue(ctx.store, ctx.caller.familyId, ctx.now, wash)
  return { body: view(wash, ctx.now) }
}

/** Starts a wash, replacing whatever was in the machine: loading it means the last one came out. */
export const startWash: Handler = async (ctx, _p, _q, body) => {
  const { caller, now, store } = ctx
  const input = parse(washStartSchema, body)
  const existing = await load(ctx)
  const startsAt = new Date(now.getTime() + input.delayMinutes * MINUTE)
  const fields = {
    load: input.load,
    programme: input.programme,
    minutes: input.minutes,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + input.minutes * MINUTE).toISOString(),
    startedBy: caller.memberId,
    emptiedAt: null,
    emptiedBy: null,
    // A new wash: its notifications (5.15) are still to send.
    readyNotifiedAt: null,
    lateNotifiedAt: null,
    // Remembered per kind of clothes, so only when that was said.
    usual: input.load ? { ...(existing?.usual ?? {}), [input.load]: { minutes: input.minutes, programme: input.programme } } : (existing?.usual ?? {}),
  }
  const saved = existing ? touch(caller, existing, fields) : stamp(caller, 'wash', fields, ID)
  await store.upsert(saved)
  return { status: 201, body: view(saved as Wash, now) }
}

/** The machine says longer or shorter than was entered. Changes the length and nothing else. */
export const adjustWash: Handler = async (ctx, _p, _q, body) => {
  const { minutes: by } = parse(washAdjustSchema, body)
  const wash = await load(ctx)
  if (!wash || wash.emptiedAt) throw notFound('Nothing in the washing machine')
  const minutes = Math.max(1, wash.minutes + by)
  const endsAt = new Date(Date.parse(wash.startsAt) + minutes * MINUTE).toISOString()
  // Moved later than now, it isn't ready after all, so it will be announced again when it is (5.15).
  const rearm = Date.parse(endsAt) > ctx.now.getTime() ? { readyNotifiedAt: null, lateNotifiedAt: null } : {}
  const saved = await ctx.store.upsert(touch(ctx.caller, wash, { minutes, endsAt, ...rearm }))
  return { body: view(saved, ctx.now) }
}

/** Emptied: collected when done, or called off before. Emptying twice changes nothing. */
export const setWashEmptied: Handler = async (ctx, _p, _q, body) => {
  parse(washEmptiedSchema, body)
  const wash = await load(ctx)
  if (!wash) throw notFound('Nothing in the washing machine')
  if (wash.emptiedAt) return { body: view(wash, ctx.now) }
  const saved = await ctx.store.upsert(touch(ctx.caller, wash, { emptiedAt: ctx.now.toISOString(), emptiedBy: ctx.caller.memberId }))
  return { body: view(saved, ctx.now) }
}
