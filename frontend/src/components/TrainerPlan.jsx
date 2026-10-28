// Trainer plans (Lindsey Lifts). Two screens:
//  - SendPlanSheet: a trainer picks a client, the routines to send and whether the week comes too.
//  - TrainerPlanCard: on the client's Plan tab, the plan their trainer sent, with Apply / Dismiss.
// The server carries the plan; applying it is lib/trainer-plan.js, on the client's own device.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { fmtDate, exCount } from '../lib/format.js'
import { buildTrainerPlan, replacedBy, applyTrainerPlan } from '../lib/trainer-plan.js'
import { Button, Switch } from './ui.jsx'
import Icon from './Icon.jsx'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const dayOf = ts => (ts ? fmtDate(new Date(ts).toISOString().slice(0, 10)) : '')

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
      .then(() => { toast(t('Sent to {0}', client.name)); close() })
      .catch(e => { toast(e.message); setBusy(false) })
  }

  if (!clients) return <div className="muted small">{t('Loading…')}</div>
  return <>
    <h3>{t('Send to a client')}</h3>
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>
      {t('They get it on their Plan tab and tap Apply. It replaces the last plan you sent them; their own routines and their workout history stay as they are.')}
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
        {client ? t('Send to {0}', client.name) : t('Pick a client')}
      </Button>
    </>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/** The client's side: shown on the Plan tab while their trainer has a plan waiting. */
export function TrainerPlanCard() {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const update = useStore(s => s.update)
  const [plans, setPlans] = useState([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!user) return
    let live = true
    api('/api/plan-inbox').then(d => { if (live) setPlans(d.plans || []) }).catch(() => { /* offline or an older server: no card */ })
    return () => { live = false }
  }, [user?.id])
  const p = plans[0]
  if (!user || !p) return null
  // The plan is written in the trainer's unit. A client still on the other one is switched to it
  // on Apply, through the same conversion Settings' "Convert the numbers" uses, so a 70 lb squat
  // reads 70 lb on pound plates instead of 31.75 kg.
  const mine = S.unit || 'kg'
  const theirs = p.plan?.unit === 'lb' || p.plan?.unit === 'kg' ? p.plan.unit : mine
  const switchUnit = theirs !== mine
  const names = (p.plan?.routines || []).map(r => r.name).filter(Boolean)
  const replaces = replacedBy(S, p.plan, p.from.id).map(r => r.name)
  const done = status => api('/api/plan-inbox/done', { method: 'POST', body: JSON.stringify({ id: p.id, status }) })
    .catch(() => { /* recorded next time; the plan itself is already applied or dropped here */ })
  const apply = () => {
    if (busy) return
    setBusy(true)
    let res
    if (switchUnit) useStore.getState().setUnit(theirs)
    try { update(s => { res = applyTrainerPlan(s, p.plan, { trainerId: p.from.id, schedule: p.schedule !== false }) }) }
    catch (e) { toast(e.message); setBusy(false); return }
    done('applied')
    setPlans(ps => ps.slice(1))
    setBusy(false)
    toast(t('Plan from {0} applied', p.from.name) + (res.dropped ? ' · ' + t('{0} exercises left out', res.dropped) : ''))
  }
  const dismiss = () => { done('dismissed'); setPlans(ps => ps.slice(1)) }

  return <div className="card" style={{ marginBottom: 14, borderLeft: '3px solid var(--acc)' }}>
    <div className="row" style={{ gap: 10, marginBottom: 6 }}>
      <Icon name="clipboard" />
      <div style={{ fontWeight: 700 }}>{t('New plan from {0}', p.from.name)}</div>
    </div>
    <div className="dim small" style={{ marginBottom: 8 }}>{t('Sent {0}', dayOf(p.sent))}</div>
    {p.note && <div className="small" style={{ marginBottom: 10, whiteSpace: 'pre-wrap' }}>“{p.note}”</div>}
    <div className="small" style={{ marginBottom: 6 }}>{names.join(' · ')}</div>
    {replaces.length > 0 && <div className="dim small" style={{ marginBottom: 6 }}>{t('Replaces: {0}', replaces.join(', '))}</div>}
    {p.schedule !== false && Object.keys(p.plan?.week || {}).length > 0 &&
      <div className="dim small" style={{ marginBottom: 6 }}>{t('Your weekly schedule is updated too.')}</div>}
    {switchUnit && <div className="small" style={{ marginBottom: 6 }}>{t('Applying also switches your app to {0}, the unit {1} writes in. Weights you already logged are converted.', theirs, p.from.name)}</div>}
    <div className="dim small" style={{ marginBottom: 12 }}>{t('Your workout history and progress stay as they are.')}</div>
    <Button variant="primary" disabled={busy} onClick={apply}>{t('Apply')}</Button>
    <div style={{ height: 6 }} />
    <Button variant="ghost" className="dim" onClick={dismiss}>{t('Dismiss')}</Button>
  </div>
}
