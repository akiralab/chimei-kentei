/**
 * 投影（d3-geo）の薄い層。viewBox が「投影後の bbox ＋ 余白」になっていることを確かめる。
 */
import { describe, expect, it } from 'vitest'
import { projectCollection, VIEWBOX_PADDING } from './project.ts'
import { JAPAN_FIXTURE, PREF_GEO_FIXTURE } from './__fixtures__/geo.ts'

describe('projectCollection', () => {
  it('feature の数だけ d を返し、viewBox は数値 4 つ', () => {
    const projected = projectCollection(JAPAN_FIXTURE)
    expect(projected).not.toBeNull()
    expect(projected?.paths).toHaveLength(2)
    for (const p of projected?.paths ?? []) {
      expect(p.d.startsWith('M')).toBe(true)
      expect(Number.isFinite(p.centroid[0])).toBe(true)
    }
    const parts = (projected?.viewBox ?? '').split(' ').map(Number)
    expect(parts).toHaveLength(4)
    expect(parts.every((n) => Number.isFinite(n))).toBe(true)
    expect(parts[2]).toBeGreaterThan(0)
    expect(parts[3]).toBeGreaterThan(0)
  })

  it('余白のぶん viewBox の原点が負側にずれる（輪郭線が枠で切れない）', () => {
    const projected = projectCollection(PREF_GEO_FIXTURE['12'])
    const [x, y, w, h] = (projected?.viewBox ?? '').split(' ').map(Number)
    // fitExtent の片側は必ず 0 に接するので、原点は -pad になる
    expect(Math.min(x, y)).toBe(-VIEWBOX_PADDING)
    expect(Math.max(w, h)).toBeCloseTo(1000 + VIEWBOX_PADDING * 2, 3)
  })

  it('feature が無ければ null', () => {
    expect(projectCollection({ type: 'FeatureCollection', features: [] })).toBeNull()
  })
})
