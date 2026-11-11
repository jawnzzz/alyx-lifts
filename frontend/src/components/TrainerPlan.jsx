// Trainer and client (Lindsey Lifts):
//  - SendPlanSheet, SendSessionSheet, NutritionForClient: what a trainer puts in a client's app.
//  - TrainerInbox: on the client's device, takes it all in on its own; they can edit it after.
// The server only carries it; applying is lib/trainer-plan.js and lib/trainer-inbox.js.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { fmtDate, exCount, isoOf } from '../lib/format.js'
import { buildTrainerPlan, applyTrainerPlan } from '../lib/trainer-plan.js'
import { sessionToSend, applyTrainerSession, applyTrainerNutrition, parseAvoid } from '../lib/trainer-inbox.js'
import { Button, Switch } from './ui.jsx'
import Icon from './Icon.jsx'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const dayOf = ts => (ts ? fmtDate(isoOf(new Date(ts))) : '')

function planStatus(p) {
  if (!p) return t('No plan sent yet')
  if (p.status === 'applied') return t('Applied {0}', dayOf(p.doneAt))
  if (p.status === 'dismissed') return t('Dismissed {0}', dayOf(p.doneAt))
  return t('Sent {0}, not applied yet', dayOf(p.sent))
}

export const sendPlanSheet = () => ui().openSheet(close => <SendPlanSheet close={close} />)

function SendPlanSheet({ close }) {
  const S = useStore(s => s.S)
  const routines = (S.routines || []).filter(r => r && (r.ex || []).length)
  const [clients, setClients] = useState(null)
  const [clientId, setClientId] = useState(null)
  const [picked, setPicked] = useState(() => new Set(routines.map(r => r.id)))
  const [schedule, setSchedule] = useState(true)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api('/api/trainer/clients')
      .then(d => { setClients(d.clients); if (d.clients.length === 1) setClientId(d.clients[0].id) })
      .catch(e => { toast(e.message); setClients([]) })
  }, [])
  const toggle = id => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const client = clients?.find(c => c.id === clientId)
  const send = () => {
    if (!client || !picked.size || busy) return
    setBusy(true)
    const plan = buildTrainerPlan(S, routines.filter(r => picked.has(r.id)).map(r => r.id), t('Plan for {0}', client.name))
    if (!schedule) plan.week = {}
    api('/api/trainer/send', { method: 'POST', body: JSON.stringify({ clientId: client.id, plan, note, schedule }) })
      .then(() => { toast(t('Added to {0}\'s app', client.name)); close() })
      .catch(e => { toast(e.message); setBusy(false) })
  }

  if (!clients) return <div className="muted small">{t('Loading…')}</div>
  return <>
    <h3>{t('Plan for a client')}</h3>
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>
      {t('It goes straight into their app the next time they open it. It replaces the routines you gave them before; their own routines and their workout history stay as they are.')}
    </div>
    {!clients.length && <div className="card small muted">{t('No clients linked to you yet. An admin links them in the Admin dashboard.')}</div>}
    {clients.length > 0 && <>
      <h4 className="sec">{t('Client')}</h4>
      <div className="list" style={{ gap: 6, marginBottom: 14 }}>
        {clients.map(c => <button key={c.id} className={'card row between' + (c.id === clientId ? ' sel' : '')}
          style={{ textAlign: 'start', borderColor: c.id === clientId ? 'var(--acc)' : undefined, borderWidth: 1, borderStyle: 'solid' }}
          onClick={() => setClientId(c.id)}>
          <div><div style={{ fontWeight: 600 }}>{c.name}</div><div className="dim small">{planStatus(c.plan)}</div></div>
          {c.id === clientId && <Icon name="check" />}
        </button>)}
      </div>
      <h4 className="sec">{t('Routines')}</h4>
      {!routines.length && <div className="card small muted">{t('Build a routine on your own Plan tab first, then send it.')}</div>}
      <div className="list" style={{ gap: 0, marginBottom: 14 }}>
        {routines.map(r => <label key={r.id} className="row between" style={{ padding: '10px 2px', borderBottom: '1px solid var(--sep)', gap: 12 }}>
          <span>{r.name} <span className="dim small">{exCount((r.ex || []).length)}</span></span>
          <Switch checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={r.name} />
        </label>)}
      </div>
      <div className="row between" style={{ padding: '10px 2px', borderBottom: '1px solid var(--sep)', marginBottom: 14, gap: 12 }}>
        <div><div style={{ fontSize: 15 }}>{t('Send the weekly schedule too')}</div><div className="small dim">{t('The days you set these routines on replace theirs.')}</div></div>
        <Switch checked={schedule} onChange={setSchedule} />
      </div>
      <textarea className="input" rows={3} maxLength={500} style={{ marginBottom: 16 }}
        placeholder={t('A note for them (optional)')} value={note} onChange={e => setNote(e.target.value)} />
      <Button variant="primary" icon="share" disabled={!client || !picked.size || busy} onClick={send}>
        {client ? t('Add to {0}\'s app', client.name) : t('Pick a client')}
      </Button>
    </>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/**
 * The client's side: everything their trainer sent, taken in on its own the moment the app is open
 * (Lindsey Lifts). Plans replace the trainer's earlier routines, sessions land in the history,
 * nutrition becomes the client's own copy. The client can change all of it afterwards. Renders
 * nothing; a toast says what arrived. A plan waits while a workout is in progress.
 */
export function TrainerInbox() {
  const user = useStore(s => s.user)
  const active = useStore(s => !!s.S.active)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') setTick(n => n + 1) }
    document.addEventListener('visibilitychange', again)
    return () => document.removeEventListener('visibilitychange', again)
  }, [])
  useEffect(() => {
    if (!user || user.trainer) return
    let live = true
    api('/api/plan-inbox').then(d => { if (live) takeIn(d.plans || []) }).catch(() => { /* offline or an older server */ })
    return () => { live = false }
  }, [user?.id, active, tick])
  return null
}

const taking = new Set()
function takeIn(items) {
  const st = useStore.getState()
  const got = []
  for (const p of items) {
    if (taking.has(p.id)) continue
    if (p.kind === 'plan' && st.S.active) continue
    taking.add(p.id)
    try {
      if (p.kind === 'plan') {
        const mine = useStore.getState().S.unit || 'kg'
        const theirs = p.plan?.unit === 'lb' || p.plan?.unit === 'kg' ? p.plan.unit : mine
        if (theirs !== mine) useStore.getState().setUnit(theirs)
        useStore.getState().update(s => { applyTrainerPlan(s, p.plan, { trainerId: p.from.id, schedule: p.schedule !== false }) })
        got.push(t('a new plan'))
      } else if (p.kind === 'session') {
        useStore.getState().update(s => { applyTrainerSession(s, p.workout, { trainerId: p.from.id }) })
        got.push(t('a session for {0}', fmtDate(p.workout?.d)))
      } else if (p.kind === 'nutrition') {
        useStore.getState().update(s => { applyTrainerNutrition(s, p.nutrition, { trainerId: p.from.id, from: p.from.name, sent: p.sent }) })
        got.push(t('your nutrition plan'))
      } else { taking.delete(p.id); continue }
    } catch (e) { taking.delete(p.id); toast(e.message); continue }
    api('/api/plan-inbox/done', { method: 'POST', body: JSON.stringify({ id: p.id, status: 'applied' }) })
      .catch(() => { taking.delete(p.id) })
  }
  if (got.length) toast(t('{0} added {1}', items[0]?.from?.name || t('Your trainer'), got.join(', ')))
}

/** Trainer: send one of your logged sessions to a client's history (from the workout's sheet). */
export const sendSessionSheet = w => ui().openSheet(close => <SendSessionSheet w={w} close={close} />)

function SendSessionSheet({ w, close }) {
  const [clients, setClients] = useState(null)
  const [clientId, setClientId] = useState(null)
  const [remove, setRemove] = useState(true)
  const [busy, setBusy] = useState(false)
  useEffect(() => { loadClients(setClients, setClientId) }, [])
  const client = clients?.find(c => c.id === clientId)
  const send = () => {
    if (!client || busy) return
    setBusy(true)
    api('/api/trainer/session', { method: 'POST', body: JSON.stringify({ clientId: client.id, workout: sessionToSend(w) }) })
      .then(() => {
        if (remove) useStore.getState().update(s => { s.workouts = s.workouts.filter(x => !(x === w || (w.id != null && x.id === w.id))) })
        toast(t('Added to {0}\'s history', client.name)); close()
      })
      .catch(e => { toast(e.message); setBusy(false) })
  }
  if (!clients) return <div className="muted small">{t('Loading…')}</div>
  return <>
    <h3>{t('Add to a client\'s history')}</h3>
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>
      {t('The session lands in their history as you logged it: {0}, {1}.', w.name || t('Workout'), fmtDate(w.d))}
    </div>
    <ClientPicker clients={clients} clientId={clientId} setClientId={setClientId} />
    {clients.length > 0 && <>
      <div className="row between" style={{ padding: '10px 2px', borderBottom: '1px solid var(--sep)', marginBottom: 14, gap: 12 }}>
        <div><div style={{ fontSize: 15 }}>{t('Remove it from my history')}</div><div className="small dim">{t('It was their workout, not yours.')}</div></div>
        <Switch checked={remove} onChange={setRemove} />
      </div>
      <Button variant="primary" icon="share" disabled={!client || busy} onClick={send}>{client ? t('Add to {0}\'s history', client.name) : t('Pick a client')}</Button>
    </>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/** Trainer: set a client's nutrition. Starts from the last one sent to them. */
export const nutritionForClientSheet = () => ui().openSheet(close => <NutritionForClient close={close} />)

function NutritionForClient({ close }) {
  const [clients, setClients] = useState(null)
  const [clientId, setClientId] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { loadClients(setClients, setClientId) }, [])
  useEffect(() => {
    if (!clientId) return
    setForm(null)
    api('/api/trainer/nutrition?clientId=' + encodeURIComponent(clientId))
      .then(d => setForm(formOf(d.nutrition)))
      .catch(() => setForm(formOf(null)))
  }, [clientId])
  const client = clients?.find(c => c.id === clientId)
  const send = () => {
    if (!client || !form || busy) return
    setBusy(true)
    api('/api/trainer/nutrition', { method: 'POST', body: JSON.stringify({ clientId: client.id, nutrition: nutritionOf(form) }) })
      .then(() => { toast(t('Nutrition updated for {0}', client.name)); close() })
      .catch(e => { toast(e.message); setBusy(false) })
  }
  if (!clients) return <div className="muted small">{t('Loading…')}</div>
  return <>
    <h3>{t('Nutrition for a client')}</h3>
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>
      {t('It shows on their Home screen. They can edit their copy; the next one you save replaces it.')}
    </div>
    <ClientPicker clients={clients} clientId={clientId} setClientId={setClientId} />
    {client && !form && <div className="muted small">{t('Loading…')}</div>}
    {client && form && <>
      <NutritionFields form={form} setForm={setForm} />
      <Button variant="primary" icon="check" disabled={busy} onClick={send}>{t('Save for {0}', client.name)}</Button>
    </>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

// The form both sides edit: numbers as text while typing, the avoid list as one line.
export const formOf = n => ({
  calories: n?.calories ?? '', protein: n?.protein ?? '', water: n?.water ?? '', steps: n?.steps ?? '',
  avoid: (n?.avoid || []).join(', '), meals: n?.meals || '', note: n?.note || '',
})
export const nutritionOf = f => {
  const num = v => (String(v).trim() === '' ? null : +v)
  return { calories: num(f.calories), protein: num(f.protein), water: num(f.water), steps: num(f.steps), avoid: parseAvoid(f.avoid), meals: f.meals, note: f.note }
}

export function NutritionFields({ form, setForm }) {
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))
  const num = (k, label, unit) => <label className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)', gap: 12 }}>
    <span>{label}</span>
    <span className="row" style={{ gap: 6 }}>
      <input className="input" inputMode="decimal" style={{ width: 90, textAlign: 'end' }} value={form[k]} onChange={set(k)} aria-label={label} />
      <span className="dim small" style={{ width: 34 }}>{unit}</span>
    </span>
  </label>
  return <>
    <h4 className="sec">{t('Daily targets')}</h4>
    <div style={{ marginBottom: 14 }}>
      {num('calories', t('Calories'), 'kcal')}
      {num('protein', t('Protein'), 'g')}
      {num('water', t('Water'), 'L')}
      {num('steps', t('Steps'), '')}
    </div>
    <h4 className="sec">{t('Foods to avoid')}</h4>
    <input className="input" style={{ marginBottom: 14 }} placeholder={t('Comma separated, e.g. apple, orange')} value={form.avoid} onChange={set('avoid')} />
    <h4 className="sec">{t('Meal plan')}</h4>
    <textarea className="input" rows={8} maxLength={8000} style={{ marginBottom: 10 }} placeholder={t('Breakfast, lunch, dinner, snacks…')} value={form.meals} onChange={set('meals')} />
    <textarea className="input" rows={2} maxLength={500} style={{ marginBottom: 16 }} placeholder={t('A note (optional)')} value={form.note} onChange={set('note')} />
  </>
}

function loadClients(setClients, setClientId) {
  api('/api/trainer/clients')
    .then(d => { setClients(d.clients); if (d.clients.length === 1) setClientId(d.clients[0].id) })
    .catch(e => { toast(e.message); setClients([]) })
}

function ClientPicker({ clients, clientId, setClientId }) {
  if (!clients.length) return <div className="card small muted">{t('No clients linked to you yet. An admin links them in the Admin dashboard.')}</div>
  return <>
    <h4 className="sec">{t('Client')}</h4>
    <div className="list" style={{ gap: 6, marginBottom: 14 }}>
      {clients.map(c => <button key={c.id} className={'card row between' + (c.id === clientId ? ' sel' : '')}
        style={{ textAlign: 'start', borderColor: c.id === clientId ? 'var(--acc)' : undefined, borderWidth: 1, borderStyle: 'solid' }}
        onClick={() => setClientId(c.id)}>
        <div style={{ fontWeight: 600 }}>{c.name}</div>
        {c.id === clientId && <Icon name="check" />}
      </button>)}
    </div>
  </>
}
