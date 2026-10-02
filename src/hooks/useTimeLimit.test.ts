// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { TIME_LIMIT_MS } from '../engine/types.ts'
import {
  NO_TIME_LIMIT,
  TIME_LIMIT_KEY,
  isValidTimeLimit,
  quizTimeLimitKey,
  readQuizTimeLimit,
  readTimeLimit,
  writeQuizTimeLimit,
  writeTimeLimit,
} from './useTimeLimit.ts'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('readTimeLimit / writeTimeLimit', () => {
  it('未設定は 0（制限なし）が既定', () => {
    expect(readTimeLimit()).toBe(NO_TIME_LIMIT)
  })

  it('20 秒を保存して読み戻せる', () => {
    writeTimeLimit(TIME_LIMIT_MS)
    expect(localStorage.getItem(TIME_LIMIT_KEY)).toBe('20000')
    expect(readTimeLimit()).toBe(TIME_LIMIT_MS)

    writeTimeLimit(NO_TIME_LIMIT)
    expect(readTimeLimit()).toBe(NO_TIME_LIMIT)
  })

  it('壊れた値・範囲外の値は 0 に寄せる', () => {
    for (const raw of ['', 'abc', '999', '60001', '-1', '1.5']) {
      localStorage.setItem(TIME_LIMIT_KEY, raw)
      expect(readTimeLimit()).toBe(NO_TIME_LIMIT)
    }
  })

  it('範囲外は保存しない（既存の設定を壊さない）', () => {
    writeTimeLimit(TIME_LIMIT_MS)
    writeTimeLimit(999)
    expect(readTimeLimit()).toBe(TIME_LIMIT_MS)
  })
})

describe('isValidTimeLimit', () => {
  it('0 と 1000〜60000 の整数だけ有効', () => {
    expect(isValidTimeLimit(0)).toBe(true)
    expect(isValidTimeLimit(1000)).toBe(true)
    expect(isValidTimeLimit(20_000)).toBe(true)
    expect(isValidTimeLimit(60_000)).toBe(true)
    expect(isValidTimeLimit(999)).toBe(false)
    expect(isValidTimeLimit(60_001)).toBe(false)
    expect(isValidTimeLimit(-1)).toBe(false)
    expect(isValidTimeLimit(1.5)).toBe(false)
  })
})

describe('その回の控え（出題 → 結果）', () => {
  const setId = 'abr20260925-e-12-1234'

  it('setId ごとに sessionStorage へ控える', () => {
    expect(readQuizTimeLimit(setId)).toBeNull()

    writeQuizTimeLimit(setId, TIME_LIMIT_MS)
    expect(sessionStorage.getItem(quizTimeLimitKey(setId))).toBe('20000')
    expect(readQuizTimeLimit(setId)).toBe(TIME_LIMIT_MS)

    // 制限なしも 0 として控える（「控えが無い」と区別する）
    writeQuizTimeLimit(setId, NO_TIME_LIMIT)
    expect(readQuizTimeLimit(setId)).toBe(NO_TIME_LIMIT)
  })

  it('別の setId の控えは混ざらない。壊れた値は null', () => {
    writeQuizTimeLimit(setId, TIME_LIMIT_MS)
    expect(readQuizTimeLimit('abr20260925-e-12-5678')).toBeNull()

    sessionStorage.setItem(quizTimeLimitKey(setId), 'あ')
    expect(readQuizTimeLimit(setId)).toBeNull()
  })
})
