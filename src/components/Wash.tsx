import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { mutations, useWash } from '../api/hooks'
import { LOADS, type Load, type WashStart, type WashState } from '../api/types'
import { fmtTime } from '../lib/dates'
import { DELAY_HOURS, delayMinutes, fmtDuration, fmtHoursEntry, HOURS_ENTRY_DIGITS, hoursEntryMinutes, MAX_WASH_MINUTES, serverNow, usualFor, WASH_MINUTES, washLabel, washStatus, washSummary, type WashStatus } from '../lib/wash'
import { Icon } from './Icons'
import { Modal } from './Modal'
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

/** Start, adjust and empty, each followed by a fresh read. */
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
    empty: () => run(() => mutations.emptyWash()),
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
 * A long programme's length can be typed on a keypad, opened by tapping the length.
 */
export function WashStartForm({ state, busy, onStart, wall = false }: { state?: State; busy: boolean; onStart: (body: WashStart) => void; wall?: boolean }) {
  const [load, setLoad] = useState<Load>()
  const [dry, setDry] = useState(false)
  const [minutes, setMinutes] = useState(60)
  const [delayMode, setDelayMode] = useState<'now' | 'start' | 'ready'>('now')
  const [delayHours, setDelayHours] = useState(DELAY_HOURS[2])
  /** Digits typed on the keypad, which opens only from tapping the length. Null while it's closed. */
  const [typing, setTyping] = useState<string | null>(null)

  const choose = (l: Load) => {
    const usual = usualFor(state, l)
    setLoad(l)
    setDry(usual.dry)
    setMinutes(usual.minutes)
  }
  const delay = delayMode === 'now' ? 0 : delayMinutes(delayMode, delayHours * 60, minutes)
  const step = (by: number) => setMinutes((m) => Math.min(MAX_WASH_MINUTES, Math.max(1, m + by)))
  const typed = typing === null ? 0 : hoursEntryMinutes(typing)
  const typedOk = typed >= 1 && typed <= MAX_WASH_MINUTES
  const key = (d: string) => setTyping((cur) => ((cur ?? '') + d).replace(/^0+/, '').slice(0, HOURS_ENTRY_DIGITS))
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

      {typing !== null ? (
        // Any length, for the long programmes the steps and chips don't reach: hours and minutes, filling from the right.
        <fieldset className={`${p}-row ${p}-typing`}>
          <legend>Type the length: hours, then minutes</legend>
          <div className={`${p}-typed`}>
            <output className={`${p}-length${typing ? '' : ` ${p}-empty`}`} aria-live="polite">
              {fmtHoursEntry(typing)}
            </output>
            {typing && !typedOk && <p className={`${p}-error`}>At most {MAX_WASH_MINUTES / 60} hours</p>}
            <div className={`${p}-typed-actions`}>
              <button type="button" className={`${p}-step`} onClick={() => setTyping(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={`${p}-start`}
                disabled={!typedOk}
                onClick={() => {
                  setMinutes(typed)
                  setTyping(null)
                }}
              >
                Done
              </button>
            </div>
          </div>
          <div className={`${p}-keys`}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} type="button" className={`${p}-key`} onClick={() => key(d)}>
                {d}
              </button>
            ))}
            <button type="button" className={`${p}-key ${p}-key-small`} disabled={!typing} onClick={() => setTyping('')}>
              Clear
            </button>
            <button type="button" className={`${p}-key`} onClick={() => key('0')}>
              0
            </button>
            <button type="button" className={`${p}-key ${p}-key-small`} disabled={!typing} onClick={() => setTyping((cur) => (cur ?? '').slice(0, -1))}>
              Delete
            </button>
          </div>
        </fieldset>
      ) : (
        <>
          <fieldset className={`${p}-row`} disabled={!load}>
            <legend>How long, as the machine shows</legend>
            <button type="button" className={`${p}-step`} aria-label="5 minutes less" onClick={() => step(-5)}>−5</button>
            <button type="button" className={`${p}-step`} aria-label="1 minute less" onClick={() => step(-1)}>−1</button>
            {/* Tapping the length is the only way to type one, so the steps and chips stay the quick path. */}
            <button type="button" className={`${p}-length ${p}-length-btn`} aria-live="polite" aria-label={`${fmtDuration(minutes * 60_000)}. Type a length`} onClick={() => setTyping('')}>
              {fmtDuration(minutes * 60_000)}
            </button>
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
        </>
      )}

      {typing === null && (
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
      )}
      {typing === null && delayMode !== 'now' && (
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
        disabled={!load || delay === null || busy || typing !== null}
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
  if (!state?.wash || !status) return null
  return (
    <section className={`wash-card card wash-card-${status.phase}`} aria-labelledby="wash-h">
      <h2 id="wash-h" className="section-title">
        <Icon name="washer" size={20} /> Washing machine
      </h2>
      <WashDetail state={state} status={status} busy={actions.busy} onAdjust={(by) => void actions.adjust(by)} onEmpty={() => void actions.empty()} />
      {actions.error && <p className="wash-error">{actions.error}</p>}
    </section>
  )
}
