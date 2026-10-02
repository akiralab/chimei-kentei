import { useEffect, useMemo, useRef, useState } from 'react'
import type { AnswerRecord, Question, QuestionSet } from '../engine/types.ts'
import { QUESTIONS_PER_SET, TIME_LIMIT_MS } from '../engine/types.ts'
import { buildQuestionSet } from '../engine/bank.ts'
import { grade } from '../engine/grading.ts'
import { SCOPE_NATIONWIDE, parseSetId } from '../engine/setId.ts'
import { readNickname } from '../hooks/useNickname.ts'
import { writeAnswerSheet } from '../hooks/answerSheet.ts'
import { SELECT_PATH, navigate, resultPath } from '../router.ts'

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
  const [remainMs, setRemainMs] = useState(TIME_LIMIT_MS)
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

  // 問ごとのカウントダウン。0 で自動パス
  useEffect(() => {
    if (!question || feedback) return
    startedAt.current = Date.now()
    inputRef.current?.focus()
    const timer = setInterval(() => {
      const left = TIME_LIMIT_MS - (Date.now() - startedAt.current)
      if (left > 0) {
        setRemainMs(left)
        return
      }
      clearInterval(timer)
      setRemainMs(0)
      setRecords((prev) => [
        ...prev,
        { questionId: question.id, input: '', correct: false, ms: TIME_LIMIT_MS, passed: true },
      ])
      setFeedback({ correct: false, answer: question.answer })
    }, 100)
    return () => clearInterval(timer)
  }, [question, feedback])

  // ○× を 1 秒見せてから次の問へ
  useEffect(() => {
    if (!feedback) return
    const t = setTimeout(() => {
      setFeedback(null)
      setInput('')
      setRemainMs(TIME_LIMIT_MS)
      setIndex((i) => i + 1)
    }, FEEDBACK_MS)
    return () => clearTimeout(t)
  }, [feedback])

  // 10 問終わったら答案を保存して結果へ
  useEffect(() => {
    if (!set || feedback) return
    if (index < set.questions.length || records.length < set.questions.length) return
    writeAnswerSheet(set.setId, records)
    navigate(resultPath(set.setId))
  }, [set, index, records, feedback])

  const answerNow = () => {
    if (!question || feedback) return
    const passed = input.trim() === ''
    const correct = !passed && grade(input, question.answer)
    const ms = passed ? TIME_LIMIT_MS : Math.min(Math.max(Date.now() - startedAt.current, 0), TIME_LIMIT_MS)
    setRecords((prev) => [...prev, { questionId: question.id, input: input.trim(), correct, ms, passed }])
    setFeedback({ correct, answer: question.answer })
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
  const remainPct = Math.max(0, Math.min(100, (remainMs / TIME_LIMIT_MS) * 100))
  const urgent = remainMs <= URGENT_MS

  return (
    <div className="paper">
      {set.widened && <p className="pen-comment">範囲が狭いため都道府県に広げました</p>}

      <div className="paper__header">
        <span>範囲: {rangeLabel(set)}</span>
        <span>科目: {set.mode === 'e' ? 'easy（市区町村名）' : 'difficult（大字・町名）'}</span>
        <span className="field">
          <span className="field__label">氏名</span>
          <span className="field__input">{nickname || '名無し'}</span>
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

      <input
        ref={inputRef}
        className="answer-input"
        type="text"
        value={input}
        autoFocus
        autoComplete="off"
        placeholder="ひらがなで"
        aria-label="読みをひらがなで入力"
        disabled={feedback !== null}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) answerNow()
        }}
      />

      <div className={urgent ? 'timer__label is-urgent' : 'timer__label'}>
        <span aria-hidden="true">⏳</span>
        <span>のこり {Math.ceil(remainMs / 1000)} 秒</span>
      </div>
      <div className={urgent ? 'timer is-urgent' : 'timer'}>
        <span className="timer__bar" style={{ width: `${remainPct}%` }} />
      </div>

      <p>
        <button type="button" className="btn btn--primary" onClick={answerNow} disabled={feedback !== null}>
          解答
        </button>
      </p>
      <p>空欄のまま解答するとパスになります。</p>

      {feedback && (
        <p>
          <span className={feedback.correct ? 'mark mark--correct' : 'mark mark--wrong'} aria-hidden="true">
            {feedback.correct ? '○' : '×'}
          </span>
          <span className="sr-only">{feedback.correct ? '正解' : '誤り'}</span>{' '}
          <span className="marker marker--yellow">{feedback.answer}</span>
        </p>
      )}
    </div>
  )
}
