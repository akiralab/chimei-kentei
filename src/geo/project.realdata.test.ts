/**
 * 実データ（public/geo/**）での投影テスト。
 *
 * 本番で「viewBox は 1012 四方なのに path が 0.04 単位の点の集まり」＝枠だけ描かれる
 * という事故が起きた。原因は `public/geo/pref/*.json` に **巻き方向が逆（CCW）の feature が
 * 数本だけ混じっていた** こと。d3-geo は球面幾何で外周リングを **CW** と約束するので、
 * CCW の外周は「地球のほぼ全部」と解釈され、1 本混じるだけで fitExtent が全球に引っ張られ、
 * その県の地図が丸ごと潰れる。
 *
 * フィクスチャの矩形は全部同じ向きなのでこの事故を再現できない。だから **実データを読む**。
 * 検証は「投影後の座標の bbox が viewBox の短辺の 80% 以上を占める」こと。
 * fit が効いていなければこの比は 1% 未満になる。
 *
 * 読み込みは `import.meta.glob`（Vite 標準）。node:fs を使うと tsconfig.app の
 * `types: ["vite/client"]` に @types/node が入っていないので tsc が通らない。
 * データがまだ無い環境では glob が空になり、テストは skip される。
 */
import type { FeatureCollection, Geometry, Position } from 'geojson'
import { describe, expect, it } from 'vitest'
import { geoMercator, geoPath } from 'd3-geo'
import type { MunicipalityFeatureProps, PrefectureFeatureProps } from '../engine/types.ts'
import { projectCollection, rewindCollection } from './project.ts'

type PrefFc = FeatureCollection<Geometry, PrefectureFeatureProps>
type MuniFc = FeatureCollection<Geometry, MunicipalityFeatureProps>

const JAPAN_FILES = import.meta.glob<PrefFc>('../../public/geo/japan.json', { eager: true, import: 'default' })
const PREF_FILES = import.meta.glob<MuniFc>('../../public/geo/pref/*.json', { eager: true, import: 'default' })

const japan: PrefFc | undefined = Object.values(JAPAN_FILES)[0]
const prefEntries = Object.entries(PREF_FILES)
const osaka: MuniFc | undefined = prefEntries.find(([p]) => p.endsWith('/27.json'))?.[1]

/** 符号付き面積（シューレース）。巻き方向の確認用 */
function signedArea(ring: Position[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return sum / 2
}

function exteriorRings(fc: FeatureCollection<Geometry, unknown>): Position[][] {
  const out: Position[][] = []
  for (const f of fc.features) {
    const g = f.geometry
    if (g.type === 'Polygon') out.push(g.coordinates[0])
    else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) out.push(poly[0])
  }
  return out
}

/** 生成された d 属性に現れる座標の外接矩形 */
function pathBbox(ds: string[]): [number, number, number, number] {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const d of ds) {
    for (const m of d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)) {
      const x = Number(m[1])
      const y = Number(m[2])
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return [x0, y0, x1, y1]
}

/** 投影後の中身が viewBox をどれだけ埋めているか（短辺基準の比） */
function fillRatio(collection: FeatureCollection<Geometry, unknown>): number {
  const projected = projectCollection(collection)
  expect(projected).not.toBeNull()
  const [vx, vy, vw, vh] = projected!.viewBox.split(' ').map(Number)
  const [x0, y0, x1, y1] = pathBbox(projected!.paths.map((p) => p.d))

  // 中身は viewBox の内側に収まっているはず
  expect(x0).toBeGreaterThanOrEqual(vx)
  expect(y0).toBeGreaterThanOrEqual(vy)
  expect(x1).toBeLessThanOrEqual(vx + vw)
  expect(y1).toBeLessThanOrEqual(vy + vh)

  return Math.max(x1 - x0, y1 - y0) / Math.min(vw, vh)
}

describe('実データの投影（fit が効いているか）', () => {
  it.skipIf(!japan)('japan.json は viewBox の短辺の 80% 以上を埋める', () => {
    expect(fillRatio(japan!)).toBeGreaterThan(0.8)
  })

  it.skipIf(!osaka)('大阪府（27）の市区町村が viewBox の短辺の 80% 以上を埋める', () => {
    expect(osaka!.features.length).toBeGreaterThan(10)
    expect(fillRatio(osaka!)).toBeGreaterThan(0.8)
  })

  it.skipIf(prefEntries.length === 0)('すべての都道府県ファイルで fit が効く', () => {
    const bad: string[] = []
    for (const [path, fc] of prefEntries) {
      if (fc.features.length === 0) continue
      if (fillRatio(fc) <= 0.8) bad.push(path)
    }
    expect(bad).toEqual([])
  })

  it.skipIf(prefEntries.length === 0)('どの県でも一番小さい自治体が 1 単位より大きく描かれる', () => {
    // 事故の状態（全球 fit）だと最小自治体は 0.1 単位未満になる
    const bad: string[] = []
    for (const [path, fc] of prefEntries) {
      const projected = projectCollection(fc)
      if (!projected) continue
      const spans = projected.paths.map((p) => {
        const [[x0, y0], [x1, y1]] = p.bounds
        return Math.max(x1 - x0, y1 - y0)
      })
      if (Math.min(...spans) <= 1) bad.push(`${path} (min=${Math.min(...spans).toFixed(2)})`)
    }
    expect(bad).toEqual([])
  })

  it.skipIf(!osaka)('巻き直さずに投影すると潰れる（事故の再現と、直っていることの裏取り）', () => {
    // 生データをそのまま d3-geo に渡すと、混じっている CCW の外周が「地球のほぼ全部」と
    // 解釈され fitExtent が全球に合う → 自治体が 1 単位未満に潰れる
    const projection = geoMercator().fitExtent(
      [
        [0, 0],
        [1000, 1000],
      ],
      osaka as never,
    )
    const render = geoPath(projection)
    const rawSpans = osaka!.features.map((f) => {
      const [[x0, y0], [x1, y1]] = render.bounds(f as never)
      return Math.max(x1 - x0, y1 - y0)
    })
    expect(Math.min(...rawSpans)).toBeLessThan(1)

    // 巻き直し（= projectCollection の既定経路）なら全自治体がまともな大きさになる
    const fixed = projectCollection(rewindCollection(osaka!))!
    const fixedSpans = fixed.paths.map((p) => {
      const [[x0, y0], [x1, y1]] = p.bounds
      return Math.max(x1 - x0, y1 - y0)
    })
    expect(Math.min(...fixedSpans)).toBeGreaterThan(5)
  })

  it.skipIf(!osaka)('巻き方向が逆の feature が実際に混じっている（巻き直しが必要な理由の明示）', () => {
    const rings = exteriorRings(osaka!)
    const ccw = rings.filter((r) => signedArea(r) > 0).length
    const cw = rings.length - ccw
    // 大半は CW（d3-geo の正しい向き）だが CCW が混じる、という前提を固定する。
    // ここが 0 になったらデータ側が直ったということ（巻き直しは無害なので残してよい）
    expect(cw).toBeGreaterThan(0)
    expect(ccw).toBeGreaterThan(0)
  })
})

describe('rewindCollection', () => {
  /** 外周が反時計回り（d3-geo の約束と逆）の正方形。d3-geo はこれを「外側全部」と解釈する */
  const ccwSquare: FeatureCollection<Geometry, null> = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: null,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [135, 34],
              [136, 34],
              [136, 35],
              [135, 35],
              [135, 34],
            ],
          ],
        },
      },
    ],
  }

  it('CCW の外周でも投影が潰れない（巻き直しが projectCollection に入っている）', () => {
    expect(fillRatio(ccwSquare)).toBeGreaterThan(0.8)
  })

  it('巻き直しは外周を CW、穴を CCW にする（d3-geo の約束）', () => {
    const withHole: FeatureCollection<Geometry, null> = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: null,
          geometry: {
            type: 'Polygon',
            coordinates: [
              // 外周 CCW / 穴 CW（どちらも d3-geo の約束と逆）
              [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
                [0, 0],
              ],
              [
                [2, 2],
                [2, 8],
                [8, 8],
                [8, 2],
                [2, 2],
              ],
            ],
          },
        },
      ],
    }
    const out = rewindCollection(withHole)
    const rings = (out.features[0].geometry as { coordinates: Position[][] }).coordinates
    expect(signedArea(rings[0])).toBeLessThan(0) // 外周 CW
    expect(signedArea(rings[1])).toBeGreaterThan(0) // 穴 CCW
  })
})
