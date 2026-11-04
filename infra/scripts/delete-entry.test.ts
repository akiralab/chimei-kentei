import { describe, expect, it } from 'vitest'
import type { AdminDb, Item } from './delete-entry.ts'
import { applyPlan, planDeletion, regionOfSetId } from './delete-entry.ts'

const SET_A = 'abr20260925r2-e-12-1111'
const SET_B = 'abr20260925r2-e-12-2222'
const SET_ALL = 'abr20260925r2-e-12-3333-all-s3'
const SK_A = 'entry#2026-11-04T00:00:00.000Z#a'

function memoryDb(seed: Item[]): AdminDb & { items: Item[]; stats: Map<string, number> } {
  const items = [...seed]
  const stats = new Map<string, number>()
  return {
    items,
    stats,
    async query(pk, prefix) {
      return items.filter((i) => i.pk === pk && i.sk.startsWith(prefix))
    },
    async scan(match) {
      return items.filter(match)
    },
    async remove(pk, sk) {
      const at = items.findIndex((i) => i.pk === pk && i.sk === sk)
      if (at >= 0) items.splice(at, 1)
    },
    async decrement(sk, field) {
      stats.set(`${sk}:${field}`, (stats.get(`${sk}:${field}`) ?? 0) - 1)
    },
  }
}

/** たろう（tok）が千葉県の SET_A に 1 件登録した状態 */
function seeded(): Item[] {
  return [
    { pk: `set#${SET_A}`, sk: SK_A, entryId: 'a', nickname: 'たろう', score: 80, createdAt: 't' },
    { pk: `set#${SET_A}`, sk: 'token#tok', entryId: 'a' },
    { pk: 'pref#12', sk: SK_A, entryId: 'a' },
    { pk: 'pref#12', sk: 'player#tok' },
    { pk: 'pref#12', sk: 'player#e#tok' },
  ]
}

describe('regionOfSetId', () => {
  it('都道府県と区分を読む', () => {
    expect(regionOfSetId(SET_A)).toEqual({ prefCode: '12', mode: 'e' })
    expect(regionOfSetId(SET_ALL)).toEqual({ prefCode: '12', mode: 'all' })
    expect(regionOfSetId('abr20260925r2-d-131016-77-all')).toEqual({ prefCode: '13', mode: 'all' })
    expect(regionOfSetId('abr20260925r2-e-01c-7460-s2')).toEqual({ prefCode: '01', mode: 'e' })
    expect(regionOfSetId('こわれた')).toBeNull()
  })
})

describe('planDeletion', () => {
  it('本体・写し・予約・人数の印を消してカウンタを減らす', async () => {
    const db = memoryDb(seeded())
    const plan = await planDeletion(db, SET_A, 'a')
    await applyPlan(db, plan!)
    expect(db.items).toEqual([])
    expect(Object.fromEntries(db.stats)).toEqual({
      '12:entries': -1,
      '12#e:entries': -1,
      '12:players': -1,
      '12#e:players': -1,
    })
  })

  it('同じ端末が同じ都道府県に別の行を持つなら人数は減らさない', async () => {
    const db = memoryDb([...seeded(), { pk: `set#${SET_B}`, sk: 'token#tok', entryId: 'b' }])
    await applyPlan(db, (await planDeletion(db, SET_A, 'a'))!)
    expect(db.items.some((i) => i.sk === 'player#tok')).toBe(true)
    expect(db.stats.has('12:players')).toBe(false)
    expect(db.stats.has('12#e:players')).toBe(false)
  })

  it('別の区分にだけ行が残るなら、区分の人数だけ減らす', async () => {
    const db = memoryDb([...seeded(), { pk: `set#${SET_ALL}`, sk: 'token#tok', entryId: 'c' }])
    await applyPlan(db, (await planDeletion(db, SET_A, 'a'))!)
    expect(db.stats.has('12:players')).toBe(false)
    expect(db.stats.get('12#e:players')).toBe(-1)
  })

  it('他の人の行は残し、無い entryId なら何もしない', async () => {
    const other = { pk: `set#${SET_A}`, sk: 'entry#2026-11-04T00:00:01.000Z#z', entryId: 'z', nickname: 'はなこ' }
    const db = memoryDb([...seeded(), other])
    expect(await planDeletion(db, SET_A, 'none')).toBeNull()
    await applyPlan(db, (await planDeletion(db, SET_A, 'a'))!)
    expect(db.items).toEqual([other])
  })
})
