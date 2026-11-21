import { beforeEach, describe, expect, it } from 'vitest'
import { adjustWash, getWash, setWashEmptied, startWash } from '../src/handlers/wash'
import { exportAll } from '../src/handlers/admin'
import type { Ctx } from '../src/lib/http'
import { MemoryStore } from '../src/lib/memoryStore'
import { ValidationError } from '../src/lib/schemas'
import { seed } from '../src/lib/seed'
import type { Caller, Wash } from '../src/lib/types'

/** 5.14: what's in the washer-dryer and when it's ready. */
process.env.FAMILY_ID = 'home'
const q = new URLSearchParams()
const tim: Caller = { memberId: 'm-tim', role: 'admin', familyId: 'home', displayName: 'Tim' }
const charlie: Caller = { memberId: 'm-charlie', role: 'member', familyId: 'home', displayName: 'Charlie' }
type View = { wash: { load: string; dry: boolean; minutes: number; startsAt: string; endsAt: string; startedBy: string } | null; usual: Record<string, { minutes: number; dry: boolean }>; now: string }

let store: MemoryStore
const at = (iso: string, caller = tim): Ctx => ({ store, caller, now: new Date(iso) })
const read = async (ctx = at('2026-11-21T10:00:00Z')) => (await getWash(ctx, {}, q, undefined)).body as View
const start = (body: unknown, ctx = at('2026-11-21T10:00:00Z')) => startWash(ctx, {}, q, body)

beforeEach(async () => {
  store = await MemoryStore.create(undefined, seed)
})

describe('the washing machine', () => {
  it('is empty to begin with, and says the server time', async () => {
    expect(await read()).toEqual({ wash: null, usual: {}, now: '2026-11-21T10:00:00.000Z' })
  })

  it('starts a wash that ends after its length, recorded as whoever started it', async () => {
    const res = await start({ load: 'Darks', minutes: 59 })
    expect(res.status).toBe(201)
    expect((await read()).wash).toEqual({ load: 'Darks', dry: false, minutes: 59, startsAt: '2026-11-21T10:00:00.000Z', endsAt: '2026-11-21T10:59:00.000Z', startedBy: 'm-tim' })
  })

  it('a delayed start begins later and ends its length after that', async () => {
    await start({ load: 'Towels', dry: true, minutes: 180, delayMinutes: 360 })
    expect((await read()).wash).toMatchObject({ dry: true, startsAt: '2026-11-21T16:00:00.000Z', endsAt: '2026-11-21T19:00:00.000Z' })
  })

  it('remembers each load’s last length and drying for next time', async () => {
    await start({ load: 'Darks', minutes: 59 })
    await start({ load: 'Towels', dry: true, minutes: 200 })
    await start({ load: 'Darks', minutes: 45 })
    expect((await read()).usual).toEqual({ Darks: { minutes: 45, dry: false }, Towels: { minutes: 200, dry: true } })
  })

  it('starting again replaces the wash in the machine, even one that was emptied', async () => {
    await start({ load: 'Darks', minutes: 59 })
    await setWashEmptied(at('2026-11-21T11:30:00Z'), {}, q, { emptied: true })
    await start({ load: 'Lights', minutes: 30 }, at('2026-11-21T12:00:00Z', charlie))
    expect((await read()).wash).toMatchObject({ load: 'Lights', startedBy: 'm-charlie', endsAt: '2026-11-21T12:30:00.000Z' })
    expect(await store.byType<Wash>('home', 'wash')).toHaveLength(1)
  })

  it('emptying clears it, recorded as whoever emptied it', async () => {
    await start({ load: 'Darks', minutes: 59 })
    await setWashEmptied(at('2026-11-21T11:30:00Z', charlie), {}, q, { emptied: true })
    expect((await read()).wash).toBeNull()
    expect(await store.get<Wash>('home', 'wash', 'wash')).toMatchObject({ emptiedAt: '2026-11-21T11:30:00.000Z', emptiedBy: 'm-charlie' })
  })

  it('cannot be un-emptied: there is no undo', async () => {
    await start({ load: 'Darks', minutes: 59 })
    await setWashEmptied(at('2026-11-21T11:30:00Z'), {}, q, { emptied: true })
    for (const body of [{ emptied: false }, {}, { emptied: 'no' }]) {
      await expect(setWashEmptied(at('2026-11-21T11:30:05Z'), {}, q, body), JSON.stringify(body)).rejects.toBeInstanceOf(ValidationError)
    }
    expect((await read()).wash).toBeNull()
  })

  it('emptying twice keeps the first time and who did it', async () => {
    await start({ load: 'Darks', minutes: 59 })
    await setWashEmptied(at('2026-11-21T11:30:00Z', charlie), {}, q, { emptied: true })
    await setWashEmptied(at('2026-11-21T11:45:00Z'), {}, q, { emptied: true })
    expect(await store.get<Wash>('home', 'wash', 'wash')).toMatchObject({ emptiedAt: '2026-11-21T11:30:00.000Z', emptiedBy: 'm-charlie' })
  })

  it('can be emptied before it is done, to call off a wrong entry', async () => {
    await start({ load: 'Darks', minutes: 59 })
    await setWashEmptied(at('2026-11-21T10:05:00Z'), {}, q, { emptied: true })
    expect((await read()).wash).toBeNull()
  })

  it('emptying with nothing ever started is a 404', async () => {
    await expect(setWashEmptied(at('2026-11-21T10:00:00Z'), {}, q, { emptied: true })).rejects.toMatchObject({ status: 404 })
  })

  it('adjusting changes the length and end, never below a minute', async () => {
    await start({ load: 'Darks', minutes: 59, delayMinutes: 60 })
    await adjustWash(at('2026-11-21T10:10:00Z'), {}, q, { minutes: 10 })
    expect((await read()).wash).toMatchObject({ minutes: 69, startsAt: '2026-11-21T11:00:00.000Z', endsAt: '2026-11-21T12:09:00.000Z' })
    await adjustWash(at('2026-11-21T10:10:00Z'), {}, q, { minutes: -120 })
    expect((await read()).wash).toMatchObject({ minutes: 1, endsAt: '2026-11-21T11:01:00.000Z' })
  })

  it('adjusting an emptied machine is a 404', async () => {
    await start({ load: 'Darks', minutes: 59 })
    await setWashEmptied(at('2026-11-21T11:30:00Z'), {}, q, { emptied: true })
    await expect(adjustWash(at('2026-11-21T11:31:00Z'), {}, q, { minutes: 10 })).rejects.toMatchObject({ status: 404 })
  })

  it('takes only the listed loads and sensible lengths, and nothing it was not asked for', async () => {
    for (const body of [{ load: 'Socks', minutes: 30 }, { load: 'Darks' }, { load: 'Darks', minutes: 0 }, { load: 'Darks', minutes: 1441 }, { load: 'Darks', minutes: 30, delayMinutes: -5 }, { load: 'Darks', minutes: 30, delayMinutes: 1441 }, { load: 'Darks', minutes: 2.5 }]) {
      await expect(start(body), JSON.stringify(body)).rejects.toBeInstanceOf(ValidationError)
    }
    await start({ load: 'Darks', minutes: 30, startedBy: 'm-jo', endsAt: '2030-01-01T00:00:00Z', familyId: 'other' })
    expect(await store.get<Wash>('home', 'wash', 'wash')).toMatchObject({ startedBy: 'm-tim', endsAt: '2026-11-21T10:30:00.000Z', familyId: 'home' })
    await expect(adjustWash(at('2026-11-21T10:00:00Z'), {}, q, { minutes: 0 })).rejects.toBeInstanceOf(ValidationError)
    await expect(adjustWash(at('2026-11-21T10:00:00Z'), {}, q, { minutes: 121 })).rejects.toBeInstanceOf(ValidationError)
  })

  it('takes a long wash, up to a day', async () => {
    await start({ load: 'Bedding', dry: true, minutes: 24 * 60 })
    expect((await read()).wash).toMatchObject({ minutes: 1440, endsAt: '2026-11-22T10:00:00.000Z' })
  })

  it('is in the export', async () => {
    await start({ load: 'Darks', minutes: 59 })
    const out = (await exportAll(at('2026-11-21T10:00:00Z'), {}, q, undefined)).body as Record<string, unknown[]>
    expect(out.wash).toHaveLength(1)
  })
})
