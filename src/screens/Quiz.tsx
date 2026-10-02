import { useEffect, useMemo, useRef, useState } from 'react'
import type { AnswerRecord, Question, QuestionSet } from '../engine/types.ts'
import { QUESTIONS_PER_SET, UNLIMITED_MAX_MS } from '../engine/types.ts'
import { buildQuestionSet } from '../engine/bank.ts'
import { grade } from '../engine/grading.ts'
import { SCOPE_NATIONWIDE, parseSetId } from '../engine/setId.ts'
import { readNickname } from '../hooks/useNickname.ts'
import { answerSheetKey, writeAnswerSheet } from '../hooks/answerSheet.ts'
import { readTimeLimit, writeQuizTimeLimit } from '../hooks/useTimeLimit.ts'
import { COVER_PATH, SELECT_PATH, navigate, resultPath } from '../router.ts'
import MunicipalityMap from '../components/MunicipalityMap.tsx'
import MunicipalityInfo from '../components/MunicipalityInfo.tsx'
import HiraganaInput from '../components/HiraganaInput.tsx'

const KANJI_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
const FEEDBACK_MS = 1000
const URGENT_MS = 5000

function kanjiNumber(n: number): string {
  return KANJI_NUM[n - 1] ?? String(n)
}

function rangeLabel(set: QuestionSet): string {
  if (set.scope === SCOPE_NATIONWIDE) return '全国'
  const first = set.questions[0]
  if (!first) return set.scope
  if (set.widened || set.scope.length === 2) return first.pref
  return first.city ?? first.pref
}

/** 添え書き。difficult は常に所属自治体、easy は全国のときだけ都道府県 */
function prefNote(set: QuestionSet, q: Question): string | null {
  if (set.mode === 'd') return q.city ?? q.pref
  if (set.scope === SCOPE_NATIONWIDE) return q.pref
  return null
}

interface Feedback {
  correct: boolean
  answer: string
}

export default function Quiz({ setId }: { setId: string }) {
  const parsed = useMemo(() => parseSetId(setId), [setId])
  const [set, setSet] = useState<QuestionSet | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [input, setInput] = useState('')
  const [records, setRecords] = useState<AnswerRecord[]>([])
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  /** その回の時間制限。0 ＝ 制限なし。出題中に設定を変えても揺れないよう 1 度だけ読む */
  const timeLimitMs = useMemo(() => readTimeLimit(), [])
  const limited = timeLimitMs > 0
  const [remainMs, setRemainMs] = useState(timeLimitMs)
  /** 「タイトルへ戻る」を押した後。タイマーと結果への自動遷移を止めるだけのフラグ */
  const [exiting, setExiting] = useState(false)
  const startedAt = useRef(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const nickname = readNickname()

  const error = parsed ? loadError : `セットIDが読めません: ${setId}`

  // 問題セットの読み込み（setId から決定論的に再現する）。App 側で key={setId} なので setId は不変
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

  const total = set?.questions.length ?? QUESTIONS_PER_SET
  const question = set && index < total ? set.questions[index] : undefined

  // 問ごとの計測開始。制限ありのときだけカウントダウンし、0 で自動パスする
  useEffect(() => {
    if (!question || feedback || exiting) return
    startedAt.current = Date.now()
    inputRef.current?.focus()
    if (!limited) return
    const timer = setInterval(() => {
      const left = timeLimitMs - (Date.now() - startedAt.current)
      if (left > 0) {
        setRemainMs(left)
        return
      }
      clearInterval(timer)
      setRemainMs(0)
      setRecords((prev) => [
        ...prev,
        { questionId: question.id, input: '', correct: false, ms: timeLimitMs, passed: true },
      ])
      setFeedback({ correct: false, answer: question.answer })
    }, 100)
    return () => clearInterval(timer)
  }, [question, feedback, exiting, limited, timeLimitMs])

  // ○× を 1 秒見せてから次の問へ
  useEffect(() => {
    if (!feedback) return
    const t = setTimeout(() => {
      setFeedback(null)
      setInput('')
      setRemainMs(timeLimitMs)
      setIndex((i) => i + 1)
    }, FEEDBACK_MS)
    return () => clearTimeout(t)
  }, [feedback, timeLimitMs])

  // 10 問終わったら答案を保存して結果へ
  useEffect(() => {
    if (!set || feedback || exiting) return
    if (index < set.questions.length || records.length < set.questions.length) return
    writeAnswerSheet(set.setId, records)
    // 結果画面が「この回の条件」で ⏳ の印を出せるように控える
    writeQuizTimeLimit(set.setId, timeLimitMs)
    navigate(resultPath(set.setId))
  }, [set, index, records, feedback, exiting, timeLimitMs])

  const answerNow = () => {
    if (!question || feedback) return
    const passed = input.trim() === ''
    const correct = !passed && grade(input, question.answer)
    const elapsed = Math.max(Date.now() - startedAt.current, 0)
    // 制限ありのパスは「使い切った」扱い（時間切れと同じ）。制限なしは実測をそのまま残す
    const ms = limited
      ? passed
        ? timeLimitMs
        : Math.min(elapsed, timeLimitMs)
      : Math.min(elapsed, UNLIMITED_MAX_MS)
    setRecords((prev) => [...prev, { questionId: question.id, input: input.trim(), correct, ms, passed }])
    setFeedback({ correct, answer: question.answer })
  }

  /**
   * 回答中にタイトルへ戻る。進行中の答案は保存せず破棄する（確認ダイアログは出さない）。
   * exiting を立ててからの遷移なので、カウントダウンと結果への自動遷移は先に止まる。
   */
  const backToCover = () => {
    setExiting(true)
    try {
      sessionStorage.removeItem(answerSheetKey(setId))
    } catch {
      // 保存できない環境では消すものも無い
    }
    navigate(COVER_PATH)
  }

  if (error) {
    return (
      <div className="paper">
        <h1 className="paper__title">出題できませんでした</h1>
        <p>{error}</p>
        <p>
          <button type="button" className="btn btn--primary" onClick={() => navigate(SELECT_PATH)}>
            範囲をえらび直す
          </button>
        </p>
      </div>
    )
  }

  if (!set) {
    return (
      <div className="paper">
        <h1 className="paper__title">地名読み検定</h1>
        <p>問題を用意しています…</p>
      </div>
    )
  }

  if (!question) {
    return (
      <div className="paper">
        <h1 className="paper__title">地名読み検定</h1>
        <p>採点しています…</p>
      </div>
    )
  }

  const note = prefNote(set, question)
  const remainPct = limited ? Math.max(0, Math.min(100, (remainMs / timeLimitMs) * 100)) : 100
  const urgent = limited && remainMs <= URGENT_MS

  return (
    <div className="layout">
      {/* 左（スマホでは上）: 県内のどこか ＋ 解答後の自治体情報 */}
      <aside className="layout__map">
        <MunicipalityMap prefCode={question.prefCode} lgCode={question.lgCode} prefName={question.pref} />
        {/* カードは常に置く（中身は解答後だけ）。出入りで全体の高さが動くと 1 画面に収まらなくなる */}
        <MunicipalityInfo
          lgCode={question.lgCode}
          revealed={feedback !== null}
          reading={set.mode === 'e' ? question.answer : undefined}
          prefName={set.scope === SCOPE_NATIONWIDE ? question.pref : undefined}
        />
      </aside>

      <div className="layout__quiz">
        <div className="paper">
          {set.widened && <p className="pen-comment">範囲が狭いため都道府県に広げました</p>}

          <div className="paper__header">
            <span>範囲: {rangeLabel(set)}</span>
            <span>科目: {set.mode === 'e' ? 'easy（市区町村名）' : 'difficult（大字・町名）'}</span>
            <span>制限: {limited ? `${Math.round(timeLimitMs / 1000)}秒` : 'なし'}</span>
            <span className="field">
              <span className="field__label">氏名</span>
              <span className="field__input">{nickname || '名無し'}</span>
            </span>
            {/* 解答欄・解答ボタンから離れた用紙の右上。押すと答案を捨てて表紙へ */}
            <span className="layout__exit">
              <button type="button" className="btn btn--ghost" onClick={backToCover}>
                タイトルへ戻る
              </button>
            </span>
          </div>

          <div className="q-number">
            問{kanjiNumber(index + 1)} / {kanjiNumber(set.questions.length)}
          </div>
          <p className="q-prompt">次の地名の読みを書け。</p>

          {/* .q-suffix の font-size は .q-kanji 基準（0.42em）なので .q-kanji の中に置く */}
          <p className="q-kanji">
            {question.display}
            {set.mode === 'e' && question.suffix && <span className="q-suffix">［{question.suffix}］</span>}
          </p>
          {note && <div className="q-pref">{note}</div>}

          {/* 入るのはひらがなだけ。ローマ字で打っても IME の変換は不要（HiraganaInput が正規化する） */}
          <HiraganaInput
            ref={inputRef}
            value={input}
            onChange={setInput}
            onSubmit={answerNow}
            disabled={feedback !== null}
            autoFocus
            placeholder="ひらがなで"
            ariaLabel="読みをひらがなで入力"
          />

          {/* 丸バツと正解は入力欄の直下に出す（用紙の底に置くと欠ける） */}
          {feedback && (
            <p className="q-feedback">
              <span className={feedback.correct ? 'mark mark--correct' : 'mark mark--wrong'} aria-hidden="true">
                {feedback.correct ? '○' : '×'}
              </span>
              <span className="sr-only">{feedback.correct ? '正解' : '誤り'}</span>{' '}
              <span className="marker marker--yellow">{feedback.answer}</span>
            </p>
          )}

          {limited ? (
            <>
              <div className={urgent ? 'timer__label is-urgent' : 'timer__label'}>
                <span aria-hidden="true">⏳</span>
                <span>のこり {Math.ceil(remainMs / 1000)} 秒</span>
              </div>
              <div className={urgent ? 'timer is-urgent' : 'timer'}>
                <span className="timer__bar" style={{ width: `${remainPct}%` }} />
              </div>
            </>
          ) : (
            <p className="q-note">時間制限なし</p>
          )}

          <p>
            <button type="button" className="btn btn--primary" onClick={answerNow} disabled={feedback !== null}>
              解答
            </button>
          </p>
          <p className="q-note">空欄のまま解答するとパスになります。</p>

        </div>
      </div>
    </div>
  )
}
