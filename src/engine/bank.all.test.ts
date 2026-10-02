import { describe, expect, it } from 'vitest'
import type { BankMeta, Question } from './types.ts'
import type { BankSource } from './bank.ts'
import { DATA_VERSION, buildQuestionSet, municipalityQuestions, questionFromCity } from './bank.ts'
import { EASY_12, EASY_13, META, fixtureSource } from './__fixtures__/questions.ts'

describe('questionFromCity', () => {
  it('接尾辞と読みの末尾を外して easy と同じ形にする', () => {
    expect(questionFromCity({ lgCode: '122165', prefCode: '12', name: '匝瑳市', kana: 'そうさし' }, '千葉県')).toEqual({
      id: 'c:122165:匝瑳',
      prefCode: '12',
      pref: '千葉県',
      lgCode: '122165',
      display: '匝瑳',
      suffix: '市',
      answer: 'そうさ',
    })
    expect(questionFromCity({ lgCode: '131016', prefCode: '13', name: '千代田区', kana: 'ちよだく' }, '東京都')?.answer).toBe(
      'ちよだ',
    )
    expect(questionFromCity({ lgCode: '473481', prefCode: '47', name: '読谷村', kana: 'よみたんそん' }, '沖縄県')?.answer).toBe(
      'よみたん',
    )
    // 町は ちょう / まち の両方。長い方（ちょう）から当てる
    expect(questionFromCity({ lgCode: '414411', prefCode: '41', name: '大町町', kana: 'おおまちちょう' }, '佐賀県')?.answer).toBe(
      'おおまち',
    )
    expect(questionFromCity({ lgCode: '082201', prefCode: '08', name: 'つくば市', kana: 'つくばし' }, '茨城県')?.display).toBe(
      'つくば',
    )
  })

  it('接尾辞や読みの末尾が合わなければ null', () => {
    expect(questionFromCity({ lgCode: '000001', prefCode: '00', name: '千市1', kana: 'し1' }, 'x')).toBeNull()
    expect(questionFromCity({ lgCode: '000002', prefCode: '00', name: '謎村', kana: 'なぞ' }, 'x')).toBeNull()
    expect(questionFromCity({ lgCode: '000003', prefCode: '00', name: '市', kana: 'し' }, 'x')).toBeNull()
  })
})

/** フィクスチャの千葉県（easy 25 件）に、easy.json に無い市区町村（r2 で除いた かなだけの名前の想定）を 2 件足す */
function sourceWithExtraCities(): BankSource {
  const base = fixtureSource()
  const meta: BankMeta = {
    ...META,
    cities: [
      ...META.cities.map((c) => (c.prefCode === '12' ? { ...c, name: `${c.name}市`, kana: `${c.kana}し` } : c)),
      { lgCode: '129901', prefCode: '12', name: 'つくば市', kana: 'つくばし' },
      { lgCode: '129902', prefCode: '12', name: 'いすみ市', kana: 'いすみし' },
    ],
  }
  return { ...base, meta: () => Promise.resolve(meta) }
}

describe('municipalityQuestions', () => {
  it('easy.json の件に meta.cities にしか無い件を足し、lgCode 順に並べる', async () => {
    const qs = await municipalityQuestions('12', sourceWithExtraCities())
    expect(qs).toHaveLength(EASY_12.length + 2)
    expect(qs.map((q) => q.lgCode)).toEqual(qs.map((q) => q.lgCode).slice().sort())
    const extra = qs.filter((q) => q.lgCode.startsWith('1299'))
    expect(extra.map((q) => q.display)).toEqual(['つくば', 'いすみ'])
    expect(extra[0]).toMatchObject({ id: 'c:129901:つくば', pref: '千葉県', suffix: '市', answer: 'つくば' })
    // easy.json にある件は問題バンクのものをそのまま使う（二重にしない）
    expect(qs.filter((q) => q.prefCode !== '12')).toHaveLength(0)
    expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length)
  })

  it('東京都は easy の 5 件だけ（meta.cities に余分が無い）', async () => {
    const qs = await municipalityQuestions('13', sourceWithExtraCities())
    expect(qs).toHaveLength(EASY_13.length)
  })
})

describe('buildQuestionSet / all', () => {
  const src = sourceWithExtraCities()

  it('都道府県の市区町村を全部、seed で決まる順に出す', async () => {
    const set = await buildQuestionSet('e', '12', '0417', src, true)
    expect(set.setId).toBe(`${DATA_VERSION}-e-12-0417-all`)
    expect(set.all).toBe(true)
    expect(set.widened).toBe(false)
    expect(set.questions).toHaveLength(EASY_12.length + 2)
    expect(set.questions.some((q) => q.display === 'つくば')).toBe(true)

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

  it('全国や町名では all にできない', async () => {
    await expect(buildQuestionSet('e', '00', '0417', src, true)).rejects.toThrow(/全市区町村名/)
    await expect(buildQuestionSet('d', '12', '0417', src, true)).rejects.toThrow(/全市区町村名/)
  })

  it('問題バンクに無い都道府県は読めない', async () => {
    const q: Question[] = []
    void q
    await expect(buildQuestionSet('e', '47', '0417', src, true)).rejects.toThrow(/都道府県コード/)
  })
})
