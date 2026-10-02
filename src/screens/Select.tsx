import { useEffect, useMemo, useState } from 'react'
import type { BankMeta, Mode } from '../engine/types.ts'
import { DATA_VERSION, loadMeta } from '../engine/bank.ts'
import { SCOPE_NATIONWIDE, buildSetId, randomSeed, todaySeed } from '../engine/setId.ts'
import { navigate, quizPath } from '../router.ts'

const CANDIDATE_LIMIT = 8

export default function Select() {
  const [meta, setMeta] = useState<BankMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<string>(SCOPE_NATIONWIDE)
  const [mode, setMode] = useState<Mode>('e')
  const [query, setQuery] = useState('')

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

  const scopeLabel = nationwide ? '全国' : (selectedCity?.name ?? selectedPref?.name ?? scope)

  const start = () => {
    if (blocked) return
    navigate(quizPath(buildSetId(DATA_VERSION, mode, scope, randomSeed())))
  }

  const startToday = () => {
    navigate(quizPath(buildSetId(DATA_VERSION, 'e', SCOPE_NATIONWIDE, todaySeed())))
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
          いまの範囲: {scopeLabel} ／ 科目: {mode === 'e' ? 'easy（市区町村名）' : 'difficult（大字・町名）'}
        </p>
      </div>

      <div className="pref-grid">
        <button
          type="button"
          className={nationwide ? 'pref-grid__item is-selected' : 'pref-grid__item'}
          onClick={() => {
            setScope(SCOPE_NATIONWIDE)
            setQuery('')
          }}
        >
          全国
        </button>
        {meta.prefectures.map((p) => (
          <button
            key={p.code}
            type="button"
            className={scope === p.code ? 'pref-grid__item is-selected' : 'pref-grid__item'}
            onClick={() => {
              setScope(p.code)
              setQuery('')
            }}
          >
            {p.name}
          </button>
        ))}
      </div>

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
          onClick={() => setMode('e')}
        >
          easy（市区町村名）
        </button>
        <button
          type="button"
          className={mode === 'd' ? 'mode-switch__item is-selected' : 'mode-switch__item'}
          onClick={() => setMode('d')}
          disabled={nationwide}
        >
          difficult（市区町村名 ＋ 大字・町名）
        </button>
      </div>

      {nationwide && <p>全国 × difficult はこのデモでは選べません。都道府県か市区町村を選んでください。</p>}

      <p>
        <button type="button" className="btn btn--primary" onClick={start} disabled={blocked}>
          始める
        </button>
        <button type="button" className="btn btn--ghost" onClick={startToday}>
          今日の10問
        </button>
      </p>
    </div>
  )
}
