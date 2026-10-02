/** 決定論的な非復元抽出。同じ setId なら常に同じ列を返す。 */
import type { Question } from './types.ts'
import { QUESTIONS_PER_SET } from './types.ts'
import { hashString, mulberry32 } from './prng.ts'

/**
 * pool を id の文字列昇順に並べたうえで、setId から導いた乱数で部分 Fisher-Yates を回し、
 * 先頭 n 件をその順のまま出題順として返す。pool が n 未満なら全件（シャッフル済み）。
 */
export function sampleQuestions(pool: Question[], setId: string, n: number = QUESTIONS_PER_SET): Question[] {
  const sorted = pool.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const take = Math.min(n, sorted.length)
  const rand = mulberry32(hashString(setId))
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rand() * (sorted.length - i))
    const tmp = sorted[i]
    sorted[i] = sorted[j]
    sorted[j] = tmp
  }
  return sorted.slice(0, take)
}
