import { describe, expect, it } from 'vitest'
import { parseHash, quizPath, resultPath } from './router.ts'

describe('parseHash', () => {
  it('表紙', () => {
    expect(parseHash('')).toEqual({ name: 'cover' })
    expect(parseHash('#')).toEqual({ name: 'cover' })
    expect(parseHash('#/')).toEqual({ name: 'cover' })
  })

  it('範囲・科目', () => {
    expect(parseHash('#/select')).toEqual({ name: 'select' })
  })

  it('出題・結果は setId を取り出す', () => {
    expect(parseHash('#/q/abr20260925-e-12-1234')).toEqual({ name: 'quiz', setId: 'abr20260925-e-12-1234' })
    expect(parseHash('#/result/abr20260925-d-122165-20261002')).toEqual({
      name: 'result',
      setId: 'abr20260925-d-122165-20261002',
    })
  })

  it('不明なハッシュは表紙', () => {
    expect(parseHash('#/nope')).toEqual({ name: 'cover' })
    expect(parseHash('#/q/')).toEqual({ name: 'cover' })
    expect(parseHash('#/q/a/b')).toEqual({ name: 'cover' })
  })

  it('パス生成はルータで往復する', () => {
    const setId = 'abr20260925-e-00-20261002'
    expect(parseHash(quizPath(setId))).toEqual({ name: 'quiz', setId })
    expect(parseHash(resultPath(setId))).toEqual({ name: 'result', setId })
  })
})
