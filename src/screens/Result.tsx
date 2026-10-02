import { useCallback, useEffect, useMemo, useState } from 'react'
import type { QuestionSet, RankingRow } from '../engine/types.ts'
import { buildQuestionSet } from '../engine/bank.ts'
import { parseSetId } from '../engine/setId.ts'
import { defaultStorage, getClientToken, isValidNickname } from '../engine/ranking.ts'
import { defaultRankingStore, isRemoteRanking } from '../engine/ranking-factory.ts'
import { readNickname } from '../hooks/useNickname.ts'
import { readAnswerSheet } from '../hooks/answerSheet.ts'
import { COVER_PATH, SELECT_PATH, absoluteUrl, navigate, quizPath } from '../router.ts'

const KANJI_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
const RANKING_LIMIT = 20

function kanjiNumber(n: number): string {
  return KANJI_NUM[n - 1] ?? String(n)
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}分${String(total % 60).padStart(2, '0')}秒`
}

// VITE_RANKING_API があれば共有ランキング（Remote）、無ければ端末内（Local）
const store = defaultRankingStore()
const remote = isRemoteRanking()
const storage = defaultStorage()

/** 登録済みのしるし。値は自分の entryId（一覧の自分の行を見分けるのに使う） */
function submittedKey(setId: string): string {
  return `submitted:${setId}`
}

export default function Result({ setId }: { setId: string }) {
  const parsed = useMemo(() => parseSetId(setId), [setId])
  const [records] = useState(() => readAnswerSheet(setId))
  const [set, setSet] = useState<QuestionSet | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [entries, setEntries] = useState<RankingRow[] | null>(null)
  const [myEntryId, setMyEntryId] = useState<string | null>(() => storage.getItem(submittedKey(setId)))
  const [registered, setRegistered] = useState(() => storage.getItem(submittedKey(setId)) !== null)
  const [myRank, setMyRank] = useState<number | null>(null)
  const [loadingRanking, setLoadingRanking] = useState(false)
  const [rankingError, setRankingError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const clientToken = useMemo(() => getClientToken(), [])
  const nickname = readNickname()

  const error = parsed ? loadError : `セットIDが読めません: ${setId}`
  const score = useMemo(() => (records ?? []).filter((r) => r.correct).length * 10, [records])
  const timeMs = useMemo(() => (records ?? []).reduce((sum, r) => sum + r.ms, 0), [records])

  // 答案が無ければ範囲選択へ戻す
  useEffect(() => {
    if (records === null) navigate(SELECT_PATH)
  }, [records])

  // 出題は setId から再現できるので、見直し用にもう一度組み立てる
  useEffect(() => {
    if (!parsed) return
    let alive = true
    buildQuestionSet(parsed.mode, parsed.scope, parsed.seed)
      .then((s) => {
        if (alive) setSet(s)
      })
      .catch((e: unknown) => {
        if (alive) setLoadError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [parsed])

  /** 順位表を取り直す。自分の行は entryId で見分ける（clientToken は一覧に出てこない） */
  const loadRanking = useCallback(
    async (entryId: string | null, alive: () => boolean = () => true): Promise<void> => {
      setLoadingRanking(true)
      setRankingError(null)
      try {
        const rows = await store.list(setId, RANKING_LIMIT)
        if (!alive()) return
        setEntries(rows)
        const i = entryId === null ? -1 : rows.findIndex((r) => r.entryId === entryId)
        setMyRank(i < 0 ? null : i + 1)
      } catch {
        if (!alive()) return
        setRankingError('ランキングに接続できませんでした。')
      } finally {
        if (alive()) setLoadingRanking(false)
      }
    },
    [setId],
  )

  // 既に登録済み（localStorage に entryId がある）なら最初から順位表を出す
  useEffect(() => {
    const saved = storage.getItem(submittedKey(setId))
    if (saved === null) return
    let alive = true
    void (async () => {
      setNotice('この問題にはすでに登録済みです。')
      await loadRanking(saved, () => alive)
    })()
    return () => {
      alive = false
    }
  }, [setId, loadRanking])

  const register = async () => {
    if (!records || registered || submitting) return
    if (!isValidNickname(nickname)) {
      setNotice('氏名（ニックネーム）が未記入です。表紙で記入してください。')
      return
    }
    setSubmitting(true)
    const res = await store.submit({
      setId,
      nickname,
      score,
      timeMs,
      answers: records,
      clientToken,
      createdAt: new Date().toISOString(),
    })
    setSubmitting(false)
    if (res.ok) {
      storage.setItem(submittedKey(setId), res.entryId)
      setMyEntryId(res.entryId)
      setRegistered(true)
      setNotice(`${res.rank} 位で登録しました。`)
      await loadRanking(res.entryId)
      return
    }
    if (res.reason === 'already_submitted') {
      setRegistered(true)
      setNotice('この問題にはすでに登録済みです。')
      await loadRanking(myEntryId)
      return
    }
    if (res.reason === 'network') {
      setNotice('ランキングに接続できませんでした。しばらくして試してください。')
      return
    }
    setNotice('氏名が 1〜12 文字ではありません。')
  }

  const share = async () => {
    const url = absoluteUrl(quizPath(setId))
    try {
      await navigator.clipboard.writeText(url)
      setNotice('この問題の URL をコピーしました。')
      setShareUrl(null)
    } catch {
      setNotice('コピーできませんでした。この URL を共有してください。')
      setShareUrl(url)
    }
  }

  if (error) {
    return (
      <div className="paper">
        <h1 className="paper__title">結果</h1>
        <p>{error}</p>
        <p>
          <button type="button" className="btn btn--primary" onClick={() => navigate(SELECT_PATH)}>
            範囲をえらび直す
          </button>
        </p>
      </div>
    )
  }

  if (!records) {
    return (
      <div className="paper">
        <h1 className="paper__title">結果</h1>
        <p>答案が見つかりませんでした。範囲選択へ戻ります。</p>
      </div>
    )
  }

  return (
    <div className="paper">
      <div className="paper__header">
        <h1 className="paper__title">答案</h1>
        <span className="field">
          <span className="field__label">氏名</span>
          <span className="field__input">{nickname || '名無し'}</span>
        </span>
        <span className="paper__subtitle">所要時間 {formatDuration(timeMs)}</span>
      </div>

      <p className="stamp">
        <span className="stamp__num">{score}</span>
        <span className="stamp__label">点</span>
      </p>

      <h3 className="paper__section">答案の見直し</h3>

      {/* .review__row は ○× | 出題 | 自分の解答 | 正解 の 4 列グリッド */}
      <ol className="review">
        {records.map((r, i) => {
          const q = set?.questions[i]
          const suffix = set?.mode === 'e' ? (q?.suffix ?? '') : ''
          return (
            <li className="review__row" key={`${r.questionId}-${i}`}>
              <span className={r.correct ? 'mark mark--correct' : 'mark mark--wrong'} aria-hidden="true">
                {r.correct ? '○' : '×'}
              </span>
              <span className="review__q">
                <span className="sr-only">
                  問{kanjiNumber(i + 1)}は{r.correct ? '正解' : '誤り'}。出題{' '}
                </span>
                {q?.display ?? r.questionId}
                {suffix && <span className="q-suffix">［{suffix}］</span>}
              </span>
              <span className="review__mine">{r.input === '' ? '（無記入）' : r.input}</span>
              <span className="review__answer">{q?.answer ?? '—'}</span>
            </li>
          )
        })}
      </ol>

      {notice && <p className="pen-comment">{notice}</p>}
      {shareUrl && <p className="review__mine">{shareUrl}</p>}

      <p>
        <button
          type="button"
          className="btn btn--primary"
          disabled={registered || submitting}
          onClick={() => void register()}
        >
          ランキングに登録
        </button>
        <button type="button" className="btn" onClick={() => void share()}>
          この問題で挑ませる
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => navigate(SELECT_PATH)}>
          もう一度（別の問題）
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => navigate(COVER_PATH)}>
          タイトルへ戻る
        </button>
      </p>

      {remote && loadingRanking && <p className="pen-comment">順位表を読み込んでいます…</p>}
      {rankingError && <p className="pen-comment">{rankingError}</p>}

      {entries && (
        <>
          <h3 className="paper__section">この問題の順位表{myRank !== null && <> ／ あなたは {myRank} 位</>}</h3>
          {entries.length === 0 ? (
            <p>まだ登録がありません。</p>
          ) : (
            <ol className="ranking">
              {entries.map((e, i) => {
                const me = e.entryId === myEntryId
                return (
                  <li className={me ? 'ranking__row is-me' : 'ranking__row'} key={e.entryId}>
                    <span className="ranking__rank">
                      {me && <span aria-hidden="true">★</span>}
                      {i + 1}
                    </span>
                    <span className="ranking__name">
                      {e.nickname}
                      {me && <span className="sr-only">（あなた）</span>}
                    </span>
                    <span className="ranking__score">{e.score}点</span>
                    <span className="ranking__time">{formatDuration(e.timeMs)}</span>
                  </li>
                )
              })}
            </ol>
          )}
        </>
      )}
    </div>
  )
}
