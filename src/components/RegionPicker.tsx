/**
 * 範囲選択の地図 UI（2 段階）。気象アプリの地点選択と同じ流れ。
 *
 *   段階 1: 地方（9 グループ）を選ぶ — 実ポリゴンを地方ごとに塗り分け、地方名チップを重ねる
 *   段階 2: その地方へズームして都道府県を選ぶ — 地図のチップ、または下の大きなボタングリッド
 *
 * 狙いは精密な地図ではなく **選びやすさ**（スマホ 375px でタップできること）。
 * なので:
 *   - チップは SVG の <text> ではなく **本物の <button>**。44px の最小タップ領域と
 *     1rem の文字サイズを CSS で素直に保証でき、Tab/Enter/Space も標準で効く
 *   - チップの位置は投影座標 → ピクセルへ自前で変換する（下の `meet` と同じ計算）。
 *     重なりは `spreadChips` がピクセル空間でほどく。地理の正確さより読めることを優先
 *   - 塗り領域（<path>）もチップもどちらを押しても同じ選択になる
 *
 * 地図データが無いときは地図を出さず、47 件のボタングリッドだけで成立させる
 * （出題は地図なしでも動く、という方針は他の地図部品と同じ）。
 */
import { useEffect, useMemo, useState } from 'react'
import type { PrefectureFeatureProps } from '../engine/types.ts'
import type { PrefectureCollection } from '../geo/load.ts'
import type { ProjectedCollection } from '../geo/project.ts'
import { filterCollection, largestPolygon, mainPolygons, projectCollection } from '../geo/project.ts'
import type { Region } from '../geo/regions.ts'
import { INSET_REGION_ID, REGIONS, regionById, regionOfPref } from '../geo/regions.ts'

interface PrefOption {
  code: string
  name: string
}

interface Props {
  /** japan.json。読めなければ null（ボタングリッドだけで動く） */
  collection: PrefectureCollection | null
  /** 選択肢に出す都道府県（問題バンクの meta から来る。地図より meta を正とする） */
  prefectures: PrefOption[]
  /** 選択中の都道府県コード。全国なら undefined */
  selected?: string
  /** 選択中の都道府県の添え書き（例「67問」「★★★ 26問」）。見出し行の余白に出す */
  selectedNote?: string
  /**
   * 上の添え書きの読み上げ・ツールチップ用の言い換え（例「★★★ の問題数 26 問」）。
   * 添え書きは幅が無いので記号で詰めるが、それだけでは何の数か分からないため別に名前を付ける
   */
  selectedNoteLabel?: string
  onSelect: (prefCode: string, name: string) => void
  /** 「全国」が選ばれているか。見出し行に全国ボタンを同居させて 1 行ぶん節約する */
  nationwide?: boolean
  onNationwide?: () => void
  /** 地図が読めなかった理由を 1 行で出すための状態 */
  loading?: boolean
}

/**
 * チップの実寸の見積もり（px）。重なりをほどく計算に使うので **CSS の実寸と揃える**。
 * 幅はラベルの文字数で決まる（「東北」50px と「中国・四国」98px では倍近く違うため、
 * 一律の見積もりだと狭いチップを離しすぎ・広いチップを重ねてしまう）。
 *
 * 実測との対応（375px 幅・1rem）: 2 文字 50px / 3 文字 66px / 5 文字 98px = 文字数 × 16 + 18。
 */
const CHIP_MIN = 44
const CHIP_GAP = 4
/** 段階 1（1rem）と段階 2（--fs-md ≒ 15px）の 1 文字あたり幅と、左右 padding ＋ 枠線 */
const REGION_CHAR = 16
const PREF_CHAR = 15
/** 広い画面は padding が var(--space-3)、狭い画面は var(--space-2)（map.css の 719px ブレーク） */
const NARROW_STAGE = 420
/**
 * 段階 2 でチップを出す最低のステージ高。スマホでは地図に 100px ほどしか割けず、
 * 7 個のチップを置くと必ず重なる。そこではチップを出さず、下の
 * **ボタングリッド（48px）だけ** を選択動線にする（そちらの方が押しやすい）。
 * 地図は「その地方のどこか」を示す役に徹する。
 */
const PREF_CHIP_MIN_STAGE_H = 130
const PREF_CHIP_MIN_STAGE_W = 220
const PAD_NARROW = 18
const PAD_WIDE = 26
const CHIP_H_REGION = 46
const CHIP_H_PREF = 38

function chipWidth(label: string, charWidth: number, pad: number): number {
  return Math.max(CHIP_MIN, label.length * charWidth + pad)
}

/** 計測前（SSR / jsdom）の既定サイズ。これが無いとチップが 1 点に重なる */
const DEFAULT_BOX = { width: 345, height: 240 }

/** 沖縄インセットの枠（本土 viewBox に対する比）。段階 1 のみ */
const INSET_WIDTH_RATIO = 0.4
const INSET_MARGIN_RATIO = 0.02

interface Chip {
  key: string
  label: string
  x: number
  y: number
  /** 実寸の見積もり。重なり判定に使う */
  w: number
  h: number
}

/**
 * 重なったチップをピクセル空間でほどく。
 *
 * 総当たりで押し合うと、ぶつかった同士が入れ替わって「中部が関東の東」のような
 * 地理的に明らかな嘘になる。そこで **北から順に置いていく貪欲法** にした。
 * 先に置いたチップは動かさず、ぶつかった後発だけを「本来の位置からいちばん近い空き」へ逃がす。
 * 結果として北→南の並びが保たれ、ズレるのは後発の一部だけで済む。乱数は使わない。
 */
function placeChips(chips: Chip[], box: { width: number; height: number }): Chip[] {
  const placed: Chip[] = []
  const clampX = (c: Chip, x: number) => Math.min(Math.max(box.width - c.w / 2 - 2, c.w / 2 + 2), Math.max(c.w / 2 + 2, x))
  const clampY = (c: Chip, y: number) => Math.min(Math.max(box.height - c.h / 2 - 2, c.h / 2 + 2), Math.max(c.h / 2 + 2, y))
  const hits = (c: Chip, x: number, y: number) =>
    placed.some(
      (o) => Math.abs(x - o.x) < (c.w + o.w) / 2 + CHIP_GAP && Math.abs(y - o.y) < (c.h + o.h) / 2 + CHIP_GAP,
    )

  for (const chip of chips) {
    const baseX = clampX(chip, chip.x)
    const baseY = clampY(chip, chip.y)
    let best: { x: number; y: number } | null = hits(chip, baseX, baseY) ? null : { x: baseX, y: baseY }

    // 本来の位置から半径を広げながら 16 方位を試す。見つかった最初＝いちばん近い空き
    for (let radius = 8; best === null && radius <= 220; radius += 8) {
      for (let step = 0; step < 16; step++) {
        const angle = (step / 16) * Math.PI * 2
        const x = clampX(chip, chip.x + Math.cos(angle) * radius)
        const y = clampY(chip, chip.y + Math.sin(angle) * radius * 0.75)
        if (!hits(chip, x, y)) {
          best = { x, y }
          break
        }
      }
    }
    placed.push({ ...chip, x: best?.x ?? baseX, y: best?.y ?? baseY })
  }
  return placed
}

/**
 * 要素の実寸を見る。ResizeObserver が無い環境（jsdom）では既定値のまま。
 *
 * **要素は state で受け取る**（ref オブジェクトではなく）。地図は読み込み後に初めて
 * マウントされるので、ref.current を見る useEffect だと「まだ null」のまま二度と
 * 再実行されず、チップが既定サイズのまま置かれてしまう（実際に踏んだ）。
 */
function useBoxSize(element: HTMLElement | null): { width: number; height: number } {
  const [box, setBox] = useState(DEFAULT_BOX)
  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect && rect.width > 0 && rect.height > 0) setBox({ width: rect.width, height: rect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return box
}

type Projected = ProjectedCollection<PrefectureFeatureProps>

/** viewBox 座標 → 画面ピクセル。SVG の preserveAspectRatio="xMidYMid meet" と同じ計算 */
function makeToPixel(projected: Projected, box: { width: number; height: number }) {
  const scale = Math.min(box.width / projected.width, box.height / projected.height)
  const offsetX = (box.width - projected.width * scale) / 2
  const offsetY = (box.height - projected.height * scale) / 2
  return (point: [number, number]): [number, number] => [
    offsetX + (point[0] - projected.x) * scale,
    offsetY + (point[1] - projected.y) * scale,
  ]
}

export default function RegionPicker({
  collection,
  prefectures,
  selected,
  selectedNote,
  selectedNoteLabel,
  onSelect,
  nationwide,
  onNationwide,
  loading,
}: Props) {
  const [regionId, setRegionId] = useState<string | null>(null)
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null)
  const box = useBoxSize(stageEl)

  // 選択中の都道府県が変わったら、その地方を開いておく（共有 URL から戻ったときなど）
  const selectedRegionId = selected ? regionOfPref(selected)?.id : undefined
  const activeRegion = regionId ? regionById(regionId) : undefined

  const known = useMemo(() => new Set(prefectures.map((p) => p.code)), [prefectures])
  const nameOf = useMemo(() => new Map(prefectures.map((p) => [p.code, p.name])), [prefectures])

  /** 実際に選べる地方（問題バンクに 1 県も無い地方は出さない） */
  const regions = useMemo(() => REGIONS.filter((r) => r.prefCodes.some((c) => known.has(c))), [known])

  // ---- 段階 1 の地図（沖縄は別枠） -------------------------------------
  // fit は各県の本体ポリゴンだけで行う（小笠原・奄美・五島に引っ張られて本土が縮むのを防ぐ）。
  // 離島は描画はされる（viewBox の外に出れば SVG が切る）
  const mainland = useMemo(() => {
    if (!collection) return null
    const land = filterCollection(collection, (p) => p.prefCode !== '47')
    return projectCollection(land, { fitTo: mainPolygons(land) })
  }, [collection])
  const inset = useMemo(() => {
    if (!collection) return null
    const okinawa = filterCollection(collection, (p) => p.prefCode === '47')
    if (okinawa.features.length === 0) return null
    return projectCollection(okinawa, { fitTo: largestPolygon(okinawa) ?? okinawa })
  }, [collection])

  // ---- 段階 2 の地図（その地方だけに fit） ------------------------------
  const zoomed = useMemo(() => {
    if (!collection || !activeRegion) return null
    const inRegion = filterCollection(collection, (p) => activeRegion.prefCodes.includes(p.prefCode))
    if (inRegion.features.length === 0) return null
    return projectCollection(inRegion, { fitTo: mainPolygons(inRegion) })
  }, [collection, activeRegion])

  const stageTwo = activeRegion !== undefined
  const projected = activeRegion ? zoomed : mainland

  // ---- チップの位置 ------------------------------------------------------
  const chips: Chip[] = useMemo(() => {
    if (!projected) return []
    const toPixel = makeToPixel(projected, box)

    const pad = box.width < NARROW_STAGE ? PAD_NARROW : PAD_WIDE

    if (!stageTwo) {
      // 狭いステージ（スマホ）は投影位置だと必ず重なるので、regions.ts の概略配置を使う
      const useCompact = box.width < NARROW_STAGE
      const insetRect = insetRectOf(projected, inset)
      return placeChips(
        regions.map((region) => {
          let center: [number, number]
          if (useCompact) {
            center = [region.compact[0] * box.width, region.compact[1] * box.height]
          } else {
            const anchor =
              region.id === INSET_REGION_ID && insetRect ?
                ([insetRect.x + insetRect.w / 2, insetRect.y + insetRect.h + insetRect.h * 0.18] as [number, number])
              : projected.project(region.anchor)
            center = anchor ? toPixel(anchor) : [box.width / 2, box.height / 2]
          }
          return {
            key: region.id,
            label: region.name,
            x: center[0],
            y: center[1],
            w: chipWidth(region.name, REGION_CHAR, pad),
            h: CHIP_H_REGION,
          }
        }),
        box,
      )
    }

    if (box.height < PREF_CHIP_MIN_STAGE_H || box.width < PREF_CHIP_MIN_STAGE_W) return []

    return placeChips(
      projected.paths
        .filter((p) => known.has(p.props.prefCode))
        .map((p) => {
          const [cx, cy] = toPixel(p.centroid)
          const label = nameOf.get(p.props.prefCode) ?? p.props.name
          return {
            key: p.props.prefCode,
            label,
            x: cx,
            y: cy,
            w: chipWidth(label, PREF_CHAR, PAD_NARROW),
            h: CHIP_H_PREF,
          }
        }),
      box,
    )
  }, [projected, box, stageTwo, regions, inset, known, nameOf])

  const insetRect = !stageTwo && projected ? insetRectOf(projected, inset) : null

  const choose = (code: string) => onSelect(code, nameOf.get(code) ?? code)

  /** 地方を開く。1 県しかない地方（北海道・沖縄）はそのまま都道府県選択にする */
  const openRegion = (region: Region) => {
    const codes = region.prefCodes.filter((c) => known.has(c))
    if (codes.length === 1) {
      choose(codes[0])
      return
    }
    setRegionId(region.id)
  }

  /** 段階 2 のボタングリッドに出す都道府県 */
  const gridPrefs: PrefOption[] =
    activeRegion ?
      activeRegion.prefCodes.filter((c) => known.has(c)).map((c) => ({ code: c, name: nameOf.get(c) ?? c }))
      // 地図が無いときは全県をそのまま並べる（これが唯一の動線になる）
    : collection ? []
    : prefectures

  const regionClassOf = (prefCode: string) => regionOfPref(prefCode)?.id ?? 'other'

  return (
    <div className="jp-map">
      {/* 見出し・全国・戻る を 1 行に詰める（縦を 1 行ぶん節約して 1 画面に収める） */}
      <div className="jp-map__head">
        <p className="jp-map__step">{activeRegion ? `${activeRegion.name}の都道府県をえらぶ` : '地方をえらぶ'}</p>
        {selected && selectedNote && (
          <span
            className="jp-map__note"
            // ★ の記号は読み上げに向かないので、読み上げ名とツールチップは言い換えた方を出す
            role={selectedNoteLabel === undefined ? undefined : 'note'}
            aria-label={selectedNoteLabel}
            title={selectedNoteLabel}
          >
            {/* 県名は広い画面だけ。狭い画面は選んだセルが光っているので件数だけで足りる */}
            <span className="jp-map__note-name">{nameOf.get(selected) ?? selected} </span>
            {selectedNote}
          </span>
        )}
        {activeRegion ?
          <button type="button" className="btn btn--ghost jp-map__back" onClick={() => setRegionId(null)}>
            地方を選び直す
          </button>
        : onNationwide && (
            <button
              type="button"
              className={nationwide ? 'jp-map__all jp-map__all--selected' : 'jp-map__all'}
              aria-pressed={nationwide}
              onClick={onNationwide}
            >
              全国
            </button>
          )
        }
      </div>

      <div className="jp-map__body">
      {collection === null ?
        <p className="map-note">{loading ? '地図を読み込み中…' : '地図を読み込めませんでした。下の一覧から選んでください。'}</p>
      : !projected ?
        <p className="map-note">地図を描けませんでした</p>
      : <div className={activeRegion ? 'jp-map__stage jp-map__stage--zoom' : 'jp-map__stage'} ref={setStageEl}>
          <svg
            className="jp-map__svg"
            viewBox={projected.viewBox}
            preserveAspectRatio="xMidYMid meet"
            role="group"
            aria-label={activeRegion ? `${activeRegion.name}の地図` : '日本地図から地方をえらぶ'}
          >
            {projected.paths.map((p) => {
              const code = p.props.prefCode
              const region = regionOfPref(code)
              const isSelected = stageTwo ? selected === code : selectedRegionId === region?.id
              const classes = ['jp-map__path', `jp-map__path--${regionClassOf(code)}`]
              if (isSelected) classes.push('jp-map__path--selected')
              return (
                <path
                  key={code}
                  className={classes.join(' ')}
                  d={p.d}
                  data-pref-code={code}
                  /* 操作子はチップとボタングリッド。塗りは「押せるが読み上げない」追加の面 */
                  aria-hidden="true"
                  onClick={() => {
                    if (stageTwo) {
                      if (known.has(code)) choose(code)
                    } else if (region) openRegion(region)
                  }}
                />
              )
            })}

            {insetRect && inset && (
              <>
                <rect
                  className="jp-map__inset-frame"
                  x={insetRect.x}
                  y={insetRect.y}
                  width={insetRect.w}
                  height={insetRect.h}
                  rx={projected.width * 0.008}
                />
                {/* 入れ子 <svg> は自前のビューポートを持つので、沖縄だけ別投影で収まる */}
                <svg
                  x={insetRect.x}
                  y={insetRect.y}
                  width={insetRect.w}
                  height={insetRect.h}
                  viewBox={inset.viewBox}
                  preserveAspectRatio="xMidYMid meet"
                >
                  {inset.paths.map((p) => (
                    <path
                      key={p.props.prefCode}
                      className={
                        selectedRegionId === 'okinawa' ?
                          'jp-map__path jp-map__path--okinawa jp-map__path--selected'
                        : 'jp-map__path jp-map__path--okinawa'
                      }
                      d={p.d}
                      aria-hidden="true"
                    />
                  ))}
                </svg>
              </>
            )}
          </svg>

          {/* チップは SVG の外（HTML）。44px のタップ領域と 1rem の文字を CSS で保証する */}
          {chips.map((chip) => {
            const isSelected =
              stageTwo ? selected === chip.key : selectedRegionId !== undefined && selectedRegionId === chip.key
            const classes = ['jp-map__chip', `jp-map__chip--${stageTwo ? regionClassOf(chip.key) : chip.key}`]
            if (isSelected) classes.push('jp-map__chip--selected')
            return (
              <button
                key={chip.key}
                type="button"
                className={classes.join(' ')}
                style={{ left: `${chip.x}px`, top: `${chip.y}px` }}
                aria-label={stageTwo ? chip.label : `${chip.label}地方`}
                aria-pressed={isSelected}
                onClick={() => {
                  if (stageTwo) choose(chip.key)
                  else {
                    const region = regionById(chip.key)
                    if (region) openRegion(region)
                  }
                }}
              >
                {chip.label}
              </button>
            )
          })}
        </div>
      }

      {gridPrefs.length > 0 && (
        <div className="jp-map__grid">
          {gridPrefs.map((p) => (
            <button
              key={p.code}
              type="button"
              className={
                selected === p.code ?
                  `jp-map__cell jp-map__cell--${regionClassOf(p.code)} jp-map__cell--selected`
                : `jp-map__cell jp-map__cell--${regionClassOf(p.code)}`
              }
              aria-pressed={selected === p.code}
              onClick={() => choose(p.code)}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
      </div>
    </div>
  )
}

/** 沖縄インセットの枠（本土 viewBox 座標）。左上は日本海側で空いている */
function insetRectOf(
  main: Projected,
  inset: Projected | null,
): { x: number; y: number; w: number; h: number } | null {
  if (!inset) return null
  const w = main.width * INSET_WIDTH_RATIO
  const h = w * (inset.height / inset.width)
  return { x: main.x + main.width * INSET_MARGIN_RATIO, y: main.y + main.height * INSET_MARGIN_RATIO, w, h }
}
