/**
 * HiraganaInput — 解答欄。入るのは「ひらがな＋長音記号ー」だけ。
 *
 * 設計の要点は 3 つ。
 *
 * 1. 値（value / onChange）は常にひらがな。変換規則は hiragana.ts の純粋関数に閉じる。
 * 2. 画面に出す文字列は「ひらがな＋打ち切れていないローマ字」。ローマ字の端は
 *    値に混ぜないが消してもいけない（消すと 1 文字も打てない）ので、内部状態
 *    `shown` にだけ持つ。例: monzen と打つ途中は値「もんぜ」／表示「もんぜn」。
 * 3. 日本語 IME の変換中（compositionstart〜compositionend）は一切手を入れない。
 *    未確定文字列を書き換えると変換候補が壊れるため。確定した瞬間に正規化する。
 *
 * Enter で onSubmit。このとき末尾のローマ字を確定させる必要があるが（「もんぜn」→
 * 「もんぜん」）、onChange と onSubmit を同じ tick で呼ぶと親はまだ古い value を
 * 握っている。そこで確定が発生したときだけ onSubmit を次のコミットまで遅らせる。
 */
import type { ChangeEvent, CompositionEvent, FocusEvent, KeyboardEvent } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { splitHiragana, toHiraganaStrict } from './hiragana.ts'

export interface HiraganaInputProps {
  /** 現在の解答。常にひらがな＋「ー」 */
  value: string
  /** ひらがなに正規化済みの次の値を渡す */
  onChange: (nextHiragana: string) => void
  /** Enter（IME 変換の確定 Enter は除く） */
  onSubmit: () => void
  disabled?: boolean
  autoFocus?: boolean
  placeholder?: string
  className?: string
  ariaLabel?: string
}

const HINT = 'ローマ字でもひらがなでも入力できます。変換せずにそのまま Enter'

export default function HiraganaInput({
  value,
  onChange,
  onSubmit,
  disabled,
  autoFocus,
  placeholder = 'ひらがなで',
  className,
  ariaLabel,
}: HiraganaInputProps) {
  const hintId = useId()
  /** 入力欄に実際に出す文字列（= value ＋ 未確定のローマ字） */
  const [shown, setShown] = useState(value)
  /** 直前に onChange で外へ出した値。親からの value 変更と自分の更新を見分ける */
  const emittedRef = useRef(value)
  /** IME 変換中か */
  const composingRef = useRef(false)
  /** ローマ字を確定させたので、次のコミットで onSubmit を呼ぶ */
  const submitAfterFlushRef = useRef(false)

  // 親が value を差し替えたとき（次の問題へ進んでクリア、など）に表示を合わせる。
  // 自分が出した値が返ってきただけなら、未確定のローマ字を消さないよう触らない。
  useEffect(() => {
    if (composingRef.current) return
    if (value === emittedRef.current) return
    emittedRef.current = value
    setShown(value)
  }, [value])

  // 確定を伴う Enter の後始末。親が onChange を受けて再描画したあとに onSubmit を呼ぶ
  useEffect(() => {
    if (!submitAfterFlushRef.current) return
    submitAfterFlushRef.current = false
    onSubmit()
  })

  /** 正規化して表示と値を更新する。戻り値は確定したひらがな */
  function apply(raw: string): string {
    const { kana, pending } = splitHiragana(raw)
    setShown(kana + pending)
    if (kana !== emittedRef.current) {
      emittedRef.current = kana
      onChange(kana)
    }
    return kana
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value
    if (composingRef.current) {
      // 未確定文字列はそのまま見せる。値はまだ動かさない
      setShown(raw)
      return
    }
    apply(raw)
  }

  function handleCompositionStart() {
    composingRef.current = true
  }

  function handleCompositionEnd(event: CompositionEvent<HTMLInputElement>) {
    composingRef.current = false
    apply(event.currentTarget.value)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    // IME の変換確定の Enter は解答の送信ではない
    if (composingRef.current || event.nativeEvent.isComposing) return
    event.preventDefault()
    const flushed = toHiraganaStrict(event.currentTarget.value)
    if (flushed === shown) {
      // 確定するものが無い（＝値は既に最新）。そのまま送る
      onSubmit()
      return
    }
    setShown(flushed)
    if (flushed !== emittedRef.current) {
      emittedRef.current = flushed
      onChange(flushed)
    }
    // setShown で必ず再描画されるので、その後のエフェクトで onSubmit を呼ぶ
    submitAfterFlushRef.current = true
  }

  /** フォーカスを外したときも確定させる（「もんぜn」を残さない） */
  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    if (composingRef.current) return
    const flushed = toHiraganaStrict(event.currentTarget.value)
    if (flushed === shown) return
    setShown(flushed)
    if (flushed !== emittedRef.current) {
      emittedRef.current = flushed
      onChange(flushed)
    }
  }

  return (
    <>
      <input
        className={className ? `answer-input ${className}` : 'answer-input'}
        type="text"
        value={shown}
        onChange={handleChange}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-describedby={hintId}
        // IME 任せにせず自前で正規化するので、ブラウザの補助は全部切る
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        inputMode="text"
        lang="ja"
        enterKeyHint="done"
      />
      <p className="answer-hint" id={hintId}>
        {HINT}
      </p>
    </>
  )
}
