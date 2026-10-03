/**
 * 難易度（★）で母集団を絞る分の検査（フィクスチャ）。実データでの件数は
 * bank.stars.realdata.test.ts の担当。
 *
 * ここが固定するのは 4 つ:
 *  - 10 問は「その難易度だけ」から出る
 *  - 全市区町村名 × 難易度は「その範囲のその難易度を全部」になる
 *  - 絞って 10 問に足りなければ **広げずに** 日本語で案内して止まる
 *  - 町名（'d'）に難易度は無い（渡したら断る）
 */
import { describe, expect, it } from 'vitest'
import type { BankMeta, Question, Stars } from './types.ts'
import { QUESTIONS_PER_SET } from './types.ts'
import type { BankSource } from './bank.ts'
import { DATA_VERSION, buildQuestionSet } from './bank.ts'
import { makeDifficult, makeEasy, withStars } from './__fixtures__/questions.ts'

/**
 * 千葉県 24 件（★3 を 12・★2 を 9・★1 を 3）／東京都 12 件（★2 を 12）。
 * 千葉県は「★3 なら 10 問が組めるが ★1 では組めない」県、東京都は「★3 が 0 件」の県
 */
const EASY_12 = withStars(makeEasy('12', '千葉県', 24), [
  ...(Array<Stars>(12).fill(3)),
  ...(Array<Stars>(9).fill(2)),
  ...(Array<Stars>(3).fill(1)),
])
const EASY_13 = withStars(makeEasy('13', '東京都', 12), [2])
const EASY_ALL: Question[] = [...EASY_12, ...EASY_13]
const DIFFICULT_12 = makeDifficult('12', '千葉県', 1, 30)

const META: BankMeta = {
  dataVersion: DATA_VERSION,
  generatedAt: '2026-10-03T00:00:00.000Z',
  source: 'テスト用フィクスチャ',
  prefectures: [
    { code: '12', name: '千葉県', easyCount: EASY_12.length, difficultCount: DIFFICULT_12.length },
    { code: '13', name: '東京都', easyCount: EASY_13.length, difficultCount: 0 },
  ],
  cities: EASY_ALL.map((q) => ({ lgCode: q.lgCode, prefCode: q.prefCode, name: q.display, kana: q.answer })),
}

const src: BankSource = {
  meta: () => Promise.resolve(META),
  easy: () => Promise.resolve(EASY_ALL),
  difficult: (prefCode) => Promise.resolve(prefCode === '12' ? DIFFICULT_12 : []),
}

function starsIn(questions: Question[]): Set<Stars | undefined> {
  return new Set(questions.map((q) => q.stars))
}

describe('buildQuestionSet / 難易度', () => {
  it('10 問はその難易度だけから出て、setId に -s{n} が残る', async () => {
    const set = await buildQuestionSet('e', '12', '0417', src, false, 3)
    expect(set.setId).toBe(`${DATA_VERSION}-e-12-0417-s3`)
    expect(set.stars).toBe(3)
    expect(set.questions).toHaveLength(QUESTIONS_PER_SET)
    expect(starsIn(set.questions)).toEqual(new Set([3]))
  })

  it('難易度を渡さなければ従来どおり全部から出る', async () => {
    const set = await buildQuestionSet('e', '12', '0417', src)
    expect(set.setId).toBe(`${DATA_VERSION}-e-12-0417`)
    expect(set.stars).toBeNull()
    expect(set.questions).toHaveLength(QUESTIONS_PER_SET)
  })

  it('同じ setId なら同じ 10 問（絞ると別の 10 問になる）', async () => {
    const a = await buildQuestionSet('e', '12', '0417', src, false, 3)
    const b = await buildQuestionSet('e', '12', '0417', src, false, 3)
    expect(a.questions.map((q) => q.id)).toEqual(b.questions.map((q) => q.id))

    // seed も範囲も同じでも、難易度の有無で setId が変わるので出題も変わる
    const whole = await buildQuestionSet('e', '12', '0417', src)
    expect(whole.questions.map((q) => q.id)).not.toEqual(a.questions.map((q) => q.id))
  })

  it('全市区町村名 × 難易度は「その範囲のその難易度を全部」', async () => {
    const set = await buildQuestionSet('e', '12', '0417', src, true, 3)
    expect(set.setId).toBe(`${DATA_VERSION}-e-12-0417-all-s3`)
    expect(set.all).toBe(true)
    expect(set.stars).toBe(3)
    expect(set.questions).toHaveLength(12)
    expect(starsIn(set.questions)).toEqual(new Set([3]))

    // 絞らなければ 24 件（全部）
    const whole = await buildQuestionSet('e', '12', '0417', src, true)
    expect(whole.questions).toHaveLength(24)
  })

  it('全市区町村名でも 10 問未満を許す（★2 が 9 件なら 9 問）', async () => {
    const set = await buildQuestionSet('e', '12', '0417', src, true, 2)
    expect(set.questions).toHaveLength(9)
  })

  it('絞って 10 問に足りなければ件数と逃げ道を言って止まる（広げない）', async () => {
    await expect(buildQuestionSet('e', '12', '0417', src, false, 1)).rejects.toThrow(
      /千葉県の市区町村名（★）は 3 件しかないので、10 問を組めません。全市区町村名で解いてください。/,
    )
    // 絞らなければ 24 件あるので組める ＝ 広げずに断っている
    await expect(buildQuestionSet('e', '12', '0417', src)).resolves.toBeTruthy()
  })

  it('0 件の難易度は全市区町村名でも出題できないと言って止まる', async () => {
    await expect(buildQuestionSet('e', '13', '0417', src, true, 3)).rejects.toThrow(
      /この範囲には出題できる★★★の市区町村がありませんでした。/,
    )
    await expect(buildQuestionSet('e', '13', '0417', src, false, 3)).rejects.toThrow(
      /東京都の市区町村名（★★★）は 0 件しかないので/,
    )
  })

  it('町名（d）に難易度は無い', async () => {
    await expect(buildQuestionSet('d', '12', '0417', src, false, 3)).rejects.toThrow(/難易度は市区町村名/)
  })

  it('全国（00）でも難易度で絞れる', async () => {
    const set = await buildQuestionSet('e', '00', '0417', src, false, 2)
    expect(set.setId).toBe(`${DATA_VERSION}-e-00-0417-s2`)
    expect(starsIn(set.questions)).toEqual(new Set([2]))
    // 千葉県 9 ＋ 東京都 12 = 21 件の母集団から 10 問
    expect(set.questions).toHaveLength(QUESTIONS_PER_SET)
    expect(new Set(set.questions.map((q) => q.prefCode)).size).toBeGreaterThan(1)
  })
})
