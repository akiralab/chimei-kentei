/**
 * hiragana.ts — 解答欄に入る文字を「ひらがな＋長音記号」だけに絞る純粋関数。
 *
 * 目的は「変換キーを押させない」こと。日本語 IME が無い環境（英語キーボード・
 * 一部のスマホ）でもローマ字を打てば読みが入り、IME があればカタカナ確定でも
 * 漢字混じりの貼り付けでもひらがなに揃える。
 *
 * ローマ字 → かなの表は wanakana に任せる（拗音・促音・撥音・長音の例外が多く、
 * 自前で持つと必ず抜ける）。`IMEMode: 'toHiragana'` を使うのが肝で、これにより
 *   - 「nn」「n'」→ ん、「n + 子音」→ ん（例: monzen → もんぜ + n）
 *   - 打ち切れていない子音（k, ts, sh, kk …）はローマ字のまま残る
 * という IME と同じ振る舞いになる。大文字を打ってもカタカナにならない。
 *
 * この「残ったローマ字」は捨ててはいけない（捨てると 1 文字も打てない）。
 * そこで変換結果を
 *   kana    … 確定したひらがな（これだけを onChange で外に出す）
 *   pending … 末尾に残ったローマ字（画面には出すが値には入れない）
 * に分けて返すのが splitHiragana()。確定させたいとき（Enter・IME 確定・blur）は
 * toHiraganaStrict() を使い、pending も一度かなに通してから落とす。
 */
import { toKana } from 'wanakana'

/** wanakana に渡すモード。大文字でもカタカナにせず、未確定のローマ字は残す */
const IME_HIRAGANA = { IMEMode: 'toHiragana' } as const

/** カタカナ ァ..ヶ の範囲。ひらがなへは -0x60 で写せる（ヴ U+30F4 → ゔ U+3094 も含む）*/
const KATAKANA_FIRST = 0x30a1
const KATAKANA_LAST = 0x30f6
const KANA_OFFSET = 0x60

/**
 * 残していい文字。ひらがな ぁ..ゖ（U+3041..U+3096。ゔ・ゐ・ゑ・小書きかな・っ を含む）と
 * 長音記号「ー」(U+30FC) だけ。漢字・英数・記号・空白・踊り字（ゝゞ）は落とす。
 */
const ALLOWED = /[^ぁ-ゖー]/gu

/** 末尾に残ったローマ字（まだかなになっていない打鍵） */
const TRAILING_ROMAJI = /[A-Za-z]+$/u

/** かな（ひらがな・カタカナ・長音・濁点）だけでできているか。踊り字も通す */
const KANA_ONLY = /^[ぁ-ゖァ-ヺーゝゞヽヾ\u3099\u309A]*$/u

/** かな・ローマ字・長音・空白だけでできているか（＝捨てる文字が無いか）の判定用 */
const CONVERTIBLE = /^[ぁ-ゖァ-ヺーゝゞヽヾ\u3099\u309AA-Za-z\-'\s]*$/u

/** 物理キーの code → ローマ字 1 文字。'\b' は 1 文字戻す、'' は無視 */
const KEY_LETTER = /^Key([A-Z])$/

/** 打鍵列の戻し記号（Backspace）*/
const STROKE_BACK = '\b'

export interface HiraganaParts {
  /** 確定したひらがな（＋「ー」）。これが入力欄の「値」 */
  kana: string
  /** 末尾に残ったローマ字。画面に出すだけで、値には含めない */
  pending: string
}

/** カタカナをひらがなへ。「ー」や既存のひらがなはそのまま通す */
function katakanaToHiragana(input: string): string {
  let out = ''
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0
    out += code >= KATAKANA_FIRST && code <= KATAKANA_LAST ? String.fromCodePoint(code - KANA_OFFSET) : ch
  }
  return out
}

/** 全角英字・半角カタカナ・濁点の分離を先に畳む */
function fold(input: string): string {
  return input.normalize('NFKC')
}

/** かな化したあとに残った「ひらがな以外」を落とす */
function keepHiraganaOnly(input: string): string {
  return input.replace(ALLOWED, '')
}

/**
 * 入力中の文字列を「確定したひらがな」と「末尾に残ったローマ字」に分ける。
 * 逐次変換（keydown ごと）に使う。
 */
export function splitHiragana(raw: string): HiraganaParts {
  if (raw === '') return { kana: '', pending: '' }
  const converted = katakanaToHiragana(toKana(fold(raw), IME_HIRAGANA))
  const tail = TRAILING_ROMAJI.exec(converted)
  const pending = tail ? tail[0] : ''
  const head = pending === '' ? converted : converted.slice(0, converted.length - pending.length)
  return { kana: keepHiraganaOnly(head), pending }
}

/**
 * 確定用。末尾に残ったローマ字も一度かなに通し（`n` → ん）、それでもかなに
 * ならないもの（`ts` など）は落とす。結果は必ずひらがな＋「ー」だけになる。
 */
export function toHiraganaStrict(raw: string): string {
  const { kana, pending } = splitHiragana(raw)
  if (pending === '') return kana
  // pending だけを「もう続きは来ない」前提で変換しなおす（IMEMode を外す）
  const flushed = keepHiraganaOnly(katakanaToHiragana(toKana(fold(pending))))
  return kana + flushed
}


/**
 * 確定文字列が「かなだけ」か。日本語 IME が漢字に変換して確定したかどうかの判定に使う。
 * 半角カタカナや濁点分離も NFKC で畳んでから見るので、`ｿｳｻ` も true。
 */
export function isKanaOnly(input: string): boolean {
  return KANA_ONLY.test(fold(input))
}

/**
 * 物理キーの `KeyboardEvent.code` をローマ字 1 文字へ。
 *
 * IME の変換中は `key` が 'Process' や undefined になるので使えないが、`code` は
 * 押した物理キーをそのまま返す。JIS 配列でも US 配列でも英字キーの code は同じ
 * （`KeyS` など）なので、配列を気にせずローマ字列を復元できる。
 *
 * 戻り値: ローマ字 1 文字 ／ `'\b'`（1 文字戻す）／ `''`（無視するキー）。
 * スペース・変換・無変換・Enter・矢印などは '' を返して打鍵列に混ぜない。
 */
export function romajiFromKeyCode(code: string): string {
  const letter = KEY_LETTER.exec(code)
  if (letter) return letter[1].toLowerCase()
  if (code === 'Minus') return '-' // 長音「ー」。toKana が '-' を 'ー' に直す
  if (code === 'Backspace') return STROKE_BACK
  return ''
}

/** 打鍵列（ローマ字）に 1 キー分を足す。Backspace は末尾を 1 文字削る */
export function pushStroke(buffer: string, code: string): string {
  const ch = romajiFromKeyCode(code)
  if (ch === '') return buffer
  if (ch === STROKE_BACK) return buffer.slice(0, -1)
  return buffer + ch
}

/**
 * ひらがなに直せない文字（漢字・記号・数字など）が混じっているか。
 *
 * 入力欄に入れた文字が黙って消えると「壊れている」と見えるので、捨てたことを
 * 一言伝えるために使う。ローマ字（A-Za-z）・長音の素になる「-」・撥音の「'」・
 * 空白は「捨てたが伝える必要のない文字」として通す（空白はかなの区切りとして
 * 貼り付けに混ざるだけで、利用者が入れた文字ではない）。
 * 半角カタカナや全角英字は NFKC で畳んでから見るので、`ｿｳｻ` は false。
 */
export function hasUnconvertible(raw: string): boolean {
  return !CONVERTIBLE.test(fold(raw))
}
