/** 採点。入力と正解をそれぞれ正規化して完全一致で判定する。 */

const SMALL_KANA: Record<string, string> = {
  'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お',
  'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'っ': 'つ', 'ゎ': 'わ',
}

const DAKUTEN_FOLD: Record<string, string> = { 'ぢ': 'じ', 'づ': 'ず' }

const OLD_KANA: Record<string, string> = { 'ゐ': 'い', 'ゑ': 'え' }

/**
 * 読みの正規化。
 * (1) 前後空白除去 (2) カタカナ→ひらがな (3) 全角英数→半角
 * (4) 小書き仮名→通常 (5) ぢ→じ・づ→ず (6) ゐ→い・ゑ→え
 * 長音符 'ー' は変換しない（'そーさ' は 'そうさ' と別物）。
 */
export function normalizeReading(s: string): string {
  if (!s) return ''
  let out = ''
  for (const ch of s.trim()) {
    const code = ch.codePointAt(0) as number
    let c = ch
    // (2) カタカナ（ァ〜ヶ の範囲のうち ァ〜ヶ=U+30A1〜U+30F6）→ ひらがな
    if (code >= 0x30a1 && code <= 0x30f6) {
      c = String.fromCodePoint(code - 0x60)
    } else if (
      // (3) 全角数字・全角英字 → 半角
      (code >= 0xff10 && code <= 0xff19) ||
      (code >= 0xff21 && code <= 0xff3a) ||
      (code >= 0xff41 && code <= 0xff5a)
    ) {
      c = String.fromCodePoint(code - 0xfee0)
    }
    // (4) 小書き仮名 → 通常の大きさ
    c = SMALL_KANA[c] ?? c
    // (5) 濃音の揺れ
    c = DAKUTEN_FOLD[c] ?? c
    // (6) 歴史的仮名
    c = OLD_KANA[c] ?? c
    out += c
  }
  return out
}

/** 正規化後が空文字の入力は常に不正解 */
export function grade(input: string, answer: string): boolean {
  const a = normalizeReading(input)
  if (a === '') return false
  return a === normalizeReading(answer)
}
