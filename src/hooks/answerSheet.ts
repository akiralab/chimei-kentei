/** 出題 → 結果 のあいだ答案を受け渡す。タブを閉じたら消えてよいので sessionStorage。 */
import type { AnswerRecord } from '../engine/types.ts'

export function answerSheetKey(setId: string): string {
  return `result:${setId}`
}

export function writeAnswerSheet(setId: string, records: AnswerRecord[]): void {
  try {
    sessionStorage.setItem(answerSheetKey(setId), JSON.stringify(records))
  } catch {
    // 保存できない環境では結果画面が範囲選択へ戻る
  }
}

export function readAnswerSheet(setId: string): AnswerRecord[] | null {
  try {
    const raw = sessionStorage.getItem(answerSheetKey(setId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as AnswerRecord[]) : null
  } catch {
    return null
  }
}
