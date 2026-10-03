import { useCallback, useEffect, useMemo, useState } from 'react'
import type { QuestionSet, RankingRow } from '../engine/types.ts'
import { buildQuestionSet, defaultSource } from '../engine/bank.ts'
import { rangeLabelOf } from '../engine/scope.ts'
import { parseSetId } from '../engine/setId.ts'
import { defaultStorage, getClientToken, isValidNickname, provisionalRank } from '../engine/ranking.ts'
import { defaultRankingStore, isRemoteRanking } from '../engine/ranking-factory.ts'
import { appendWrongFromEntry } from '../engine/wrongList.ts'
import { readNickname } from '../hooks/useNickname.ts'
import { readAnswerSheet } from '../hooks/answerSheet.ts'
import { readQuizTimeLimit, readTimeLimit } from '../hooks/useTimeLimit.ts'
import { COVER_PATH, REVIEW_PATH, SELECT_PATH, absoluteUrl, navigate, quizPath } from '../router.ts'

const KANJI_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
const RANKING_LIMIT = 20

/** 問番号。10 問までは漢数字、全市区町村名のように多いときは算用数字（Quiz と同じ） */
function questionNumber(n: number, total: number): string {
  if (total > KANJI_NUM.length) return String(n)
  return KANJI_NUM[n - 1] ?? String(n)
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}分${String(total % 60).padStart(2, '0')}秒`
}

/**
 * seed が 8 桁（`YYYYMMDD`）なら「今日の10問」のセット。`YYYY-MM-DD` に整形して返す。
 * それ以外（4 桁の乱数など）は null。月日の体裁が崩れている 8 桁も日付扱いしない。
 */
function dateFromSeed(seed: string): string | null {
  if (seed.length !== 8) return null
  const month = Number(seed.slice(4, 6))
  const day = Number(seed.slice(6, 8))
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${seed.slice(0, 4)}-${seed.slice(4, 6)}-${seed.slice(6, 8)}`
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
  /** 未登録のときの仮の順位。capped ＝ 上位 RANKING_LIMIT 件の外なので「以下」と濁す */
  const [provisional, setProvisional] = useState<{ rank: number; capped: boolean } | null>(null)
  const [loadingRanking, setLoadingRanking] = useState(false)
  const [rankingError, setRankingError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const clientToken = useMemo(() => getClientToken(), [])
  const nickname = readNickname()
  /** この回に使った時間制限。出題時の控えが無ければ今の設定で代用する */
  const timeLimitMs = useMemo(() => readQuizTimeLimit(setId) ?? readTimeLimit(), [setId])

  const error = parsed ? loadError : `セットIDが読めません: ${setId}`
  /** 全市区町村名（練習）。順位表には載せず、得点は正答率で出す */
  const practice = parsed?.all === true
  const total = records?.length ?? 0
  const correct = useMemo(() => (records ?? []).filter((r) => r.correct).length, [records])
  /** 10 問なら正答数 × 10。全市区町村名は問題数が県ごとに違うので 100 点満点の正答率 */
  const score = useMemo(
    () => (practice ? (total === 0 ? 0 : Math.round((correct / total) * 100)) : correct * 10),
    [practice, correct, total],
  )
  const timeMs = useMemo(() => (records ?? []).reduce((sum, r) => sum + r.ms, 0), [records])

  /** 「今日の10問」（seed が日付）なら見出しに日付を出す */
  const rankingTitle = useMemo(() => {
    const date = parsed === null ? null : dateFromSeed(parsed.seed)
    return date === null ? 'この問題の順位表' : `今日の10問（${date}）の順位表`
  }, [parsed])

  // 答案が無ければ範囲選択へ戻す
  useEffect(() => {
    if (records === null) navigate(SELECT_PATH)
  }, [records])

  // 出題は setId から再現できるので、見直し用にもう一度組み立てる
  useEffect(() => {
    if (!parsed) return
    let alive = true
    buildQuestionSet(parsed.mode, parsed.scope, parsed.seed, defaultSource(), parsed.all)
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
        if (entryId === null) {
          // 未登録。いまの得点・時間ならどこに入るかを示す（同点・同時間なら後から来る自分が下）
          const rank = provisionalRank(rows, { score, timeMs, createdAt: new Date().toISOString() }, RANKING_LIMIT)
          setProvisional({ rank, capped: rows.length >= RANKING_LIMIT && rank > rows.length })
        } else {
          setProvisional(null)
        }
      } catch {
        if (!alive()) return
        setRankingError('ランキングに接続できませんでした。')
      } finally {
        if (alive()) setLoadingRanking(false)
      }
    },
    [setId, score, timeMs],
  )

  // 登録の有無にかかわらず、画面を開いた時点で順位表を出す。
  // 未登録なら「登録すると N 位」を示し、登録を迷っている人も比べられるようにする。
  // 全市区町村名（練習）は順位表の対象外なので取りに行かない
  useEffect(() => {
    if (!parsed || records === null || parsed.all) return
    const saved = storage.getItem(submittedKey(setId))
    let alive = true
    void (async () => {
      if (saved !== null) setNotice('この問題にはすでに登録済みです。')
      await loadRanking(saved, () => alive)
    })()
    return () => {
      alive = false
    }
  }, [setId, parsed, records, loadRanking])

  const register = async () => {
    if (!records || registered || submitting || practice) return
    if (!isValidNickname(nickname)) {
      setNotice('氏名（ニックネーム）が未記入です。表紙で記入してください。')
      return
    }
    setSubmitting(true)
    const entry = {
      setId,
      nickname,
      score,
      timeMs,
      answers: records,
      clientToken,
      createdAt: new Date().toISOString(),
      timeLimitMs,
    }
    const res = await store.submit(entry)
    setSubmitting(false)
    if (res.ok) {
      storage.setItem(submittedKey(setId), res.entryId)
      setMyEntryId(res.entryId)
      setRegistered(true)
      // 「間違えた問題」は登録した答案だけ記録する（練習の回は残さない）
      if (set) appendWrongFromEntry(set, { ...entry, entryId: res.entryId })
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
        <span className="paper__subtitle">
          {/* 範囲は出題を組み直せたときだけ（セットが読めない経路でも帯が崩れないように） */}
          {set && `範囲 ${rangeLabelOf(set)} ／ `}正解 {correct} / {total} 問 ／ 所要時間 {formatDuration(timeMs)} ／ 制限{' '}
          {timeLimitMs > 0 ? `${Math.round(timeLimitMs / 1000)}秒` : 'なし'}
        </span>
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
                  問{questionNumber(i + 1, records.length)}は{r.correct ? '正解' : '誤り'}。出題{' '}
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
      {practice && <p className="pen-comment">全市区町村名は練習なので、順位表には載りません。</p>}

      <p>
        {!practice && (
          <button
            type="button"
            className="btn btn--primary"
            disabled={registered || submitting}
            onClick={() => void register()}
          >
            ランキングに登録
          </button>
        )}
        <button type="button" className="btn" onClick={() => void share()}>
          この問題で挑ませる
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => navigate(SELECT_PATH)}>
          もう一度（別の問題）
        </button>
        {registered && (
          <button type="button" className="btn btn--ghost" onClick={() => navigate(REVIEW_PATH)}>
            間違えた問題を見る
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={() => navigate(COVER_PATH)}>
          タイトルへ戻る
        </button>
      </p>

      {remote && loadingRanking && <p className="pen-comment">順位表を読み込んでいます…</p>}
      {rankingError && <p className="pen-comment">{rankingError}</p>}

      {entries && (
        <>
          <h3 className="paper__section">
            {rankingTitle}
            {myRank !== null && <> ／ あなたは {myRank} 位</>}
          </h3>
          {!registered && provisional !== null && (
            <p className="pen-comment">
              登録すると {provisional.rank} 位{provisional.capped && '以下'}です。
            </p>
          )}
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
                    <span className="ranking__time">
                      {formatDuration(e.timeMs)}
                      {e.timeLimitMs !== undefined && e.timeLimitMs > 0 && (
                        <>
                          {' '}
                          <span title="1 問あたりの制限つき">⏳{Math.round(e.timeLimitMs / 1000)}秒</span>
                        </>
                      )}
                    </span>
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
