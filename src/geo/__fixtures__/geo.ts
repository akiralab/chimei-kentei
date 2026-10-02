/**
 * テスト・開発用の小さな地図データ。public/geo/ には置かない。
 * 本番データ（地図データ担当が生成する public/geo/）がまだ無い間、
 * コンポーネントの単体テストと見た目の確認はここを使う。
 *
 * 形は緯度経度の矩形。2 県 × 各 3 市区町村。投影（Mercator）が通れば十分なので
 * 実際の県境とは関係ない。
 */
import type { MunicipalityStats } from '../../engine/types.ts'
import type { GeoSource, MunicipalityCollection, MunicipalityStatsMap, PrefectureCollection } from '../load.ts'

/** [西, 南, 東, 北] の矩形リング */
function rect(west: number, south: number, east: number, north: number): number[][][] {
  return [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ]
}

export const PREF_FIXTURE: { code: string; name: string; box: [number, number, number, number] }[] = [
  { code: '12', name: '千葉県', box: [139.8, 34.9, 140.9, 36.1] },
  { code: '13', name: '東京都', box: [138.9, 35.5, 139.9, 35.9] },
]

export const JAPAN_FIXTURE: PrefectureCollection = {
  type: 'FeatureCollection',
  features: PREF_FIXTURE.map((p) => ({
    type: 'Feature',
    properties: { prefCode: p.code, name: p.name },
    geometry: { type: 'Polygon', coordinates: rect(...p.box) },
  })),
}

/** 県の矩形を縦 3 等分して市区町村にする */
function municipalitiesOf(prefCode: string): MunicipalityCollection {
  const pref = PREF_FIXTURE.find((p) => p.code === prefCode)
  if (!pref) return { type: 'FeatureCollection', features: [] }
  const [west, south, east, north] = pref.box
  const step = (north - south) / 3
  return {
    type: 'FeatureCollection',
    features: [0, 1, 2].map((i) => ({
      type: 'Feature',
      properties: {
        lgCode: `${prefCode}000${i + 1}`,
        prefCode,
        name: `${pref.name.slice(0, 1)}市${i + 1}`,
      },
      geometry: { type: 'Polygon', coordinates: rect(west, south + step * i, east, south + step * (i + 1)) },
    })),
  }
}

export const PREF_GEO_FIXTURE: Record<string, MunicipalityCollection> = {
  '12': municipalitiesOf('12'),
  '13': municipalitiesOf('13'),
}

function statsOf(prefCode: string, seq: number, population: number, households: number, areaKm2: number): MunicipalityStats {
  const pref = PREF_FIXTURE.find((p) => p.code === prefCode)
  return {
    lgCode: `${prefCode}000${seq}`,
    prefCode,
    name: `${(pref?.name ?? '').slice(0, 1)}市${seq}`,
    population,
    households,
    areaKm2,
    densityPerKm2: Math.round(population / areaKm2),
    centroid: [140, 35.5],
    source: 'census2020',
  }
}

export const STATS_FIXTURE: MunicipalityStatsMap = Object.fromEntries(
  [
    statsOf('12', 1, 1_234_567, 567_890, 1234.56),
    statsOf('12', 2, 38_601, 15_420, 101.52),
    statsOf('12', 3, 902, 410, 8.09),
    statsOf('13', 1, 9_733_276, 4_880_123, 627.57),
    statsOf('13', 2, 120_500, 55_300, 24.75),
    statsOf('13', 3, 4_811, 2_033, 76.2),
  ].map((s) => [s.lgCode, s]),
)

/** 全部読める GeoSource */
export function fixtureGeoSource(): GeoSource {
  return {
    async japan() {
      return JAPAN_FIXTURE
    },
    async pref(prefCode: string) {
      return PREF_GEO_FIXTURE[prefCode] ?? null
    },
    async stats() {
      return STATS_FIXTURE
    },
  }
}

/** 何も読めない GeoSource（地図なしで動き続ける経路の確認用） */
export function emptyGeoSource(): GeoSource {
  return {
    async japan() {
      return null
    },
    async pref() {
      return null
    },
    async stats() {
      return null
    },
  }
}
