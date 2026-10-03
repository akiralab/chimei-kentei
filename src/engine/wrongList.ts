/**
 * 「今まで間違えた問題」の蓄積（端末内・localStorage `wrong:list`）。
 *
 * 記録するのは **ランキングに登録した答案だけ**（Result.tsx の登録成功時にだけ呼ぶ）。
 * 解いただけで登録しなかった回は残さない。10 問でも全市区町村名でも扱いは同じ。
 *
 * - 同じ questionId は最新で上書きする（最後に間違えたときの入力が残る）
 * - 上限 500 件。超えたら古いものから捨てる
 */
import type { Mode, QuestionSet, ResultEntry } from './types.ts'
import type { KeyValueStorage } from './ranking.ts'
import { defaultStorage } from './ranking.ts'

export const WRONG_LIST_KEY = 'wrong:list'
export const WRONG_LIST_MAX = 500

export interface WrongItem {
  questionId: string
  /** 画面に出す漢字（幹） */
  display: string
  /** 正解の読み */
  answer: string
  /** そのとき自分が書いた読み（パス・時間切れは空文字） */
  input: string
  /** 所属市区町村の表示名。difficult のみ */
  city?: string
  pref: string
  prefCode: string
  setId: string
  mode: Mode
  /** 間違えた日時。ISO 8601 */
  at: string
}

function isItem(v: unknown): v is WrongItem {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.questionId === 'string' &&
    typeof o.display === 'string' &&
    typeof o.answer === 'string' &&
    typeof o.input === 'string' &&
    typeof o.pref === 'string' &&
    typeof o.prefCode === 'string' &&
    typeof o.setId === 'string' &&
    (o.mode === 'e' || o.mode === 'd') &&
    typeof o.at === 'string'
  )
}

/** 古い順（末尾が最新）。壊れた値は捨てる */
export function readWrongList(storage: KeyValueStorage = defaultStorage()): WrongItem[] {
  const raw = storage.getItem(WRONG_LIST_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isItem)
  } catch {
    return []
  }
}

export function writeWrongList(items: WrongItem[], storage: KeyValueStorage = defaultStorage()): void {
  storage.setItem(WRONG_LIST_KEY, JSON.stringify(items.slice(-WRONG_LIST_MAX)))
}

export function clearWrongList(storage: KeyValueStorage = defaultStorage()): void {
  storage.setItem(WRONG_LIST_KEY, '[]')
}

/** 新しい順（画面はこの順で出す） */
export function newestFirst(items: WrongItem[]): WrongItem[] {
  return items.slice().reverse()
}

/**
 * 登録した答案から誤答（パス・時間切れを含む `correct !== true`）を抜き出して蓄積する。
 * 返り値は更新後の一覧（古い順）。
 */
export function appendWrongFromEntry(
  set: QuestionSet,
  entry: ResultEntry,
  storage: KeyValueStorage = defaultStorage(),
): WrongItem[] {
  const byId = new Map(set.questions.map((q) => [q.id, q]))
  const added: WrongItem[] = []
  for (const a of entry.answers) {
    if (a.correct) continue
    const q = byId.get(a.questionId)
    if (!q) continue
    added.push({
      questionId: q.id,
      display: q.display,
      answer: q.answer,
      input: a.input,
      ...(q.city === undefined ? {} : { city: q.city }),
      pref: q.pref,
      prefCode: q.prefCode,
      setId: entry.setId,
      mode: set.mode,
      at: entry.createdAt,
    })
  }
  if (added.length === 0) return readWrongList(storage)

  // 同じ questionId は最新で上書き（古い行を抜いてから末尾に足す）
  const replacing = new Set(added.map((i) => i.questionId))
  const kept = readWrongList(storage).filter((i) => !replacing.has(i.questionId))
  const next = [...kept, ...added].slice(-WRONG_LIST_MAX)
  writeWrongList(next, storage)
  return next
}
