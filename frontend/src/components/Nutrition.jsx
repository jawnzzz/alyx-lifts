// Home cards for a client (Lindsey Lifts): the nutrition their trainer set, which they can edit,
// and their waist measurement next to the weight card.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtNum, fmtDate, isoOf } from '../lib/format.js'
import { hasNutrition } from '../lib/trainer-inbox.js'
import { latestMeasurement, measurementSeries, measurementUnit, toMeasurementDisplay } from '../lib/measurements.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { NutritionFields, formOf, nutritionOf } from './TrainerPlan.jsx'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

const ui = () => useUI.getState()

export function NutritionCard() {
  const n = useStore(s => s.S.nutrition)
  if (!hasNutrition(n)) return null
  const targets = [
    n.calories != null && [fmtNum(n.calories), 'kcal'],
    n.protein != null && [fmtNum(n.protein), t('g protein')],
    n.water != null && [fmtNum(n.water), t('L water')],
    n.steps != null && [fmtNum(n.steps), t('steps')],
  ].filter(Boolean)
  return <div className="card tappable" style={{ cursor: 'pointer' }} {...tappable(nutritionSheet)}>
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Nutrition')}</h2>
      <Icon name="chevronRight" className="chev" />
    </div>
    {targets.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: `repeat(${targets.length}, minmax(0, 1fr))`, gap: 8 }}>
      {targets.map(([v, u]) => <div key={u}><div style={{ fontSize: 20, fontWeight: 600 }}>{v}</div><div className="dim small">{u}</div></div>)}
    </div>}
    {(n.avoid || []).length > 0 && <div className="small" style={{ marginTop: 10 }}>
      <span className="dim">{t('Avoid')}: </span>{n.avoid.join(', ')}
    </div>}
    {n.from && <div className="dim small" style={{ marginTop: 8 }}>{t('From {0}', n.from)}{n.sent ? ' · ' + fmtDate(isoOf(new Date(n.sent))) : ''}</div>}
  </div>
}

export const nutritionSheet = () => ui().openSheet(close => <NutritionSheet close={close} />)

function NutritionSheet({ close }) {
  const n = useStore(s => s.S.nutrition)
  const update = useStore(s => s.update)
  const [form, setForm] = useState(null)
  if (form) return <>
    <h3>{t('Edit nutrition')}</h3>
    <NutritionFields form={form} setForm={setForm} />
    <Button variant="primary" icon="check" onClick={() => {
      update(s => { s.nutrition = { ...(s.nutrition || {}), ...nutritionOf(form) } })
      setForm(null)
    }}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={() => setForm(null)}>{t('Cancel')}</Button>
  </>
  return <>
    <h3>{t('Nutrition')}</h3>
    {n?.note && <div className="small" style={{ marginBottom: 12, whiteSpace: 'pre-wrap' }}>“{n.note}”</div>}
    {(n?.avoid || []).length > 0 && <>
      <h4 className="sec">{t('Foods to avoid')}</h4>
      <div className="small" style={{ marginBottom: 14 }}>{n.avoid.join(', ')}</div>
    </>}
    {n?.meals && <>
      <h4 className="sec">{t('Meal plan')}</h4>
      <div className="small" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5, marginBottom: 16 }}>{n.meals}</div>
    </>}
    {n?.from && <div className="dim small" style={{ marginBottom: 14 }}>{t('Set by {0}. Your edits stay until they send a new one.', n.from)}</div>}
    <Button icon="pencil" onClick={() => setForm(formOf(n))}>{t('Edit')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}

/** The latest waist measurement and how far it has moved since the first one. */
export function WaistCard() {
  const S = useStore(s => s.S)
  const nav = useNavigate()
  const latest = latestMeasurement(S, 'waist')
  // Shown empty to a client whose trainer set them up, so the first measurement is a tap away.
  if (!latest) return hasNutrition(S.nutrition) ? <div className="card tappable" style={{ cursor: 'pointer' }} {...tappable(() => nav('/measurements'))}>
    <div className="row between">
      <div><div className="lbl2">{t('Waist')}</div><div className="small muted">{t('Measure at your navel, in the morning, every 2 weeks.')}</div></div>
      <Icon name="plus" className="chev" />
    </div>
  </div> : null
  const series = measurementSeries(S, 'waist')
  const unit = measurementUnit(S.unit)
  const now = toMeasurementDisplay(latest.value, S.unit)
  const first = series.length > 1 ? series[0].y : null
  const change = first != null ? Math.round((now - first) * 10) / 10 : null
  return <div className="card tappable" style={{ cursor: 'pointer' }} {...tappable(() => nav('/measurements'))}>
    <div className="row between">
      <div>
        <div className="lbl2">{t('Waist')}</div>
        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          <div className="big">{fmtNum(now)} <span className="muted" style={{ fontSize: '1rem' }}>{unit}</span></div>
          {!!change && <span className="small" style={{ fontWeight: 500, color: change < 0 ? 'var(--green)' : 'var(--label-2)' }}>
            {change > 0 ? '+' : '−'}{fmtNum(Math.abs(change))} {t('since {0}', fmtDate(series[0].d))}
          </span>}
        </div>
      </div>
      <Icon name="chevronRight" className="chev" />
    </div>
  </div>
}
