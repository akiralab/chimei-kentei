/**
 * 自治体情報カード（出題画面の左パネル・地図の下）。
 *
 * 自治体の勉強が目的なので、読みやすさを優先して数字を大きく、ラベルは明朝で小さく。
 *
 * 1 画面に収める都合で **常に同じ高さの枠を描く**。解答前（revealed=false）と、
 * 統計が読めなかったときは値を '—' にしたプレースホルダーになる。
 * 「解答した瞬間にカードが現れて全体の高さが変わる」のを避けるため。
 */
import { useEffect, useState } from 'react'
import type { MunicipalityStats } from '../engine/types.ts'
import type { GeoSource } from '../geo/load.ts'
import { defaultGeoSource } from '../geo/load.ts'
import { groupDigits } from '../geo/format.ts'

interface Props {
  lgCode: string
  /** 解答後（○× 表示中）だけ中身を見せる */
  revealed: boolean
  /** 市区町村名の読み。easy だけ分かる（difficult は大字の読みなので渡さない） */
  reading?: string
  /** 全国モードのときだけ都道府県名を添える */
  prefName?: string
  source?: GeoSource
}

const BLANK = '—'
const LABELS = ['人口', '世帯数', '面積', '人口密度'] as const
const UNITS = ['人', '世帯', 'km²', '人/km²'] as const

function valuesOf(stats: MunicipalityStats | null): string[] {
  if (!stats) return LABELS.map(() => BLANK)
  return [
    groupDigits(stats.population),
    groupDigits(stats.households),
    groupDigits(stats.areaKm2, 2),
    groupDigits(stats.densityPerKm2),
  ]
}

export default function MunicipalityInfo({
  lgCode,
  revealed,
  reading,
  prefName,
  source = defaultGeoSource(),
}: Props) {
  // どの自治体の結果かを添えて持つ。次の問に進んだ直後に前の問の数字を出さないため
  const [loaded, setLoaded] = useState<{ lgCode: string; stats: MunicipalityStats | null } | null>(null)

  useEffect(() => {
    let alive = true
    source
      .stats()
      .then((map) => {
        if (alive) setLoaded({ lgCode, stats: map?.[lgCode] ?? null })
      })
      .catch(() => {
        if (alive) setLoaded({ lgCode, stats: null })
      })
    return () => {
      alive = false
    }
  }, [lgCode, source])

  const stats = revealed && loaded?.lgCode === lgCode ? loaded.stats : null
  const values = valuesOf(stats)

  return (
    <div className={stats ? 'info-card' : 'info-card info-card--placeholder'}>
      {/* 見出しは常に 1 行（プレースホルダーと実カードで高さを変えないため）。
          easy の読みは答えなので、解答後だけ出す */}
      <div className="info-card__head">
        <span className="info-card__name">{stats ? stats.name : '？'}</span>
        <span className="info-card__reading">{stats ? reading : '解答すると出ます'}</span>
      </div>
      {/* 全国モードでは都道府県名を添える。答えではないので解答前から出す（行数を揃える） */}
      {prefName && <p className="info-card__pref">{prefName}</p>}

      <dl className="info-card__stats">
        {LABELS.map((label, i) => (
          <div className="info-card__row" key={label}>
            <dt className="info-card__label">{label}</dt>
            <dd className="info-card__value">
              {values[i]}
              <span className="info-card__unit">{UNITS[i]}</span>
            </dd>
          </div>
        ))}
      </dl>

      <p className="info-card__source">出典: 2020 年国勢調査（e-Stat 境界データ）</p>
    </div>
  )
}
