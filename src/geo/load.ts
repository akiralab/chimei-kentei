/**
 * 地図データ（public/geo/）の読み込み。
 *
 * - `geo/japan.json` … 都道府県ポリゴン（properties: prefCode, name）
 * - `geo/pref/{prefCode}.json` … その県の市区町村ポリゴン（properties: lgCode, prefCode, name）
 * - `geo/municipalities.json` … Record<lgCode, MunicipalityStats>
 *
 * 地図は「あると嬉しい」添え物なので、**失敗しても例外を投げず null を返す**。
 * 画面側は null のときだけ 1 行の注記を出し、出題そのものは動き続ける
 * （問題バンク = src/engine/bank.ts は逆に throw する。性質が違うので揃えない）。
 *
 * fetch 層は bank.ts の BankSource と同じ「Promise のメモリキャッシュ」方式。
 * 成功した Promise は使い回し、失敗したものはキャッシュから外して再試行できるようにする。
 */
import type { FeatureCollection, Geometry } from 'geojson'
import type { MunicipalityFeatureProps, MunicipalityStats, PrefectureFeatureProps } from '../engine/types.ts'

export type PrefectureCollection = FeatureCollection<Geometry, PrefectureFeatureProps>
export type MunicipalityCollection = FeatureCollection<Geometry, MunicipalityFeatureProps>
export type MunicipalityStatsMap = Record<string, MunicipalityStats>

export interface GeoSource {
  /** 47 都道府県のポリゴン。読めなければ null */
  japan(): Promise<PrefectureCollection | null>
  /** ある都道府県の市区町村ポリゴン。読めなければ null */
  pref(prefCode: string): Promise<MunicipalityCollection | null>
  /** 市区町村の統計（lgCode 引き）。読めなければ null */
  stats(): Promise<MunicipalityStatsMap | null>
}

function geoBaseUrl(): string {
  const base = import.meta.env?.BASE_URL ?? '/'
  return `${base}geo/`
}

/** FeatureCollection の形だけ確かめる。壊れた JSON を描画に流さないための番人 */
function asCollection<P>(value: unknown): FeatureCollection<Geometry, P> | null {
  if (typeof value !== 'object' || value === null) return null
  const fc = value as { type?: unknown; features?: unknown }
  if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return null
  return value as FeatureCollection<Geometry, P>
}

function asStatsMap(value: unknown): MunicipalityStatsMap | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as MunicipalityStatsMap
}

/** fetch ＋ メモリキャッシュの GeoSource */
export function createFetchGeoSource(baseUrl: string = geoBaseUrl()): GeoSource {
  const cache = new Map<string, Promise<unknown | null>>()

  function getJson(path: string): Promise<unknown | null> {
    const hit = cache.get(path)
    if (hit) return hit
    const started = (async () => {
      const res = await fetch(baseUrl + path)
      if (!res.ok) throw new Error(`geo を読み込めませんでした（${res.status}）: ${path}`)
      return (await res.json()) as unknown
    })().catch(() => {
      // 次に表示されたときもう一度試せるように、失敗はキャッシュに残さない
      cache.delete(path)
      return null
    })
    cache.set(path, started)
    return started
  }

  return {
    async japan() {
      return asCollection<PrefectureFeatureProps>(await getJson('japan.json'))
    },
    async pref(prefCode: string) {
      return asCollection<MunicipalityFeatureProps>(await getJson(`pref/${prefCode}.json`))
    },
    async stats() {
      return asStatsMap(await getJson('municipalities.json'))
    },
  }
}

let shared: GeoSource | undefined

/** アプリ既定の GeoSource（モジュール内でキャッシュを共有する） */
export function defaultGeoSource(): GeoSource {
  if (!shared) shared = createFetchGeoSource()
  return shared
}

/** テスト用。既定ソースのキャッシュを捨てる */
export function resetGeoSource(): void {
  shared = undefined
}
