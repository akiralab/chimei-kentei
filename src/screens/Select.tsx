import { useEffect, useMemo, useState } from 'react'
import type { BankMeta, Mode } from '../engine/types.ts'
import { QUESTIONS_PER_SET } from '../engine/types.ts'
import { DATA_VERSION, loadMeta } from '../engine/bank.ts'
import { MODES, MODE_LABELS, modeName } from '../engine/modes.ts'
import { SCOPE_NATIONWIDE, buildSetId, canBeAll, randomSeed } from '../engine/setId.ts'
import { navigate, quizPath } from '../router.ts'
import { TIME_LIMIT_CHOICES, useTimeLimit } from '../hooks/useTimeLimit.ts'
import type { PrefectureCollection } from '../geo/load.ts'
import { defaultGeoSource } from '../geo/load.ts'
import RegionPicker from '../components/RegionPicker.tsx'

/**
 * 「全54市町村」の添え書き。政令市の区は市にまとめてあるので、区が混じるのは東京都（特別区）だけ。
 * 件数は問題バンクではなく meta.cities（全市区町村）で数える。全市区町村名モードもこの集合を出す
 */
function municipalityCount(meta: BankMeta, prefCode: string): { n: number; label: string } {
  const cities = meta.cities.filter((c) => c.prefCode === prefCode)
  const hasWard = cities.some((c) => c.name.endsWith('区'))
  return { n: cities.length, label: `全${cities.length}${hasWard ? '市区町村' : '市町村'}` }
}

export default function Select() {
  const [meta, setMeta] = useState<BankMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<string>(SCOPE_NATIONWIDE)
  const [mode, setMode] = useState<Mode>('e')
  /** 問題数。false ＝ 10 問、true ＝ その都道府県の全市区町村名（市区町村名 × 都道府県のときだけ） */
  const [all, setAll] = useState(false)
  // 時間制限は端末の設定（既定は「制限なし」）。Quiz は出題開始時に readTimeLimit() で読み直す
  const [timeLimitMs, setTimeLimitMs] = useTimeLimit()
  // 地図（地方 → 都道府県の 2 段階）。読めなくても RegionPicker がボタングリッドで成立させる
  const [japan, setJapan] = useState<PrefectureCollection | null>(null)
  const [mapLoading, setMapLoading] = useState(true)

  useEffect(() => {
    let alive = true
    loadMeta()
      .then((m) => {
        if (alive) setMeta(m)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [])

  // 地図データ（public/geo/japan.json）。無くても範囲選択は一覧で成立する
  useEffect(() => {
    let alive = true
    defaultGeoSource()
      .japan()
      .then((fc) => {
        if (!alive) return
        setJapan(fc)
        setMapLoading(false)
      })
      .catch(() => {
        if (alive) setMapLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const selectedPref = useMemo(
    () => (scope.length === 2 && scope !== SCOPE_NATIONWIDE ? meta?.prefectures.find((p) => p.code === scope) : undefined),
    [meta, scope],
  )
  const count = useMemo(() => (meta && selectedPref ? municipalityCount(meta, selectedPref.code) : null), [meta, selectedPref])

  const nationwide = scope === SCOPE_NATIONWIDE
  /**
   * 全国 × 町名は母集団を組めない（町名は都道府県ごとのファイル）。
   * 科目の切替自体は全国のままでも押せるようにし、「始める」だけを止めて案内を出す。
   */
  const blocked = nationwide && mode === 'd'
  /** 全市区町村名を選べる条件。外れたら 10 問に戻す（切替は押せないまま残さない） */
  const allAvailable = canBeAll(mode, scope)
  const allSelected = all && allAvailable

  /** 地図で光らせる県 */
  const mapSelected = nationwide ? undefined : scope

  const scopeLabel = nationwide ? '全国' : (selectedPref?.name ?? scope)
  /** 「制限なし」→「なし」。見出しや切替で「制限: 制限なし」と重ならないように頭を落とす */
  const shortLimit = (label: string) => label.replace(/^制限/, '')
  const timeLimitLabel = shortLimit(
    TIME_LIMIT_CHOICES.find((c) => c.value === timeLimitMs)?.label ?? TIME_LIMIT_CHOICES[0].label,
  )
  const countLabel = allSelected && count ? `全 ${count.n} 問` : `${QUESTIONS_PER_SET} 問`

  const choosePref = (prefCode: string) => setScope(prefCode)
  const chooseNationwide = () => {
    setScope(SCOPE_NATIONWIDE)
    setAll(false)
  }
  const chooseMode = (m: Mode) => {
    setMode(m)
    if (m !== 'e') setAll(false)
  }

  const start = () => {
    if (blocked) return
    navigate(quizPath(buildSetId(DATA_VERSION, mode, scope, randomSeed(), allSelected)))
  }

  if (error) {
    return (
      <div className="paper">
        <h1 className="paper__title">範囲・科目</h1>
        <p>問題バンクを読み込めませんでした。</p>
        <p>{error}</p>
      </div>
    )
  }

  if (!meta) {
    return (
      <div className="paper">
        <h1 className="paper__title">範囲・科目</h1>
        <p>読み込み中…</p>
      </div>
    )
  }

  return (
    <div className="paper">
      <div className="paper__header">
        <h1 className="paper__title">範囲・科目</h1>
        <p className="paper__subtitle">
          いまの範囲: {scopeLabel} ／ 科目: {modeName(mode)} ／ 問題数: {countLabel} ／ 制限: {timeLimitLabel}
        </p>
      </div>

      <RegionPicker
        collection={japan}
        prefectures={meta.prefectures.map((p) => ({ code: p.code, name: p.name }))}
        selected={mapSelected}
        selectedNote={count?.label}
        loading={mapLoading}
        nationwide={nationwide}
        onNationwide={chooseNationwide}
        onSelect={choosePref}
      />

      {/* 科目 ＝ 出題する地名の種類（難易度ではない）。市区町村名だけか、大字・町名も含むか */}
      <div className="mode-switch">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={mode === m ? 'mode-switch__item is-selected' : 'mode-switch__item'}
            aria-pressed={mode === m}
            aria-label={MODE_LABELS[m].name}
            onClick={() => chooseMode(m)}
          >
            <span className="mode-switch__full" aria-hidden="true">
              {MODE_LABELS[m].name}
            </span>
            <span className="mode-switch__abbr" aria-hidden="true">
              {MODE_LABELS[m].short}
            </span>
          </button>
        ))}
      </div>

      {/* 問題数と時間制限。1 行に 2 つ並べて縦を節約する（1 画面に収めるため） */}
      <div className="switch-row">
        <div className="mode-switch">
          <button
            type="button"
            className={allSelected ? 'mode-switch__item' : 'mode-switch__item is-selected'}
            aria-pressed={!allSelected}
            aria-label={`問題数: ${QUESTIONS_PER_SET} 問`}
            onClick={() => setAll(false)}
          >
            <span className="mode-switch__full" aria-hidden="true">
              {QUESTIONS_PER_SET}問
            </span>
            <span className="mode-switch__abbr" aria-hidden="true">
              {QUESTIONS_PER_SET}問
            </span>
          </button>
          <button
            type="button"
            className={allSelected ? 'mode-switch__item is-selected' : 'mode-switch__item'}
            aria-pressed={allSelected}
            aria-label={count ? `問題数: 全市区町村名（${count.n} 問）` : '問題数: 全市区町村名'}
            title={allAvailable ? undefined : '市区町村名で都道府県を選ぶと選べます'}
            disabled={!allAvailable}
            onClick={() => setAll(true)}
          >
            <span className="mode-switch__full" aria-hidden="true">
              全市区町村名{count && `（${count.n}問）`}
            </span>
            <span className="mode-switch__abbr" aria-hidden="true">
              全部{count && `（${count.n}）`}
            </span>
          </button>
        </div>

        <div className="mode-switch">
          {TIME_LIMIT_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              className={timeLimitMs === choice.value ? 'mode-switch__item is-selected' : 'mode-switch__item'}
              aria-pressed={timeLimitMs === choice.value}
              aria-label={`時間制限: ${shortLimit(choice.label)}`}
              onClick={() => setTimeLimitMs(choice.value)}
            >
              <span className="mode-switch__full" aria-hidden="true">
                時間制限: {shortLimit(choice.label)}
              </span>
              {/* 狭い画面でも「なし」単独だと何の設定か分からないので、短縮版は元のラベルを使う */}
              <span className="mode-switch__abbr" aria-hidden="true">
                {choice.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <p>
        {/* 全国のまま町名（都道府県ごとの出題）を選んでいる間は始められない。
            行を足すと 1 画面に収まらなくなるので、案内はボタンのラベルに出す */}
        <button type="button" className="btn btn--primary" onClick={start} disabled={blocked}>
          {blocked ? '都道府県を選ぶと始められます' : '始める'}
        </button>
      </p>
    </div>
  )
}
