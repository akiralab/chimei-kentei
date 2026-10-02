/**
 * 日本地図から都道府県をえらぶ（範囲・科目 画面の主役）。
 *
 * データの読み込みは親（Select）が持つ。ここは渡された FeatureCollection を描くだけ
 * ＝ 非同期を含まないので、テストも同期で書ける。
 *
 * 沖縄県だけは **左上の小さな枠（インセット）に別投影** で描く。
 * 沖縄を本土と同じ fit に入れると経度が 122.9°〜145.8° に広がって本土が縮むため
 * （実測: 沖縄を外すと経度幅が 22.87° → 17.41° に縮む）。
 * 小笠原（東京都）・奄美（鹿児島県）はそれぞれの県のポリゴンに含まれるのでそのまま。
 * インセットの中でもクリック・キーボード・選択表示は本土と同じに効く。
 *
 * キーボード操作: 各県の <path> が role="button" / tabIndex=0 / Enter・Space で選択。
 * hover と focus のどちらでも県名ラベルを出す（マウスでもキーボードでも同じ手応えにする）。
 */
import { useMemo, useState } from 'react'
import type { PrefectureFeatureProps } from '../engine/types.ts'
import type { PrefectureCollection } from '../geo/load.ts'
import type { ProjectedCollection } from '../geo/project.ts'
import { filterCollection, largestPolygon, projectCollection } from '../geo/project.ts'

interface Props {
  collection: PrefectureCollection
  /** 選択中の都道府県コード。全国のときは undefined */
  selected?: string
  onSelect: (prefCode: string, name: string) => void
}

/** インセットに回す県。沖縄県 */
const INSET_PREF = '47'
/** インセット枠の幅（本土 viewBox 幅に対する比）と、viewBox 端からの余白 */
const INSET_WIDTH_RATIO = 0.4
const INSET_MARGIN_RATIO = 0.02

/** 県名ラベルの大きさ・縁取り。viewBox 単位なので地図の広さに比例させる */
const LABEL_RATIO = 0.05
const LABEL_HALO_RATIO = 0.009

type Projected = ProjectedCollection<PrefectureFeatureProps>

export default function JapanMap({ collection, selected, onSelect }: Props) {
  const main = useMemo(() => projectCollection(filterCollection(collection, (p) => p.prefCode !== INSET_PREF)), [
    collection,
  ])
  // インセットは **沖縄本島** に fit する。県全体（与那国〜北大東で経度 8.3°）に合わせると
  // どの島も数ピクセルの点になるため。本島から離れた島は枠（入れ子 SVG）が切る
  const inset = useMemo(() => {
    const okinawa = filterCollection(collection, (p) => p.prefCode === INSET_PREF)
    if (okinawa.features.length === 0) return null
    return projectCollection(okinawa, { fitTo: largestPolygon(okinawa) ?? okinawa })
  }, [collection])
  const [active, setActive] = useState<string | null>(null)

  // 沖縄だけのデータ（＝本土が無い）でも描けるように、本土が無ければインセットを主にする
  const base: Projected | null = main ?? inset
  if (!base) return <p className="map-note">地図を描けませんでした</p>

  const [bx, by, bw, bh] = base.viewBox.split(' ').map(Number)
  const labelSize = bw * LABEL_RATIO
  const haloWidth = bw * LABEL_HALO_RATIO

  // インセットの置き場所は本土 viewBox の **左上**（日本海側＝北海道より西は海で空いている）。
  // 左下は九州が来るので重なる
  const showInset = main !== null && inset !== null
  const insetW = bw * INSET_WIDTH_RATIO
  const insetH = insetW * (inset ? inset.height / inset.width : 1)
  const insetX = bx + bw * INSET_MARGIN_RATIO
  const insetY = by + bh * INSET_MARGIN_RATIO

  /** 選択中・hover 中は最後に描く（隣県の輪郭線に塗りを削られないように） */
  const weight = (code: string) => (selected === code ? 2 : active === code ? 1 : 0)
  const ordered = (p: Projected) =>
    p.paths.slice().sort((a, b) => weight(a.props.prefCode) - weight(b.props.prefCode))

  const renderPaths = (p: Projected) =>
    ordered(p).map((path) => {
      const code = path.props.prefCode
      const isSelected = selected === code
      const classes = ['jp-map__path']
      if (isSelected) classes.push('jp-map__path--selected')
      if (active === code) classes.push('jp-map__path--active')
      return (
        <path
          key={code}
          className={classes.join(' ')}
          d={path.d}
          data-pref-code={code}
          role="button"
          tabIndex={0}
          aria-label={path.props.name}
          aria-pressed={isSelected}
          onClick={() => onSelect(code, path.props.name)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault()
            onSelect(code, path.props.name)
          }}
          onMouseEnter={() => setActive(code)}
          onMouseLeave={() => setActive((cur) => (cur === code ? null : cur))}
          onFocus={() => setActive(code)}
          onBlur={() => setActive((cur) => (cur === code ? null : cur))}
        />
      )
    })

  const hovered = base.paths.find((p) => p.props.prefCode === active)
  const hoveredInset = showInset && active === INSET_PREF
  // インセットは入れ子 <svg> で座標系が別なので、ラベルだけは外側の枠の上に出す
  const labelAt: [number, number] | null =
    hoveredInset ? [insetX + insetW / 2, insetY + insetH + labelSize * 0.7]
    : hovered ? hovered.centroid
    : null
  const labelText = hoveredInset ? '沖縄県' : hovered?.props.name

  return (
    <svg
      className="jp-map__svg"
      viewBox={base.viewBox}
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label="日本地図から都道府県をえらぶ"
    >
      {main && renderPaths(main)}

      {showInset && inset && (
        <>
          <rect
            className="jp-map__inset-frame"
            x={insetX}
            y={insetY}
            width={insetW}
            height={insetH}
            rx={bw * 0.008}
          />
          {/* 入れ子 <svg> は自前のビューポートを持つので、沖縄だけ別投影で収まる */}
          <svg
            x={insetX}
            y={insetY}
            width={insetW}
            height={insetH}
            viewBox={inset.viewBox}
            preserveAspectRatio="xMidYMid meet"
          >
            {renderPaths(inset)}
          </svg>
        </>
      )}

      {labelAt && labelText && (
        <text
          className="jp-map__label"
          x={labelAt[0]}
          y={labelAt[1]}
          style={{ fontSize: labelSize, strokeWidth: haloWidth }}
          aria-hidden="true"
        >
          {labelText}
        </text>
      )}
    </svg>
  )
}
