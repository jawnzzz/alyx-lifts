// What a trainer sends a client (Lindsey Lifts), taken in on the client's own device. The server
// only carries it (api/server.js, /api/plan-inbox); the client's app applies each item through
// the store's ordinary update, so sync sees an ordinary edit, and the client can change anything
// afterwards like their own data. Plans go through lib/trainer-plan.js; sessions and nutrition are
// here.

import { insertChronological } from './backfill.js'
import { rebuildPrHistory } from './workout-date.js'
import { stampWorkout } from './sync-merge.js'

const norm = s => String(s || '').trim().toLowerCase()

/**
 * A session the trainer logged in their own app, as it travels to the client: the sets and the
 * timing, none of the trainer's own body weight, photos or badges. The client's PRs are worked
 * out against the client's own history when it lands.
 */
export function sessionToSend(w) {
  const entries = (w.entries || []).map(({ muscleSnapshot, ...e }) => e)
  return {
    id: w.id, d: w.d, start: w.start, end: w.end, name: w.name || '',
    entries, ...(w.note ? { note: w.note } : {}),
  }
}

/**
 * Files a session from the trainer in the client's history `s.workouts`, in date order, linked to
 * the client's routine of the same name if they have one. A session already filed (same id) is
 * left alone, so taking the same item in twice adds it once. Mutates `s`; returns whether it was
 * added.
 */
export function applyTrainerSession(s, workout, { trainerId, now = Date.now() } = {}) {
  if (!workout || !Array.isArray(workout.entries)) return false
  s.workouts = Array.isArray(s.workouts) ? s.workouts : []
  if (workout.id != null && s.workouts.some(w => w.id === workout.id)) return false
  const routine = (s.routines || []).find(r => norm(r.name) === norm(workout.name))
  const routineIds = routine ? [routine.id] : []
  const w = stampWorkout({
    ...workout, routineIds, routineId: routineIds[0] ?? null, prs: [],
    ...(trainerId ? { fromTrainer: trainerId } : {}),
  }, now)
  s.workouts = rebuildPrHistory(insertChronological(s.workouts, w), w.entries.map(e => e.id), w)
  return true
}

/** Splits a typed "avoid" list into items: one per comma or line. */
export const parseAvoid = text => String(text || '').split(/[,\n]/).map(x => x.trim()).filter(Boolean).slice(0, 40)

/**
 * Nutrition from the trainer, copied into the client's own `s.nutrition`. The client can edit it;
 * the next one from the trainer replaces it. Mutates `s`.
 */
export function applyTrainerNutrition(s, nutrition, { trainerId, from = '', sent = Date.now() } = {}) {
  if (!nutrition || typeof nutrition !== 'object') return false
  const n = v => (v == null || v === '' || !Number.isFinite(+v) ? null : +v)
  s.nutrition = {
    calories: n(nutrition.calories), protein: n(nutrition.protein), water: n(nutrition.water), steps: n(nutrition.steps),
    avoid: Array.isArray(nutrition.avoid) ? nutrition.avoid.map(String).filter(Boolean) : [],
    meals: typeof nutrition.meals === 'string' ? nutrition.meals : '',
    note: typeof nutrition.note === 'string' ? nutrition.note : '',
    from, trainerId: trainerId || null, sent,
  }
  return true
}

/** Whether a nutrition record holds anything worth a card. */
export const hasNutrition = n => !!n && (n.calories != null || n.protein != null || n.water != null || n.steps != null
  || (n.avoid || []).length > 0 || !!(n.meals || '').trim())
