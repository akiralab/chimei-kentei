/** テスト用の小さな問題バンク。public/ には置かない。 */
import type { BankMeta, Question, Stars } from '../types.ts'
import type { BankSource } from '../bank.ts'

export function lgCodeOf(prefCode: string, seq: number): string {
  return `${prefCode}${String(seq).padStart(4, '0')}`
}

/**
 * 市区町村名（easy）を count 件。難易度 ★ は ★1 → ★2 → ★3 の繰り返しで振る
 * （実データと同じく **全問が 1〜3 を持つ**状態を作る。どの値かは問わないテストが多いので、
 * 偏りのない既定として循環させる）。特定の分布が要るテストは withStars() で上書きする
 */
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
      stars: ((i % 3) + 1) as Stars,
    } satisfies Question
  })
}

/**
 * 難易度を並び順どおりに振り直す（先頭から starsList の値を当てる。足りない分は最後の値）。
 * 「★3 が 11 件・★2 が 3 件・★1 が 1 件」のような狙った分布を作るのに使う
 */
export function withStars(questions: Question[], starsList: Stars[]): Question[] {
  return questions.map((q, i) => ({ ...q, stars: starsList[i] ?? starsList[starsList.length - 1] }))
}

/**
 * ある自治体の大字・町名（difficult）を count 件。難易度 ★ は easy と同じく
 * ★1 → ★2 → ★3 の繰り返しで振る（実データと同じく **全問が 1〜3 を持つ**）
 */
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
      stars: ((i % 3) + 1) as Stars,
    } satisfies Question
  })
}

/**
 * 指定した位置の問に `skip: 'reading'`（出題しない印）を付ける。実データでいう
 * 「読みに全角数字が混ざる町名 345 件」の代わり（Issue #50）。
 * **既存のフィクスチャには付けない** — 件数や ★ の期待値が動かないよう、
 * skip を試すテストだけがこれで自前の母集団を作る
 */
export function withSkipReading(questions: Question[], indexes: number[]): Question[] {
  const mark = new Set(indexes)
  return questions.map((q, i) => (mark.has(i) ? { ...q, skip: 'reading' as const } : q))
}

/** `[★1, ★2, ★3]` の件数。meta の difficultStars / townStars と同じ形（skip は数えない） */
export function starsTriple(questions: Question[]): [number, number, number] {
  const askable = questions.filter((q) => q.skip === undefined)
  const n = (s: Stars) => askable.filter((q) => q.stars === s).length
  return [n(1), n(2), n(3)]
}

/**
 * meta.cities の 1 行。町名の件数（towns / townStars）は渡した difficult から
 * lgCode で数える（実データの build_questions.py と同じ数え方 ＝ **skip は除く**）
 */
export function cityRow(
  city: { lgCode: string; prefCode: string; name: string; kana: string },
  towns: Question[] = [],
): BankMeta['cities'][number] {
  const inCity = towns.filter((t) => t.lgCode === city.lgCode && t.skip === undefined)
  return { ...city, towns: inCity.length, townStars: starsTriple(inCity) }
}

/** easy の 1 件を meta.cities の行にする（名前は display のまま＝接尾辞を足さない簡易版） */
export function cityRowOf(q: Question, towns: Question[] = []): BankMeta['cities'][number] {
  return cityRow({ lgCode: q.lgCode, prefCode: q.prefCode, name: q.display, kana: q.answer }, towns)
}

/** pref '12' は easy 25 件、pref '13' は easy 5 件。difficult は '12' の 1 番目の自治体に 30 件 */
export const EASY_12 = makeEasy('12', '千葉県', 25)
export const EASY_13 = makeEasy('13', '東京都', 5)
export const EASY_ALL: Question[] = [...EASY_12, ...EASY_13]
export const DIFFICULT_12 = makeDifficult('12', '千葉県', 1, 30)
export const DIFFICULT_13 = makeDifficult('13', '東京都', 1, 3)
/**
 * 千葉県の 9 番目の自治体の町名 14 件のうち 2 件に `skip` を付けたもの（Issue #50）。
 * **fixtureSource() には入れない** — 既存のセットの 10 問が動かないよう、
 * skip を試すテストが自前の BankSource に足して使う（出題できるのは 12 件）
 */
export const DIFFICULT_12_WITH_SKIP = withSkipReading(makeDifficult('12', '千葉県', 9, 14), [2, 11])
const DIFFICULT_ALL: Question[] = [...DIFFICULT_12, ...DIFFICULT_13]

export const META: BankMeta = {
  dataVersion: 'abr20260925',
  generatedAt: '2026-09-25T00:00:00.000Z',
  source: 'テスト用フィクスチャ',
  prefectures: [
    {
      code: '12',
      name: '千葉県',
      easyCount: EASY_12.length,
      difficultCount: DIFFICULT_12.length,
      difficultStars: starsTriple(DIFFICULT_12),
    },
    {
      code: '13',
      name: '東京都',
      easyCount: EASY_13.length,
      difficultCount: DIFFICULT_13.length,
      difficultStars: starsTriple(DIFFICULT_13),
    },
  ],
  cities: EASY_ALL.map((q) => cityRowOf(q, DIFFICULT_ALL)),
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
