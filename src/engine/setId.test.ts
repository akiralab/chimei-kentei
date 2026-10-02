import { describe, expect, it } from 'vitest'
import { buildSetId, parseSetId, randomSeed, todaySeed } from './setId.ts'

describe('buildSetId / parseSetId', () => {
  it('組み立てと分解が往復する', () => {
    const id = buildSetId('abr20260925', 'e', '12', '1234')
    expect(id).toBe('abr20260925-e-12-1234')
    expect(parseSetId(id)).toEqual({ dataVersion: 'abr20260925', mode: 'e', scope: '12', seed: '1234' })
  })

  it('全国 scope と 6 桁 scope、8 桁 seed も通る', () => {
    expect(parseSetId('abr20260925-d-122165-20261002')).toEqual({
      dataVersion: 'abr20260925',
      mode: 'd',
      scope: '122165',
      seed: '20261002',
    })
    expect(parseSetId('abr20260925-e-00-0007')?.scope).toBe('00')
  })

  it('不正な setId は null', () => {
    expect(parseSetId('')).toBeNull()
    expect(parseSetId('abr20260925-e-12')).toBeNull()
    expect(parseSetId('abr20260925-x-12-1234')).toBeNull()
    expect(parseSetId('abr20260925-e-1-1234')).toBeNull()
    expect(parseSetId('abr20260925-e-1234-1234')).toBeNull()
    expect(parseSetId('abr20260925-e-12-123')).toBeNull()
    expect(parseSetId('abr20260925-e-12-123456789')).toBeNull()
    expect(parseSetId('abr20260925-e-12-12a4')).toBeNull()
    expect(parseSetId('ABR-e-12-1234')).toBeNull()
  })

  it('buildSetId は不正な引数で throw する', () => {
    expect(() => buildSetId('abr20260925', 'e', '1', '1234')).toThrow()
    expect(() => buildSetId('abr20260925', 'e', '12', '12')).toThrow()
  })
})

describe('todaySeed / randomSeed', () => {
  it('todaySeed は JST の暦日の YYYYMMDD', () => {
    expect(todaySeed(new Date('2026-10-01T23:30:00Z'))).toBe('20261002')
    expect(todaySeed(new Date('2025-12-31T15:00:00Z'))).toBe('20260101')
  })

  it('todaySeed は端末のタイムゾーンによらず JST の 0 時で切り替わる', () => {
    // UTC 15:00 以降は JST では翌日
    expect(todaySeed(new Date('2026-10-02T15:30:00Z'))).toBe('20261003')
    expect(todaySeed(new Date('2026-10-02T14:59:00Z'))).toBe('20261002')
  })

  it('randomSeed は 4 桁の数字文字列（先頭 0 もあり）', () => {
    for (let i = 0; i < 200; i++) {
      const s = randomSeed()
      expect(s).toMatch(/^\d{4}$/)
      expect(parseSetId(`abr20260925-e-00-${s}`)).not.toBeNull()
    }
  })
})
