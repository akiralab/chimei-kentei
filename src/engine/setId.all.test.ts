import { describe, expect, it } from 'vitest'
import { buildSetId, canBeAll, isScope, parseSetId } from './setId.ts'

describe('全市区町村名（-all）のセット ID', () => {
  it('市区町村名 × 都道府県のときだけ組み立てられ、末尾に -all が付く', () => {
    const id = buildSetId('abr20260925r2', 'e', '12', '0417', true)
    expect(id).toBe('abr20260925r2-e-12-0417-all')
    expect(parseSetId(id)).toEqual({ dataVersion: 'abr20260925r2', mode: 'e', scope: '12', seed: '0417', all: true })
  })

  it('all を立てなければ従来どおり 4 つ組で、all: false として分解される', () => {
    expect(buildSetId('abr20260925r2', 'e', '12', '0417')).toBe('abr20260925r2-e-12-0417')
    expect(parseSetId('abr20260925r2-e-12-0417')?.all).toBe(false)
  })

  it('町名（d）・全国・市区町村 scope では all にできない', () => {
    expect(canBeAll('e', '12')).toBe(true)
    expect(canBeAll('d', '12')).toBe(false)
    expect(canBeAll('e', '00')).toBe(false)
    expect(canBeAll('e', '122165')).toBe(false)
    expect(() => buildSetId('abr20260925r2', 'd', '12', '0417', true)).toThrow()
    expect(() => buildSetId('abr20260925r2', 'e', '00', '0417', true)).toThrow()
    expect(parseSetId('abr20260925r2-d-12-0417-all')).toBeNull()
    expect(parseSetId('abr20260925r2-e-00-0417-all')).toBeNull()
    expect(parseSetId('abr20260925r2-e-122165-0417-all')).toBeNull()
  })

  it('5 つ目が all 以外なら読めない', () => {
    expect(parseSetId('abr20260925r2-e-12-0417-x')).toBeNull()
    expect(parseSetId('abr20260925r2-e-12-0417-all-all')).toBeNull()
  })
})

describe('地域（3 文字）の scope', () => {
  it('3 文字 scope と -all を受け付ける', () => {
    expect(buildSetId('abr20260925r2', 'e', '01c', '0417')).toBe('abr20260925r2-e-01c-0417')
    expect(parseSetId('abr20260925r2-e-01c-0417')).toEqual({
      dataVersion: 'abr20260925r2',
      mode: 'e',
      scope: '01c',
      seed: '0417',
      all: false,
    })
    expect(buildSetId('abr20260925r2', 'e', '13i', '0417', true)).toBe('abr20260925r2-e-13i-0417-all')
    expect(parseSetId('abr20260925r2-e-13i-0417-all')?.all).toBe(true)
    // 町名（d）でも地域は選べる（all だけが市区町村名専用）
    expect(parseSetId('abr20260925r2-d-13i-0417')?.scope).toBe('13i')
    expect(canBeAll('e', '01c')).toBe(true)
    expect(canBeAll('d', '01c')).toBe(false)
  })

  it('実在しない地域・桁数違いは拒む', () => {
    expect(isScope('01c')).toBe(true)
    expect(isScope('01z')).toBe(false)
    expect(isScope('1c')).toBe(false)
    expect(isScope('013')).toBe(false)
    expect(() => buildSetId('abr20260925r2', 'e', '01z', '0417')).toThrow(/scope/)
    expect(() => buildSetId('abr20260925r2', 'e', '1c', '0417')).toThrow(/scope/)
    expect(parseSetId('abr20260925r2-e-01z-0417')).toBeNull()
    expect(parseSetId('abr20260925r2-e-1c-0417')).toBeNull()
    expect(parseSetId('abr20260925r2-e-013-0417')).toBeNull()
    expect(parseSetId('abr20260925r2-e-01z-0417-all')).toBeNull()
    expect(canBeAll('e', '01z')).toBe(false)
  })
})
