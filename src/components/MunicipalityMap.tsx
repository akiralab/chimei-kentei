/**
 * 「その市区町村が都道府県内のどこにあるか」を示す地図（出題画面の左パネル）。
 *
 * 県内の市区町村を薄い線で描き、出題中の自治体（lgCode）だけを塗って強調する。
 * difficult（大字・町名）でも Question.lgCode は所属市区町村なので、同じ扱いで正しく光る。
 *
 * 離島が遠い県（東京都＝小笠原まで約 1000km）は本体のまとまりに fit する（mainCluster）。
 * 県全体に fit すると 23 区が地図の 1% 未満に潰れるため。枠外の離島は SVG が切る。
 *
 * 小さい自治体（忠岡町のように県の 1% 未満）でも位置が分かるように:
 *   - 対象は **最後に描く**（隣接自治体の輪郭線に塗りを削られない）
 *   - 対象の下に太い縁取り（.map-muni__halo）を敷く
 *   - 投影後の大きさが地図の短辺の 12% 未満なら、重心に照準リング（.map-muni__pin）を足す
 *
 * 全国 easy では問題ごとに県が変わるため、読み込みはこのコンポーネントが持つ
 * （prefCode をキーに GeoSource のキャッシュが効く）。読めなければ 1 行の注記にとどめ、
 * パネル自体は残す（出題は地図なしでも成立する）。
 */
import { useEffect, useMemo, useState } from 'react'
import type { GeoSource, MunicipalityCollection } from '../geo/load.ts'
import { defaultGeoSource } from '../geo/load.ts'
import { mainCluster, projectCollection } from '../geo/project.ts'

interface Props {
  prefCode: string
  /**
   * 強調する市区町村の 6 桁コード。省くと県の形だけを描く（塗り・縁取り・照準リングを出さない）。
   * 地名帳（#/atlas/{scope}）で行を選ぶ前の状態に使う
   */
  lgCode?: string
  /** 見出しに出す県名 */
  prefName?: string
  source?: GeoSource
}

/** 照準リングを出す閾値（対象の長辺 ÷ 地図の短辺）と、そのリングの半径比 */
const PIN_THRESHOLD = 0.12
const PIN_RADIUS_RATIO = 0.055

/** どの県の結果かを state に持たせる。prefCode が変わった直後の「前の県の地図」を描かないため */
interface Loaded {
  prefCode: string
  collection: MunicipalityCollection | null
}

export default function MunicipalityMap({ prefCode, lgCode, prefName, source = defaultGeoSource() }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    let alive = true
    source
      .pref(prefCode)
      .then((fc) => {
        if (alive) setLoaded({ prefCode, collection: fc })
      })
      .catch(() => {
        if (alive) setLoaded({ prefCode, collection: null })
      })
    return () => {
      alive = false
    }
  }, [prefCode, source])

  // 読み込み中かどうかは state のリセットではなく「今の prefCode と一致するか」で判定する
  const current = loaded?.prefCode === prefCode ? loaded : null
  const loading = current === null
  const collection = current?.collection ?? null
  // 遠い離島（東京都の小笠原など）を fit から外し、本体が読める縮尺にする。
  // 出題対象だけは必ず fit に含めるので、小笠原が出題されたときはそこまで引いた地図になる
  const projected = useMemo(() => {
    if (!collection) return null
    // 対象が無い（地名帳で行を選ぶ前）ときは守る自治体も無いので mustKeep を渡さない
    const fitTo = mainCluster(collection, lgCode === undefined ? {} : { mustKeep: (props) => props.lgCode === lgCode })
    return projectCollection(collection, { fitTo })
  }, [collection, lgCode])

  const target = lgCode === undefined ? undefined : projected?.paths.find((p) => p.props.lgCode === lgCode)
  const others = projected?.paths.filter((p) => p.props.lgCode !== lgCode) ?? []

  // 対象が小さいときだけ照準リングを足す（大阪市のような大きい自治体には出さない）
  let pinRadius = 0
  if (projected && target) {
    const [[tx0, ty0], [tx1, ty1]] = target.bounds
    const span = Math.max(tx1 - tx0, ty1 - ty0)
    const short = Math.min(projected.width, projected.height)
    if (span < short * PIN_THRESHOLD) pinRadius = projected.width * PIN_RADIUS_RATIO
  }

  return (
    <div className="map-muni">
      <p className="map-muni__caption">{prefName ? `${prefName}のどこ？` : '県内のどこ？'}</p>
      {projected ? (
        <svg
          className="map-muni__svg"
          viewBox={projected.viewBox}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={prefName ? `${prefName}の中の出題地点` : '都道府県の中の出題地点'}
        >
          {others.map((p) => (
            <path key={p.props.lgCode} className="map-muni__path" data-lg-code={p.props.lgCode} d={p.d} />
          ))}

          {target && (
            <>
              <path className="map-muni__halo" d={target.d} />
              <path
                className="map-muni__path map-muni__path--target"
                data-lg-code={target.props.lgCode}
                d={target.d}
              />
              {pinRadius > 0 && (
                <circle
                  className="map-muni__pin"
                  cx={target.centroid[0]}
                  cy={target.centroid[1]}
                  r={pinRadius}
                />
              )}
            </>
          )}
        </svg>
      ) : (
        <p className="map-note">{loading ? '地図を読み込み中…' : '地図を読み込めませんでした'}</p>
      )}
    </div>
  )
}
