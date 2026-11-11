import { describe, it, expect } from 'vitest'
import { sessionToSend, applyTrainerSession, applyTrainerNutrition, parseAvoid, hasNutrition } from './trainer-inbox.js'

const W = {
  id: 'w1', d: '2026-11-07', start: Date.parse('2026-11-07T16:00:00Z'), end: Date.parse('2026-11-07T17:00:00Z'),
  name: 'Upper B', bw: 150, prs: ['0025'], media: [{ h: 'x' }],
  entries: [{ id: '0025', sets: [{ w: 12, r: 8, done: true }], muscleSnapshot: { chest: 1 } }],
}

describe('sessionToSend', () => {
  it('drops the trainer\'s own body weight, badges, media and muscle snapshots', () => {
    const out = sessionToSend(W)
    expect(out.bw).toBeUndefined()
    expect(out.prs).toBeUndefined()
    expect(out.media).toBeUndefined()
    expect(out.entries[0].muscleSnapshot).toBeUndefined()
    expect(out.entries[0].sets[0].w).toBe(12)
  })
})

describe('applyTrainerSession', () => {
  const later = { id: 'w2', d: '2026-11-09', start: Date.parse('2026-11-09T16:00:00Z'), entries: [] }
  it('files it by date, links the routine of the same name, and only once', () => {
    const s = { workouts: [later], routines: [{ id: 'rB', name: 'upper b' }] }
    expect(applyTrainerSession(s, sessionToSend(W), { trainerId: 't1', now: 5 })).toBe(true)
    expect(s.workouts.map(w => w.id)).toEqual(['w1', 'w2'])
    const got = s.workouts[0]
    expect(got.routineIds).toEqual(['rB'])
    expect(got.fromTrainer).toBe('t1')
    expect(got._ts).toBe(5)
    expect(applyTrainerSession(s, sessionToSend(W), { trainerId: 't1' })).toBe(false)
    expect(s.workouts.length).toBe(2)
  })
  it('leaves the routine unlinked when the client has none of that name', () => {
    const s = { workouts: [], routines: [] }
    applyTrainerSession(s, sessionToSend(W))
    expect(s.workouts[0].routineIds).toEqual([])
    expect(s.workouts[0].routineId).toBe(null)
  })
})

describe('nutrition', () => {
  it('parses an avoid list on commas and lines', () => {
    expect(parseAvoid('Apple, orange\n pineapple ,,')).toEqual(['Apple', 'orange', 'pineapple'])
  })
  it('replaces the client copy with the trainer\'s', () => {
    const s = { nutrition: { calories: 2000, meals: 'old' } }
    applyTrainerNutrition(s, { calories: '1700', protein: 115, avoid: ['Apple'], meals: 'new' }, { trainerId: 't1', from: 'Lindsey', sent: 9 })
    expect(s.nutrition).toMatchObject({ calories: 1700, protein: 115, water: null, avoid: ['Apple'], meals: 'new', from: 'Lindsey', sent: 9 })
    expect(hasNutrition(s.nutrition)).toBe(true)
    expect(hasNutrition({ calories: null, avoid: [], meals: ' ' })).toBe(false)
  })
})
