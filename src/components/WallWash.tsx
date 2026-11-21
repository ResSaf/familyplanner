import { useEffect, useState, type ReactNode } from 'react'
import { fmtDuration, fmtReadyFor } from '../lib/wash'
import { Icon } from './Icons'
import { useWashActions, useWashNow, WashDetail, WashStartForm } from './Wash'

/** How long Undo stays up after the wash is emptied on the wall, as for a ticked to-do. */
const UNDO_FOR_MS = 8_000

/**
 * The washing machine on the wall (5.14), in the header so it shows on every view: a button after Notes, quiet
 * while the machine is empty or running. Once the wash is ready a red alert takes the weather's place, flashing,
 * and turns a stronger, pulsing red once it has waited two hours. Either opens a panel to start a wash, or to see,
 * correct or empty the one in the machine. Returns the three pieces for the page to place.
 */
export function useWallWash(): { button: ReactNode; alert: ReactNode; panel: ReactNode } {
  const [open, setOpen] = useState(false)
  const [undoUntil, setUndoUntil] = useState(0)
  const { state, status } = useWashNow(open ? 5_000 : 15_000)
  const actions = useWashActions()

  useEffect(() => {
    if (!undoUntil) return
    const t = setTimeout(() => setUndoUntil(0), undoUntil - Date.now())
    return () => clearTimeout(t)
  }, [undoUntil])

  const empty = async () => {
    if (await actions.setEmptied(true)) {
      setOpen(false)
      setUndoUntil(Date.now() + UNDO_FOR_MS)
    }
  }
  const undo = async () => {
    setUndoUntil(0)
    await actions.setEmptied(false)
  }

  const phase = status?.phase
  const ready = phase === 'done' || phase === 'overdue'
  const label = undoUntil ? 'Undo' : phase === 'running' ? fmtDuration(status!.leftMs).replace(' min', 'm') : phase === 'waiting' ? 'Later' : 'Wash'
  // While the alert is up it is the way in, so the small button steps aside and the header still fits.
  const button = ready && !undoUntil ? null : (
    <button
      type="button"
      className={`wall-notes-btn wall-wash-btn${phase ? ' wall-wash-on' : ''}`}
      aria-label={undoUntil ? 'Undo emptying the washing machine' : 'Washing machine'}
      onClick={() => (undoUntil ? void undo() : setOpen(true))}
    >
      <Icon name="washer" size={22} />
      {label}
    </button>
  )
  const alert = ready && state?.wash && (
    <button type="button" className={`wall-wash-ready wall-wash-${phase}`} aria-label={`Wash ready: ${state.wash.load}. Open`} onClick={() => setOpen(true)}>
      <Icon name="washer" size={34} />
      <span>
        <b>{phase === 'overdue' ? 'Wash waiting' : 'Wash ready'}</b>
        <small>
          {state.wash.load} · {fmtReadyFor(status!.readyForMs)}
        </small>
      </span>
    </button>
  )

  const panel = open && (
    <div className="wall-timer-backdrop" onClick={() => setOpen(false)}>
      <div className="wall-timer wall-wash" role="dialog" aria-modal="true" aria-label="Washing machine" onClick={(e) => e.stopPropagation()}>
        {state?.wash && status ? (
          <WashDetail state={state} status={status} busy={actions.busy} onAdjust={(by) => void actions.adjust(by)} onEmpty={() => void empty()} wall />
        ) : (
          <WashStartForm
            state={state}
            busy={actions.busy}
            onStart={async (body) => {
              if (await actions.start(body)) setOpen(false)
            }}
            wall
          />
        )}
        {actions.error && (
          <p className="wall-note" role="alert">
            {actions.error}
          </p>
        )}
        <div className="wall-timer-actions">
          <button type="button" className="wall-flip" onClick={() => setOpen(false)}>
            <Icon name="close" size={28} />
            Close
          </button>
        </div>
      </div>
    </div>
  )
  return { button, alert, panel }
}
