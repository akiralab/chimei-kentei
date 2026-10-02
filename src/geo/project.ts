/**
 * GeoJSON → SVG パス。d3-geo の geoMercator / geoPath だけを使う。
 *
 * 考え方:
 *   1. `geoMercator().fitExtent([[0,0],[BOX,BOX]], fc)` で正方形の作業座標に収める
 *      （fitSize の padding 付き版。fitSize だと輪郭線が枠で切れる）
 *   2. 投影後の実際の bbox を測り、その bbox ＋ 余白を viewBox にする
 *   3. SVG 側は `preserveAspectRatio="xMidYMid meet"` ＋ CSS で伸縮
 *
 * 2 の「bbox を viewBox にする」が効くのは、都道府県の形（細長い新潟・横長の愛知）が
 * まちまちでも、パネルの中で常に最大まで使われるため。ResizeObserver は不要になる。
 * 線の太さは viewBox 単位に依存しないよう CSS 側で `vector-effect: non-scaling-stroke`。
 */
import { geoMercator, geoPath } from 'd3-geo'
import type { ExtendedFeature, ExtendedFeatureCollection } from 'd3-geo'
import type { Feature, FeatureCollection, Geometry } from 'geojson'

/** fitExtent の作業座標の一辺。viewBox はこの後 bbox で切り直すので見た目には出ない */
export const PROJECTION_BOX = 1000
/** viewBox に足す余白（作業座標の単位）。輪郭線の太さぶん */
export const VIEWBOX_PADDING = 6

export interface ProjectedPath<P> {
  /** SVG の d 属性 */
  d: string
  /** ラベルを置く重心（投影後の座標） */
  centroid: [number, number]
  props: P
}

export interface ProjectedCollection<P> {
  viewBox: string
  /** viewBox の幅。文字サイズなど viewBox 単位の寸法を決めるのに使う */
  width: number
  height: number
  paths: ProjectedPath<P>[]
}

/**
 * FeatureCollection を投影して SVG パスの配列にする。
 * 描けるジオメトリが無い（空・壊れている）ときは null。
 */
export function projectCollection<P>(
  collection: FeatureCollection<Geometry, P>,
  box: number = PROJECTION_BOX,
  pad: number = VIEWBOX_PADDING,
): ProjectedCollection<P> | null {
  if (collection.features.length === 0) return null

  // d3-geo の型（ExtendedFeature*）は geojson の型と形が同じだが名前が違うので橋渡しする
  const fitTarget = collection as unknown as ExtendedFeatureCollection
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
  for (const feature of collection.features) {
    const target = feature as unknown as ExtendedFeature
    const d = render(target)
    if (!d) continue
    paths.push({ d, centroid: render.centroid(target), props: (feature as Feature<Geometry, P>).properties })
  }
  if (paths.length === 0) return null

  return { viewBox: `${x0 - pad} ${y0 - pad} ${width} ${height}`, width, height, paths }
}
