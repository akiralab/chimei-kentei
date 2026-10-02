/**
 * これまでのランキング。
 *
 * - `#/ranking` … 都道府県ごとの回答人数（＋全国）。地図か 47 ボタンの一覧から都道府県をえらぶ
 * - `#/ranking/{prefCode}` … その都道府県の上位 30 件。科目（easy / difficult）で絞り込める
 *
 * 保存先は Local（localStorage）か Remote（共有ランキング API）か。
 * どちらでも `RankingStore` の prefectureStats() / listByPrefecture() を呼ぶだけで、画面は同じ。
 */
import { useEffect, useMemo, useState } from 'react'
import type { BankMeta, Mode, PrefectureStat, RankingRow } from '../engine/types.ts'
import { loadMeta } from '../engine/bank.ts'
import { SCOPE_NATIONWIDE } from '../engine/setId.ts'
import { defaultRankingStore } from '../engine/ranking-factory.ts'
import type { PrefectureCollection } from '../geo/load.ts'
import { defaultGeoSource } from '../geo/load.ts'
import JapanMap from '../components/JapanMap.tsx'
import { COVER_PATH, RANKING_PATH, SELECT_PATH, navigate, quizPath, rankingPrefPath } from '../router.ts'

/** 都道府県の詳細で一度に見せる件数 */
const PREF_LIMIT = 30

const store = defaultRankingStore()

/** 科目の絞り込み。'all' は絞り込まない */
type ModeFilter = 'all' | Mode

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

function modeLabel(mode: Mode | undefined): string {
  if (mode === 'e') return 'easy'
  if (mode === 'd') return 'difficult'
  return '—'
}

export default function Ranking({ prefCode }: { prefCode?: string } = {}) {
  const [meta, setMeta] = useState<BankMeta | null>(null)
  const [stats, setStats] = useState<PrefectureStat[] | null>(null)
  const [rows, setRows] = useState<RankingRow[] | null>(null)
  const [japan, setJapan] = useState<PrefectureCollection | null>(null)
  const [mapLoading, setMapLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all')

  // 都道府県名・市区町村名の引き当てに使う（地図が無くても一覧は出せる）
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

  // 地図データ。トップ画面でだけ使う
  useEffect(() => {
    if (prefCode !== undefined) return
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
  }, [prefCode])

  // ランキング本体。Remote だと失敗しうるので必ず error を見せられるようにする
  // 初期状態が loading = true / error = null なので、ここで setState を先打ちしない
  // （App が prefCode を key に渡すため、別の都道府県へ移ると作り直される）
  useEffect(() => {
    let alive = true
    const load = prefCode === undefined ? store.prefectureStats() : store.listByPrefecture(prefCode, PREF_LIMIT)
    load
      .then((result) => {
        if (!alive) return
        if (prefCode === undefined) setStats(result as PrefectureStat[])
        else setRows(result as RankingRow[])
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
  }, [prefCode])

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
    const shown = (rows ?? []).filter((r) => modeFilter === 'all' || r.mode === modeFilter)
    return (
      <div className="paper">
        <div className="paper__header">
          <h1 className="paper__title">{titleOf(prefCode)}のランキング</h1>
          <p className="paper__subtitle">
            上位 {PREF_LIMIT} 件まで ／ 得点の高い順（同点なら所要時間の短い順）
          </p>
        </div>

        <div className="mode-switch">
          {(['all', 'e', 'd'] as ModeFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={modeFilter === f ? 'mode-switch__item is-selected' : 'mode-switch__item'}
              aria-pressed={modeFilter === f}
              onClick={() => setModeFilter(f)}
            >
              {f === 'all' ? 'すべて' : f === 'e' ? 'easy' : 'difficult'}
            </button>
          ))}
        </div>

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
                <span className="ranking__time">{formatDuration(r.timeMs)}</span>
                {/* 4 列グリッドの 2 行目として全幅に置く（科目・範囲・登録日・挑戦リンク） */}
                <span className="q-pref" style={{ gridColumn: '1 / -1', margin: 0 }}>
                  {modeLabel(r.mode)} ／ {scopeLabel(r.scope)} ／ {formatDate(r.createdAt)}{' '}
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

  const nationwide = statOf.get(SCOPE_NATIONWIDE)
  const totalEntries = (stats ?? []).reduce((sum, s) => sum + s.entries, 0)
  // 全国 → 47 都道府県（meta の順。meta が読めないときは実績のある県だけ）
  const listed: string[] = meta
    ? meta.prefectures.map((p) => p.code)
    : (stats ?? []).map((s) => s.prefCode).filter((c) => c !== SCOPE_NATIONWIDE)

  return (
    <div className="paper">
      <div className="paper__header">
        <h1 className="paper__title">これまでのランキング</h1>
        <p className="paper__subtitle">
          登録 {totalEntries} 件 ／ 都道府県をえらぶと上位 {PREF_LIMIT} 件が見られる
        </p>
      </div>

      <div className="jp-map">
        {japan ? (
          <JapanMap collection={japan} onSelect={(code) => navigate(rankingPrefPath(code))} />
        ) : (
          <p className="map-note">
            {mapLoading ? '地図を読み込み中…' : '地図を読み込めませんでした。一覧から選んでください。'}
          </p>
        )}
      </div>

      {loading && <p>読み込み中…</p>}
      {error && <p className="pen-comment">{error}</p>}

      {!loading && !error && (
        <ol className="pref-grid">
          <li>
            <button
              type="button"
              className="pref-grid__item"
              disabled={!nationwide}
              aria-label={`全国 ${nationwide?.players ?? 0}人が回答`}
              onClick={() => navigate(rankingPrefPath(SCOPE_NATIONWIDE))}
            >
              全国 {nationwide ? `${nationwide.players}人` : '—'}
            </button>
          </li>
          {listed.map((code) => {
            const stat = statOf.get(code)
            return (
              <li key={code}>
                <button
                  type="button"
                  className="pref-grid__item"
                  disabled={!stat}
                  aria-label={`${titleOf(code)} ${stat?.players ?? 0}人が回答`}
                  onClick={() => navigate(rankingPrefPath(code))}
                >
                  {titleOf(code)} {stat ? `${stat.players}人` : '—'}
                </button>
              </li>
            )
          })}
        </ol>
      )}

      {footer}
    </div>
  )
}
