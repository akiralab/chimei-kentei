import { describe, expect, it } from 'vitest'
import { MIN_POOL_FOR_SCOPE } from './types.ts'
import { DATA_VERSION, buildPool, buildQuestionSet, loadMeta } from './bank.ts'
import { DIFFICULT_12, EASY_12, EASY_13, fixtureSource, lgCodeOf } from './__fixtures__/questions.ts'

const src = fixtureSource()

describe('loadMeta', () => {
  it('meta を読める', async () => {
    const meta = await loadMeta(src)
    expect(meta.prefectures.map((p) => p.code)).toEqual(['12', '13'])
    expect(meta.cities.length).toBe(EASY_12.length + EASY_13.length)
  })
})

describe('buildPool / easy', () => {
  it("scope '00' は easy 全件", async () => {
    const pool = await buildPool('e', '00', src)
    expect(pool.questions).toHaveLength(EASY_12.length + EASY_13.length)
    expect(pool.widened).toBe(false)
  })

  it('2 桁はその都道府県の easy', async () => {
    const pool = await buildPool('e', '12', src)
    expect(pool.questions).toHaveLength(EASY_12.length)
    expect(pool.questions.every((q) => q.prefCode === '12')).toBe(true)
    expect(pool.widened).toBe(false)
  })

  it('6 桁は母集団 1 件なので必ず都道府県へ広がる（widened）', async () => {
    const pool = await buildPool('e', lgCodeOf('12', 3), src)
    expect(pool.widened).toBe(true)
    expect(pool.scope).toBe('12')
    expect(pool.questions).toHaveLength(EASY_12.length)
  })

  it('都道府県でも MIN_POOL_FOR_SCOPE 未満ならそのまま（これ以上広げない）', async () => {
    expect(EASY_13.length).toBeLessThan(MIN_POOL_FOR_SCOPE)
    const pool = await buildPool('e', '13', src)
    expect(pool.widened).toBe(false)
    expect(pool.scope).toBe('13')
    expect(pool.questions).toHaveLength(EASY_13.length)
  })
})

describe('buildPool / difficult', () => {
  it('2 桁は easy ∪ difficult', async () => {
    const pool = await buildPool('d', '12', src)
    expect(pool.questions).toHaveLength(EASY_12.length + DIFFICULT_12.length)
    expect(new Set(pool.questions.map((q) => q.id)).size).toBe(pool.questions.length)
    expect(pool.widened).toBe(false)
  })

  it('6 桁は lgCode 一致の easy 1 件 ∪ difficult', async () => {
    const pool = await buildPool('d', lgCodeOf('12', 1), src)
    expect(pool.widened).toBe(false)
    expect(pool.questions).toHaveLength(1 + DIFFICULT_12.length)
  })

  it('6 桁で母集団が足りなければ都道府県へ広がる', async () => {
    const pool = await buildPool('d', lgCodeOf('13', 1), src)
    expect(pool.widened).toBe(true)
    expect(pool.scope).toBe('13')
  })

  it("scope '00' は非対応（throw）", async () => {
    await expect(buildPool('d', '00', src)).rejects.toThrow()
  })
})

describe('buildQuestionSet', () => {
  it('setId・10 問・widened が揃う', async () => {
    const set = await buildQuestionSet('e', '12', '1234', src)
    expect(set.setId).toBe(`${DATA_VERSION}-e-12-1234`)
    expect(set.dataVersion).toBe(DATA_VERSION)
    expect(set.mode).toBe('e')
    expect(set.scope).toBe('12')
    expect(set.seed).toBe('1234')
    expect(set.widened).toBe(false)
    expect(set.questions).toHaveLength(10)
  })

  it('同じ setId なら同じ出題列', async () => {
    const a = await buildQuestionSet('e', '12', '1234', src)
    const b = await buildQuestionSet('e', '12', '1234', src)
    expect(a.questions.map((q) => q.id)).toEqual(b.questions.map((q) => q.id))
  })

  it('seed が違えば別の出題列', async () => {
    const a = await buildQuestionSet('e', '12', '1234', src)
    const b = await buildQuestionSet('e', '12', '8888', src)
    expect(a.questions.map((q) => q.id)).not.toEqual(b.questions.map((q) => q.id))
  })

  it('scope が 6 桁でも setId には選んだ範囲が残り、widened が立つ', async () => {
    const set = await buildQuestionSet('e', lgCodeOf('12', 7), '1234', src)
    expect(set.setId).toBe(`${DATA_VERSION}-e-${lgCodeOf('12', 7)}-1234`)
    expect(set.scope).toBe(lgCodeOf('12', 7))
    expect(set.widened).toBe(true)
  })

  it('出題できる地名が無ければ throw', async () => {
    await expect(buildQuestionSet('e', '990001', '1234', src)).rejects.toThrow()
  })
})
