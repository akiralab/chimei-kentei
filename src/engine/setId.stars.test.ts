import { describe, expect, it } from 'vitest'
import { buildSetId, canHaveStars, parseSetId, parseStarsSegment } from './setId.ts'

const VER = 'abr20260925r2'

describe('難易度（-s{1,2,3}）のセット ID', () => {
  it('市区町村名のときだけ末尾に -s{n} が付き、同じ値に戻る', () => {
    expect(buildSetId(VER, 'e', '12', '0417', false, 3)).toBe(`${VER}-e-12-0417-s3`)
    expect(parseSetId(`${VER}-e-12-0417-s3`)).toEqual({
      dataVersion: VER,
      mode: 'e',
      scope: '12',
      seed: '0417',
      all: false,
      stars: 3,
    })
    expect(parseSetId(`${VER}-e-12-0417-s1`)?.stars).toBe(1)
    expect(parseSetId(`${VER}-e-00-0417-s2`)?.stars).toBe(2)
    // 地域（3 文字）・市区町村（6 桁）でも難易度は付けられる
    expect(parseSetId(`${VER}-e-01c-0417-s2`)?.stars).toBe(2)
    expect(parseSetId(`${VER}-e-122165-0417-s2`)?.stars).toBe(2)
  })

  it('-all と組み合わせるときは all が先（-all-s2）', () => {
    expect(buildSetId(VER, 'e', '12', '0417', true, 2)).toBe(`${VER}-e-12-0417-all-s2`)
    expect(parseSetId(`${VER}-e-12-0417-all-s2`)).toEqual({
      dataVersion: VER,
      mode: 'e',
      scope: '12',
      seed: '0417',
      all: true,
      stars: 2,
    })
    // 並べ替えた ID は読まない（形式を 1 つに決めて、同じ条件が 2 通りに書けないようにする）
    expect(parseSetId(`${VER}-e-12-0417-s2-all`)).toBeNull()
  })

  it('難易度を渡さなければ従来どおりの ID で、stars は null として分解される', () => {
    expect(buildSetId(VER, 'e', '12', '0417')).toBe(`${VER}-e-12-0417`)
    expect(buildSetId(VER, 'e', '12', '0417', true)).toBe(`${VER}-e-12-0417-all`)
    expect(parseSetId(`${VER}-e-12-0417`)?.stars).toBeNull()
    expect(parseSetId(`${VER}-e-12-0417-all`)?.stars).toBeNull()
    expect(parseSetId(`${VER}-d-12-0417`)?.stars).toBeNull()
  })

  it('★ は 1〜3 だけ。s0 / s4 / s / s12 は読まない', () => {
    for (const bad of ['s0', 's4', 's', 's12', 's1x', 'S1', 'star1']) {
      expect(parseStarsSegment(bad)).toBeNull()
      expect(parseSetId(`${VER}-e-12-0417-${bad}`)).toBeNull()
    }
    expect(parseStarsSegment('s1')).toBe(1)
    expect(parseStarsSegment('s3')).toBe(3)
    // buildSetId も範囲外を弾く（呼び出し側の型をすり抜けてきたとき）
    expect(() => buildSetId(VER, 'e', '12', '0417', false, 0 as 1)).toThrow(/難易度/)
    expect(() => buildSetId(VER, 'e', '12', '0417', false, 4 as 1)).toThrow(/難易度/)
  })

  it('町名（d）に難易度は付かない', () => {
    expect(canHaveStars('e')).toBe(true)
    expect(canHaveStars('d')).toBe(false)
    expect(() => buildSetId(VER, 'd', '12', '0417', false, 3)).toThrow(/難易度/)
    expect(parseSetId(`${VER}-d-12-0417-s3`)).toBeNull()
    expect(parseSetId(`${VER}-d-12-0417-all-s3`)).toBeNull()
  })

  it('余った区切りは読まない（7 つ組・重複）', () => {
    expect(parseSetId(`${VER}-e-12-0417-all-s2-s2`)).toBeNull()
    expect(parseSetId(`${VER}-e-12-0417-s2-s2`)).toBeNull()
    expect(parseSetId(`${VER}-e-12-0417-all-all`)).toBeNull()
  })
})
