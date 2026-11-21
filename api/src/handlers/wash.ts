import { notFound } from '../lib/errors'
import type { Ctx, Handler } from '../lib/http'
import { parse, washAdjustSchema, washEmptiedSchema, washStartSchema } from '../lib/schemas'
import type { Wash } from '../lib/types'
import { stamp, touch } from '../lib/util'

/**
 * The washer-dryer (5.14). One machine, so one record. Members use these through /api/wash, and the wall
 * through /api/display/wash, its third, fourth and fifth writes (S34): start, adjust and empty, nothing else.
 */
const ID = 'wash'
const MINUTE = 60_000

const load = ({ store, caller }: Ctx) => store.get<Wash>(caller.familyId, ID, 'wash')

/** What the app and wall show: the wash in the machine, if any, and each load's usual length. */
function view(wash: Wash | undefined, now: Date) {
  const current =
    wash && !wash.emptiedAt
      ? { load: wash.load, dry: wash.dry, minutes: wash.minutes, startsAt: wash.startsAt, endsAt: wash.endsAt, startedBy: wash.startedBy }
      : null
  // The server's clock, so a frame whose own clock is wrong still counts down to the right minute.
  return { wash: current, usual: wash?.usual ?? {}, now: now.toISOString() }
}

export const getWash: Handler = async (ctx) => ({ body: view(await load(ctx), ctx.now) })

/** Starts a wash, replacing whatever was in the machine: loading it means the last one came out. */
export const startWash: Handler = async (ctx, _p, _q, body) => {
  const { caller, now, store } = ctx
  const input = parse(washStartSchema, body)
  const existing = await load(ctx)
  const startsAt = new Date(now.getTime() + input.delayMinutes * MINUTE)
  const fields = {
    load: input.load,
    dry: input.dry,
    minutes: input.minutes,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + input.minutes * MINUTE).toISOString(),
    startedBy: caller.memberId,
    emptiedAt: null,
    emptiedBy: null,
    usual: { ...(existing?.usual ?? {}), [input.load]: { minutes: input.minutes, dry: input.dry } },
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
  const saved = await ctx.store.upsert(touch(ctx.caller, wash, { minutes, endsAt }))
  return { body: view(saved, ctx.now) }
}

/** Emptied: collected when done, or called off before. `false` is Undo, and puts it back as it was. */
export const setWashEmptied: Handler = async (ctx, _p, _q, body) => {
  const { emptied } = parse(washEmptiedSchema, body)
  const wash = await load(ctx)
  if (!wash) throw notFound('Nothing in the washing machine')
  if (emptied === !!wash.emptiedAt) return { body: view(wash, ctx.now) }
  const saved = await ctx.store.upsert(
    touch(ctx.caller, wash, emptied ? { emptiedAt: ctx.now.toISOString(), emptiedBy: ctx.caller.memberId } : { emptiedAt: null, emptiedBy: null }),
  )
  return { body: view(saved, ctx.now) }
}
