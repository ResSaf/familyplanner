import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { mutations, useChores } from '../api/hooks'
import type { Chore, ChoreSchedule } from '../api/types'
import { Icon } from '../components/Icons'
import { Modal } from '../components/Modal'
import { PersonChips } from '../components/People'
import { useToast } from '../components/Toast'
import { WeekNav } from '../components/WeekNav'
import { addDays, fmtDay, mondayOf, parseISODate, todayISO } from '../lib/dates'

/** How often a chore can come round (R1). */
const REPEATS: [number, string][] = [
  [1, 'Every week'],
  [2, 'Every 2 weeks'],
  [3, 'Every 3 weeks'],
  [4, 'Every 4 weeks'],
  [6, 'Every 6 weeks'],
  [8, 'Every 8 weeks'],
  [13, 'Every 13 weeks (quarterly)'],
  [26, 'Every 26 weeks (twice a year)'],
  [52, 'Every 52 weeks (yearly)'],
]

/** Longest repeat whose next due week is picked from a list rather than a date. */
const PICK_MAX = 13

const repeatLabel = (every = 1) => REPEATS.find(([n]) => n === every)?.[1] ?? `Every ${every} weeks`
const weeksBetween = (from: string, to: string) => Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / (7 * 86_400_000))

/** Whether a chore comes round in the week of this Monday. The API applies the same rule. */
function isDue(chore: Pick<Chore, 'everyWeeks' | 'fromWeek'>, week: string) {
  const every = chore.everyWeeks ?? 1
  if (every <= 1 || !chore.fromWeek) return true
  return ((weeksBetween(chore.fromWeek, week) % every) + every) % every === 0
}

/** Who has which chore, week by week. It only shows the schedule: there is nothing to tick off, and no one assigned means anyone. Chores that do not come round this week are listed below, to edit. */
export function Chores() {
  const [params, setParams] = useSearchParams()
  const week = /^\d{4}-\d{2}-\d{2}$/.test(params.get('week') ?? '') ? mondayOf(params.get('week')!) : mondayOf(todayISO())
  const { data, isLoading } = useChores(week)
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<Chore | null>(null)

  const refresh = () => void qc.invalidateQueries({ queryKey: ['chores'] })
  const chores = data?.chores ?? []
  const assignments = data?.assignments ?? []
  const notDue = data?.notDue ?? []

  const assign = async (choreId: string, memberId: string | undefined) => {
    qc.setQueryData<ChoreSchedule>(['chores', week], (old) =>
      old && { ...old, assignments: [...old.assignments.filter((a) => a.choreId !== choreId), ...(memberId ? [{ choreId, memberId }] : [])] },
    )
    try {
      if (memberId) await mutations.assignChore(choreId, week, memberId)
      else await mutations.unassignChore(choreId, week)
    } catch (e) {
      toast((e as Error).message)
    }
    refresh()
  }

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    setName('')
    try {
      await mutations.createChore(n)
      refresh()
    } catch (err) {
      toast((err as Error).message)
    }
  }

  const copyLastWeek = async () => {
    const { copied } = await mutations.copyChoreWeek(week)
    refresh()
    toast(copied ? `Copied ${copied} from last week` : 'Nothing to copy, or every chore was already assigned')
  }

  return (
    <>
      <WeekNav week={week} onChange={(w) => setParams({ view: 'chores', week: w })} />

      <div className="card">
        {isLoading && <p className="loading">Loading…</p>}
        {!isLoading && chores.length === 0 && <p className="empty">{notDue.length ? 'No chores come round this week.' : 'No chores yet. Add the first one below.'}</p>}
        {chores.map((c) => (
          <div className="chore" key={c.id}>
            <div className="chore-name">
              <span className="grow">
                {c.name}
                {(c.everyWeeks ?? 1) > 1 && <span className="muted small chore-repeat"> {repeatLabel(c.everyWeeks).toLowerCase()}</span>}
              </span>
              <button className="icon-btn" type="button" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                <Icon name="edit" size={18} />
              </button>
            </div>
            <PersonChips value={assignments.filter((a) => a.choreId === c.id).map((a) => a.memberId)} onChange={(v) => void assign(c.id, v[0])} single />
          </div>
        ))}
      </div>

      {notDue.length > 0 && (
        <section className="card" aria-labelledby="chores-not-due-h">
          <h2 id="chores-not-due-h" className="section-title">
            Not this week
          </h2>
          {notDue.map((c) => (
            <div className="chore-name" key={c.id}>
              <span className="grow">
                {c.name}
                <span className="muted small chore-repeat">
                  {' '}
                  {repeatLabel(c.everyWeeks).toLowerCase()}
                  {c.nextWeek && `, next the week of ${fmtDay(c.nextWeek)}`}
                </span>
              </span>
              <button className="icon-btn" type="button" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                <Icon name="edit" size={18} />
              </button>
            </div>
          ))}
        </section>
      )}

      <form className="card row" onSubmit={add}>
        <input type="text" aria-label="New chore" placeholder="Add a chore…" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} enterKeyHint="done" />
        <button className="btn primary" type="submit" disabled={!name.trim()}>
          Add
        </button>
      </form>

      {chores.length + notDue.length > 0 && (
        <button className="btn sm" type="button" onClick={copyLastWeek}>
          Copy last week
        </button>
      )}

      {editing && (
        <ChoreEditor
          key={editing.id}
          chore={editing}
          week={week}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            refresh()
          }}
        />
      )}
    </>
  )
}

/**
 * Name and repeat. For a repeat of up to 13 weeks the next due week is picked from the next few weeks, which covers
 * every possible rhythm; a longer one takes a date.
 */
function ChoreEditor({ chore, week, onClose, onSaved }: { chore: Chore; week: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(chore.name)
  const [every, setEvery] = useState(chore.everyWeeks ?? 1)
  const [from, setFrom] = useState(() => (chore.fromWeek && (chore.everyWeeks ?? 1) > 1 ? firstDue(chore, week) : week))
  const toast = useToast()
  const starts = every <= PICK_MAX ? Array.from({ length: every }, (_, i) => addDays(week, 7 * i)) : []
  const save = async () => {
    try {
      await mutations.saveChore(chore.id, name.trim(), every > 1 ? { everyWeeks: every, fromWeek: from } : { everyWeeks: 1 })
      onSaved()
    } catch (e) {
      toast((e as Error).message)
    }
  }
  return (
    <Modal
      title="Edit chore"
      onClose={onClose}
      footer={
        <>
          <button
            className="btn danger"
            type="button"
            onClick={async () => {
              if (!confirm(`Delete ${chore.name} from every week?`)) return
              await mutations.deleteChore(chore.id)
              onSaved()
            }}
          >
            Delete
          </button>
          <button className="btn primary" type="button" onClick={save} disabled={!name.trim()}>
            Save
          </button>
        </>
      }
    >
      <label className="field">
        <span>Name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} data-autofocus />
      </label>
      <label className="field">
        <span>Comes round</span>
        <select
          value={every}
          onChange={(e) => {
            const n = Number(e.target.value)
            setEvery(n)
            // Keep the chosen week if it is still offered, else start from the week being viewed.
            if (n <= PICK_MAX && weeksBetween(week, from) >= n) setFrom(week)
          }}
        >
          {REPEATS.map(([n, label]) => (
            <option key={n} value={n}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {every > PICK_MAX && (
        <label className="field">
          <span>Next due (any day that week)</span>
          <input type="date" value={from} min={week} onChange={(e) => e.target.value && setFrom(mondayOf(e.target.value))} />
        </label>
      )}
      {every > 1 && every <= PICK_MAX && (
        <label className="field">
          <span>Next due</span>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {starts.map((w, i) => (
              <option key={w} value={w}>
                {i === 0 ? 'This week' : i === 1 ? 'Next week' : 'The week'} of {fmtDay(w)}
              </option>
            ))}
          </select>
        </label>
      )}
    </Modal>
  )
}

/** The first week from this one in which the chore comes round, within its repeat. */
function firstDue(chore: Chore, week: string) {
  for (let i = 0; i < (chore.everyWeeks ?? 1); i++) if (isDue(chore, addDays(week, 7 * i))) return addDays(week, 7 * i)
  return week
}
