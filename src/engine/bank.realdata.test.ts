/**
 * 生成済みの問題バンク（public/questions/{DATA_VERSION}/）そのものを検査する（node 環境）。
 * フィクスチャではなく実データを読むので、data/build_questions.py の出力と
 * src/engine の契約がずれたらここで落ちる（Issue #14 の再発防止）。
 *
 * 読み込みは `import.meta.glob`（Vite 標準）。node:fs を使うと tsconfig.app の
 * `types: ["vite/client"]` に @types/node が入っていないので tsc が通らない
 * （src/geo/project.realdata.test.ts と同じ理由）。glob のパターンは静的でなければ
 * ならないので、版のディレクトリは `*` で拾って DATA_VERSION のものだけを await する。
 * 旧版のディレクトリは残してあるが、eager: false なので読み込まれない。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { DATA_VERSION } from './bank.ts'
import { QUESTIONS_PER_SET } from './types.ts'
import type { BankMeta, Question } from './types.ts'

const EASY_FILES = import.meta.glob<Question[]>('../../public/questions/*/easy.json', { import: 'default' })
const META_FILES = import.meta.glob<BankMeta>('../../public/questions/*/meta.json', { import: 'default' })

function load<T>(files: Record<string, () => Promise<T>>, name: string): Promise<T> {
  const hit = Object.entries(files).find(([path]) => path.includes(`/${DATA_VERSION}/`))
  if (!hit) throw new Error(`public/questions/${DATA_VERSION}/${name} が無い（npm run build:questions）`)
  return hit[1]()
}

/** ルール e と同じ文字集合（々・〆 を含む漢字）。easy は 1 字でも含めば読みとして成立する */
const KANJI = /[々〆㐀-䶿一-鿿豈-﫿]|[\u{20000}-\u{2ebef}]/u

let easy: Question[]
let meta: BankMeta

/** prefCode -> easy の件数 */
function countByPref(list: Question[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const q of list) counts.set(q.prefCode, (counts.get(q.prefCode) ?? 0) + 1)
  return counts
}

beforeAll(async () => {
  easy = await load(EASY_FILES, 'easy.json')
  meta = await load(META_FILES, 'meta.json')
})

describe('問題バンク実データ / easy', () => {
  it('全エントリの display に漢字が 1 字以上ある（Issue #14）', () => {
    const kanaOnly = easy.filter((q) => !KANJI.test(q.display))
    expect(kanaOnly.map((q) => `${q.pref}${q.display}${q.suffix ?? ''}`)).toEqual([])
  })

  it('id が重複しない', () => {
    expect(new Set(easy.map((q) => q.id)).size).toBe(easy.length)
  })

  it('47 都道府県すべてに 1 セット分以上ある', () => {
    const counts = countByPref(easy)
    expect(counts.size).toBe(47)
    expect([...counts].filter(([, n]) => n < QUESTIONS_PER_SET)).toEqual([])
  })
})

describe('問題バンク実データ / meta', () => {
  it('dataVersion が DATA_VERSION と一致する', () => {
    expect(meta.dataVersion).toBe(DATA_VERSION)
  })

  it('prefectures の easyCount が easy.json の実数と一致する', () => {
    const counts = countByPref(easy)
    for (const p of meta.prefectures) {
      expect(p.easyCount, `${p.code} ${p.name}`).toBe(counts.get(p.code) ?? 0)
    }
  })

  it('cities は除外前の全市区町村を持つ（範囲選択と difficult の絞り込みに使う）', () => {
    expect(meta.cities.length).toBeGreaterThan(easy.length)
    const lgCodes = new Set(meta.cities.map((c) => c.lgCode))
    expect(easy.every((q) => lgCodes.has(q.lgCode))).toBe(true)
  })
})
