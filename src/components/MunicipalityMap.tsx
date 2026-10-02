/**
 * 「その市区町村が都道府県内のどこにあるか」を示す地図（出題画面の左パネル）。
 *
 * 県内の市区町村を薄い線で描き、出題中の自治体（lgCode）だけを塗って強調する。
 * difficult（大字・町名）でも Question.lgCode は所属市区町村なので、同じ扱いで正しく光る。
 *
 * 全国 easy では問題ごとに県が変わるため、読み込みはこのコンポーネントが持つ
 * （prefCode をキーに GeoSource のキャッシュが効く）。読めなければ 1 行の注記にとどめ、
 * パネル自体は残す（出題は地図なしでも成立する）。
 */
import { useEffect, useMemo, useState } from 'react'
import type { GeoSource, MunicipalityCollection } from '../geo/load.ts'
import { defaultGeoSource } from '../geo/load.ts'
import { projectCollection } from '../geo/project.ts'

interface Props {
  prefCode: string
  /** 強調する市区町村の 6 桁コード */
  lgCode: string
  /** 見出しに出す県名 */
  prefName?: string
  source?: GeoSource
}

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
  const projected = useMemo(() => (collection ? projectCollection(collection) : null), [collection])

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
          {projected.paths.map((p) => (
            <path
              key={p.props.lgCode}
              className={
                p.props.lgCode === lgCode ? 'map-muni__path map-muni__path--target' : 'map-muni__path'
              }
              data-lg-code={p.props.lgCode}
              d={p.d}
            />
          ))}
        </svg>
      ) : (
        <p className="map-note">{loading ? '地図を読み込み中…' : '地図を読み込めませんでした'}</p>
      )}
    </div>
  )
}
