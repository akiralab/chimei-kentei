/**
 * 難易度 ★ の表示名。選択・出題・着地・答案・順位表で同じ文字列を出すために
 * **ここが唯一の実装**（modes.ts と同じ役回り）。
 *
 * ★ は市区町村名（Mode 'e'）の出題だけが持つ。付け方（A1 人口 × B2 音訓分解 ×
 * B4 漢字の難しさ）の正本は data/build_stars.py で、画面はその結果を見せるだけ。
 *
 * 記号（★ の数）と読み上げ文を分けてあるのは、色だけに頼らず・絵文字に頼らずに
 * 難易度が伝わるようにするため（CONTRACT.md の「正誤は色と記号の両方で示す」に倣う）。
 */
import type { Stars } from './types.ts'

/** 切替に並べる難易度。0 ＝ 絞らない（全部）は画面側が別に持つ */
export const STARS_CHOICES: Stars[] = [1, 2, 3]

/** 絞っていない状態。選択画面の state と「全部」の表示に使う */
export const STARS_ALL = 0

export function isStars(v: number): v is Stars {
  return v === 1 || v === 2 || v === 3
}

/** 見せる記号。★ / ★★ / ★★★ */
export function starsMark(stars: Stars): string {
  return '★'.repeat(stars)
}

/** 選択画面の切替の読み上げ。「難易度: ★3」「難易度: 全部」 */
export function starsSwitchLabel(stars: Stars | typeof STARS_ALL): string {
  return stars === STARS_ALL ? '難易度: 全部' : `難易度: ★${stars}`
}

/** 出題・答案に添える ★ の読み上げ。「難易度 3」（記号は aria-hidden で隠す） */
export function starsAria(stars: Stars): string {
  return `難易度 ${stars}`
}

/** 帯（見出し行）に足す一文。「難易度: ★★★」。絞っていないときは出さない */
export function starsHeaderNote(stars: Stars): string {
  return `難易度: ${starsMark(stars)}`
}

/** 順位表の行に添える注記。「★★★のみ」（score.ts の allRowNote と並べて出す） */
export function starsRowNote(stars: Stars): string {
  return `${starsMark(stars)}のみ`
}
