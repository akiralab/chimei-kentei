/**
 * HiraganaInput — 解答欄。入るのは「ひらがな＋長音記号ー」だけ。
 *
 * 設計の要点は 4 つ。
 *
 * 1. 値（value / onChange）は常にひらがな。変換規則は hiragana.ts の純粋関数に閉じる。
 * 2. 画面に出す文字列は「ひらがな＋打ち切れていないローマ字」。ローマ字の端は
 *    値に混ぜないが消してもいけない（消すと 1 文字も打てない）ので、内部状態
 *    `shown` にだけ持つ。例: monzen と打つ途中は値「もんぜ」／表示「もんぜn」。
 * 3. 日本語 IME の変換中（compositionstart〜compositionend）は一切手を入れない。
 *    未確定文字列を書き換えると変換候補が壊れるため。
 * 4. **漢字に変換されて確定されても読みに戻す。** Web から IME は無効化できず、
 *    macOS のライブ変換では黙って漢字になる。確定文字列を捨てて「読み」を
 *    復元する経路を 2 本持つ（下の「読みの復元」）。
 *
 * ## 読みの復元
 *
 * compositionend の確定文字列にかな以外（漢字など）が混じっていたら、次の順で
 * 読みを作り直す。
 *
 *   (1) 打鍵列から再構成（主）
 *       変換中でも keydown は飛んでくる。`key` は 'Process' や undefined に
 *       なりうるが `code`（物理キー）は使えるので、KeyS KeyO KeyU KeyS KeyA を
 *       'sousa' として貯め、Backspace で 1 文字戻す。Space / Enter / 変換キーは
 *       打鍵列に入れない。これを toHiraganaStrict に通す。
 *
 *       **1 打鍵目だけは compositionstart より前に来る。** Chrome / Safari とも
 *       IME の先頭文字は「keydown（keyCode 229・key 'Process'・isComposing は
 *       まだ false）→ compositionstart → compositionupdate → input」の順で、
 *       isComposing が true になるのは 2 文字目以降。composition 中の keydown
 *       だけを見ていると先頭が落ちて『そうさ』が『おうさ』になる。そこで
 *       「isComposing か keyCode 229 か key 'Process'」を IME 打鍵とみなして
 *       拾い、compositionstart ではその先取り分を消さない。
 *   (2) 未確定文字列の履歴から（副）
 *       compositionupdate の data を見て「全部かな」だった最後の文字列を覚える。
 *       打鍵列が空（貼り付け・手書き入力など）のときの保険。
 *   (3) どちらも無ければ従来どおり、確定文字列からかな以外を除去する。
 *
 * かなのまま確定された場合（スマホのフリック入力・かな入力・無変換確定）は
 * (1)(2) を使わず確定文字列をそのまま正規化する。利用者が変換候補から別の読みを
 * 選び直した場合に、打鍵列より確定文字列を信じたいため。
 *
 * ## Enter
 *
 * Enter で onSubmit。このとき末尾のローマ字を確定させる必要があるが（「もんぜn」→
 * 「もんぜん」）、onChange と onSubmit を同じ tick で呼ぶと親はまだ古い value を
 * 握っている。そこで確定が発生したときだけ onSubmit を次のコミットまで遅らせる。
 */
import type { ChangeEvent, CompositionEvent, FocusEvent, KeyboardEvent, Ref } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { isKanaOnly, pushStroke, splitHiragana, toHiraganaStrict } from './hiragana.ts'

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
  /**
   * 入力欄そのものへの参照。画面側が次の問題でフォーカスを戻すのに使う。
   * React 19 では ref を普通の prop として受け取れるので forwardRef は要らない。
   */
  ref?: Ref<HTMLInputElement>
}

const HINT = 'ローマ字でもひらがなでも入力できます。漢字に変換されても読みに戻ります'
const HINT_MAC = '（IME を英数にすると変換なしで打てます）'

export default function HiraganaInput({
  value,
  onChange,
  onSubmit,
  disabled,
  autoFocus,
  placeholder = 'ひらがなで',
  className,
  ariaLabel,
  ref,
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

  /** composition 中の打鍵列（ローマ字）。復元の主経路 */
  const strokesRef = useRef('')
  /** 最後に「全部かな」だった未確定文字列。復元の副経路 */
  const kanaUpdateRef = useRef('')
  /** composition 開始時点の確定済みテキスト（確定文字列の前に残る部分）*/
  const baseRef = useRef('')
  /**
   * compositionstart より前に来た 1 打鍵目を既に拾ってあるか。
   * IME の先頭文字だけは keydown が compositionstart より先に飛ぶ（下記）。
   */
  const primedRef = useRef(false)
  /**
   * compositionend 直後、ブラウザが「変換後の生の値」で input を飛ばしてくる
   * （Chrome は compositionend の直後に input を出す）。復元した値が上書き
   * されないよう、その 1 回だけ読み替える。
   */
  const recoveredRef = useRef<{ from: string; to: string } | null>(null)

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

  /** 正規化して表示と値を更新する。戻り値は入力欄に出す文字列 */
  function apply(raw: string): string {
    const { kana, pending } = splitHiragana(raw)
    const next = kana + pending
    setShown(next)
    if (kana !== emittedRef.current) {
      emittedRef.current = kana
      onChange(kana)
    }
    return next
  }

  /** 確定された 1 区間を「読み」に戻す */
  function recoverSegment(segment: string): string {
    // かなのまま確定された（フリック・かな入力・無変換）。利用者が選んだ読みを信じる
    if (isKanaOnly(segment)) return segment

    const fromStrokes = toHiraganaStrict(strokesRef.current)
    if (fromStrokes !== '') return fromStrokes

    const fromUpdate = toHiraganaStrict(kanaUpdateRef.current)
    if (fromUpdate !== '') return fromUpdate

    // 貼り付けなど打鍵の痕跡が無いとき。従来どおり、かな以外は落ちる
    return segment
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value
    if (composingRef.current) {
      // 未確定文字列はそのまま見せる。値はまだ動かさない
      setShown(raw)
      return
    }
    const recovered = recoveredRef.current
    if (recovered && raw === recovered.from) {
      // compositionend の後追いで来た「変換後の生の値」。復元結果を守る
      recoveredRef.current = null
      setShown(recovered.to)
      return
    }
    recoveredRef.current = null
    // composition に入らずに文字が確定した（英数モードなど）。先取りした打鍵は捨てる
    primedRef.current = false
    strokesRef.current = ''
    apply(raw)
  }

  function handleCompositionStart() {
    composingRef.current = true
    recoveredRef.current = null
    // 1 打鍵目を keydown で先取りしてあるなら消さない（先頭文字が落ちる）
    if (primedRef.current) return
    strokesRef.current = ''
    kanaUpdateRef.current = ''
    baseRef.current = shown
  }

  function handleCompositionUpdate(event: CompositionEvent<HTMLInputElement>) {
    const data = event.data ?? ''
    // ライブ変換で漢字になる前の「読み」を 1 つだけ覚えておく
    if (data !== '' && isKanaOnly(data)) kanaUpdateRef.current = data
  }

  function handleCompositionEnd(event: CompositionEvent<HTMLInputElement>) {
    composingRef.current = false
    const raw = event.currentTarget.value
    const data = event.data ?? ''

    // 入力欄全体のうち、今回確定した区間だけを差し替える。
    // data が確定区間そのものなので、取れるならそちらを信じる
    let head: string
    let segment: string
    if (data !== '') {
      segment = data
      head = raw.endsWith(data) ? raw.slice(0, raw.length - data.length) : baseRef.current
    } else if (raw.startsWith(baseRef.current)) {
      head = baseRef.current
      segment = raw.slice(head.length)
    } else {
      head = ''
      segment = raw
    }

    const next = head + recoverSegment(segment)
    const applied = apply(next)
    recoveredRef.current = raw === applied ? null : { from: raw, to: applied }
    strokesRef.current = ''
    kanaUpdateRef.current = ''
    primedRef.current = false
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // IME が食べた打鍵か。1 打鍵目は composition がまだ始まっていないので
    // isComposing では捕まらない。keyCode 229 / key 'Process' で見分ける
    const toIme =
      composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229 || event.key === 'Process'

    if (toIme) {
      // key は当てにならないので code（物理キー）だけを拾って打鍵列に貯める。
      // この Enter は変換の確定であって解答の送信ではない
      if (!composingRef.current && !primedRef.current) {
        // compositionstart より前の 1 打鍵目。ここから新しい打鍵列が始まる
        strokesRef.current = ''
        kanaUpdateRef.current = ''
        baseRef.current = shown
        primedRef.current = true
      }
      strokesRef.current = pushStroke(strokesRef.current, event.code ?? '')
      return
    }

    if (event.key !== 'Enter') return
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
        ref={ref}
        className={className ? `answer-input ${className}` : 'answer-input'}
        type="text"
        value={shown}
        onChange={handleChange}
        onCompositionStart={handleCompositionStart}
        onCompositionUpdate={handleCompositionUpdate}
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
        <span className="answer-hint__mac">{HINT_MAC}</span>
      </p>
    </>
  )
}
