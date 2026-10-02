import { describe, expect, it } from 'vitest'
import { buildSetId, canBeAll, parseSetId } from './setId.ts'

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
