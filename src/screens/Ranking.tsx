/**
 * これまでのランキング。
 *
 * - `#/ranking` … 区分（市区町村名 / 市区町村名＋町名 / 全問）ごとに、都道府県の回答人数を一覧で見せる
 * - `#/ranking/{prefCode}` … その都道府県・その区分の上位 30 件
 *
 * 区分は 3 つ。10 問の 2 科目と、全問（全市区町村名・全町名。問題数が範囲ごとに違い、
 * 得点は正答率）は 1 問の重みが違うので同じ一覧に混ぜない。どちらの「全問」なのかは
 * 行の注記（engine/score.ts の allRowNote）で見分ける。全国（scope '00'）に全問は無い。
 *
 * 地図は置かない（範囲選択の主役なので、ここでは一覧だけにする）。
 * 区分は localStorage（useRankingMode）でトップと詳細を引き継ぐ。
 * 絞り込みはストア側（Remote なら API の `?mode=`）で行うので、画面は受け取った順に並べるだけ。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BankMeta, PrefectureStat, RankingMode, RankingRow } from '../engine/types.ts'
import { ALL_RANKING_MODE } from '../engine/types.ts'
import { RANKING_MODES, RANKING_MODE_LABELS, rankingModeName } from '../engine/modes.ts'
import { allSetName, isAllRow, rowCounts, starsOfRow } from '../engine/score.ts'
import { starsRowNote } from '../engine/stars.ts'
import { loadMeta } from '../engine/bank.ts'
import { scopeLabel } from '../engine/scope.ts'
import { SCOPE_NATIONWIDE } from '../engine/setId.ts'
import { defaultRankingStore } from '../engine/ranking-factory.ts'
import { connectionMessage } from '../hooks/connection.ts'
import { useRankingMode } from '../hooks/useRankingMode.ts'
import PaperSkeleton from '../components/PaperSkeleton.tsx'
import { RANKING_PATH, SELECT_PATH, navigate, quizPath, rankingPrefPath } from '../router.ts'

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

/**
 * その区分の件数・人数。byMode が無い古いデータは合計で代用するが、
 * 全問（全市区町村名・全町名）は登録できるようになる前のデータに存在しないので 0 件とする。
 */
function countOf(stat: PrefectureStat | undefined, mode: RankingMode): { entries: number; players: number } {
  if (!stat) return { entries: 0, players: 0 }
  const hit = stat.byMode?.[mode]
  if (hit) return hit
  if (mode === ALL_RANKING_MODE) return { entries: 0, players: 0 }
  return { entries: stat.entries, players: stat.players }
}

export default function Ranking({ prefCode }: { prefCode?: string } = {}) {
  const [mode, setMode] = useRankingMode()
  const [meta, setMeta] = useState<BankMeta | null>(null)
  const [stats, setStats] = useState<PrefectureStat[] | null>(null)
  const [rows, setRows] = useState<RankingRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** 「もう一度ためす」を押した回数。増やすと下の useEffect が取り直す */
  const [attempt, setAttempt] = useState(0)

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

  // ランキング本体。詳細は科目が変わるたびに取り直す（絞り込みはストア側の仕事）。
  // attempt が増えると「もう一度ためす」としてもう一度同じ取得を走らせる
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
        setError(connectionMessage())
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [prefCode, mode, attempt])

  const retry = useCallback(() => {
    setLoading(true)
    setError(null)
    setAttempt((n) => n + 1)
  }, [])

  /** 失敗の表示。原因の 1 行と「もう一度ためす」をひと組で出す */
  const errorBlock = error !== null && (
    <>
      <p className="pen-comment">{error}</p>
      <p>
        <button type="button" className="btn" onClick={retry}>
          もう一度ためす
        </button>
      </p>
    </>
  )

  const statOf = useMemo(() => new Map((stats ?? []).map((s) => [s.prefCode, s])), [stats])
  const cityName = useMemo(() => new Map((meta?.cities ?? []).map((c) => [c.lgCode, c.name])), [meta])
  const prefName = useMemo(() => new Map((meta?.prefectures ?? []).map((p) => [p.code, p.name])), [meta])

  /** '00' → 全国 ／ 2 桁 → 都道府県名 ／ 3 文字 → 「東京都・多摩」 ／ 6 桁 → 市区町村名 */
  const labelOfScope = (scope: string | undefined): string =>
    scopeLabel(
      scope,
      (code) => prefName.get(code),
      (lgCode) => cityName.get(lgCode),
    )

  const titleOf = (code: string): string =>
    code === SCOPE_NATIONWIDE ? '全国' : (prefName.get(code) ?? `都道府県 ${code}`)

  /** 全国（scope '00'）の一覧。全問は都道府県・市区町村ごとの出題なので区分として出さない */
  const nationwideOnly = prefCode === SCOPE_NATIONWIDE

  /** 区分の切替（市区町村名 / 市区町村名＋町名 / 全問）。トップと詳細で同じものを出す */
  const modeSwitch = (
    <div className="mode-switch">
      {RANKING_MODES.map((m) => (
        <button
          key={m}
          type="button"
          className={mode === m ? 'mode-switch__item is-selected' : 'mode-switch__item'}
          aria-pressed={mode === m}
          aria-label={RANKING_MODE_LABELS[m].name}
          disabled={nationwideOnly && m === ALL_RANKING_MODE}
          onClick={() => setMode(m)}
        >
          {/* 狭い画面では短いほうを見せる（3 つ並ぶので 1 行に収める）。切り替えは CSS 側 */}
          <span className="mode-switch__full" aria-hidden="true">
            {RANKING_MODE_LABELS[m].name}
          </span>
          <span className="mode-switch__abbr" aria-hidden="true">
            {RANKING_MODE_LABELS[m].short}
          </span>
        </button>
      ))}
    </div>
  )

  /** 用紙の底。同じ画面の中の移動（都道府県の一覧へ）と次の行動だけを残す（第 3 波 D1）*/
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
            {rankingModeName(mode)} ／ 上位 {PREF_LIMIT} 件まで ／ 得点の高い順（同点なら所要時間の短い順）
          </p>
        </div>

        {modeSwitch}

        {loading && <PaperSkeleton lines={5} />}
        {errorBlock}

        {!loading && !error && shown.length === 0 && <p>まだ登録がありません。</p>}

        {shown.length > 0 && (
          <ol className="ranking">
            {shown.map((r, i) => {
              const rowStars = starsOfRow(r)
              return (
                <li className="ranking__row" key={r.entryId}>
                  <span className="ranking__rank">{i + 1}</span>
                  <span className="ranking__name">{r.nickname}</span>
                  <span className="ranking__score">
                    {/* 全問は問題数が範囲ごとに違うので、正解数と問題数も見せる */}
                    {isAllRow(r) && r.total !== undefined && (
                      <span className="q-suffix">正解 {rowCounts(r).correct} / {r.total} 問・</span>
                    )}
                    {r.score}点
                    {/* 難易度で区分を分けない代わりに、絞ったセットの行にだけ「★★★のみ」と添える */}
                    {rowStars !== null && <span className="q-suffix">［{starsRowNote(rowStars)}］</span>}
                  </span>
                  <span className="ranking__time">
                    {formatDuration(r.timeMs)}
                    {r.timeLimitMs !== undefined && r.timeLimitMs > 0 && (
                      <>
                        {' '}
                        <span title="1 問あたりの制限つき">⏳{Math.round(r.timeLimitMs / 1000)}秒</span>
                      </>
                    )}
                  </span>
                  {/* 4 列グリッドの 2 行目として全幅に置く（科目・範囲・登録日・挑戦リンク）。
                      区分「全問」は全市区町村名と全町名が同居するので、ここでは
                      どちらなのかが分かる名前を出す（engine/score.ts の allSetName） */}
                  <span className="q-pref" style={{ gridColumn: '1 / -1', margin: 0 }}>
                    {isAllRow(r) ? allSetName(r.mode ?? 'e') : r.mode === undefined ? '—' : rankingModeName(r.mode)}{' '}
                    ／ {labelOfScope(r.scope)} ／{' '}
                    {formatDate(r.createdAt)}{' '}
                    <a className="btn btn--ghost" href={quizPath(r.setId)}>
                      この問題に挑戦
                    </a>
                  </span>
                </li>
              )
            })}
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
          aria-label={`${titleOf(code)} ${count.players}人が回答（${rankingModeName(mode)}）`}
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
          {rankingModeName(mode)} ／ 登録 {totalEntries} 件 ／ 都道府県をえらぶと上位 {PREF_LIMIT} 件が見られる
        </p>
      </div>

      {modeSwitch}

      {loading && <PaperSkeleton lines={5} />}
      {errorBlock}

      {!loading && !error && (
        <ol className="pref-grid">
          <li>
            <button
              type="button"
              className="pref-grid__item"
              disabled={nationwide.entries === 0}
              aria-label={`全国 ${nationwide.players}人が回答（${rankingModeName(mode)}）`}
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
