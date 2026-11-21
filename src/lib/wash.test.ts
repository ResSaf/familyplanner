import { describe, expect, it } from 'vitest'
import type { Wash } from '../api/types'
import { delayMinutes, fmtDuration, fmtHoursEntry, hoursEntryMinutes, OVERDUE_AFTER_MS, serverNow, usualFor, washLabel, washStatus, washSummary } from './wash'

const wash: Wash = { load: 'Darks', dry: false, minutes: 60, startsAt: '2026-11-21T10:00:00Z', endsAt: '2026-11-21T11:00:00Z', startedBy: 'm-tim' }
const t = (iso: string) => Date.parse(iso)

describe('washStatus', () => {
  it('waits for a delayed start', () => {
    expect(washStatus(wash, t('2026-11-21T09:00:00Z'))).toMatchObject({ phase: 'waiting', leftMs: 3_600_000, progress: 0 })
  })
  it('runs, and says how far through', () => {
    expect(washStatus(wash, t('2026-11-21T10:15:00Z'))).toMatchObject({ phase: 'running', leftMs: 45 * 60_000, progress: 0.25 })
  })
  it('is done at the end time, and overdue two hours after', () => {
    expect(washStatus(wash, t('2026-11-21T11:00:00Z'))).toMatchObject({ phase: 'done', readyForMs: 0 })
    expect(washStatus(wash, t('2026-11-21T11:00:00Z') + OVERDUE_AFTER_MS - 1).phase).toBe('done')
    expect(washStatus(wash, t('2026-11-21T13:00:00Z'))).toMatchObject({ phase: 'overdue', readyForMs: OVERDUE_AFTER_MS })
  })
})

describe('wording', () => {
  it('labels a wash and dry', () => {
    expect(washLabel(wash)).toBe('Darks')
    expect(washLabel({ ...wash, dry: true })).toBe('Darks, wash & dry')
  })
  it('rounds time left up, so it reads 0 only when done', () => {
    expect(fmtDuration(30_001)).toBe('1 min')
    expect(fmtDuration(59 * 60_000)).toBe('59 min')
    expect(fmtDuration(65 * 60_000)).toBe('1h 05m')
  })
  it('sums up each phase', () => {
    expect(washSummary(washStatus(wash, t('2026-11-21T08:00:00Z')))).toBe('Starts in 2h 00m')
    expect(washSummary(washStatus(wash, t('2026-11-21T10:18:00Z')))).toBe('42 min left')
    expect(washSummary(washStatus(wash, t('2026-11-21T11:00:20Z')))).toBe('Ready now')
    expect(washSummary(washStatus(wash, t('2026-11-21T14:10:00Z')))).toBe('Ready 3h 10m ago')
  })
})

describe('the clock', () => {
  it('corrects this device’s clock by the server’s', () => {
    expect(serverNow({ now: '', skewMs: -5000 }, 100_000)).toBe(95_000)
    expect(serverNow({ now: '' }, 100_000)).toBe(100_000)
  })
})

describe('starting', () => {
  it('offers a load’s last length, else a first guess', () => {
    expect(usualFor({ usual: { Darks: { minutes: 59, dry: true } } }, 'Darks')).toEqual({ minutes: 59, dry: true })
    expect(usualFor({ usual: {} }, 'Towels')).toEqual({ minutes: 90, dry: false })
    expect(usualFor(undefined, 'Delicates').minutes).toBe(45)
  })
  it('turns "ready in" into a start delay, refusing one shorter than the wash', () => {
    expect(delayMinutes('start', 120, 60)).toBe(120)
    expect(delayMinutes('ready', 480, 60)).toBe(420)
    expect(delayMinutes('ready', 60, 60)).toBe(0)
    expect(delayMinutes('ready', 30, 60)).toBeNull()
  })
  it('reads typed digits as hours and minutes', () => {
    expect(fmtHoursEntry('')).toBe('0:00')
    expect(fmtHoursEntry('130')).toBe('1:30')
    expect(hoursEntryMinutes('130')).toBe(90)
    expect(hoursEntryMinutes('59')).toBe(59)
  })
})
