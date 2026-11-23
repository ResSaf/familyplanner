import { useState, type ReactNode } from 'react'
import { fmtDuration, fmtReadyFor, washLabel } from '../lib/wash'
import { Icon } from './Icons'
import { useWashActions, useWashNow, WashDetail, WashStartForm } from './Wash'

/**
 * The washing machine on the wall (5.14), in the header so it shows on every view: a button after Notes, quiet
 * while the machine is empty or running. Once the wash is ready a red alert takes the weather's place, flashing,
 * and turns a stronger, pulsing red once it has waited two hours. Either opens a panel to start a wash, or to see,
 * correct or empty the one in the machine. Returns the three pieces for the page to place.
 */
export function useWallWash(): { button: ReactNode; alert: ReactNode; panel: ReactNode } {
  const [open, setOpen] = useState(false)
  /** Loading the next wash in place of the one just finished. */
  const [reloading, setReloading] = useState(false)
  const close = () => {
    setOpen(false)
    setReloading(false)
  }
  const { state, status } = useWashNow(open ? 5_000 : 15_000)
  const actions = useWashActions()

  const empty = async () => {
    if (await actions.empty()) close()
  }

  const phase = status?.phase
  const ready = phase === 'done' || phase === 'overdue'
  const label = phase === 'running' ? fmtDuration(status!.leftMs).replace(' min', 'm') : phase === 'waiting' ? 'Later' : 'Wash'
  // While the alert is up it is the way in, so the small button steps aside and the header still fits.
  const button = ready ? null : (
    <button
      type="button"
      className={`wall-notes-btn wall-wash-btn${phase ? ' wall-wash-on' : ''}`}
      aria-label="Washing machine"
      onClick={() => setOpen(true)}
    >
      <Icon name="washer" size={22} />
      {label}
    </button>
  )
  const alert = ready && state?.wash && (
    <button type="button" className={`wall-wash-ready wall-wash-${phase}`} aria-label={`Washing ready: ${washLabel(state.wash)}. Open`} onClick={() => setOpen(true)}>
      <Icon name="washer" size={34} />
      <span>
        {/* "Washing", not "Wash": it may have only been dried. */}
        <b>{phase === 'overdue' ? 'Washing waiting' : 'Washing ready'}</b>
        <small>
          {washLabel(state.wash)} · {fmtReadyFor(status!.readyForMs)}
        </small>
      </span>
    </button>
  )

  const panel = open && (
    <div className="wall-timer-backdrop" onClick={close}>
      <div className="wall-timer wall-wash" role="dialog" aria-modal="true" aria-label="Washing machine" onClick={(e) => e.stopPropagation()}>
        {state?.wash && status && !reloading ? (
          <WashDetail
            state={state}
            status={status}
            busy={actions.busy}
            onAdjust={(by) => void actions.adjust(by)}
            onEmpty={() => void empty()}
            onReload={() => setReloading(true)}
            wall
          />
        ) : (
          // Starting replaces the wash in the machine, which counts as emptying it, so one call does both.
          <WashStartForm
            state={state}
            initial={reloading ? (state?.wash ?? undefined) : undefined}
            busy={actions.busy}
            onBack={reloading ? () => setReloading(false) : undefined}
            onStart={async (body) => {
              if (await actions.start(body)) close()
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
          <button type="button" className="wall-flip" onClick={close}>
            <Icon name="close" size={28} />
            Close
          </button>
        </div>
      </div>
    </div>
  )
  return { button, alert, panel }
}
