import { describe, expect, it } from 'vitest'
import type { BankMeta } from './types.ts'
import type { BankSource } from './bank.ts'
import { DATA_VERSION, allQuestions, buildQuestionSet } from './bank.ts'
import { DIFFICULT_12, EASY_12, EASY_13, META, cityRow, fixtureSource } from './__fixtures__/questions.ts'

/** DIFFICULT_12 が所属する市区町村（フィクスチャの千葉県 1 番目・町名 30 件） */
const CITY_WITH_TOWNS = DIFFICULT_12[0].lgCode

/**
 * フィクスチャの meta.cities に「easy.json には無い市区町村」を 2 件足す。
 * 実データでいう さいたま・ニセコ・むかわ のような、問題バンクが除いた市区町村の代わり。
 * 全市区町村名はこれらを **出さない**（問題バンクで除外したものはクイズに出さない）
 */
function sourceWithExtraCities(): BankSource {
  const base = fixtureSource()
  const meta: BankMeta = {
    ...META,
    cities: [
      ...META.cities.map((c) => (c.prefCode === '12' ? { ...c, name: `${c.name}市`, kana: `${c.kana}し` } : c)),
      cityRow({ lgCode: '129901', prefCode: '12', name: 'つくば市', kana: 'つくばし' }),
      cityRow({ lgCode: '129902', prefCode: '12', name: 'いすみ市', kana: 'いすみし' }),
    ],
  }
  return { ...base, meta: () => Promise.resolve(meta) }
}

describe('allQuestions / 市区町村名', () => {
  it('easy.json にある市区町村だけを lgCode 順に返す（meta.cities にしか無い件は出さない）', async () => {
    const qs = await allQuestions('e', '12', sourceWithExtraCities())
    expect(qs).toHaveLength(EASY_12.length)
    expect(qs.map((q) => q.lgCode)).toEqual(qs.map((q) => q.lgCode).slice().sort())
    expect(qs.filter((q) => q.lgCode.startsWith('1299'))).toEqual([])
    expect(qs.some((q) => q.display === 'つくば')).toBe(false)
    expect(qs.filter((q) => q.prefCode !== '12')).toHaveLength(0)
    expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length)
  })

  it('東京都は easy の 5 件だけ', async () => {
    const qs = await allQuestions('e', '13', sourceWithExtraCities())
    expect(qs).toHaveLength(EASY_13.length)
  })

  it('問題バンクに無い都道府県は読めない', async () => {
    await expect(allQuestions('e', '47', sourceWithExtraCities())).rejects.toThrow(/都道府県コード/)
  })

  it('実在しない地域コードは読めない', async () => {
    await expect(allQuestions('e', '01z', sourceWithExtraCities())).rejects.toThrow(/地域コード/)
  })
})

describe('allQuestions / 全町名', () => {
  it('その市区町村の町名だけを id 順に返す（市区町村名そのものは含めない）', async () => {
    const qs = await allQuestions('d', CITY_WITH_TOWNS, sourceWithExtraCities())
    expect(qs).toHaveLength(DIFFICULT_12.length)
    expect(qs.every((q) => q.lgCode === CITY_WITH_TOWNS)).toBe(true)
    // 市区町村名（id が 'c:' 始まり）は 1 件も混ざらない ＝ meta.cities[].towns と数が一致する
    expect(qs.every((q) => q.id.startsWith('o:'))).toBe(true)
    expect(qs.map((q) => q.id)).toEqual(qs.map((q) => q.id).slice().sort())
  })

  it('町名が 1 件も無い市区町村は空（出題は buildQuestionSet が断る）', async () => {
    expect(await allQuestions('d', EASY_12[1].lgCode, sourceWithExtraCities())).toEqual([])
  })
})

describe('buildQuestionSet / all', () => {
  const src = sourceWithExtraCities()

  it('都道府県の市区町村名を全部、seed で決まる順に出す', async () => {
    const set = await buildQuestionSet('e', '12', '0417', src, true)
    expect(set.setId).toBe(`${DATA_VERSION}-e-12-0417-all`)
    expect(set.all).toBe(true)
    expect(set.widened).toBe(false)
    expect(set.questions).toHaveLength(EASY_12.length)
    // 問題バンクが除いた市区町村は出さない
    expect(set.questions.some((q) => q.display === 'つくば')).toBe(false)

    const again = await buildQuestionSet('e', '12', '0417', src, true)
    expect(again.questions.map((q) => q.id)).toEqual(set.questions.map((q) => q.id))
    const other = await buildQuestionSet('e', '12', '0418', src, true)
    expect(other.questions.map((q) => q.id)).not.toEqual(set.questions.map((q) => q.id))
    expect(new Set(other.questions.map((q) => q.id))).toEqual(new Set(set.questions.map((q) => q.id)))
  })

  it('10 問のセットは all: false のままで、中身も変わらない', async () => {
    const set = await buildQuestionSet('e', '12', '0417', src)
    expect(set.all).toBe(false)
    expect(set.setId).toBe(`${DATA_VERSION}-e-12-0417`)
    expect(set.questions).toHaveLength(10)
  })

  it('全国や、科目に合わない単位では all にできない', async () => {
    await expect(buildQuestionSet('e', '00', '0417', src, true)).rejects.toThrow(/全市区町村名/)
    await expect(buildQuestionSet('d', '12', '0417', src, true)).rejects.toThrow(/全町名/)
    await expect(buildQuestionSet('e', CITY_WITH_TOWNS, '0417', src, true)).rejects.toThrow(/全市区町村名/)
  })

  it('問題バンクに無い都道府県は読めない', async () => {
    await expect(buildQuestionSet('e', '47', '0417', src, true)).rejects.toThrow(/都道府県コード/)
  })
})

describe('buildQuestionSet / 全町名', () => {
  const src = sourceWithExtraCities()

  it('その市区町村の町名を全部、seed で決まる順に出す', async () => {
    const set = await buildQuestionSet('d', CITY_WITH_TOWNS, '0417', src, true)
    expect(set.setId).toBe(`${DATA_VERSION}-d-${CITY_WITH_TOWNS}-0417-all`)
    expect(set.all).toBe(true)
    expect(set.mode).toBe('d')
    expect(set.widened).toBe(false)
    expect(set.questions).toHaveLength(DIFFICULT_12.length)
    expect(set.questions.every((q) => q.lgCode === CITY_WITH_TOWNS)).toBe(true)

    const again = await buildQuestionSet('d', CITY_WITH_TOWNS, '0417', src, true)
    expect(again.questions.map((q) => q.id)).toEqual(set.questions.map((q) => q.id))
    const other = await buildQuestionSet('d', CITY_WITH_TOWNS, '0418', src, true)
    expect(other.questions.map((q) => q.id)).not.toEqual(set.questions.map((q) => q.id))
    expect(new Set(other.questions.map((q) => q.id))).toEqual(new Set(set.questions.map((q) => q.id)))
  })

  it('難易度で絞ると「その市区町村のその ★ を全部」になる', async () => {
    const want = DIFFICULT_12.filter((q) => q.stars === 3)
    const set = await buildQuestionSet('d', CITY_WITH_TOWNS, '0417', src, true, 3)
    expect(set.setId).toBe(`${DATA_VERSION}-d-${CITY_WITH_TOWNS}-0417-all-s3`)
    expect(set.stars).toBe(3)
    expect(set.questions).toHaveLength(want.length)
    expect(set.questions.every((q) => q.stars === 3)).toBe(true)
  })

  it('町名が 1 件も無い市区町村は案内して止まる', async () => {
    await expect(buildQuestionSet('d', EASY_12[1].lgCode, '0417', src, true)).rejects.toThrow(
      /この範囲には出題できる町名がありませんでした。/,
    )
  })
})
