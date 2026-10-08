/**
 * 難易度 ★ を **実データ**で検査する（node 環境）。読み込みは bank.subregion.realdata.test.ts と同じ
 * `import.meta.glob`。
 *
 * ここが固定するのは 5 つ:
 *  - easy.json の全問が ★1〜3 を持ち、全国の件数が下の表と一致する
 *    （data/build_stars.py の軸を変えたらこの数字も動く ＝ 気づけるようにする）
 *  - difficult（町名）も全問が ★1〜3 を持ち、全国の件数が下の表と一致する（Issue #46）
 *  - 全市区町村名 × 難易度は、その都道府県のその ★ を **全件** 出す
 *  - 全町名 × 難易度は、その市区町村のその ★ を **全件** 出し、件数が meta.cities と合う
 *  - 10 問に足りない組み合わせは案内して止まる（★ では珍しくない。README の注記参照）
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { BankMeta, Question, Stars } from './types.ts'
import { QUESTIONS_PER_SET } from './types.ts'
import type { BankSource } from './bank.ts'
import { DATA_VERSION, allQuestions, buildQuestionSet } from './bank.ts'
import { STARS_CHOICES } from './stars.ts'

const EASY_FILES = import.meta.glob<Question[]>('../../public/questions/*/easy.json', { import: 'default' })
const META_FILES = import.meta.glob<BankMeta>('../../public/questions/*/meta.json', { import: 'default' })
const DIFFICULT_FILES = import.meta.glob<Question[]>('../../public/questions/*/difficult/*.json', { import: 'default' })

function pick<T>(files: Record<string, () => Promise<T>>, suffix: string): Promise<T> {
  const hit = Object.entries(files).find(([path]) => path.includes(`/${DATA_VERSION}/`) && path.endsWith(suffix))
  if (!hit) throw new Error(`public/questions/${DATA_VERSION}/…${suffix} が無い（npm run build:questions）`)
  return hit[1]()
}

/** 全 1,700 件の ★ の分布（data/build_stars.py の既定・--major-exempt なし） */
const NATIONWIDE: Record<Stars, number> = { 1: 566, 2: 601, 3: 533 }
const EASY_TOTAL = 1700

/**
 * **出題できる**町名 107,336 件の ★ の分布（judge_towns ＝ B2×B4×B5。Issue #46 の案 C）。
 * JSON の配列は 107,681 件だが、ルール h の `skip` 345 件は meta の件数から除く。
 * skip の 345 件はすべて ★★★（読みを音訓で分解できない）なので、
 * 減ったのは ★★★ だけ（Issue #50）。
 *
 * Issue #54 で町名の B2 に「五段動詞の連用形」と「地名で定着した名乗りの表
 * （data/stars_manual.tsv）」を入れ、名乗りでしか読めなかった 5,823 件が
 * ★★★ → ★★ に落ちた（★★ 40,931 → 46,754 ／ ★★★ 27,542 → 21,719。★ は不変）
 */
const TOWNS_NATIONWIDE: Record<Stars, number> = { 1: 38_863, 2: 46_754, 3: 21_719 }
const TOWNS_TOTAL = 107_336

/** 全町名の検算に使う市区町村（Issue #46 のセット ID 例 `-d-122351-1234-all`） */
const SOUSA = '122351'

let easy: Question[]
let meta: BankMeta
let difficult12: Question[]
let source: BankSource

beforeAll(async () => {
  const [e, m, d12] = await Promise.all([
    pick(EASY_FILES, 'easy.json'),
    pick(META_FILES, 'meta.json'),
    pick(DIFFICULT_FILES, 'difficult/12.json'),
  ])
  easy = e
  meta = m
  difficult12 = d12
  source = {
    meta: () => Promise.resolve(m),
    easy: () => Promise.resolve(e),
    difficult: (prefCode: string) => Promise.resolve(prefCode === '12' ? d12 : []),
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
    const whole = await allQuestions('e', '01', source)
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

describe('町名の難易度 ★ の実データ（Issue #46）', () => {
  it('meta の difficultStars が全国で TOWNS_NATIONWIDE と一致する', () => {
    const sum: Record<Stars, number> = { 1: 0, 2: 0, 3: 0 }
    let total = 0
    for (const p of meta.prefectures) {
      for (const s of STARS_CHOICES) sum[s] += p.difficultStars[s - 1]
      total += p.difficultCount
      expect(p.difficultStars.reduce((a, b) => a + b, 0), `${p.code} ${p.name}`).toBe(p.difficultCount)
    }
    expect(total).toBe(TOWNS_TOTAL)
    expect(sum).toEqual(TOWNS_NATIONWIDE)
  })

  it('meta の townStars の合計が towns と一致し、都道府県の difficultStars に積み上がる', () => {
    const byPref = new Map<string, [number, number, number]>()
    for (const c of meta.cities) {
      expect(c.townStars.reduce((a, b) => a + b, 0), `${c.lgCode} ${c.name}`).toBe(c.towns)
      const acc = byPref.get(c.prefCode) ?? [0, 0, 0]
      for (const s of STARS_CHOICES) acc[s - 1] += c.townStars[s - 1]
      byPref.set(c.prefCode, acc)
    }
    for (const p of meta.prefectures) {
      expect(byPref.get(p.code), `${p.code} ${p.name}`).toEqual(p.difficultStars)
    }
  })

  it('difficult/12.json の全問が ★1〜3 を持つ', () => {
    expect(difficult12.length).toBeGreaterThan(0)
    expect(difficult12.every((q) => q.stars === 1 || q.stars === 2 || q.stars === 3)).toBe(true)
  })

  it('全町名は meta.cities[].towns と同じ件数を出す（市区町村名は混ざらない）', async () => {
    const city = meta.cities.find((c) => c.lgCode === SOUSA)
    if (!city) throw new Error(`meta.cities に ${SOUSA} が無い`)
    const set = await buildQuestionSet('d', SOUSA, '1234', source, true)
    expect(set.setId).toBe(`${DATA_VERSION}-d-${SOUSA}-1234-all`)
    expect(set.questions).toHaveLength(city.towns)
    expect(set.questions.every((q) => q.lgCode === SOUSA && q.id.startsWith('o:'))).toBe(true)
  })

  it.each(STARS_CHOICES)('全町名 × ★%i は meta.cities[].townStars と同じ件数', async (stars) => {
    const city = meta.cities.find((c) => c.lgCode === SOUSA)
    if (!city) throw new Error(`meta.cities に ${SOUSA} が無い`)
    const set = await buildQuestionSet('d', SOUSA, '1234', source, true, stars)
    expect(set.setId).toBe(`${DATA_VERSION}-d-${SOUSA}-1234-all-s${stars}`)
    expect(set.questions).toHaveLength(city.townStars[stars - 1])
    expect(set.questions.every((q) => q.stars === stars)).toBe(true)
  })

  it('町名を含む科目 × ★ の 10 問も、その ★ だけから出る', async () => {
    const set = await buildQuestionSet('d', '12', '1234', source, false, 3)
    expect(set.setId).toBe(`${DATA_VERSION}-d-12-1234-s3`)
    expect(set.questions).toHaveLength(QUESTIONS_PER_SET)
    expect(set.questions.every((q) => q.stars === 3)).toBe(true)
  })
})
