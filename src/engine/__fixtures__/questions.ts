/** テスト用の小さな問題バンク。public/ には置かない。 */
import type { BankMeta, Question } from '../types.ts'
import type { BankSource } from '../bank.ts'

export function lgCodeOf(prefCode: string, seq: number): string {
  return `${prefCode}${String(seq).padStart(4, '0')}`
}

/** 市区町村名（easy）を count 件 */
export function makeEasy(prefCode: string, pref: string, count: number): Question[] {
  return Array.from({ length: count }, (_, i) => {
    const seq = i + 1
    const lgCode = lgCodeOf(prefCode, seq)
    const display = `${pref.slice(0, 1)}市${seq}`
    return {
      id: `c:${lgCode}:${display}`,
      prefCode,
      pref,
      lgCode,
      display,
      suffix: '市',
      answer: `し${seq}`,
    } satisfies Question
  })
}

/** ある自治体の大字・町名（difficult）を count 件 */
export function makeDifficult(prefCode: string, pref: string, seq: number, count: number): Question[] {
  const lgCode = lgCodeOf(prefCode, seq)
  const city = `${pref.slice(0, 1)}市${seq}`
  return Array.from({ length: count }, (_, i) => {
    const display = `${city}町${i + 1}`
    return {
      id: `o:${lgCode}:${display}`,
      prefCode,
      pref,
      lgCode,
      city,
      display,
      answer: `まち${i + 1}`,
    } satisfies Question
  })
}

/** pref '12' は easy 25 件、pref '13' は easy 5 件。difficult は '12' の 1 番目の自治体に 30 件 */
export const EASY_12 = makeEasy('12', '千葉県', 25)
export const EASY_13 = makeEasy('13', '東京都', 5)
export const EASY_ALL: Question[] = [...EASY_12, ...EASY_13]
export const DIFFICULT_12 = makeDifficult('12', '千葉県', 1, 30)
export const DIFFICULT_13 = makeDifficult('13', '東京都', 1, 3)

export const META: BankMeta = {
  dataVersion: 'abr20260925',
  generatedAt: '2026-09-25T00:00:00.000Z',
  source: 'テスト用フィクスチャ',
  prefectures: [
    { code: '12', name: '千葉県', easyCount: EASY_12.length, difficultCount: DIFFICULT_12.length },
    { code: '13', name: '東京都', easyCount: EASY_13.length, difficultCount: DIFFICULT_13.length },
  ],
  cities: EASY_ALL.map((q) => ({ lgCode: q.lgCode, prefCode: q.prefCode, name: q.display, kana: q.answer })),
}

export function fixtureSource(): BankSource {
  return {
    async meta() {
      return META
    },
    async easy() {
      return EASY_ALL
    },
    async difficult(prefCode: string) {
      if (prefCode === '12') return DIFFICULT_12
      if (prefCode === '13') return DIFFICULT_13
      return []
    },
  }
}
