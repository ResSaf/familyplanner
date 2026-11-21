import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { mutations, useWash } from '../api/hooks'
import { LOADS, type Load, type WashStart, type WashState } from '../api/types'
import { fmtTime } from '../lib/dates'
import { DELAY_HOURS, delayMinutes, fmtDuration, serverNow, usualFor, WASH_MINUTES, washLabel, washStatus, washSummary, type WashStatus } from '../lib/wash'
import { Icon } from './Icons'
import { Modal } from './Modal'
import { useToast } from './Toast'
import { usePersonMap } from './People'

/**
 * The washer-dryer (5.14), shared by the app and the wall. The same calls work on both: on the wall page
 * they go to /api/display/wash, which the display key may write to (S34).
 */

type State = WashState & { skewMs: number }

/** The wash, where it's up to now, and redraws often enough for a minute countdown. */
export function useWashNow(tickMs = 15_000) {
  const query = useWash()
  const [, redraw] = useState(0)
  useEffect(() => {
    const t = setInterval(() => redraw((n) => n + 1), tickMs)
    return () => clearInterval(t)
  }, [tickMs])
  const state = query.data
  // Read the clock on every draw, not only on the tick, or a wash just started can show as not yet begun.
  const nowMs = state ? serverNow(state) : Date.now()
  const status = state?.wash ? washStatus(state.wash, nowMs) : undefined
  return { state, status, nowMs, failed: query.isError }
}

/** Start, adjust, empty and undo, each followed by a fresh read. */
export function useWashActions() {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(undefined)
    try {
      await fn()
      return true
    } catch {
      setError("Couldn't save that. Try again.")
      return false
    } finally {
      setBusy(false)
      await qc.invalidateQueries({ queryKey: ['wash'] })
    }
  }
  return {
    busy,
    error,
    start: (body: WashStart) => run(() => mutations.startWash(body)),
    adjust: (minutes: number) => run(() => mutations.adjustWash(minutes)),
    setEmptied: (emptied: boolean) => run(() => mutations.setWashEmptied(emptied)),
  }
}

/** Who started it: a person, or the wall. */
export function useStartedBy() {
  const people = usePersonMap()
  return (id: string) => (id.startsWith('display:') ? 'the wall' : (people.get(id)?.displayName ?? 'someone'))
}

const hoursLabel = (h: number) => `${h}h`

/**
 * Choosing what's going in: the load, wash or wash & dry, the length (its last one offered first) and, if the
 * machine's delay is used, when it starts or is ready. A few taps, no typing, so it suits the wall as well as a phone.
 */
export function WashStartForm({ state, busy, onStart, wall = false }: { state?: State; busy: boolean; onStart: (body: WashStart) => void; wall?: boolean }) {
  const [load, setLoad] = useState<Load>()
  const [dry, setDry] = useState(false)
  const [minutes, setMinutes] = useState(60)
  const [delayMode, setDelayMode] = useState<'now' | 'start' | 'ready'>('now')
  const [delayHours, setDelayHours] = useState(DELAY_HOURS[2])

  const choose = (l: Load) => {
    const usual = usualFor(state, l)
    setLoad(l)
    setDry(usual.dry)
    setMinutes(usual.minutes)
  }
  const delay = delayMode === 'now' ? 0 : delayMinutes(delayMode, delayHours * 60, minutes)
  const step = (by: number) => setMinutes((m) => Math.min(600, Math.max(1, m + by)))
  const p = wall ? 'wall-wash' : 'wash'
  const chip = (on: boolean) => `${p}-chip${on ? ' on' : ''}`

  return (
    <div className={`${p}-form`}>
      <fieldset className={`${p}-loads`}>
        <legend>What's in it?</legend>
        {LOADS.map((l) => (
          <button key={l} type="button" className={chip(load === l)} aria-pressed={load === l} onClick={() => choose(l)}>
            {l}
          </button>
        ))}
      </fieldset>

      <fieldset className={`${p}-row`} disabled={!load}>
        <legend>Programme</legend>
        <button type="button" className={chip(!dry)} aria-pressed={!dry} onClick={() => setDry(false)}>
          Wash
        </button>
        <button type="button" className={chip(dry)} aria-pressed={dry} onClick={() => setDry(true)}>
          Wash &amp; dry
        </button>
      </fieldset>

      <fieldset className={`${p}-row`} disabled={!load}>
        <legend>How long, as the machine shows</legend>
        <button type="button" className={`${p}-step`} aria-label="5 minutes less" onClick={() => step(-5)}>−5</button>
        <button type="button" className={`${p}-step`} aria-label="1 minute less" onClick={() => step(-1)}>−1</button>
        <output className={`${p}-length`} aria-live="polite">{fmtDuration(minutes * 60_000)}</output>
        <button type="button" className={`${p}-step`} aria-label="1 minute more" onClick={() => step(1)}>+1</button>
        <button type="button" className={`${p}-step`} aria-label="5 minutes more" onClick={() => step(5)}>+5</button>
      </fieldset>
      <div className={`${p}-row ${p}-quick`}>
        {WASH_MINUTES.map((m) => (
          <button key={m} type="button" className={chip(minutes === m)} disabled={!load} onClick={() => setMinutes(m)}>
            {m < 60 ? `${m} min` : hoursLabel(m / 60)}
          </button>
        ))}
      </div>

      <fieldset className={`${p}-row`} disabled={!load}>
        <legend>Delay</legend>
        <button type="button" className={chip(delayMode === 'now')} aria-pressed={delayMode === 'now'} onClick={() => setDelayMode('now')}>
          Starting now
        </button>
        <button type="button" className={chip(delayMode === 'start')} aria-pressed={delayMode === 'start'} onClick={() => setDelayMode('start')}>
          Starts in…
        </button>
        <button type="button" className={chip(delayMode === 'ready')} aria-pressed={delayMode === 'ready'} onClick={() => setDelayMode('ready')}>
          Ready in…
        </button>
      </fieldset>
      {delayMode !== 'now' && (
        <div className={`${p}-row ${p}-quick`}>
          {DELAY_HOURS.map((h) => (
            <button key={h} type="button" className={chip(delayHours === h)} onClick={() => setDelayHours(h)}>
              {hoursLabel(h)}
            </button>
          ))}
        </div>
      )}
      {delay === null && <p className={`${p}-error`}>Ready in {delayHours}h is sooner than the wash takes.</p>}

      <button
        type="button"
        className={`${p}-start`}
        disabled={!load || delay === null || busy}
        onClick={() => load && delay !== null && onStart({ load, dry, minutes, delayMinutes: delay })}
      >
        {load ? `Start ${washLabel({ load, dry })}` : 'Choose what’s in it'}
      </button>
    </div>
  )
}

/** The wash in the machine: what, how long, and the buttons to correct or empty it. */
export function WashDetail({
  state,
  status,
  busy,
  onAdjust,
  onEmpty,
  wall = false,
}: {
  state: State
  status: WashStatus
  busy: boolean
  onAdjust: (by: number) => void
  onEmpty: () => void
  wall?: boolean
}) {
  const startedBy = useStartedBy()
  const w = state.wash!
  const p = wall ? 'wall-wash' : 'wash'
  const finished = status.phase === 'done' || status.phase === 'overdue'
  return (
    <div className={`${p}-detail ${p}-${status.phase}`}>
      <div className={`${p}-what`}>{washLabel(w)}</div>
      <div className={`${p}-big`} role={finished ? 'alert' : 'timer'}>
        {washSummary(status)}
      </div>
      {!finished && (
        <div className={`${p}-bar`}>
          <span style={{ width: `${Math.round(status.progress * 100)}%` }} />
        </div>
      )}
      <p className={`${p}-meta`}>
        {status.phase === 'waiting' && `Starts at ${fmtTime(w.startsAt)}, ready at ${fmtTime(w.endsAt)}. `}
        {status.phase === 'running' && `Ready at ${fmtTime(w.endsAt)}. `}
        {finished && `Finished at ${fmtTime(w.endsAt)}. `}
        Started by {startedBy(w.startedBy)}.
      </p>
      <div className={`${p}-actions`}>
        {!finished && (
          <>
            <button type="button" className={`${p}-step`} disabled={busy} onClick={() => onAdjust(-10)}>
              −10 min
            </button>
            <button type="button" className={`${p}-step`} disabled={busy} onClick={() => onAdjust(10)}>
              +10 min
            </button>
          </>
        )}
        <button type="button" className={finished ? `${p}-start` : `${p}-step`} disabled={busy} onClick={onEmpty}>
          {finished ? (
            <>
              <Icon name="check" size={wall ? 30 : 20} /> Emptied
            </>
          ) : (
            'Cancel wash'
          )}
        </button>
      </div>
    </div>
  )
}

/** Starting a wash from the app: a sheet, closed once it has started. */
export function WashSheet({ onClose }: { onClose: () => void }) {
  const { state } = useWashNow()
  const actions = useWashActions()
  return (
    <Modal title="Start a wash" onClose={onClose}>
      <WashStartForm
        state={state}
        busy={actions.busy}
        onStart={async (body) => {
          if (await actions.start(body)) onClose()
        }}
      />
      {actions.error && <p className="wash-error">{actions.error}</p>}
    </Modal>
  )
}

/**
 * The dashboard's washing machine card (5.14), first on the page while there's a wash in: the countdown while it
 * runs, red once it's ready, stronger red once it has waited two hours. Hidden when the machine is empty.
 */
export function WashCard() {
  const { state, status } = useWashNow()
  const actions = useWashActions()
  const toast = useToast()
  if (!state?.wash || !status) return null
  const empty = async () => {
    const what = washLabel(state.wash!)
    if (await actions.setEmptied(true)) toast(`Emptied: ${what}`, { action: { label: 'Undo', onClick: () => void actions.setEmptied(false) }, duration: 5000 })
  }
  return (
    <section className={`wash-card card wash-card-${status.phase}`} aria-labelledby="wash-h">
      <h2 id="wash-h" className="section-title">
        <Icon name="washer" size={20} /> Washing machine
      </h2>
      <WashDetail state={state} status={status} busy={actions.busy} onAdjust={(by) => void actions.adjust(by)} onEmpty={() => void empty()} />
      {actions.error && <p className="wash-error">{actions.error}</p>}
    </section>
  )
}
