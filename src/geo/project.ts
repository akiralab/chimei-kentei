/**
 * GeoJSON → SVG パス。d3-geo の geoMercator / geoPath だけを使う。
 *
 * 考え方:
 *   1. リングの巻き方向を d3-geo の約束に正す（rewindCollection。下の「巻き直し」参照）
 *   2. `geoMercator().fitExtent([[0,0],[BOX,BOX]], fc)` で正方形の作業座標に収める
 *      （fitSize の padding 付き版。fitSize だと輪郭線が枠で切れる）
 *   3. 投影後の実際の bbox を測り、その bbox ＋ 余白を viewBox にする
 *   4. SVG 側は `preserveAspectRatio="xMidYMid meet"` ＋ CSS で伸縮
 *
 * 3 の「bbox を viewBox にする」が効くのは、都道府県の形（細長い新潟・横長の愛知）が
 * まちまちでも、パネルの中で常に最大まで使われるため。ResizeObserver は不要になる。
 * 線の太さは viewBox 単位に依存しないよう CSS 側で `vector-effect: non-scaling-stroke`。
 *
 * ── 巻き直し（rewindCollection）がなぜ必須か ────────────────────────────
 * d3-geo は平面ではなく **球面** 幾何でポリゴンを解釈する。そして d3-geo の巻き方向の
 * 約束は GeoJSON (RFC 7946) と **逆** で、外周リングは **時計回り (CW)**。
 * CCW の外周は「そのポリゴンの外側＝地球のほぼ全部」と解釈される。すると
 *   - `fitExtent` が地球全体を 1000 の箱に収める → 自治体 1 つが 1 単位未満に潰れる
 *   - `geoPath.bounds(fc)` が箱いっぱい（[[0,0],[1000,1000]]）を返す
 * となり、「viewBox は 1012 四方なのに path は 0.04 単位の点の集まり」＝
 * 枠だけ描かれて地図が見えない、という症状になる（本番で実際に起きた）。
 *
 * `public/geo/**` は大半が CW で正しいが、**一部の feature だけ CCW が混じる**
 * （実測: 大阪府 43 自治体のうち 7・東京都 62 のうち 4・北海道 179 のうち 1。
 *  japan.json は 125 リングすべて CW で、こちらは元から描けていた）。
 * 1 つ混じるだけで fit が全球に引っ張られ、**その県の地図が丸ごと潰れる**。
 * フィクスチャの矩形はすべて同じ向きだったのでテストを通り抜けていた。
 * 投影の前に必ずここを通す。
 */
import { geoMercator, geoPath } from 'd3-geo'
import type { ExtendedFeature, ExtendedFeatureCollection } from 'd3-geo'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'

/** fitExtent の作業座標の一辺。viewBox はこの後 bbox で切り直すので見た目には出ない */
export const PROJECTION_BOX = 1000
/** viewBox に足す余白（作業座標の単位）。輪郭線の太さぶん */
export const VIEWBOX_PADDING = 6

export interface ProjectedPath<P> {
  /** SVG の d 属性 */
  d: string
  /** ラベル・ピンを置く重心（投影後の座標） */
  centroid: [number, number]
  /** 投影後の外接矩形 [[x0,y0],[x1,y1]]。小さすぎる対象の検出に使う */
  bounds: [[number, number], [number, number]]
  props: P
}

export interface ProjectedCollection<P> {
  viewBox: string
  /** viewBox の幅・高さ。文字サイズなど viewBox 単位の寸法を決めるのに使う */
  width: number
  height: number
  /** viewBox の原点（左上）。画面座標へ直すときに使う */
  x: number
  y: number
  paths: ProjectedPath<P>[]
  /** 任意の [経度, 緯度] を同じ投影の viewBox 座標へ。投影できなければ null（ラベル位置の算出用） */
  project: (lonLat: [number, number]) => [number, number] | null
}

// --------------------------------------------------------------- 巻き直し

/** 符号付き面積（シューレース）。閉じていないリングでも最後→最初の辺を補って数える */
function signedArea(ring: Position[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return sum / 2
}

/** ccw=true なら反時計回りに揃える。既にその向きなら元の配列をそのまま返す（無駄なコピーをしない） */
function orient(ring: Position[], ccw: boolean): Position[] {
  if (ring.length < 4) return ring
  const isCcw = signedArea(ring) > 0
  return isCcw === ccw ? ring : ring.slice().reverse()
}

/** d3-geo の約束に合わせる: 外周は CW、穴は CCW（RFC 7946 とは逆） */
function rewindPolygon(rings: Position[][]): Position[][] {
  return rings.map((ring, i) => orient(ring, i !== 0))
}

function rewindGeometry(geometry: Geometry): Geometry {
  switch (geometry.type) {
    case 'Polygon':
      return { ...geometry, coordinates: rewindPolygon(geometry.coordinates) }
    case 'MultiPolygon':
      return { ...geometry, coordinates: geometry.coordinates.map(rewindPolygon) }
    case 'GeometryCollection':
      return { ...geometry, geometries: geometry.geometries.map(rewindGeometry) }
    default:
      return geometry
  }
}

/** リングの巻き方向を d3-geo の約束（外周 CW・穴 CCW）に正した新しい FeatureCollection */
export function rewindCollection<P>(collection: FeatureCollection<Geometry, P>): FeatureCollection<Geometry, P> {
  return {
    ...collection,
    features: collection.features.map((f) => ({ ...f, geometry: f.geometry ? rewindGeometry(f.geometry) : f.geometry })),
  }
}

// ------------------------------------------------------------------- 抽出

/** properties で feature を絞った FeatureCollection（沖縄のインセット分割などに使う） */
export function filterCollection<P>(
  collection: FeatureCollection<Geometry, P>,
  keep: (props: P) => boolean,
): FeatureCollection<Geometry, P> {
  return { ...collection, features: collection.features.filter((f) => keep(f.properties)) }
}

/** 経度緯度の全頂点を舐める（巻き方向に依存しない素朴な走査） */
function* positionsOf(geometry: Geometry): Generator<Position> {
  switch (geometry.type) {
    case 'Polygon':
      for (const ring of geometry.coordinates) yield* ring
      break
    case 'MultiPolygon':
      for (const poly of geometry.coordinates) for (const ring of poly) yield* ring
      break
    case 'GeometryCollection':
      for (const g of geometry.geometries) yield* positionsOf(g)
      break
    default:
      break
  }
}

/** feature の経度緯度 bbox の中心 */
function lonLatCenter(geometry: Geometry): [number, number] | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of positionsOf(geometry)) {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  if (!Number.isFinite(x0)) return null
  return [(x0 + x1) / 2, (y0 + y1) / 2]
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export interface ClusterOptions<P> {
  /** 距離に関係なく必ず残す feature（出題対象など） */
  mustKeep?: (props: P) => boolean
  /** 中央値距離の何倍までを「本体」とみなすか */
  factor?: number
  /** 小さい県で過剰に切らないための下限（度） */
  floorDeg?: number
  /** これを下回るほど削れたら諦めて全体を返す */
  minShare?: number
}

/**
 * 遠く離れた離島を fit の対象から外した FeatureCollection を返す。
 *
 * 東京都は小笠原（本土から約 1000km）まで含むため、県全体に fit すると
 * 23 区が地図の 1% 未満に潰れる。本体のまとまりに fit して、離島は
 * SVG のビューポートで切る（＝描画はするが枠外に出る）方が地図として読める。
 * 出題対象だけは `mustKeep` で必ず fit に含めるので、小笠原が出題されたときは
 * ちゃんとそこまで引いた地図になる。
 */
export function mainCluster<P>(
  collection: FeatureCollection<Geometry, P>,
  options: ClusterOptions<P> = {},
): FeatureCollection<Geometry, P> {
  const { mustKeep, factor = 4, floorDeg = 0.35, minShare = 0.5 } = options
  const features = collection.features
  if (features.length < 4) return collection

  const centers = features.map((f) => (f.geometry ? lonLatCenter(f.geometry) : null))
  const valid = centers.filter((c): c is [number, number] => c !== null)
  if (valid.length < 4) return collection

  const medLon = median(valid.map((c) => c[0]))
  const medLat = median(valid.map((c) => c[1]))
  const scaleLon = Math.cos((medLat * Math.PI) / 180)
  const distance = (c: [number, number]) => Math.hypot((c[0] - medLon) * scaleLon, c[1] - medLat)

  const limit = Math.max(median(valid.map(distance)) * factor, floorDeg)
  const kept = features.filter((f, i) => {
    if (mustKeep?.(f.properties)) return true
    const c = centers[i]
    return c === null || distance(c) <= limit
  })

  // 削りすぎ（データが散在しているだけ）なら手を出さない
  if (kept.length < features.length * minShare) return collection
  return { ...collection, features: kept }
}

/**
 * **各 feature の最大ポリゴンだけ** を残した FeatureCollection。fit の対象に使う。
 *
 * 東京都には小笠原・伊豆諸島が、鹿児島県には奄美が、長崎県には五島・対馬が
 * 同じ feature の MultiPolygon として入っている。これを fit に含めると
 * 地図が南や西へ引っ張られ、本体が隅の小さな染みになる（関東を開くと
 * 東京の島に引かれて 80px ほどに縮んでいた）。
 * 描画は全ポリゴンのまま、**fit だけ本体に寄せる** のがここの役目。
 */
export function mainPolygons<P>(collection: FeatureCollection<Geometry, P>): FeatureCollection<Geometry, P> {
  const features: Feature<Geometry, P>[] = []
  for (const feature of collection.features) {
    const g = feature.geometry
    if (g?.type !== 'MultiPolygon') {
      features.push(feature as Feature<Geometry, P>)
      continue
    }
    let best: Position[][] | null = null
    let bestArea = -Infinity
    for (const poly of g.coordinates) {
      const area = Math.abs(signedArea(poly[0]))
      if (area > bestArea) {
        bestArea = area
        best = poly
      }
    }
    features.push(
      best ?
        ({ ...feature, geometry: { type: 'Polygon', coordinates: best } } as Feature<Geometry, P>)
      : (feature as Feature<Geometry, P>),
    )
  }
  return { ...collection, features }
}

/** 面積が最大のポリゴン 1 枚だけの FeatureCollection（沖縄本島など「主島」に寄せる用） */
export function largestPolygon<P>(
  collection: FeatureCollection<Geometry, P>,
): FeatureCollection<Geometry, P> | null {
  let best: { area: number; feature: Feature<Geometry, P> } | null = null
  for (const feature of collection.features) {
    const g = feature.geometry
    const polys =
      g?.type === 'MultiPolygon' ? g.coordinates
      : g?.type === 'Polygon' ? [g.coordinates]
      : []
    for (const poly of polys) {
      const area = Math.abs(signedArea(poly[0]))
      if (!best || area > best.area) {
        best = {
          area,
          feature: { ...feature, geometry: { type: 'Polygon', coordinates: poly } } as Feature<Geometry, P>,
        }
      }
    }
  }
  return best ? { type: 'FeatureCollection', features: [best.feature] } : null
}

// ------------------------------------------------------------------- 投影

export interface ProjectOptions<P> {
  /** fit の対象。省略時は collection 自身。描画は常に collection 全体（枠外は SVG が切る） */
  fitTo?: FeatureCollection<Geometry, P>
  box?: number
  pad?: number
}

/**
 * FeatureCollection を投影して SVG パスの配列にする。
 * 描けるジオメトリが無い（空・壊れている）ときは null。
 */
export function projectCollection<P>(
  collection: FeatureCollection<Geometry, P>,
  options: ProjectOptions<P> = {},
): ProjectedCollection<P> | null {
  const { fitTo, box = PROJECTION_BOX, pad = VIEWBOX_PADDING } = options
  if (collection.features.length === 0) return null

  // 球面幾何で裏返って解釈されないよう、必ず巻き直してから投影する
  const wound = rewindCollection(collection)
  const woundFit = fitTo && fitTo !== collection ? rewindCollection(fitTo) : wound
  if (woundFit.features.length === 0) return null

  // d3-geo の型（ExtendedFeature*）は geojson の型と形が同じだが名前が違うので橋渡しする
  const fitTarget = woundFit as unknown as ExtendedFeatureCollection
  const projection = geoMercator().fitExtent(
    [
      [0, 0],
      [box, box],
    ],
    fitTarget,
  )
  const render = geoPath(projection)

  const [[x0, y0], [x1, y1]] = render.bounds(fitTarget)
  if (![x0, y0, x1, y1].every((n) => Number.isFinite(n)) || x1 <= x0 || y1 <= y0) return null

  const width = x1 - x0 + pad * 2
  const height = y1 - y0 + pad * 2

  const paths: ProjectedPath<P>[] = []
  for (const feature of wound.features) {
    const target = feature as unknown as ExtendedFeature
    const d = render(target)
    if (!d) continue
    paths.push({
      d,
      centroid: render.centroid(target),
      bounds: render.bounds(target),
      props: (feature as Feature<Geometry, P>).properties,
    })
  }
  if (paths.length === 0) return null

  const project = (lonLat: [number, number]): [number, number] | null => {
    const point = projection(lonLat)
    return point && Number.isFinite(point[0]) && Number.isFinite(point[1]) ? [point[0], point[1]] : null
  }

  return { viewBox: `${x0 - pad} ${y0 - pad} ${width} ${height}`, width, height, x: x0 - pad, y: y0 - pad, paths, project }
}
