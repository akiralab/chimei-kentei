/**
 * 時間制限の設定（端末保存）。**既定は「制限なし」**。
 *
 * - 0 … 制限なし。1 問の経過時間だけ測る
 * - 20000 … 20 秒（従来の挙動。0 を切ったら自動パス）
 *
 * 設定そのものは localStorage `timeLimitMs` に 1 つだけ持つ。
 * 出題のたびに「その回に使った制限」を sessionStorage へ控えるので、
 * 結果画面は答案と同じ条件で ⏳ の印を出せる（設定を途中で変えても狂わない）。
 */
import { useCallback, useState } from 'react'
import { TIME_LIMIT_MAX_MS, TIME_LIMIT_MIN_MS, TIME_LIMIT_MS } from '../engine/types.ts'

export const TIME_LIMIT_KEY = 'timeLimitMs'

/** 制限なし */
export const NO_TIME_LIMIT = 0

/** 設定 UI が出す選択肢（Select 画面の切替はこれを使う） */
export const TIME_LIMIT_CHOICES: { value: number; label: string }[] = [
  { value: NO_TIME_LIMIT, label: '制限なし' },
  { value: TIME_LIMIT_MS, label: '20秒' },
]

/** 0（制限なし）か 1000〜60000 のみ有効。API の検証と同じ範囲 */
export function isValidTimeLimit(ms: number): boolean {
  if (!Number.isInteger(ms)) return false
  if (ms === NO_TIME_LIMIT) return true
  return ms >= TIME_LIMIT_MIN_MS && ms <= TIME_LIMIT_MAX_MS
}

/** 未設定・壊れた値はすべて 0（制限なし）に寄せる */
export function readTimeLimit(): number {
  try {
    const raw = localStorage.getItem(TIME_LIMIT_KEY)
    if (raw === null) return NO_TIME_LIMIT
    const ms = Number(raw)
    return isValidTimeLimit(ms) ? ms : NO_TIME_LIMIT
  } catch {
    return NO_TIME_LIMIT
  }
}

export function writeTimeLimit(ms: number): void {
  if (!isValidTimeLimit(ms)) return
  try {
    localStorage.setItem(TIME_LIMIT_KEY, String(ms))
  } catch {
    // 保存できない環境では毎回「制限なし」に戻るだけ
  }
}

/** localStorage `timeLimitMs` と同期する設定の状態。Select 画面の切替 UI がこれを使う */
export function useTimeLimit(): [number, (ms: number) => void] {
  const [timeLimitMs, setState] = useState<number>(() => readTimeLimit())
  const update = useCallback((ms: number) => {
    if (!isValidTimeLimit(ms)) return
    setState(ms)
    writeTimeLimit(ms)
  }, [])
  return [timeLimitMs, update]
}

// --------------------------------------------------------------------------
// その回に使った制限（出題 → 結果 の受け渡し）。答案と同じ寿命なので sessionStorage
// --------------------------------------------------------------------------

export function quizTimeLimitKey(setId: string): string {
  return `timeLimit:${setId}`
}

export function writeQuizTimeLimit(setId: string, ms: number): void {
  try {
    sessionStorage.setItem(quizTimeLimitKey(setId), String(ms))
  } catch {
    // 控えられなければ結果画面が現在の設定で代用する
  }
}

/** 控えが無ければ null（結果画面は現在の設定で代用する） */
export function readQuizTimeLimit(setId: string): number | null {
  try {
    const raw = sessionStorage.getItem(quizTimeLimitKey(setId))
    if (raw === null) return null
    const ms = Number(raw)
    return isValidTimeLimit(ms) ? ms : null
  } catch {
    return null
  }
}
