import { planBetween } from '../handlers/plan'
import { addDays, dateOf, wallClock } from './dates'
import { readCalendars, type ExternalOccurrence } from './googleCalendars'
import { membersWanting, pushConfigured, sendTo, type Notice } from './push'
import type { Store } from './store'
import type { NotifyState, Programme, Settings, Slot, Wash } from './types'

/**
 * What's due to be sent (5.15). There is no timer: the wall asks for the washing machine every minute and the app
 * every 30 seconds while open, and each of those reads runs this. Each notice is recorded before it is sent, so
 * the next read doesn't send it again. Two reads at the same moment could both send, which is harmless: the
 * second replaces the first on the phone because they share a tag.
 */
export const TZ = 'Europe/London'
const HOUR = 3_600_000
/** As on the dashboard and wall, which turn darker red at two hours (5.14). */
export const LATE_AFTER_MS = 2 * HOUR
/** A wash left this long is old news: nothing more is sent about it. */
export const STALE_AFTER_MS = 12 * HOUR
export const SUMMARY_FROM_HOUR = 20
export const SUMMARY_UNTIL_HOUR = 22
export const MAX_EVENTS_PER_DAY = 6

const PROGRAMMES: Record<Programme, string> = { wash: 'Wash', 'wash-dry': 'Wash & dry', dry: 'Dry only' }

/** "Darks", "Darks, wash & dry", or "Wash & dry" when the kind of clothes wasn't said, as the app says it. */
export function washLabel(w: Pick<Wash, 'load' | 'programme'>) {
  if (!w.load) return PROGRAMMES[w.programme]
  return w.programme === 'wash' ? w.load : `${w.load}, ${PROGRAMMES[w.programme].toLowerCase()}`
}

const hhmm = (instant: Date) => {
  const { hh, mm } = wallClock(instant, TZ)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** The washing notice that's due now, if any, and the record as it should be saved first. */
export function washDue(wash: Wash | undefined, now: Date): { notice: Notice; saved: Wash } | undefined {
  if (!wash || wash.emptiedAt) return undefined
  const ended = Date.parse(wash.endsAt)
  const waited = now.getTime() - ended
  if (waited < 0 || waited >= STALE_AFTER_MS) return undefined
  const body = `${washLabel(wash)}. Ready since ${hhmm(new Date(ended))}.`
  const base = { tag: 'wash', url: '/', body }
  if (waited >= LATE_AFTER_MS) {
    if (wash.lateNotifiedAt) return undefined
    const at = now.toISOString()
    return {
      notice: { ...base, title: 'Washing still waiting', ttlSeconds: 2 * 3600 },
      saved: { ...wash, readyNotifiedAt: wash.readyNotifiedAt ?? at, lateNotifiedAt: at },
    }
  }
  if (wash.readyNotifiedAt) return undefined
  return { notice: { ...base, title: 'Washing ready', ttlSeconds: 2 * 3600 }, saved: { ...wash, readyNotifiedAt: now.toISOString() } }
}

// Dates are calendar dates, so format them at noon UTC to stay on the right day.
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const weekdayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' })
const noon = (date: string) => new Date(`${date}T12:00:00Z`)

/** The dates an event shows on, as the dashboard groups them: each day it covers. */
function eventDays(e: ExternalOccurrence): [string, string] {
  return e.allDay ? [e.start, e.end] : [dateOf(new Date(e.start), TZ), dateOf(new Date(e.end), TZ)]
}

export interface SummaryInput {
  /** The two dates, tomorrow first. */
  days: [string, string]
  meals: { date: string; slot: Slot; text: string }[]
  breakfastEnabled: boolean
  events: ExternalOccurrence[]
  unavailable: boolean
}

/** The evening summary's text: for each day, its meals and then its events, all-day ones first. */
export function summaryNotice({ days, meals, breakfastEnabled, events, unavailable }: SummaryInput): Notice {
  const slots: Slot[] = breakfastEnabled ? ['breakfast', 'lunch', 'dinner'] : ['lunch', 'dinner']
  const lines: string[] = []
  for (const day of days) {
    lines.push(dayFmt.format(noon(day)))
    const planned = slots.flatMap((slot) => {
      const m = meals.find((p) => p.date === day && p.slot === slot)
      return m ? [`${slot[0].toUpperCase()}${slot.slice(1)}: ${m.text}`] : []
    })
    lines.push(...(planned.length ? planned : ['No meals planned']))
    const todays = events.filter((e) => {
      const [first, last] = eventDays(e)
      return first <= day && day <= last
    })
    todays.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start))
    for (const e of todays.slice(0, MAX_EVENTS_PER_DAY)) {
      const startsToday = !e.allDay && dateOf(new Date(e.start), TZ) === day
      lines.push(`${e.allDay || !startsToday ? 'All day' : hhmm(new Date(e.start))}: ${e.title}`)
    }
    if (todays.length > MAX_EVENTS_PER_DAY) lines.push(`and ${todays.length - MAX_EVENTS_PER_DAY} more`)
  }
  if (unavailable) lines.push("Some calendars couldn't be read.")
  return {
    title: `Tomorrow and ${weekdayFmt.format(noon(days[1]))}`,
    body: lines.join('\n'),
    tag: 'summary',
    url: '/',
    ttlSeconds: 12 * 3600,
  }
}

/** The date the evening summary is due for now, if it's the summary's time of day. */
export function summaryDate(now: Date): string | undefined {
  const { hh } = wallClock(now, TZ)
  return hh >= SUMMARY_FROM_HOUR && hh < SUMMARY_UNTIL_HOUR ? dateOf(now, TZ) : undefined
}

/**
 * Sends whatever is due. `wash` is the record the caller has just read, already brought up to date.
 * Never throws: a read of the washing machine must not fail because a notification did.
 */
export async function notifyDue(store: Store, familyId: string, now: Date, wash: Wash | undefined): Promise<{ sent: number; removed: number }> {
  const total = { sent: 0, removed: 0 }
  if (!pushConfigured()) return total
  const add = (r: { sent: number; removed: number }) => {
    total.sent += r.sent
    total.removed += r.removed
  }
  try {
    const due = washDue(wash, now)
    if (due) {
      await store.upsert(due.saved)
      add(await sendTo(store, familyId, await membersWanting(store, familyId, 'wash'), due.notice, now))
    }

    const today = summaryDate(now)
    if (today) {
      const state = await store.get<NotifyState>(familyId, 'notify', 'notifyState')
      if (state?.summarySentFor !== today) {
        const stamp = now.toISOString()
        await store.upsert<NotifyState>(
          state
            ? { ...state, summarySentFor: today, updatedAt: stamp, updatedBy: 'notify' }
            : { id: 'notify', type: 'notifyState', familyId, summarySentFor: today, createdAt: stamp, createdBy: 'notify', updatedAt: stamp, updatedBy: 'notify' },
        )
        const days: [string, string] = [addDays(today, 1), addDays(today, 2)]
        const [meals, settings, calendars] = await Promise.all([
          planBetween(store, familyId, days[0], days[1]),
          store.get<Settings>(familyId, 'settings', 'settings'),
          readCalendars(days[0], days[1], now.getTime()),
        ])
        const notice = summaryNotice({ days, meals, breakfastEnabled: settings?.breakfastEnabled ?? false, events: calendars.events, unavailable: calendars.unavailable })
        add(await sendTo(store, familyId, await membersWanting(store, familyId, 'summary'), notice, now))
      }
    }
  } catch (e) {
    console.warn(`notify: ${(e as Error).message}`)
  }
  return total
}
