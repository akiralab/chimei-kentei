/**
 * 難易度 ★ を **実データ**で検査する（node 環境）。読み込みは bank.subregion.realdata.test.ts と同じ
 * `import.meta.glob`。
 *
 * ここが固定するのは 3 つ:
 *  - easy.json の全問が ★1〜3 を持ち、全国の件数が下の表と一致する
 *    （data/build_stars.py の軸を変えたらこの数字も動く ＝ 気づけるようにする）
 *  - 全市区町村名 × 難易度は、その都道府県のその ★ を **全件** 出す
 *  - 10 問に足りない組み合わせは案内して止まる（★ では珍しくない。README の注記参照）
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { BankMeta, Question, Stars } from './types.ts'
import { QUESTIONS_PER_SET } from './types.ts'
import type { BankSource } from './bank.ts'
import { DATA_VERSION, buildQuestionSet, municipalityQuestions } from './bank.ts'
import { STARS_CHOICES } from './stars.ts'

const EASY_FILES = import.meta.glob<Question[]>('../../public/questions/*/easy.json', { import: 'default' })
const META_FILES = import.meta.glob<BankMeta>('../../public/questions/*/meta.json', { import: 'default' })

function pick<T>(files: Record<string, () => Promise<T>>, suffix: string): Promise<T> {
  const hit = Object.entries(files).find(([path]) => path.includes(`/${DATA_VERSION}/`) && path.endsWith(suffix))
  if (!hit) throw new Error(`public/questions/${DATA_VERSION}/…${suffix} が無い（npm run build:questions）`)
  return hit[1]()
}

/** 全 1,700 件の ★ の分布（data/build_stars.py の既定・--major-exempt なし） */
const NATIONWIDE: Record<Stars, number> = { 1: 566, 2: 601, 3: 533 }
const EASY_TOTAL = 1700

let easy: Question[]
let source: BankSource

beforeAll(async () => {
  const [e, meta] = await Promise.all([pick(EASY_FILES, 'easy.json'), pick(META_FILES, 'meta.json')])
  easy = e
  source = {
    meta: () => Promise.resolve(meta),
    easy: () => Promise.resolve(e),
    difficult: () => Promise.resolve([]),
  }
})

function countIn(prefCode: string | null, stars: Stars): number {
  return easy.filter((q) => (prefCode === null || q.prefCode === prefCode) && q.stars === stars).length
}

describe('難易度 ★ の実データ', () => {
  it('easy の全問が ★1〜3 を持つ', () => {
    expect(easy).toHaveLength(EASY_TOTAL)
    expect(easy.every((q) => q.stars === 1 || q.stars === 2 || q.stars === 3)).toBe(true)
  })

  it.each(STARS_CHOICES)('全国の ★%i は NATIONWIDE の件数と一致する', (stars) => {
    expect(countIn(null, stars)).toBe(NATIONWIDE[stars])
  })

  it('3 つ合わせて easy の全件（取りこぼしも重複も無い）', () => {
    expect(NATIONWIDE[1] + NATIONWIDE[2] + NATIONWIDE[3]).toBe(EASY_TOTAL)
  })

  it('全国 × ★3 の 10 問はすべて ★3 で、母集団は全国の ★3 と同じ', async () => {
    const set = await buildQuestionSet('e', '00', '0417', source, false, 3)
    expect(set.setId).toBe(`${DATA_VERSION}-e-00-0417-s3`)
    expect(set.questions).toHaveLength(QUESTIONS_PER_SET)
    expect(set.questions.every((q) => q.stars === 3)).toBe(true)
    expect(new Set(set.questions.map((q) => q.id)).size).toBe(QUESTIONS_PER_SET)
  })

  // 北海道は ★3 が 79 件（最多）。全市区町村名で絞ると「道内の ★3 を全部」になる
  it('北海道 × ★3 × 全市区町村名は、その県のその ★ を全件出す', async () => {
    const want = countIn('01', 3)
    expect(want).toBeGreaterThan(QUESTIONS_PER_SET)

    const set = await buildQuestionSet('e', '01', '0417', source, true, 3)
    expect(set.setId).toBe(`${DATA_VERSION}-e-01-0417-all-s3`)
    expect(set.all).toBe(true)
    expect(set.stars).toBe(3)
    expect(set.questions).toHaveLength(want)
    expect(set.questions.every((q) => q.stars === 3 && q.prefCode === '01')).toBe(true)

    // 絞らなければ道内の easy 全件（＝ ★1+★2+★3）
    const whole = await municipalityQuestions('01', source)
    expect(whole).toHaveLength(countIn('01', 1) + countIn('01', 2) + countIn('01', 3))
  })

  it('地域（道東）× ★3 も、その地域のその ★ だけから出る', async () => {
    const set = await buildQuestionSet('e', '01e', '0417', source, true, 3)
    expect(set.setId).toBe(`${DATA_VERSION}-e-01e-0417-all-s3`)
    expect(set.questions.length).toBeGreaterThan(0)
    expect(set.questions.every((q) => q.stars === 3 && q.prefCode === '01')).toBe(true)
    // 道内の ★3 の一部（地域で絞れている）
    expect(set.questions.length).toBeLessThan(countIn('01', 3))
  })

  // 鳥取県の ★3 は 5 件。★ で絞ると 10 問に足りない組み合わせは珍しくない（47 × 3 のうち 71 通り）
  it('鳥取県 × ★3 は 10 問を組めず、件数と逃げ道を言って止まる', async () => {
    const want = countIn('31', 3)
    expect(want).toBeLessThan(QUESTIONS_PER_SET)

    await expect(buildQuestionSet('e', '31', '0417', source, false, 3)).rejects.toThrow(
      `鳥取県の市区町村名（★★★）は ${want} 件しかないので、${QUESTIONS_PER_SET} 問を組めません。全市区町村名で解いてください。`,
    )

    // 逃げ道（全市区町村名）はその件数で成立する
    const set = await buildQuestionSet('e', '31', '0417', source, true, 3)
    expect(set.questions).toHaveLength(want)
  })
})
