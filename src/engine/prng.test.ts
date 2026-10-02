import { describe, expect, it } from 'vitest'
import { hashString, mulberry32 } from './prng.ts'

describe('hashString', () => {
  it('FNV-1a 32bit の既知値', () => {
    expect(hashString('')).toBe(0x811c9dc5)
    expect(hashString('a')).toBe(0xe40c292c)
    expect(hashString('foobar')).toBe(0xbf9cf968)
  })

  it('同じ文字列は同じ値、違う文字列はほぼ別の値', () => {
    expect(hashString('abr20260925-e-12-1234')).toBe(hashString('abr20260925-e-12-1234'))
    expect(hashString('abr20260925-e-12-1234')).not.toBe(hashString('abr20260925-e-12-1235'))
  })
})

describe('mulberry32', () => {
  it('同じ種なら同じ列、[0,1) に収まる', () => {
    const a = mulberry32(12345)
    const b = mulberry32(12345)
    const xs = Array.from({ length: 50 }, () => a())
    const ys = Array.from({ length: 50 }, () => b())
    expect(xs).toEqual(ys)
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })

  it('違う種なら違う列', () => {
    const a = Array.from({ length: 10 }, mulberry32(1))
    const b = Array.from({ length: 10 }, mulberry32(2))
    expect(a).not.toEqual(b)
  })
})
