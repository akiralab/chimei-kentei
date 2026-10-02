import { useEffect, useMemo, useState } from 'react'
import type { BankMeta, Mode } from '../engine/types.ts'
import { DATA_VERSION, loadMeta } from '../engine/bank.ts'
import { SCOPE_NATIONWIDE, buildSetId, randomSeed, todaySeed } from '../engine/setId.ts'
import { navigate, quizPath } from '../router.ts'
import { TIME_LIMIT_CHOICES, useTimeLimit } from '../hooks/useTimeLimit.ts'
import type { PrefectureCollection } from '../geo/load.ts'
import { defaultGeoSource } from '../geo/load.ts'
import RegionPicker from '../components/RegionPicker.tsx'

const CANDIDATE_LIMIT = 8

export default function Select() {
  const [meta, setMeta] = useState<BankMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<string>(SCOPE_NATIONWIDE)
  const [mode, setMode] = useState<Mode>('e')
  const [query, setQuery] = useState('')
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

  const candidates = useMemo(() => {
    const q = query.trim()
    if (!meta || q === '') return []
    return meta.cities.filter((c) => c.name.includes(q) || c.kana.includes(q)).slice(0, CANDIDATE_LIMIT)
  }, [meta, query])

  const selectedCity = useMemo(
    () => (scope.length === 6 ? meta?.cities.find((c) => c.lgCode === scope) : undefined),
    [meta, scope],
  )
  const selectedPref = useMemo(
    () => (scope.length === 2 && scope !== SCOPE_NATIONWIDE ? meta?.prefectures.find((p) => p.code === scope) : undefined),
    [meta, scope],
  )

  const nationwide = scope === SCOPE_NATIONWIDE
  const blocked = nationwide && mode === 'd'

  /** 地図で光らせる県。市区町村を選んでいるときはその所属県 */
  const mapSelected = nationwide ? undefined : scope.slice(0, 2)

  const scopeLabel = nationwide ? '全国' : (selectedCity?.name ?? selectedPref?.name ?? scope)
  /** 「制限なし」→「なし」。見出しや切替で「制限: 制限なし」と重ならないように頭を落とす */
  const shortLimit = (label: string) => label.replace(/^制限/, '')
  const timeLimitLabel = shortLimit(
    TIME_LIMIT_CHOICES.find((c) => c.value === timeLimitMs)?.label ?? TIME_LIMIT_CHOICES[0].label,
  )

  const start = () => {
    if (blocked) return
    navigate(quizPath(buildSetId(DATA_VERSION, mode, scope, randomSeed())))
  }

  /**
   * 「今日の10問」は **いま選んでいる範囲・科目** で日付シードのセットを作る。
   * 以前は全国 easy 固定だったので「東京都を選んだのに山梨県が出た」と見える不具合報告になった。
   * 全国 × difficult だけは母集団を組めないので easy に落とす。
   */
  const todayMode: Mode = blocked ? 'e' : mode
  const startToday = () => {
    navigate(quizPath(buildSetId(DATA_VERSION, todayMode, scope, todaySeed())))
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
        onNationwide={() => {
          setScope(SCOPE_NATIONWIDE)
          setQuery('')
        }}
        onSelect={(prefCode) => {
          setScope(prefCode)
          setQuery('')
        }}
      />

      <label className="field">
        <span className="field__label">市区町村で絞る</span>
        <input
          className="field__input"
          type="text"
          value={query}
          placeholder="例: そうさ / 匝瑳"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {candidates.length > 0 && (
        <div className="pref-grid">
          {candidates.map((c) => (
            <button
              key={c.lgCode}
              type="button"
              className={scope === c.lgCode ? 'pref-grid__item is-selected' : 'pref-grid__item'}
              title={c.kana}
              onClick={() => {
                setScope(c.lgCode)
                setQuery('')
              }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

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
          disabled={nationwide}
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

      {/* 普段は出さない。全国のまま difficult が残っている（＝本当に始められない）ときだけ */}
      {blocked && <p>全国 × difficult はこのデモでは選べません。都道府県か市区町村を選んでください。</p>}

      <p>
        <button type="button" className="btn btn--primary" onClick={start} disabled={blocked}>
          始める
        </button>
        <button type="button" className="btn btn--ghost" onClick={startToday}>
          今日の10問（{scopeLabel}・{todayMode === 'e' ? 'easy' : 'difficult'}）
        </button>
      </p>
    </div>
  )
}
