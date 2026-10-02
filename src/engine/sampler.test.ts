import { describe, expect, it } from 'vitest'
import { sampleQuestions } from './sampler.ts'
import { EASY_12 } from './__fixtures__/questions.ts'

const ids = (qs: { id: string }[]) => qs.map((q) => q.id)

describe('sampleQuestions', () => {
  it('同じ setId なら同じ列（順序も同じ）', () => {
    const a = sampleQuestions(EASY_12, 'abr20260925-e-12-1234')
    const b = sampleQuestions(EASY_12, 'abr20260925-e-12-1234')
    expect(ids(a)).toEqual(ids(b))
  })

  it('pool の並び順が違っても setId が同じなら同じ列', () => {
    const shuffled = EASY_12.slice().reverse()
    expect(ids(sampleQuestions(shuffled, 'abr20260925-e-12-1234'))).toEqual(
      ids(sampleQuestions(EASY_12, 'abr20260925-e-12-1234')),
    )
  })

  it('seed が違えば違う列', () => {
    const a = ids(sampleQuestions(EASY_12, 'abr20260925-e-12-1234'))
    const b = ids(sampleQuestions(EASY_12, 'abr20260925-e-12-9999'))
    expect(a).not.toEqual(b)
  })

  it('10 件・重複なし（非復元）', () => {
    const got = sampleQuestions(EASY_12, 'abr20260925-e-12-4242')
    expect(got).toHaveLength(10)
    expect(new Set(ids(got)).size).toBe(10)
    for (const q of got) expect(EASY_12).toContain(q)
  })

  it('pool が n 未満なら全件を返す', () => {
    const small = EASY_12.slice(0, 4)
    const got = sampleQuestions(small, 'abr20260925-e-12-1234')
    expect(got).toHaveLength(4)
    expect(new Set(ids(got)).size).toBe(4)
  })

  it('n を指定できる', () => {
    expect(sampleQuestions(EASY_12, 'abr20260925-e-12-1234', 3)).toHaveLength(3)
  })
})
