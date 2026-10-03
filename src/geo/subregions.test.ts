/**
 * 地域（北海道 4・東京都 3）の定義を **実データ**で検査する。
 * 読み込みは `import.meta.glob`（src/engine/bank.realdata.test.ts と同じ理由で node:fs は使わない）。
 *
 * 判定が団体コード頼みなので、データ版を上げて市町村合併が入ったらここで落ちる。
 * そのときは SUBREGIONS 側（市の明示リスト・振興局の連番範囲）を直す。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { BankMeta } from '../engine/types.ts'
import { DATA_VERSION } from '../engine/bank.ts'
import { SUBREGIONS, isSubregionScope, subregionById, subregionOf, subregionsOf, wholePrefLabel } from './subregions.ts'

const META_FILES = import.meta.glob<BankMeta>('../../public/questions/*/meta.json', { import: 'default' })

let meta: BankMeta

beforeAll(async () => {
  const hit = Object.entries(META_FILES).find(([path]) => path.includes(`/${DATA_VERSION}/`))
  if (!hit) throw new Error(`public/questions/${DATA_VERSION}/meta.json が無い（npm run build:questions）`)
  meta = await hit[1]()
})

/** prefCode の市区町村を地域 ID ごとに数える。どの地域にも入らなかったものは名前を返す */
function tally(prefCode: string): { counts: Record<string, number>; orphans: string[] } {
  const counts: Record<string, number> = {}
  const orphans: string[] = []
  for (const city of meta.cities.filter((c) => c.prefCode === prefCode)) {
    const sub = subregionOf(city.lgCode)
    if (!sub) orphans.push(`${city.lgCode} ${city.name}`)
    else counts[sub.id] = (counts[sub.id] ?? 0) + 1
  }
  return { counts, orphans }
}

describe('地域の定義', () => {
  it('北海道 4・東京都 3 で、ID は都道府県コード ＋ 1 文字', () => {
    expect(SUBREGIONS.map((s) => s.id)).toEqual(['01c', '01s', '01n', '01e', '13k', '13t', '13i'])
    expect(SUBREGIONS.every((s) => /^\d{2}[a-z]$/.test(s.id) && s.id.startsWith(s.prefCode))).toBe(true)
    expect(subregionsOf('01').map((s) => s.name)).toEqual(['道央', '道南', '道北', '道東'])
    expect(subregionsOf('13').map((s) => s.name)).toEqual(['23区', '多摩', '島しょ'])
    expect(subregionsOf('12')).toEqual([])
  })

  it('都道府県まるごとの選択肢名は北海道「全道」・東京都「全域」', () => {
    expect(wholePrefLabel('01')).toBe('全道')
    expect(wholePrefLabel('13')).toBe('全域')
    expect(wholePrefLabel('12')).toBeUndefined()
  })

  it('subregionById / isSubregionScope は実在する ID だけを通す', () => {
    expect(subregionById('01c')?.name).toBe('道央')
    expect(subregionById('01z')).toBeUndefined()
    expect(isSubregionScope('13i')).toBe(true)
    expect(isSubregionScope('01z')).toBe(false)
    expect(isSubregionScope('01')).toBe(false)
    expect(isSubregionScope('011002')).toBe(false)
  })
})

describe('地域の割り当て（実データ）', () => {
  it('北海道の 179 市町村がちょうど 1 つの地域に入り、件数が道庁の 4 区分と一致する', () => {
    const { counts, orphans } = tally('01')
    expect(orphans).toEqual([])
    expect(counts).toEqual({ '01c': 70, '01s': 18, '01n': 41, '01e': 50 })
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(179)
  })

  it('東京都の 62 市区町村がちょうど 1 つの地域に入り、23区 23・多摩 30・島しょ 9 になる', () => {
    const { counts, orphans } = tally('13')
    expect(orphans).toEqual([])
    expect(counts).toEqual({ '13k': 23, '13t': 30, '13i': 9 })
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(62)
  })

  it('北海道・東京都以外の市区町村はどの地域にも入らない', () => {
    const others = meta.cities.filter((c) => c.prefCode !== '01' && c.prefCode !== '13')
    expect(others.length).toBeGreaterThan(1000)
    expect(others.filter((c) => subregionOf(c.lgCode) !== undefined)).toEqual([])
  })

  it('6 桁でない・数字でないコードは undefined', () => {
    expect(subregionOf('01100')).toBeUndefined()
    expect(subregionOf('0110022')).toBeUndefined()
    expect(subregionOf('')).toBeUndefined()
    expect(subregionOf('01abcd')).toBeUndefined()
  })
})
