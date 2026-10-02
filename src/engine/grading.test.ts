import { describe, expect, it } from 'vitest'
import { grade, normalizeReading } from './grading.ts'

describe('normalizeReading', () => {
  it('(1) 前後の空白（全角含む）を落とす', () => {
    expect(normalizeReading('  そうさ  ')).toBe('そうさ')
    expect(normalizeReading('　そうさ　')).toBe('そうさ')
  })

  it('(2) カタカナ → ひらがな', () => {
    expect(normalizeReading('ソウサ')).toBe('そうさ')
    expect(normalizeReading('ハナテンヒガシ')).toBe('はなてんひがし')
  })

  it('(3) 全角英数 → 半角', () => {
    expect(normalizeReading('１ちようめ')).toBe('1ちようめ')
    expect(normalizeReading('１ちょうめ')).toBe('1ちようめ') // (4) で ょ→よ も効く
    expect(normalizeReading('Ａｂ')).toBe('Ab')
  })

  it('(4) 小書き仮名 → 通常の大きさ', () => {
    expect(normalizeReading('じゅうそう')).toBe('じゆうそう')
    expect(normalizeReading('はっさく')).toBe('はつさく')
    expect(normalizeReading('ぁぃぅぇぉゃゅょっゎ')).toBe('あいうえおやゆよつわ')
    expect(normalizeReading('ジュウソウ')).toBe('じゆうそう')
  })

  it('(5) ぢ→じ・づ→ず', () => {
    expect(normalizeReading('あづみの')).toBe('あずみの')
    expect(normalizeReading('ぢ')).toBe('じ')
  })

  it('(6) ゐ→い・ゑ→え', () => {
    expect(normalizeReading('ゐゑ')).toBe('いえ')
  })

  it('長音符はそのまま残す', () => {
    expect(normalizeReading('そーさ')).toBe('そーさ')
  })
})

describe('grade', () => {
  it('カタカナ入力は正解', () => {
    expect(grade('ソウサ', 'そうさ')).toBe(true)
    expect(grade('そうさ', 'そうさ')).toBe(true)
  })

  it('長音符は代用にならない', () => {
    expect(grade('そーさ', 'そうさ')).toBe(false)
  })

  it('づ / ず は同一視', () => {
    expect(grade('あづみの', 'あずみの')).toBe(true)
    expect(grade('あずみの', 'あづみの')).toBe(true)
  })

  it('小書き仮名の揺れは同一視', () => {
    expect(grade('じゅうそう', 'じゆうそう')).toBe(true)
    expect(grade('じゆうそう', 'じゅうそう')).toBe(true)
  })

  it('空文字・空白のみは不正解', () => {
    expect(grade('', 'そうさ')).toBe(false)
    expect(grade('   ', 'そうさ')).toBe(false)
  })

  it('別の読みは不正解', () => {
    expect(grade('しょうさ', 'そうさ')).toBe(false)
  })
})
