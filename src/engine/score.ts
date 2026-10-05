/**
 * 得点の計算。クライアント（結果画面）とサーバー（共有ランキング API）で同じ関数を使う。
 *
 * - 10 問のセット … 正答数 × 10（従来どおり）
 * - それ以外（全市区町村名・全町名のように問題数が範囲ごとに違うセット）… 正答率を 100 点満点に丸めた値
 *
 * どちらも 0〜100 点だが **1 問の重みが違う**ので、10 問と全問は別の順位表として扱う
 * （区分は RankingMode の 'e' | 'd' | 'all'）。
 */
import type { Mode, RankingRow, Stars } from './types.ts'
import { QUESTIONS_PER_SET } from './types.ts'
import { parseSetId } from './setId.ts'

/** 得点。total が 0 以下（答案が無い）なら 0 点 */
export function scoreOf(correct: number, total: number): number {
  if (total <= 0) return 0
  if (total === QUESTIONS_PER_SET) return correct * 10
  return Math.round((correct / total) * 100)
}

/** 順位表の 1 行のうち、正解数・問題数の判定に要る分だけ */
export type CountableRow = Pick<RankingRow, 'setId' | 'score'> & Partial<Pick<RankingRow, 'correct' | 'total'>>

/**
 * その行の「正解 n / N 問」。
 * correct / total は後から足した項目なので、持っていない古い行は 10 問のセットとみなし
 * （全市区町村名が登録できなかった頃のデータなので必ず 10 問）、得点から正解数を復元する。
 */
export function rowCounts(row: CountableRow): { correct: number; total: number } {
  const total = row.total ?? QUESTIONS_PER_SET
  return { correct: row.correct ?? Math.round((row.score / 100) * total), total }
}

/**
 * 10 問ではなく母集団を全部出したセットの行か（全市区町村名・全町名）。
 * setId が読めればそれが正本（`-all` 付き）、読めないときだけ total が 10 問でないことで見分ける。
 */
export function isAllRow(row: CountableRow): boolean {
  const parsed = parseSetId(row.setId)
  if (parsed) return parsed.all
  return row.total !== undefined && row.total !== QUESTIONS_PER_SET
}

/**
 * 全部出すセットの名前。**科目で単位が違う**ので文言もここで分ける（Issue #46）。
 * 「全問」の 1 区分に同居させる代わりに、どちらなのかはこの名前で見分ける
 */
export function allSetName(mode: Mode): string {
  return mode === 'e' ? '全市区町村名' : '全町名'
}

/**
 * 全部出すセットの表示名。**ここが唯一の組み立て**で、選択画面の問題数ボタン・
 * 挑戦状の着地・順位表の行が同じ文字列を出す（「全市区町村名（54 問）」「全町名（97 問）」）。
 * total を渡さなければ件数を添えない（順位表の古い行は問題数を持たない）
 */
export function allSetLabel(mode: Mode, total?: number): string {
  return total === undefined ? allSetName(mode) : `${allSetName(mode)}（${total} 問）`
}

/** 順位表の行に添える注記。10 問のセットなら null（問題数は古い行には無いので出さない） */
export function allRowNote(row: CountableRow): string | null {
  if (!isAllRow(row)) return null
  // 科目は setId から読む。読めない古い行は全市区町村名しか登録できなかった頃のものなので 'e'
  const mode = parseSetId(row.setId)?.mode ?? 'e'
  return allSetLabel(mode, row.total)
}

/**
 * その行が難易度で絞ったセットなら ★ の数、絞っていない（または setId が読めない）なら null。
 * 町名のセットも ★ を持つ（Issue #46）ので、両科目の行に出る。
 * **順位表は難易度で分けない**（10 問どうしなら ★ を絞っても 1 問の重みは同じで、
 * 区分を 3 → 9 に増やすと 1 区分あたりの人数が薄くなる）。混ざるので行に注記を出す
 */
export function starsOfRow(row: Pick<RankingRow, 'setId'>): Stars | null {
  return parseSetId(row.setId)?.stars ?? null
}
