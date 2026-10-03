import { describe, expect, it } from 'vitest'
import { DATA_VERSION } from './bank.ts'
import { allRowNote, isAllRow, rowCounts, scoreOf } from './score.ts'

const SET = `${DATA_VERSION}-e-12-1234`
const SET_ALL = `${DATA_VERSION}-e-12-1234-all`

describe('scoreOf', () => {
  it('10 問は正答数 × 10', () => {
    expect(scoreOf(0, 10)).toBe(0)
    expect(scoreOf(8, 10)).toBe(80)
    expect(scoreOf(10, 10)).toBe(100)
  })

  it('10 問以外は正答率を 100 点満点に丸める', () => {
    // 23 問で 20 問正解 → 86.95… → 87 点
    expect(scoreOf(20, 23)).toBe(87)
    expect(scoreOf(19, 25)).toBe(76)
    expect(scoreOf(179, 179)).toBe(100)
    expect(scoreOf(0, 179)).toBe(0)
  })

  it('答案が無ければ 0 点', () => {
    expect(scoreOf(0, 0)).toBe(0)
    expect(scoreOf(3, -1)).toBe(0)
  })
})

describe('rowCounts', () => {
  it('correct / total があればそのまま', () => {
    expect(rowCounts({ setId: SET_ALL, score: 87, correct: 20, total: 23 })).toEqual({ correct: 20, total: 23 })
  })

  it('持っていない古い行は 10 問として得点から正答数を戻す', () => {
    expect(rowCounts({ setId: SET, score: 80 })).toEqual({ correct: 8, total: 10 })
  })
})

describe('isAllRow / allRowNote', () => {
  it('setId の `-all` で見分ける', () => {
    expect(isAllRow({ setId: SET, score: 80 })).toBe(false)
    expect(isAllRow({ setId: SET_ALL, score: 87, correct: 20, total: 23 })).toBe(true)
  })

  it('setId が読めないときだけ total が 10 問でないことで見分ける', () => {
    expect(isAllRow({ setId: 'こわれた', score: 87, total: 23 })).toBe(true)
    expect(isAllRow({ setId: 'こわれた', score: 80, total: 10 })).toBe(false)
    expect(isAllRow({ setId: 'こわれた', score: 80 })).toBe(false)
  })

  it('注記は 10 問なら null、全市区町村名なら問題数を添える（無ければ名前だけ）', () => {
    expect(allRowNote({ setId: SET, score: 80, correct: 8, total: 10 })).toBeNull()
    expect(allRowNote({ setId: SET_ALL, score: 87, correct: 20, total: 23 })).toBe('全市区町村名（23 問）')
    expect(allRowNote({ setId: SET_ALL, score: 87 })).toBe('全市区町村名')
  })
})
