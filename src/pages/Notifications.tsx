import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { mutations, useMe } from '../api/hooks'
import type { NotifyChoices, PushDevice } from '../api/types'
import { useToast } from '../components/Toast'
import { browserSupport, currentSubscription, deviceId, turnOff, turnOn } from '../lib/push'

/**
 * Phone notifications (5.15): washing ready and the evening summary. Each person turns them on for each of their
 * phones here, and chooses which they want. Open to every member, since Settings is admin-only.
 */
export function Notifications() {
  const { data: me } = useMe()
  const qc = useQueryClient()
  const toast = useToast()
  const support = browserSupport()
  const devices = useQuery({ queryKey: ['push-devices'], queryFn: () => api<PushDevice[]>('/push/devices') })
  const key = useQuery({ queryKey: ['push-key'], queryFn: () => api<{ key: string | null }>('/push/key') })
  const [thisId, setThisId] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const permission = typeof Notification === 'undefined' ? 'default' : Notification.permission

  const findThis = async () => setThisId(support === 'ok' ? await currentSubscription().then((s) => (s ? deviceId(s) : null)) : null)
  useEffect(() => void findThis(), [])
  const thisOn = !!thisId && !!devices.data?.some((d) => d.id === thisId)
  const refresh = async () => {
    await findThis()
    void qc.invalidateQueries({ queryKey: ['push-devices'] })
  }

  const on = async () => {
    setBusy(true)
    try {
      const r = await turnOn()
      if (r === 'denied') toast('Notifications are blocked for this app. Allow them in the phone’s settings, then try again.')
      else if (r === 'not-set-up') toast('Notifications aren’t set up on the server yet.')
      else if (r === 'no-worker') toast('Reload the page and try again.')
      else toast('Notifications are on for this phone')
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  const off = async () => {
    setBusy(true)
    try {
      await turnOff()
      toast('Notifications are off for this phone')
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  const test = async () => {
    try {
      const r = await mutations.pushTest()
      toast(r.sent ? 'Sent. It should arrive in a few seconds.' : 'Nothing could be sent. Try turning notifications off and on again.')
    } catch (e) {
      toast((e as Error).message)
    }
  }

  const remove = async (d: PushDevice) => {
    await api<void>(`/push/devices/${encodeURIComponent(d.id)}`, { method: 'DELETE' }).catch((e: Error) => toast(e.message))
    await refresh()
  }

  const choices: NotifyChoices = me?.notify ?? { wash: true, summary: true }
  const choose = async (patch: Partial<NotifyChoices>) => {
    try {
      await mutations.patchMe({ notify: { ...choices, ...patch } })
      void qc.invalidateQueries({ queryKey: ['me'] })
    } catch (e) {
      toast((e as Error).message)
    }
  }

  return (
    <>
      <h1>Notifications</h1>
      <div className="card stack">
        <p>Two notifications, sent to your phone:</p>
        <ul>
          <li>
            <strong>Washing ready</strong>, when a wash finishes, and once more if it’s still in the machine two hours later.
          </li>
          <li>
            <strong>Evening summary</strong> at 8pm: the meals and calendar events for tomorrow and the day after.
          </li>
        </ul>

        {import.meta.env.DEV ? (
          <p className="muted">Notifications only work on the live site, where the app’s service worker runs.</p>
        ) : key.data && !key.data.key ? (
          <p className="muted">Notifications aren’t set up on the server yet.</p>
        ) : support === 'ios-install' ? (
          <p>
            On iPhone, notifications need the planner on your Home Screen. In Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>, then open
            FamilyPlanner from the Home Screen and come back to this page.
          </p>
        ) : support === 'unsupported' ? (
          <p className="muted">This browser can’t show notifications from the planner.</p>
        ) : thisOn ? (
          <div className="row wrap">
            <span>On for this phone.</span>
            <button className="btn sm" type="button" onClick={test}>
              Send a test
            </button>
            <button className="btn sm" type="button" onClick={off} disabled={busy}>
              Turn off on this phone
            </button>
          </div>
        ) : permission === 'denied' ? (
          <p>Notifications are blocked for this app. Allow them in the phone’s settings for this site or app, then reload this page.</p>
        ) : (
          <button className="btn primary" type="button" onClick={on} disabled={busy || thisId === undefined}>
            Turn on notifications on this phone
          </button>
        )}
      </div>

      <div className="card">
        <h2>What you get</h2>
        <p className="muted small">These apply to all your phones.</p>
        <label className="check">
          <input type="checkbox" checked={choices.wash} onChange={(e) => void choose({ wash: e.target.checked })} />
          Washing ready
        </label>
        <label className="check">
          <input type="checkbox" checked={choices.summary} onChange={(e) => void choose({ summary: e.target.checked })} />
          Evening summary
        </label>
      </div>

      {!!devices.data?.length && (
        <div className="card">
          <h2>Your phones</h2>
          <ul className="list">
            {devices.data.map((d) => (
              <li key={d.id}>
                <span style={{ flex: 1 }}>
                  {d.label}
                  {d.id === thisId && <span className="muted"> (this one)</span>}
                  <div className="muted small">Since {new Date(d.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                </span>
                <button className="btn link danger" type="button" onClick={() => void (d.id === thisId ? off() : remove(d))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small">A phone removed here comes back if it’s opened again with notifications still allowed. To stop one for good, turn it off on that phone.</p>
        </div>
      )}
    </>
  )
}
