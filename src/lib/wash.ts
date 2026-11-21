import type { Load, Wash, WashState } from '../api/types'

/** The washer-dryer (5.14): where a wash is up to, and how the app and wall word it. */

/** A finished wash left this long goes from "ready" to "waiting" and shows more strongly. */
export const OVERDUE_AFTER_MS = 2 * 60 * 60_000
/** One-tap lengths, in minutes. Anything else is typed. */
export const WASH_MINUTES = [30, 45, 60, 90, 120, 180, 240]
/** One-tap delays, in hours, for the machine's delay start or "ready in". */
export const DELAY_HOURS = [1, 2, 3, 4, 6, 8, 10, 12]
/** What a load is first offered as, before it has been run once. */
const FIRST_MINUTES: Record<Load, number> = { Lights: 60, Darks: 60, Colours: 60, Whites: 90, Towels: 90, Bedding: 90, Delicates: 45, Mixed: 60 }

export type WashPhase = 'waiting' | 'running' | 'done' | 'overdue'
export interface WashStatus {
  phase: WashPhase
  /** Until it starts (waiting) or finishes (running). */
  leftMs: number
  /** How long it has been ready (done, overdue). */
  readyForMs: number
  /** How far through, 0 to 1. */
  progress: number
}

/** Where the wash is up to at this moment, on the server's clock. */
export function washStatus(wash: Wash, nowMs: number): WashStatus {
  const start = Date.parse(wash.startsAt)
  const end = Date.parse(wash.endsAt)
  if (nowMs < start) return { phase: 'waiting', leftMs: start - nowMs, readyForMs: 0, progress: 0 }
  if (nowMs < end) return { phase: 'running', leftMs: end - nowMs, readyForMs: 0, progress: (nowMs - start) / (end - start) }
  const readyForMs = nowMs - end
  return { phase: readyForMs >= OVERDUE_AFTER_MS ? 'overdue' : 'done', leftMs: 0, readyForMs, progress: 1 }
}

/** The state's clock now: this device's, corrected by how far it was from the server's. */
export const serverNow = (state: Pick<WashState, 'now'> & { skewMs?: number }, deviceNowMs = Date.now()) => deviceNowMs + (state.skewMs ?? 0)

/** "Darks", or "Darks, wash & dry". */
export const washLabel = (w: Pick<Wash, 'load' | 'dry'>) => (w.dry ? `${w.load}, wash & dry` : w.load)

/** A length of time, rounded up to the minute: "45 min", "1h 05m". */
export function fmtDuration(ms: number) {
  const mins = Math.max(0, Math.ceil(ms / 60_000))
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
}

/** How long it has been ready, rounded down: "just now", "25 min", "3h 10m". */
export function fmtReadyFor(ms: number) {
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  return `${fmtDuration(mins * 60_000)} ago`
}

/** One line for a chip or card: "42 min left", "Starts in 2h 00m", "Ready 25 min ago". */
export function washSummary(s: WashStatus) {
  if (s.phase === 'waiting') return `Starts in ${fmtDuration(s.leftMs)}`
  if (s.phase === 'running') return `${fmtDuration(s.leftMs)} left`
  return s.readyForMs < 60_000 ? 'Ready now' : `Ready ${fmtReadyFor(s.readyForMs)}`
}

/** What to offer for a load: its last length and drying, or a usual first guess. */
export function usualFor(state: Pick<WashState, 'usual'> | undefined, load: Load) {
  return state?.usual[load] ?? { minutes: FIRST_MINUTES[load], dry: false }
}

/**
 * The delay to send. The machine either starts after a delay, or (as many do) finishes after one: "ready in 8 hours".
 * Null when "ready in" is shorter than the wash itself.
 */
export function delayMinutes(mode: 'start' | 'ready', delay: number, minutes: number): number | null {
  if (mode === 'start') return delay
  return delay >= minutes ? delay - minutes : null
}

/** Typed digits as hours and minutes, filling from the right: "130" is 1:30. At most 9:59, so a few presses. */
export function fmtHoursEntry(digits: string) {
  const d = digits.padStart(3, '0')
  return `${Number(d.slice(0, -2))}:${d.slice(-2)}`
}
export function hoursEntryMinutes(digits: string) {
  const d = digits.padStart(3, '0')
  return Number(d.slice(0, -2)) * 60 + Number(d.slice(-2))
}
