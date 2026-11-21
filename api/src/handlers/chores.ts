import { addDays, mondayOf } from '../lib/dates'
import { badRequest, notFound } from '../lib/errors'
import type { Handler } from '../lib/http'
import { choreAssignSchema, choreSchema, copyWeekSchema, dateSchema, parse } from '../lib/schemas'
import type { Store } from '../lib/store'
import type { Chore, ChoreWeek, Member } from '../lib/types'
import { stamp, touch } from '../lib/util'

const assignmentId = (week: string, choreId: string) => `chorewk:${week}:${choreId}`
const weekOf = (date: unknown) => mondayOf(parse(dateSchema, date))

async function getChore(store: Store, familyId: string, id: string) {
  const chore = await store.get<Chore>(familyId, id, 'chore')
  if (!chore) throw notFound('Chore not found')
  return chore
}

const DAY = 86_400_000
const weeksBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / (7 * DAY))

/** Whether a chore comes round in the week starting on this Monday (R1). Weekly chores always do. */
export function isDue(chore: Pick<Chore, 'everyWeeks' | 'fromWeek'>, week: string) {
  const every = chore.everyWeeks ?? 1
  if (every <= 1 || !chore.fromWeek) return true
  return ((weeksBetween(chore.fromWeek, week) % every) + every) % every === 0
}

/** The first week on or after this one in which the chore is due. */
export function nextDue(chore: Pick<Chore, 'everyWeeks' | 'fromWeek'>, week: string) {
  for (let w = week, i = 0; i < 53; i++, w = addDays(w, 7)) if (isDue(chore, w)) return w
  return week
}

const view = ({ id, name, everyWeeks, fromWeek }: Chore) => ({ id, name, everyWeeks: everyWeeks ?? 1, ...(fromWeek && (everyWeeks ?? 1) > 1 ? { fromWeek } : {}) })

/** The repeat to store: weekly drops the start week, and any other repeat needs one, defaulting to this week. */
function repeatOf(input: { everyWeeks?: number; fromWeek?: string }, existing: Chore | undefined, now: Date) {
  const everyWeeks = input.everyWeeks ?? existing?.everyWeeks ?? 1
  if (everyWeeks <= 1) return { everyWeeks: 1, fromWeek: undefined }
  const from = input.fromWeek ?? existing?.fromWeek ?? now.toISOString().slice(0, 10)
  return { everyWeeks, fromWeek: mondayOf(from) }
}

async function activeMemberIds(store: Store, familyId: string) {
  const members = await store.byType<Member>(familyId, 'member')
  return new Set(members.filter((m) => m.active && m.role !== 'display').map((m) => m.id))
}

export const getChores: Handler = async ({ store, caller }, _p, query) => {
  const week = weekOf(query.get('week'))
  const [chores, assignments] = await Promise.all([store.byType<Chore>(caller.familyId, 'chore'), store.byType<ChoreWeek>(caller.familyId, 'choreWeek')])
  chores.sort((a, b) => a.name.localeCompare(b.name))
  const due = chores.filter((c) => isDue(c, week))
  const dueIds = new Set(due.map((c) => c.id))
  return {
    body: {
      // Only the chores that come round this week, so the dashboard, wall and chat need no rule of their own.
      chores: due.map(view),
      assignments: assignments.filter((a) => a.week === week && dueIds.has(a.choreId)).map(({ choreId, memberId }) => ({ choreId, memberId })),
      // The rest, for the Chores page to list and edit, each with the next week it comes round.
      notDue: chores.filter((c) => !dueIds.has(c.id)).map((c) => ({ ...view(c), nextWeek: nextDue(c, week) })),
    },
  }
}

export const createChore: Handler = async ({ store, caller, now }, _p, _q, body) => {
  const input = parse(choreSchema, body)
  const saved = await store.upsert(stamp(caller, 'chore', { name: input.name, ...repeatOf(input, undefined, now) }))
  return { status: 201, body: view(saved as Chore) }
}

/** Changing the repeat leaves past assignments alone; those in weeks it is no longer due are simply not shown. */
export const patchChore: Handler = async ({ store, caller, now }, params, _q, body) => {
  const chore = await getChore(store, caller.familyId, params.id)
  const input = parse(choreSchema, body)
  return { body: view(await store.upsert(touch(caller, chore, { name: input.name, ...repeatOf(input, chore, now) }))) }
}

/** Takes the chore's past and future weeks with it. */
export const deleteChore: Handler = async ({ store, caller }, params) => {
  const chore = await getChore(store, caller.familyId, params.id)
  const assignments = await store.byType<ChoreWeek>(caller.familyId, 'choreWeek')
  for (const a of assignments) if (a.choreId === chore.id) await store.delete(caller.familyId, a.id)
  await store.delete(caller.familyId, chore.id)
  return { status: 204 }
}

export const assignChore: Handler = async ({ store, caller }, params, _q, body) => {
  const week = weekOf(params.week)
  const chore = await getChore(store, caller.familyId, params.id)
  const { memberId } = parse(choreAssignSchema, body)
  if (!isDue(chore, week)) throw badRequest('That chore is not due that week')
  if (!(await activeMemberIds(store, caller.familyId)).has(memberId)) throw badRequest('Unknown member')
  const id = assignmentId(week, chore.id)
  const existing = await store.get<ChoreWeek>(caller.familyId, id, 'choreWeek')
  const saved = existing ? await store.upsert(touch(caller, existing, { memberId })) : await store.upsert(stamp(caller, 'choreWeek', { week, choreId: chore.id, memberId }, id))
  return { body: saved }
}

export const unassignChore: Handler = async ({ store, caller }, params) => {
  await store.delete(caller.familyId, assignmentId(weekOf(params.week), params.id))
  return { status: 204 }
}

/**
 * Fill the given week from each chore's last time round (the week before for a weekly chore,
 * two weeks before for a fortnightly one), leaving chores already assigned alone. Mirrors the meal plan's copy.
 */
export const copyChoreWeek: Handler = async ({ store, caller }, _p, _q, body) => {
  const week = weekOf(parse(copyWeekSchema, body).week)
  const [chores, assignments] = await Promise.all([store.byType<Chore>(caller.familyId, 'chore'), store.byType<ChoreWeek>(caller.familyId, 'choreWeek')])
  const lastTime = new Map(chores.filter((c) => isDue(c, week)).map((c) => [c.id, addDays(week, -7 * (c.everyWeeks ?? 1))]))
  const taken = new Set(assignments.filter((a) => a.week === week).map((a) => a.choreId))
  const active = await activeMemberIds(store, caller.familyId)
  let copied = 0
  for (const a of assignments) {
    if (a.week !== lastTime.get(a.choreId) || taken.has(a.choreId) || !active.has(a.memberId)) continue
    await store.upsert(stamp(caller, 'choreWeek', { week, choreId: a.choreId, memberId: a.memberId }, assignmentId(week, a.choreId)))
    copied++
  }
  return { body: { copied } }
}
