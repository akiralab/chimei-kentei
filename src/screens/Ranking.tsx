/**
 * これまでのランキング。
 *
 * - `#/ranking` … 科目（easy / difficult）ごとに、都道府県の回答人数を一覧で見せる
 * - `#/ranking/{prefCode}` … その都道府県・その科目の上位 30 件
 *
 * 地図は置かない（範囲選択の主役なので、ここでは一覧だけにする）。
 * 科目は localStorage（useRankingMode）でトップと詳細を引き継ぐ。
 * 絞り込みはストア側（Remote なら API の `?mode=`）で行うので、画面は受け取った順に並べるだけ。
 */
import { useEffect, useMemo, useState } from 'react'
import type { BankMeta, Mode, PrefectureStat, RankingRow } from '../engine/types.ts'
import { loadMeta } from '../engine/bank.ts'
import { SCOPE_NATIONWIDE } from '../engine/setId.ts'
import { defaultRankingStore } from '../engine/ranking-factory.ts'
import { useRankingMode } from '../hooks/useRankingMode.ts'
import { COVER_PATH, RANKING_PATH, SELECT_PATH, navigate, quizPath, rankingPrefPath } from '../router.ts'

/** 都道府県の詳細で一度に見せる件数 */
const PREF_LIMIT = 30

const store = defaultRankingStore()

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}分${String(total % 60).padStart(2, '0')}秒`
}

/** ISO 8601 → 'YYYY-MM-DD'（ローカル時刻） */
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, '0')}`
}

function modeName(mode: Mode): string {
  return mode === 'e' ? 'easy' : 'difficult'
}

/** その科目の件数・人数。byMode が無い古いデータは合計で代用する */
function countOf(stat: PrefectureStat | undefined, mode: Mode): { entries: number; players: number } {
  if (!stat) return { entries: 0, players: 0 }
  return stat.byMode?.[mode] ?? { entries: stat.entries, players: stat.players }
}

export default function Ranking({ prefCode }: { prefCode?: string } = {}) {
  const [mode, setMode] = useRankingMode()
  const [meta, setMeta] = useState<BankMeta | null>(null)
  const [stats, setStats] = useState<PrefectureStat[] | null>(null)
  const [rows, setRows] = useState<RankingRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 都道府県名・市区町村名の引き当てに使う
  useEffect(() => {
    let alive = true
    loadMeta()
      .then((m) => {
        if (alive) setMeta(m)
      })
      .catch(() => {
        // 問題バンクが読めなくてもランキングは数字だけで成立する
      })
    return () => {
      alive = false
    }
  }, [])

  // ランキング本体。詳細は科目が変わるたびに取り直す（絞り込みはストア側の仕事）
  useEffect(() => {
    let alive = true
    const load =
      prefCode === undefined ? store.prefectureStats() : store.listByPrefecture(prefCode, PREF_LIMIT, mode)
    load
      .then((result) => {
        if (!alive) return
        if (prefCode === undefined) setStats(result as PrefectureStat[])
        else setRows(result as RankingRow[])
        setError(null)
        setLoading(false)
      })
      .catch(() => {
        if (!alive) return
        setError('ランキングに接続できませんでした。')
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [prefCode, mode])

  const statOf = useMemo(() => new Map((stats ?? []).map((s) => [s.prefCode, s])), [stats])
  const cityName = useMemo(() => new Map((meta?.cities ?? []).map((c) => [c.lgCode, c.name])), [meta])
  const prefName = useMemo(() => new Map((meta?.prefectures ?? []).map((p) => [p.code, p.name])), [meta])

  /** '00' → 全国 ／ 2 桁 → 都道府県名 ／ 6 桁 → 市区町村名 */
  const scopeLabel = (scope: string | undefined): string => {
    if (scope === undefined) return '—'
    if (scope === SCOPE_NATIONWIDE) return '全国'
    if (scope.length === 2) return prefName.get(scope) ?? scope
    return cityName.get(scope) ?? scope
  }

  const titleOf = (code: string): string =>
    code === SCOPE_NATIONWIDE ? '全国' : (prefName.get(code) ?? `都道府県 ${code}`)

  /** easy / difficult の切替。トップと詳細で同じものを出す */
  const modeSwitch = (
    <div className="mode-switch">
      {(['e', 'd'] as Mode[]).map((m) => (
        <button
          key={m}
          type="button"
          className={mode === m ? 'mode-switch__item is-selected' : 'mode-switch__item'}
          aria-pressed={mode === m}
          onClick={() => setMode(m)}
        >
          {modeName(m)}
        </button>
      ))}
    </div>
  )

  const footer = (
    <p>
      {prefCode !== undefined && (
        <button type="button" className="btn" onClick={() => navigate(RANKING_PATH)}>
          都道府県の一覧へ
        </button>
      )}
      <button type="button" className="btn" onClick={() => navigate(SELECT_PATH)}>
        もう一度（範囲選択へ）
      </button>
      <button type="button" className="btn btn--ghost" onClick={() => navigate(COVER_PATH)}>
        タイトルへ戻る
      </button>
    </p>
  )

  // ------------------------------------------------------ 都道府県の詳細

  if (prefCode !== undefined) {
    const shown = rows ?? []
    return (
      <div className="paper">
        <div className="paper__header">
          <h1 className="paper__title">{titleOf(prefCode)}のランキング</h1>
          <p className="paper__subtitle">
            {modeName(mode)} ／ 上位 {PREF_LIMIT} 件まで ／ 得点の高い順（同点なら所要時間の短い順）
          </p>
        </div>

        {modeSwitch}

        {loading && <p>読み込み中…</p>}
        {error && <p className="pen-comment">{error}</p>}

        {!loading && !error && shown.length === 0 && <p>まだ登録がありません。</p>}

        {shown.length > 0 && (
          <ol className="ranking">
            {shown.map((r, i) => (
              <li className="ranking__row" key={r.entryId}>
                <span className="ranking__rank">{i + 1}</span>
                <span className="ranking__name">{r.nickname}</span>
                <span className="ranking__score">{r.score}点</span>
                <span className="ranking__time">
                  {formatDuration(r.timeMs)}
                  {r.timeLimitMs !== undefined && r.timeLimitMs > 0 && (
                    <>
                      {' '}
                      <span title="1 問あたりの制限つき">⏳{Math.round(r.timeLimitMs / 1000)}秒</span>
                    </>
                  )}
                </span>
                {/* 4 列グリッドの 2 行目として全幅に置く（科目・範囲・登録日・挑戦リンク） */}
                <span className="q-pref" style={{ gridColumn: '1 / -1', margin: 0 }}>
                  {r.mode === undefined ? '—' : modeName(r.mode)} ／ {scopeLabel(r.scope)} ／{' '}
                  {formatDate(r.createdAt)}{' '}
                  <a className="btn btn--ghost" href={quizPath(r.setId)}>
                    この問題に挑戦
                  </a>
                </span>
              </li>
            ))}
          </ol>
        )}

        {footer}
      </div>
    )
  }

  // ------------------------------------------------------ トップ（都道府県ごとの人数）

  const nationwide = countOf(statOf.get(SCOPE_NATIONWIDE), mode)
  const totalEntries = (stats ?? []).reduce((sum, s) => sum + countOf(s, mode).entries, 0)
  // 全国 → 47 都道府県（meta の順。meta が読めないときは実績のある県だけ）
  const listed: string[] = meta
    ? meta.prefectures.map((p) => p.code)
    : (stats ?? []).map((s) => s.prefCode).filter((c) => c !== SCOPE_NATIONWIDE)

  /**
   * 1 県分のボタン。登録がある県はラベルを蛍光マーカーで塗って見分けられるようにする
   * （styles は別担当の持ち物なので、新しい修飾子を作らず既存の .marker を当てる）。
   */
  const prefButton = (code: string) => {
    const count = countOf(statOf.get(code), mode)
    const label = `${titleOf(code)} ${count.entries > 0 ? `${count.players}人` : '—'}`
    return (
      <li key={code}>
        <button
          type="button"
          className="pref-grid__item"
          disabled={count.entries === 0}
          aria-label={`${titleOf(code)} ${count.players}人が回答（${modeName(mode)}）`}
          onClick={() => navigate(rankingPrefPath(code))}
        >
          {count.entries > 0 ? <span className="marker marker--yellow">{label}</span> : label}
        </button>
      </li>
    )
  }

  return (
    <div className="paper">
      <div className="paper__header">
        <h1 className="paper__title">これまでのランキング</h1>
        <p className="paper__subtitle">
          {modeName(mode)} ／ 登録 {totalEntries} 件 ／ 都道府県をえらぶと上位 {PREF_LIMIT} 件が見られる
        </p>
      </div>

      {modeSwitch}

      {loading && <p>読み込み中…</p>}
      {error && <p className="pen-comment">{error}</p>}

      {!loading && !error && (
        <ol className="pref-grid">
          <li>
            <button
              type="button"
              className="pref-grid__item"
              disabled={nationwide.entries === 0}
              aria-label={`全国 ${nationwide.players}人が回答（${modeName(mode)}）`}
              onClick={() => navigate(rankingPrefPath(SCOPE_NATIONWIDE))}
            >
              {nationwide.entries > 0 ? (
                <span className="marker marker--yellow">全国 {nationwide.players}人</span>
              ) : (
                '全国 —'
              )}
            </button>
          </li>
          {listed.map(prefButton)}
        </ol>
      )}

      {footer}
    </div>
  )
}
