import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AnswerRecord, Question, QuestionSet } from '../engine/types.ts'
import { QUESTIONS_PER_SET, UNLIMITED_MAX_MS } from '../engine/types.ts'
import { OUTDATED_SET_MESSAGE, buildQuestionSet, defaultSource, isCurrentDataVersion } from '../engine/bank.ts'
import { modeName } from '../engine/modes.ts'
import { starsAria, starsMark } from '../engine/stars.ts'
import { grade } from '../engine/grading.ts'
import { rangeLabelOf } from '../engine/scope.ts'
import { SCOPE_NATIONWIDE, parseSetId } from '../engine/setId.ts'
import { useNickname } from '../hooks/useNickname.ts'
import { answerSheetKey, writeAnswerSheet } from '../hooks/answerSheet.ts'
import { readTimeLimit, writeQuizTimeLimit } from '../hooks/useTimeLimit.ts'
import { COVER_PATH, SELECT_PATH, navigate, resultPath } from '../router.ts'
import MunicipalityMap from '../components/MunicipalityMap.tsx'
import MunicipalityInfo from '../components/MunicipalityInfo.tsx'
import HiraganaInput from '../components/HiraganaInput.tsx'
import Challenge from './Challenge.tsx'

const KANJI_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
const FEEDBACK_MS = 1000
const URGENT_MS = 5000

/** 問番号。10 問までは漢数字（問三 / 十）、全市区町村名のように多いときは算用数字（問12 / 54） */
function questionNumber(n: number, total: number): string {
  if (total > KANJI_NUM.length) return String(n)
  return KANJI_NUM[n - 1] ?? String(n)
}

/** 添え書き。町名（'d'）は常に所属自治体、市区町村名（'e'）は全国のときだけ都道府県 */
function prefNote(set: QuestionSet, q: Question): string | null {
  if (set.mode === 'd') return q.city ?? q.pref
  if (set.scope === SCOPE_NATIONWIDE) return q.pref
  return null
}

interface Feedback {
  correct: boolean
  answer: string
}

/**
 * direct … 共有リンク（`#/q/{setId}`）を直接開いて着地した場合に true。
 * このときだけ出題の前に挑戦状（Challenge）を 1 枚挟み、「はじめる」まで計測を始めない。
 */
export default function Quiz({ setId, direct = false }: { setId: string; direct?: boolean }) {
  const parsed = useMemo(() => parseSetId(setId), [setId])
  const [set, setSet] = useState<QuestionSet | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [input, setInput] = useState('')
  const [records, setRecords] = useState<AnswerRecord[]>([])
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  /**
   * その回の時間制限。0 ＝ 制限なし。出題中に設定を変えても揺れないよう、
   * 開始時（挑戦状なら「はじめる」を押した時点）に 1 度だけ読む
   */
  const [timeLimitMs, setTimeLimitMs] = useState(() => readTimeLimit())
  const limited = timeLimitMs > 0
  const [remainMs, setRemainMs] = useState(timeLimitMs)
  /** 挑戦状の「はじめる」を押したか。direct でないときは最初から出題 */
  const [started, setStarted] = useState(false)
  /** 挑戦状を出しているあいだ。砂時計も問ごとの計測も動かさない */
  const pending = direct && !started
  /** 「タイトルへ戻る」を押した後。タイマーと結果への自動遷移を止めるだけのフラグ */
  const [exiting, setExiting] = useState(false)
  const startedAt = useRef(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [nickname, setNickname] = useNickname()

  const error =
    parsed === null ? `セットIDが読めません: ${setId}`
    : isCurrentDataVersion(parsed.dataVersion) ? loadError
    : OUTDATED_SET_MESSAGE

  // 問題セットの読み込み（setId から決定論的に再現する）。App 側で key={setId} なので setId は不変
  useEffect(() => {
    if (!parsed || !isCurrentDataVersion(parsed.dataVersion)) return
    let alive = true
    buildQuestionSet(parsed.mode, parsed.scope, parsed.seed, defaultSource(), parsed.all, parsed.stars)
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
    if (!question || feedback || exiting || pending) return
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
  }, [question, feedback, exiting, pending, limited, timeLimitMs])

  /** 次の問へ（最後の問なら結果へ）。計測は次の問の表示から始まるので、正解を眺めていた時間は数えない */
  const advance = useCallback(() => {
    setFeedback(null)
    setInput('')
    setRemainMs(timeLimitMs)
    setIndex((i) => i + 1)
  }, [timeLimitMs])

  // ○ は 1 秒見せて自動で次へ。× とパス（時間切れ含む）は「次へ」を押すまで止める。
  // このアプリの目的は正しい読みを身につけることなので、間違えた読みは自分のペースで確かめてから進む
  useEffect(() => {
    if (!feedback || !feedback.correct) return
    const t = setTimeout(advance, FEEDBACK_MS)
    return () => clearTimeout(t)
  }, [feedback, advance])

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
        <p>
          <button type="button" className="btn btn--ghost" onClick={() => navigate(COVER_PATH)}>
            タイトルへ戻る
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

  if (pending) {
    return (
      <Challenge
        rangeLabel={rangeLabelOf(set)}
        mode={set.mode}
        total={set.questions.length}
        all={set.all}
        stars={set.stars}
        widened={set.widened}
        nickname={nickname}
        onNicknameChange={setNickname}
        onStart={() => {
          // 制限は挑戦状で変えられるので、開始の瞬間の設定を読み直す
          const ms = readTimeLimit()
          setTimeLimitMs(ms)
          setRemainMs(ms)
          setStarted(true)
        }}
      />
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
            <span>範囲: {rangeLabelOf(set)}</span>
            <span>科目: {modeName(set.mode)}</span>
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
            {/* 番号は独立した要素にする（★ が混ざっても「問三 / 十」だけを読み取れるように） */}
            <span className="q-number__text">
              問{questionNumber(index + 1, set.questions.length)} /{' '}
              {questionNumber(set.questions.length, set.questions.length)}
            </span>
            {/* その問の難易度。★ を持つのは市区町村名だけなので、町名の問には出ない。
                role="img" + aria-label で「★★★」ではなく「難易度 3」と読ませる */}
            {question.stars !== undefined && (
              <span className="stars q-number__stars" role="img" aria-label={starsAria(question.stars)}>
                {starsMark(question.stars)}
              </span>
            )}
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
            {/* 間違えたあとは「解答」の場所に「次へ」を出す（高さを変えず、指の位置も同じ）。
                autoFocus で Enter / Space でも進める。最後の問なら結果へ */}
            {/* key を分けて別要素として差し替える。同じ <button> の更新扱いだと autoFocus が効かない */}
            {feedback && !feedback.correct ?
              <button key="next" type="button" className="btn btn--primary" onClick={advance} autoFocus>
                {index + 1 >= set.questions.length ? '結果を見る' : '次へ'}
              </button>
            : <button
                key="answer"
                type="button"
                className="btn btn--primary"
                onClick={answerNow}
                disabled={feedback !== null}
              >
                解答
              </button>
            }
          </p>
          {/* 丸バツを見せている間は要らない注意書き。消して用紙の高さを抑える（1280×800 で底が欠けないように） */}
          {!feedback && <p className="q-note">空欄のまま解答するとパスになります。</p>}

        </div>
      </div>
    </div>
  )
}
