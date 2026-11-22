import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportAll, removeMember } from '../src/handlers/admin'
import { getMe, patchMe } from '../src/handlers/me'
import { deleteDevice, getDevices, getPushKey, saveSubscription, sendTest } from '../src/handlers/push'
import { adjustWash, getWash, setWashEmptied, startWash } from '../src/handlers/wash'
import { clearFeedCache, type ExternalOccurrence } from '../src/lib/googleCalendars'
import type { Ctx } from '../src/lib/http'
import { MemoryStore } from '../src/lib/memoryStore'
import { summaryNotice } from '../src/lib/notify'
import { pushSubId, setSender, type PushTarget } from '../src/lib/push'
import { isPushEndpoint, ValidationError } from '../src/lib/schemas'
import { seed } from '../src/lib/seed'
import type { Caller, PlanEntry, PushSub, Wash } from '../src/lib/types'

/** 5.15: washing ready and the evening summary, sent from the wash reads the wall and app already make. */
process.env.FAMILY_ID = 'home'
const q = new URLSearchParams()
const tim: Caller = { memberId: 'm-tim', role: 'admin', familyId: 'home', displayName: 'Tim' }
const jo: Caller = { memberId: 'm-jo', role: 'admin', familyId: 'home', displayName: 'Jo' }
const charlie: Caller = { memberId: 'm-charlie', role: 'member', familyId: 'home', displayName: 'Charlie' }
const wall: Caller = { memberId: 'display:d1', role: 'display', familyId: 'home', displayName: 'Kitchen' }

const endpoint = (who: string, host = 'fcm.googleapis.com') => `https://${host}/fcm/send/${who}-device`
const sub = (who: string, host?: string) => ({ endpoint: endpoint(who, host), keys: { p256dh: 'BPk3' + 'a'.repeat(80), auth: 'c2VjcmV0' }, label: 'Android' })

let store: MemoryStore
let sent: { to: string; notice: { title: string; body: string; tag: string; url: string }; ttl: number }[]
let gone: Set<string>
const at = (iso: string, caller = tim): Ctx => ({ store, caller, now: new Date(iso) })
const readWash = (iso: string, caller = wall) => getWash(at(iso, caller), {}, q, undefined)
const titles = () => sent.map((s) => `${s.to}: ${s.notice.title}`).sort()

beforeAll(() => {
  process.env.VAPID_PUBLIC_KEY = 'BPublicKeyForTests'
  process.env.VAPID_PRIVATE_KEY = 'private-key-for-tests'
})
afterAll(() => {
  delete process.env.VAPID_PUBLIC_KEY
  delete process.env.VAPID_PRIVATE_KEY
  setSender(undefined)
})

beforeEach(async () => {
  store = await MemoryStore.create(undefined, seed)
  // The seed plans meals around today; these tests choose their own.
  for (const p of await store.byType<PlanEntry>('home', 'plan')) await store.delete('home', p.id)
  sent = []
  gone = new Set()
  setSender(async (target: PushTarget, payload: string, ttl: number) => {
    if (gone.has(target.endpoint)) return { gone: true }
    sent.push({ to: target.endpoint.split('/').pop()!.replace('-device', ''), notice: JSON.parse(payload), ttl })
    return { gone: false }
  })
  await saveSubscription(at('2026-11-22T09:00:00Z', tim), {}, q, sub('tim'))
  await saveSubscription(at('2026-11-22T09:00:00Z', jo), {}, q, sub('jo', 'web.push.apple.com'))
})

describe('subscribing', () => {
  it('gives the browser the public key, never the private one', async () => {
    expect((await getPushKey(at('2026-11-22T09:00:00Z'), {}, q, undefined)).body).toEqual({ key: 'BPublicKeyForTests' })
  })

  it('S35: only the push services phones use are accepted', () => {
    expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true)
    expect(isPushEndpoint('https://web.push.apple.com/QGx')).toBe(true)
    expect(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true)
    expect(isPushEndpoint('https://wns2-db5p.notify.windows.com/w/?token=x')).toBe(true)
    expect(isPushEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false)
    expect(isPushEndpoint('https://fcm.googleapis.com.evil.example/x')).toBe(false)
    expect(isPushEndpoint('https://evilpush.apple.com.example/x')).toBe(false)
    expect(isPushEndpoint('https://169.254.169.254/metadata')).toBe(false)
    expect(isPushEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false)
    expect(isPushEndpoint('https://user:pw@fcm.googleapis.com/x')).toBe(false)
  })

  it('A13c: a subscription to anywhere else is refused and nothing is stored', async () => {
    await expect(saveSubscription(at('2026-11-22T09:00:00Z', charlie), {}, q, { ...sub('c'), endpoint: 'https://example.com/hook' })).rejects.toBeInstanceOf(ValidationError)
    expect((await getDevices(at('2026-11-22T09:00:00Z', charlie), {}, q, undefined)).body).toEqual([])
  })

  it('never sends a subscription back: devices show only id, label and date', async () => {
    const res = await getDevices(at('2026-11-22T09:00:00Z', tim), {}, q, undefined)
    expect(res.body).toEqual([{ id: pushSubId(endpoint('tim')), label: 'Android', createdAt: expect.any(String) }])
    expect(JSON.stringify(res.body)).not.toContain('fcm')
  })

  it('saving the same phone again replaces it, and moves it to whoever is signed in now', async () => {
    await saveSubscription(at('2026-11-22T10:00:00Z', charlie), {}, q, sub('tim'))
    const subs = await store.byType<PushSub>('home', 'pushSub')
    expect(subs.filter((s) => s.endpoint === endpoint('tim')).map((s) => s.memberId)).toEqual(['m-charlie'])
  })

  it('a person can remove only their own devices', async () => {
    const id = pushSubId(endpoint('tim'))
    await expect(deleteDevice(at('2026-11-22T10:00:00Z', jo), { id }, q, undefined)).rejects.toMatchObject({ status: 404 })
    await deleteDevice(at('2026-11-22T10:00:00Z', tim), { id }, q, undefined)
    expect((await getDevices(at('2026-11-22T10:00:00Z', tim), {}, q, undefined)).body).toEqual([])
  })

  it('A9n: a test goes to the caller’s phones only', async () => {
    await sendTest(at('2026-11-22T10:00:00Z', tim), {}, q, {})
    expect(titles()).toEqual(['tim: FamilyPlanner'])
    await expect(sendTest(at('2026-11-22T10:00:00Z', charlie), {}, q, {})).rejects.toMatchObject({ status: 400 })
  })

  it('choices default to both on, and a person can change their own', async () => {
    expect((await getMe(at('2026-11-22T10:00:00Z', jo), {}, q, undefined)).body).toMatchObject({ notify: { wash: true, summary: true } })
    const res = await patchMe(at('2026-11-22T10:00:00Z', jo), {}, q, { notify: { wash: false, summary: true } })
    expect(res.body).toMatchObject({ notify: { wash: false, summary: true } })
  })

  it('S35: removing a member removes their phones, and the export has no subscriptions', async () => {
    await removeMember(at('2026-11-22T10:00:00Z', tim), { id: 'm-jo' }, q, undefined)
    expect((await store.byType<PushSub>('home', 'pushSub')).map((s) => s.memberId)).toEqual(['m-tim'])
    const out = JSON.stringify((await exportAll(at('2026-11-22T10:00:00Z', tim), {}, q, undefined)).body)
    expect(out).not.toContain('fcm.googleapis.com')
    expect(out).not.toContain('pushSub')
  })

  it('a push service saying a phone is gone removes that phone', async () => {
    gone.add(endpoint('jo', 'web.push.apple.com'))
    await sendTest(at('2026-11-22T10:00:00Z', jo), {}, q, {})
    expect(await store.byType<PushSub>('home', 'pushSub')).toHaveLength(1)
  })
})

describe('A9o: washing ready', () => {
  const startAt = (body: object, iso = '2026-11-22T10:00:00Z', caller = wall) => startWash(at(iso, caller), {}, q, body)

  it('nothing while it runs, then "Washing ready" once to every adult, whoever started it', async () => {
    await startAt({ load: 'Darks', programme: 'wash-dry', minutes: 10 })
    await readWash('2026-11-22T10:09:00Z')
    expect(sent).toEqual([])
    await readWash('2026-11-22T10:10:30Z')
    await readWash('2026-11-22T10:11:00Z', tim)
    expect(titles()).toEqual(['jo: Washing ready', 'tim: Washing ready'])
    expect(sent[0].notice).toMatchObject({ body: 'Darks, wash & dry. Ready since 10:10.', tag: 'wash', url: '/' })
  })

  it('says the time in UK time', async () => {
    await startAt({ minutes: 30 }, '2026-07-01T10:00:00Z')
    await readWash('2026-07-01T10:31:00Z')
    expect(sent[0].notice.body).toBe('Wash. Ready since 11:30.')
  })

  it('then "Washing still waiting" two hours later, with the same tag so it replaces the first', async () => {
    await startAt({ minutes: 10 })
    await readWash('2026-11-22T10:10:00Z')
    sent = []
    await readWash('2026-11-22T12:09:00Z')
    expect(sent).toEqual([])
    await readWash('2026-11-22T12:10:00Z')
    await readWash('2026-11-22T12:11:00Z')
    expect(titles()).toEqual(['jo: Washing still waiting', 'tim: Washing still waiting'])
    expect(sent[0].notice.tag).toBe('wash')
  })

  it('only the second, if the first read after the end is already two hours late', async () => {
    await startAt({ minutes: 10 })
    await readWash('2026-11-22T13:00:00Z')
    expect(titles()).toEqual(['jo: Washing still waiting', 'tim: Washing still waiting'])
  })

  it('nothing about a wash that finished more than 12 hours ago', async () => {
    await startAt({ minutes: 10 })
    await readWash('2026-11-23T00:00:00Z')
    expect(sent).toEqual([])
  })

  it('nothing once emptied', async () => {
    await startAt({ minutes: 10 })
    await setWashEmptied(at('2026-11-22T10:05:00Z'), {}, q, { emptied: true })
    await readWash('2026-11-22T10:15:00Z')
    expect(sent).toEqual([])
  })

  it('moved later after it was announced, it is announced again at the new end', async () => {
    await startAt({ minutes: 10 })
    await readWash('2026-11-22T10:10:00Z')
    await adjustWash(at('2026-11-22T10:12:00Z'), {}, q, { minutes: 10 })
    await readWash('2026-11-22T10:15:00Z')
    expect(sent).toHaveLength(2)
    await readWash('2026-11-22T10:20:00Z')
    expect(sent).toHaveLength(4)
  })

  it('starting a new wash re-arms it', async () => {
    await startAt({ minutes: 10 })
    await readWash('2026-11-22T10:10:00Z')
    await startAt({ minutes: 10 }, '2026-11-22T10:30:00Z')
    expect(await store.get<Wash>('home', 'wash', 'wash')).toMatchObject({ readyNotifiedAt: null, lateNotifiedAt: null })
    await readWash('2026-11-22T10:40:00Z')
    expect(sent).toHaveLength(4)
  })

  it('not to anyone who turned washing off', async () => {
    await patchMe(at('2026-11-22T09:00:00Z', jo), {}, q, { notify: { wash: false, summary: true } })
    await startAt({ minutes: 10 })
    await readWash('2026-11-22T10:10:00Z')
    expect(titles()).toEqual(['tim: Washing ready'])
  })

  it('the wash read never fails because a notification did', async () => {
    setSender(async () => {
      throw new Error('push failed: 500')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await startAt({ minutes: 10 })
    const res = await readWash('2026-11-22T10:10:00Z')
    expect((res.body as { wash: unknown }).wash).not.toBeNull()
    expect(warn.mock.calls.join(' ')).not.toContain('fcm.googleapis.com')
    warn.mockRestore()
  })

  it('the wash read shows none of the notification bookkeeping', async () => {
    await startAt({ minutes: 10 })
    const res = await readWash('2026-11-22T10:10:00Z')
    expect(JSON.stringify(res.body)).not.toContain('Notified')
  })
})

describe('A9p: the evening summary', () => {
  const SECRET = 'https://calendar.google.com/calendar/ical/x/private-s3cret/basic.ics'
  const FEED = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:dentist@google.com',
    'DTSTART:20261123T090000Z',
    'DTEND:20261123T093000Z',
    'SUMMARY:Dentist',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:bins@google.com',
    'DTSTART;VALUE=DATE:20261124',
    'DTEND;VALUE=DATE:20261125',
    'SUMMARY:Bin day',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  beforeEach(async () => {
    clearFeedCache()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(FEED, { status: 200 })))
    process.env.GOOGLE_CALENDARS = JSON.stringify([{ label: 'Family', url: SECRET }])
    const plan = (date: string, slot: string, text: string) => ({ id: `plan:${date}:${slot}`, familyId: 'home', type: 'plan' as const, date, slot: slot as 'dinner', text, createdAt: '', createdBy: 'm-tim', updatedAt: '', updatedBy: 'm-tim' })
    await store.upsert(plan('2026-11-23', 'dinner', 'Lasagne'))
    await store.upsert(plan('2026-11-23', 'lunch', 'Soup'))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.GOOGLE_CALENDARS
  })

  it('is sent at 20:00, once, with tomorrow’s and the next day’s meals and events', async () => {
    await readWash('2026-11-22T19:59:00Z')
    expect(sent).toEqual([])
    await readWash('2026-11-22T20:00:00Z')
    await readWash('2026-11-22T20:01:00Z', tim)
    expect(titles()).toEqual(['jo: Tomorrow and Tuesday', 'tim: Tomorrow and Tuesday'])
    expect(sent[0].notice.body).toBe(['Mon 23 Nov', 'Lunch: Soup', 'Dinner: Lasagne', '09:00: Dentist', 'Tue 24 Nov', 'No meals planned', 'All day: Bin day'].join('\n'))
    expect(sent[0].notice).toMatchObject({ tag: 'summary', url: '/' })
    expect(JSON.stringify(sent)).not.toContain('s3cret')
  })

  it('again the next evening', async () => {
    await readWash('2026-11-22T20:00:00Z')
    await readWash('2026-11-23T20:00:00Z')
    expect(sent).toHaveLength(4)
  })

  it('not at all if it couldn’t be sent by 22:00', async () => {
    await readWash('2026-11-22T22:00:00Z')
    expect(sent).toEqual([])
  })

  it('20:00 is UK time, so in summer it is 19:00 UTC', async () => {
    await readWash('2026-07-01T18:59:00Z')
    expect(sent).toEqual([])
    await readWash('2026-07-01T19:00:00Z')
    expect(sent).toHaveLength(2)
  })

  it('not to anyone who turned it off', async () => {
    await patchMe(at('2026-11-22T09:00:00Z', tim), {}, q, { notify: { wash: true, summary: false } })
    await readWash('2026-11-22T20:00:00Z')
    expect(titles()).toEqual(['jo: Tomorrow and Tuesday'])
  })
})

describe('the summary text', () => {
  const ev = (title: string, start: string, end: string, allDay = false): ExternalOccurrence => ({
    id: title,
    title,
    allDay,
    start,
    end,
    occurrenceDate: allDay ? start : start.slice(0, 10),
    recurring: false,
    external: { label: 'Family', colour: '#000' },
  })
  const input = { days: ['2026-11-23', '2026-11-24'] as [string, string], meals: [], breakfastEnabled: false, events: [], unavailable: false }

  it('says when no meals are planned, even with nothing else on', () => {
    expect(summaryNotice(input).body).toBe('Mon 23 Nov\nNo meals planned\nTue 24 Nov\nNo meals planned')
  })

  it('shows breakfast only when it is enabled, in slot order', () => {
    const meals = [
      { date: '2026-11-23', slot: 'dinner' as const, text: 'Pie' },
      { date: '2026-11-23', slot: 'breakfast' as const, text: 'Pancakes' },
    ]
    expect(summaryNotice({ ...input, meals }).body.split('\n').slice(0, 2)).toEqual(['Mon 23 Nov', 'Dinner: Pie'])
    expect(summaryNotice({ ...input, meals, breakfastEnabled: true }).body.split('\n').slice(0, 3)).toEqual(['Mon 23 Nov', 'Breakfast: Pancakes', 'Dinner: Pie'])
  })

  it('shows at most six events a day, then how many more', () => {
    const events = Array.from({ length: 8 }, (_, i) => ev(`E${i}`, `2026-11-23T0${i}:00:00Z`, `2026-11-23T0${i}:30:00Z`))
    const lines = summaryNotice({ ...input, events }).body.split('\n')
    expect(lines.filter((l) => l.startsWith('0'))).toHaveLength(6)
    expect(lines).toContain('and 2 more')
  })

  it('a trip over both days shows on each, and one that started earlier shows as all day', () => {
    const events = [ev('Away', '2026-11-22T18:00:00Z', '2026-11-24T10:00:00Z'), ev('Half term', '2026-11-23', '2026-11-24', true)]
    expect(summaryNotice({ ...input, events }).body).toBe(
      ['Mon 23 Nov', 'No meals planned', 'All day: Half term', 'All day: Away', 'Tue 24 Nov', 'No meals planned', 'All day: Half term', 'All day: Away'].join('\n'),
    )
  })

  it('says when a calendar couldn’t be read', () => {
    expect(summaryNotice({ ...input, unavailable: true }).body).toMatch(/Some calendars couldn't be read\.$/)
  })
})
