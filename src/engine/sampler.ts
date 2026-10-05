/** 決定論的な非復元抽出。同じ setId なら常に同じ列を返す。 */
import type { Question } from './types.ts'
import { QUESTIONS_PER_SET } from './types.ts'
import { hashString, mulberry32 } from './prng.ts'

/**
 * pool を id の文字列昇順に並べたうえで、setId から導いた乱数で部分 Fisher-Yates を回し、
 * 先頭から n 件をその順のまま出題順として返す。pool が n 未満なら全件（シャッフル済み）。
 *
 * **`skip` が付いた問（出題しないと決めた問。types.ts の `Question.skip`）は返さない。**
 * シャッフルは **`skip` を含む母集団全体**に対して回し、引いた問が `skip` なら数に入れず
 * 次へ進む（＝必要なぶんだけシャッフルを進める）。こうすると母集団から消す場合と違って
 * 乱数の消費が前と同じ順に並ぶので、**`skip` を 1 件も引かなかったセットは今までと
 * 完全に同じ列**になり、引いていたセットだけその 1 件が後ろの問に置き換わる（Issue #50）。
 * `skip` が多くて n 件に届かなければ、拾えた分だけを返す。
 */
export function sampleQuestions(pool: Question[], setId: string, n: number = QUESTIONS_PER_SET): Question[] {
  const sorted = pool.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const take = Math.min(n, sorted.length)
  const rand = mulberry32(hashString(setId))
  const picked: Question[] = []
  for (let i = 0; i < sorted.length && picked.length < take; i++) {
    const j = i + Math.floor(rand() * (sorted.length - i))
    const tmp = sorted[i]
    sorted[i] = sorted[j]
    sorted[j] = tmp
    if (sorted[i].skip === undefined) picked.push(sorted[i])
  }
  return picked
}
