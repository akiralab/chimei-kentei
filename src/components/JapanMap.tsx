/**
 * 日本地図から都道府県をえらぶ（範囲・科目 画面の主役）。
 *
 * データの読み込みは親（Select）が持つ。ここは渡された FeatureCollection を描くだけ
 * ＝ 非同期を含まないので、テストも同期で書ける。
 *
 * キーボード操作: 各県の <path> が role="button" / tabIndex=0 / Enter・Space で選択。
 * hover と focus のどちらでも県名ラベルを出す（マウスでもキーボードでも同じ手応えにする）。
 */
import { useMemo, useState } from 'react'
import type { PrefectureCollection } from '../geo/load.ts'
import { projectCollection } from '../geo/project.ts'

interface Props {
  collection: PrefectureCollection
  /** 選択中の都道府県コード。全国のときは undefined */
  selected?: string
  onSelect: (prefCode: string, name: string) => void
}

/** 県名ラベルの大きさ・縁取り。viewBox 単位なので地図の広さに比例させる */
const LABEL_RATIO = 0.05
const LABEL_HALO_RATIO = 0.009

export default function JapanMap({ collection, selected, onSelect }: Props) {
  const projected = useMemo(() => projectCollection(collection), [collection])
  const [active, setActive] = useState<string | null>(null)

  if (!projected) return <p className="map-note">地図を描けませんでした</p>

  const hovered = projected.paths.find((p) => p.props.prefCode === active)
  const labelSize = projected.width * LABEL_RATIO
  const haloWidth = projected.width * LABEL_HALO_RATIO

  return (
    <svg
      className="jp-map__svg"
      viewBox={projected.viewBox}
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label="日本地図から都道府県をえらぶ"
    >
      {projected.paths.map((p) => {
        const isSelected = selected === p.props.prefCode
        const classes = ['jp-map__path']
        if (isSelected) classes.push('jp-map__path--selected')
        if (active === p.props.prefCode) classes.push('jp-map__path--active')
        return (
          <path
            key={p.props.prefCode}
            className={classes.join(' ')}
            d={p.d}
            data-pref-code={p.props.prefCode}
            role="button"
            tabIndex={0}
            aria-label={p.props.name}
            aria-pressed={isSelected}
            onClick={() => onSelect(p.props.prefCode, p.props.name)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              onSelect(p.props.prefCode, p.props.name)
            }}
            onMouseEnter={() => setActive(p.props.prefCode)}
            onMouseLeave={() => setActive((cur) => (cur === p.props.prefCode ? null : cur))}
            onFocus={() => setActive(p.props.prefCode)}
            onBlur={() => setActive((cur) => (cur === p.props.prefCode ? null : cur))}
          />
        )
      })}

      {hovered && (
        <text
          className="jp-map__label"
          x={hovered.centroid[0]}
          y={hovered.centroid[1]}
          style={{ fontSize: labelSize, strokeWidth: haloWidth }}
          aria-hidden="true"
        >
          {hovered.props.name}
        </text>
      )}
    </svg>
  )
}
