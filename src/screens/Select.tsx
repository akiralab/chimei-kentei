import { useEffect, useMemo, useState } from 'react'
import type { BankMeta, Mode } from '../engine/types.ts'
import { DATA_VERSION, loadMeta } from '../engine/bank.ts'
import { SCOPE_NATIONWIDE, buildSetId, randomSeed } from '../engine/setId.ts'
import { navigate, quizPath } from '../router.ts'
import { TIME_LIMIT_CHOICES, useTimeLimit } from '../hooks/useTimeLimit.ts'
import type { PrefectureCollection } from '../geo/load.ts'
import { defaultGeoSource } from '../geo/load.ts'
import RegionPicker from '../components/RegionPicker.tsx'

export default function Select() {
  const [meta, setMeta] = useState<BankMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<string>(SCOPE_NATIONWIDE)
  const [mode, setMode] = useState<Mode>('e')
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

  const nationwide = scope === SCOPE_NATIONWIDE
  /**
   * 全国 × difficult は母集団を組めない（difficult は都道府県ごとのファイル）。
   * 科目の切替自体は全国のままでも押せるようにし、「始める」だけを止めて案内を出す。
   */
  const blocked = nationwide && mode === 'd'

  /** 地図で光らせる県 */
  const mapSelected = nationwide ? undefined : scope

  const scopeLabel = nationwide ? '全国' : (selectedPref?.name ?? scope)
  /** 「制限なし」→「なし」。見出しや切替で「制限: 制限なし」と重ならないように頭を落とす */
  const shortLimit = (label: string) => label.replace(/^制限/, '')
  const timeLimitLabel = shortLimit(
    TIME_LIMIT_CHOICES.find((c) => c.value === timeLimitMs)?.label ?? TIME_LIMIT_CHOICES[0].label,
  )

  const start = () => {
    if (blocked) return
    navigate(quizPath(buildSetId(DATA_VERSION, mode, scope, randomSeed())))
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
          いまの範囲: {scopeLabel} ／ 科目: {mode === 'e' ? 'easy（市区町村名）' : 'difficult（大字・町名）'} ／ 制限:{' '}
          {timeLimitLabel}
        </p>
      </div>

      <RegionPicker
        collection={japan}
        prefectures={meta.prefectures.map((p) => ({ code: p.code, name: p.name }))}
        selected={mapSelected}
        loading={mapLoading}
        nationwide={nationwide}
        onNationwide={() => setScope(SCOPE_NATIONWIDE)}
        onSelect={(prefCode) => setScope(prefCode)}
      />

      <div className="mode-switch">
        <button
          type="button"
          className={mode === 'e' ? 'mode-switch__item is-selected' : 'mode-switch__item'}
          aria-label="easy（市区町村名）"
          onClick={() => setMode('e')}
        >
          <span className="mode-switch__full" aria-hidden="true">
            easy（市区町村名）
          </span>
          <span className="mode-switch__abbr" aria-hidden="true">
            easy
          </span>
        </button>
        <button
          type="button"
          className={mode === 'd' ? 'mode-switch__item is-selected' : 'mode-switch__item'}
          aria-label="difficult（市区町村名 ＋ 大字・町名）"
          onClick={() => setMode('d')}
        >
          <span className="mode-switch__full" aria-hidden="true">
            difficult（市区町村名 ＋ 大字・町名）
          </span>
          <span className="mode-switch__abbr" aria-hidden="true">
            difficult
          </span>
        </button>
      </div>

      {/* 時間制限。科目の切替と同じ見た目で 1 段下に並べる（既定は「制限なし」） */}
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

      <p>
        {/* 全国のまま difficult（都道府県ごとの出題）を選んでいる間は始められない。
            行を足すと 1 画面に収まらなくなるので、案内はボタンのラベルに出す */}
        <button type="button" className="btn btn--primary" onClick={start} disabled={blocked}>
          {blocked ? '都道府県を選ぶと始められます' : '始める'}
        </button>
      </p>
    </div>
  )
}
