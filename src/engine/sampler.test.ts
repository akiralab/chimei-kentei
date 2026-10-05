import { describe, expect, it } from 'vitest'
import { sampleQuestions } from './sampler.ts'
import { DIFFICULT_12_WITH_SKIP, EASY_12, makeDifficult, withSkipReading } from './__fixtures__/questions.ts'

const ids = (qs: { id: string }[]) => qs.map((q) => q.id)

/** 出題しない町名を 2 件（町3・町12）含む 14 件の母集団。出題できるのは 12 件 */
const SKIP_POOL = DIFFICULT_12_WITH_SKIP
const SKIP_SET_ID = 'abr20260925-d-120009-0417'

/**
 * SKIP_POOL に skip が無かったとして（＝ Issue #50 以前の sampleQuestions で）
 * SKIP_SET_ID を引いたときの 10 問。skip の 2 件を抜いた並びが新しい結果の前半になる
 */
const BEFORE_SKIP = [
  'o:120009:千市9町11',
  'o:120009:千市9町5',
  'o:120009:千市9町12', // skip（出題しない）
  'o:120009:千市9町6',
  'o:120009:千市9町13',
  'o:120009:千市9町2',
  'o:120009:千市9町7',
  'o:120009:千市9町8',
  'o:120009:千市9町9',
  'o:120009:千市9町14',
]

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

/**
 * 出題しない問（`skip`）の扱い（Issue #50）。要点は
 * **skip を引かなかったセットの 10 問が前と変わらない**こと
 */
describe('sampleQuestions / skip', () => {
  it('skip 無しの母集団では結果が従来と同一', () => {
    // Issue #50 以前の実装（母集団の先頭 n 件をそのまま返す）で得た列を固定する
    expect(ids(sampleQuestions(EASY_12, 'abr20260925-e-12-1234'))).toEqual([
      'c:120023:千市23',
      'c:120021:千市21',
      'c:120020:千市20',
      'c:120009:千市9',
      'c:120005:千市5',
      'c:120011:千市11',
      'c:120008:千市8',
      'c:120013:千市13',
      'c:120004:千市4',
      'c:120003:千市3',
    ])
    expect(EASY_12.every((q) => q.skip === undefined)).toBe(true)
  })

  it('skip を含む母集団では skip を飛ばして n 件', () => {
    const got = ids(sampleQuestions(SKIP_POOL, SKIP_SET_ID))
    expect(got).toHaveLength(10)
    expect(got).toEqual([
      // 従来の列から skip の町12 が抜け、後ろが 1 つずつ繰り上がって町10 が足される
      'o:120009:千市9町11',
      'o:120009:千市9町5',
      'o:120009:千市9町6',
      'o:120009:千市9町13',
      'o:120009:千市9町2',
      'o:120009:千市9町7',
      'o:120009:千市9町8',
      'o:120009:千市9町9',
      'o:120009:千市9町14',
      'o:120009:千市9町10',
    ])
    // skip は 1 件も返らず、重複もない
    expect(got.filter((id) => id.endsWith('町12') || id.endsWith('町3'))).toEqual([])
    expect(new Set(got).size).toBe(10)
    // 置き換わったのは skip の 1 件だけ ＝ 残り 9 問は従来のまま（順も相対的に同じ）
    expect(got.filter((id) => BEFORE_SKIP.includes(id))).toEqual(
      BEFORE_SKIP.filter((id) => !id.endsWith('町12')),
    )
  })

  it('全件（n = 母集団）でも skip は返らない', () => {
    const got = sampleQuestions(SKIP_POOL, SKIP_SET_ID, SKIP_POOL.length)
    expect(got).toHaveLength(SKIP_POOL.length - 2)
    expect(got.every((q) => q.skip === undefined)).toBe(true)
    expect(new Set(ids(got)).size).toBe(got.length)
  })

  it('skip だらけで n 件に足りなければ拾えた分だけ', () => {
    const towns = makeDifficult('12', '千葉県', 9, 14)
    const mostly = withSkipReading(towns, [...Array(12).keys()]) // 14 件のうち 12 件が skip
    const got = sampleQuestions(mostly, SKIP_SET_ID)
    expect(ids(got)).toEqual(['o:120009:千市9町13', 'o:120009:千市9町14'])
  })

  it('母集団が skip だけなら空', () => {
    const towns = makeDifficult('12', '千葉県', 9, 5)
    expect(sampleQuestions(withSkipReading(towns, [0, 1, 2, 3, 4]), SKIP_SET_ID)).toEqual([])
  })
})
