import { describe, it, expect } from 'vitest'
import { buildTrainerPlan, replacedBy, applyTrainerPlan } from './trainer-plan.js'

const ex = (id, weight) => ({ id, sets: 3, reps: 12, repsMin: 8, prog: 'double', ...(weight ? { weight } : {}) })
const trainerState = () => ({
  unit: 'lb',
  routines: [
    { id: 'a', name: 'Lower A', ex: [ex('0770', 70)] },
    { id: 'b', name: 'Upper A', ex: [ex('0289')] },
    { id: 'c', name: 'My own thing', ex: [ex('0293')] },
  ],
  week: { 1: ['a'], 3: ['b', 'c'], 5: ['c'] },
  customEx: [],
})

describe('buildTrainerPlan', () => {
  it('sends only the chosen routines, and only their days', () => {
    const p = buildTrainerPlan(trainerState(), ['a', 'b'], 'Week 2')
    expect(p.routines.map(r => r.name)).toEqual(['Lower A', 'Upper A'])
    expect(p.week).toEqual({ 1: ['a'], 3: ['b'] })
    expect(p.unit).toBe('lb')
    expect(p.name).toBe('Week 2')
  })
})

describe('applyTrainerPlan', () => {
  const T = 'u_trainer'
  const plan = buildTrainerPlan(trainerState(), ['a', 'b'])

  it('adds the routines, tags them and sets the week', () => {
    const s = { unit: 'lb', routines: [], week: {}, workouts: [] }
    const r = applyTrainerPlan(s, plan, { trainerId: T })
    expect(r.added).toBe(2)
    expect(s.routines.map(x => x.name)).toEqual(['Lower A', 'Upper A'])
    expect(s.routines.every(x => x.fromTrainer === T)).toBe(true)
    const byId = Object.fromEntries(s.routines.map(x => [x.id, x.name]))
    expect(byId[s.week[1][0]]).toBe('Lower A')
    expect(byId[s.week[3][0]]).toBe('Upper A')
    expect(s.routines[0].ex[0].weight).toBe(70)
  })

  it('replaces the previous plan from the same trainer instead of duplicating it', () => {
    const s = { unit: 'lb', routines: [], week: {}, workouts: [] }
    applyTrainerPlan(s, plan, { trainerId: T })
    const next = buildTrainerPlan({ ...trainerState(), routines: trainerState().routines.map(r => r.id === 'a' ? { ...r, ex: [ex('0770', 75)] } : r) }, ['a', 'b'])
    const r = applyTrainerPlan(s, next, { trainerId: T })
    expect(r.replaced.sort()).toEqual(['Lower A', 'Upper A'])
    expect(s.routines.map(x => x.name)).toEqual(['Lower A', 'Upper A'])
    expect(s.routines.find(x => x.name === 'Lower A').ex[0].weight).toBe(75)
  })

  it('keeps the client’s own routines and another trainer’s', () => {
    const s = {
      unit: 'lb', week: { 2: ['mine'] }, workouts: [],
      routines: [
        { id: 'mine', name: 'Sunday run', ex: [ex('0685')] },
        { id: 'theirs', name: 'Lower A', fromTrainer: 'u_other', ex: [ex('0770')] },
      ],
    }
    const r = applyTrainerPlan(s, plan, { trainerId: T, schedule: false })
    expect(r.replaced).toEqual([])
    expect(s.routines.map(x => x.name).sort()).toEqual(['Lower A', 'Lower A', 'Sunday run', 'Upper A'])
    expect(s.week).toEqual({ 2: ['mine'] })
  })

  it('takes the place of a plan file imported by hand with the same routine names', () => {
    const s = {
      unit: 'lb', workouts: [], week: { 1: ['old1'], 2: ['old2'] },
      routines: [{ id: 'old1', name: 'Lower A', ex: [ex('0770', 70)] }, { id: 'old2', name: 'upper a ', ex: [ex('0289')] }],
    }
    expect(replacedBy(s, plan, T).map(r => r.id)).toEqual(['old1', 'old2'])
    applyTrainerPlan(s, plan, { trainerId: T })
    expect(s.routines).toHaveLength(2)
    expect(s.routines.some(r => r.id === 'old1' || r.id === 'old2')).toBe(false)
    expect(s.week[2]).toBeUndefined()
  })

  it('converts the weights into a kg client’s unit', () => {
    const s = { unit: 'kg', routines: [], week: {}, workouts: [] }
    applyTrainerPlan(s, plan, { trainerId: T })
    expect(s.routines[0].ex[0].weight).toBeCloseTo(31.75, 0)
  })

  it('refuses something that is not a plan', () => {
    const s = { unit: 'lb', routines: [], week: {} }
    expect(() => applyTrainerPlan(s, { hello: 1 }, { trainerId: T })).toThrow()
  })
})
