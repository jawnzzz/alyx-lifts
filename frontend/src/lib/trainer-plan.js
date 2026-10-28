// Trainer plans (Lindsey Lifts): a trainer sends routines to a linked client, the client applies
// them from their Plan tab. The server only carries the plan (api/server.js, /api/trainer/send and
// /api/plan-inbox); everything that touches the client's data happens here, on their device,
// through the store's ordinary update, so sync sees an ordinary edit.
//
// The bundle is a plan file (lib/plan-share.js buildPlanBundle), so applying goes through the same
// parsePlan → mergePlan path an imported file does. What a plan file cannot do on its own is
// replace: importing twice gives two of everything. So the routines a trainer's plan adds carry
// `fromTrainer` (the trainer's id), and the next plan from that trainer removes them first.

import { buildPlanBundle, parsePlan, mergePlan } from './plan-share.js'
import { deleteRoutine } from './routines.js'

const norm = s => String(s || '').trim().toLowerCase()

/**
 * The bundle a trainer sends: the chosen routines, and the week restricted to them. A routine
 * scheduled on a day but not chosen is left off that day, so the client's week never points at a
 * routine they were not sent.
 */
export function buildTrainerPlan(S, routineIds, name) {
  const keep = new Set(routineIds)
  const full = buildPlanBundle(S, name)
  const routines = full.routines.filter(r => keep.has(r.id))
  const used = new Set(routines.flatMap(r => r.ex.map(e => e.id)))
  const week = {}
  Object.entries(full.week || {}).forEach(([d, ids]) => {
    const left = [].concat(ids).filter(id => keep.has(id))
    if (left.length) week[d] = left
  })
  return { ...full, week, routines, customEx: (full.customEx || []).filter(c => used.has(c.id)) }
}

/**
 * The client's routines a plan from `trainerId` replaces: every routine an earlier plan from them
 * added, plus, for routines that carry no trainer at all, any with the same name as a routine in
 * the new plan (a plan file the client imported by hand before plans could be sent, so the first
 * plan sent takes its place instead of sitting next to it). Another trainer's routines are never
 * matched by name.
 */
export function replacedBy(S, plan, trainerId) {
  const incoming = new Set((plan?.routines || []).map(r => norm(r.name)))
  return (S.routines || []).filter(r => r && (
    r.fromTrainer === trainerId || (!r.fromTrainer && incoming.has(norm(r.name)))
  ))
}

/**
 * Apply a sent plan in place on a store draft `s`. Returns what changed, for the toast.
 * `plan` is the raw bundle off the server; parsePlan validates it and converts its weights to the
 * client's unit. With `schedule`, the plan's week replaces the client's (as a plan import does).
 */
export function applyTrainerPlan(s, plan, { trainerId, schedule = true } = {}) {
  const unit = s.unit == null ? 'kg' : s.unit
  const bundle = parsePlan(plan, unit)
  if (!bundle.routines.length) throw new Error('This plan has no routines.')
  s.routines = s.routines || []
  s.week = s.week || {}
  const replaced = replacedBy(s, bundle, trainerId)
  replaced.forEach(r => deleteRoutine(s, r.id))
  const before = new Set(s.routines.map(r => r.id))
  mergePlan(s, bundle, { schedule })
  s.routines.forEach(r => { if (!before.has(r.id)) r.fromTrainer = trainerId })
  return { added: bundle.routines.length, replaced: replaced.map(r => r.name), dropped: bundle.dropped }
}
