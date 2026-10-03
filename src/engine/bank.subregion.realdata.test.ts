/**
 * 地域（北海道 4・東京都 3）の母集団を **実データ**で検査する（node 環境）。
 * 件数は Issue #34 の表そのもの。読み込みは bank.realdata.test.ts と同じ `import.meta.glob`。
 *
 * ここが固定するのは 3 つ:
 *  - 地域の母集団が Issue の表と一致する（市区町村名・市区町村名＋町名の両方）
 *  - 地域は都道府県へ広げない（widened が立たない）
 *  - 母集団が 10 問に足りない島しょ × 市区町村名は、10 問が組めず全市区町村名なら 9 問になる
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { subregionOf } from '../geo/subregions.ts'
import type { BankMeta, Question } from './types.ts'
import { MIN_POOL_FOR_SCOPE, QUESTIONS_PER_SET } from './types.ts'
import type { BankSource } from './bank.ts'
import { DATA_VERSION, buildPool, buildQuestionSet, municipalityQuestions } from './bank.ts'

const EASY_FILES = import.meta.glob<Question[]>('../../public/questions/*/easy.json', { import: 'default' })
const META_FILES = import.meta.glob<BankMeta>('../../public/questions/*/meta.json', { import: 'default' })
const DIFFICULT_FILES = import.meta.glob<Question[]>('../../public/questions/*/difficult/*.json', { import: 'default' })

function pick<T>(files: Record<string, () => Promise<T>>, suffix: string): Promise<T> {
  const hit = Object.entries(files).find(([path]) => path.includes(`/${DATA_VERSION}/`) && path.endsWith(suffix))
  if (!hit) throw new Error(`public/questions/${DATA_VERSION}/…${suffix} が無い（npm run build:questions）`)
  return hit[1]()
}

let source: BankSource

beforeAll(async () => {
  const [easy, meta, d01, d13] = await Promise.all([
    pick(EASY_FILES, 'easy.json'),
    pick(META_FILES, 'meta.json'),
    pick(DIFFICULT_FILES, 'difficult/01.json'),
    pick(DIFFICULT_FILES, 'difficult/13.json'),
  ])
  const difficult: Record<string, Question[]> = { '01': d01, '13': d13 }
  source = {
    meta: () => Promise.resolve(meta),
    easy: () => Promise.resolve(easy),
    difficult: (prefCode: string) => Promise.resolve(difficult[prefCode] ?? []),
  }
})

/** Issue #34 の表（市区町村数 / 市区町村名の母集団 / 町名も含めた母集団） */
const EXPECTED: { scope: string; name: string; cities: number; easy: number; difficult: number }[] = [
  { scope: '01c', name: '道央', cities: 70, easy: 67, difficult: 2063 },
  { scope: '01s', name: '道南', cities: 18, easy: 17, difficult: 589 },
  { scope: '01n', name: '道北', cities: 41, easy: 41, difficult: 887 },
  { scope: '01e', name: '道東', cities: 50, easy: 50, difficult: 2031 },
  { scope: '13k', name: '23区', cities: 23, easy: 23, difficult: 891 },
  { scope: '13t', name: '多摩', cities: 30, easy: 30, difficult: 638 },
  { scope: '13i', name: '島しょ', cities: 9, easy: 9, difficult: 40 },
]

describe('地域の母集団（実データ）', () => {
  it.each(EXPECTED)('$name（$scope）の市区町村名は $easy 件・町名も含めて $difficult 件', async (row) => {
    const easy = await buildPool('e', row.scope, source)
    expect(easy.questions).toHaveLength(row.easy)
    expect(easy.questions.every((q) => subregionOf(q.lgCode)?.id === row.scope)).toBe(true)

    const difficult = await buildPool('d', row.scope, source)
    expect(difficult.questions).toHaveLength(row.difficult)
    expect(difficult.questions.every((q) => subregionOf(q.lgCode)?.id === row.scope)).toBe(true)
  })

  it.each(EXPECTED)('$name の全市区町村名は $cities 件（easy.json に無い名前も含む）', async (row) => {
    expect(await municipalityQuestions(row.scope, source)).toHaveLength(row.cities)
  })

  it('地域は都道府県へ広げない（島しょは 9 件でも widened が立たない）', async () => {
    const pool = await buildPool('e', '13i', source)
    expect(pool.questions.length).toBeLessThan(MIN_POOL_FOR_SCOPE)
    expect(pool.widened).toBe(false)
    expect(pool.scope).toBe('13i')
  })

  it('地域の 10 問は setId に 3 文字の scope が残り、その地域だけから出る', async () => {
    const set = await buildQuestionSet('e', '01c', '0417', source)
    expect(set.setId).toBe(`${DATA_VERSION}-e-01c-0417`)
    expect(set.scope).toBe('01c')
    expect(set.widened).toBe(false)
    expect(set.questions).toHaveLength(QUESTIONS_PER_SET)
    expect(set.questions.every((q) => subregionOf(q.lgCode)?.id === '01c')).toBe(true)
  })

  it('島しょ × 市区町村名は 10 問を組めず、全市区町村名なら 9 問になる', async () => {
    await expect(buildQuestionSet('e', '13i', '0417', source)).rejects.toThrow(
      /島しょの市区町村名は 9 件しかないので、10 問を組めません/,
    )

    const set = await buildQuestionSet('e', '13i', '0417', source, true)
    expect(set.setId).toBe(`${DATA_VERSION}-e-13i-0417-all`)
    expect(set.all).toBe(true)
    expect(set.questions).toHaveLength(9)

    // 市区町村名＋町名なら 40 件あるので 10 問を組める
    const difficult = await buildQuestionSet('d', '13i', '0417', source)
    expect(difficult.questions).toHaveLength(QUESTIONS_PER_SET)
  })
})
