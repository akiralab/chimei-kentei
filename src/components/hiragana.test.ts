/**
 * hiragana.ts のテスト（純粋関数なので node 環境でよい）。
 * 「変換キーを押さなくても読みが入る」ことが要件なので、ローマ字入力の
 * 例外（拗音・促音・撥音・長音）を主に固定する。
 */
import { describe, expect, it } from 'vitest'
import { splitHiragana, toHiraganaStrict } from './hiragana.ts'

describe('toHiraganaStrict — ローマ字', () => {
  it('素直なローマ字をひらがなにする', () => {
    expect(toHiraganaStrict('sousa')).toBe('そうさ')
    expect(toHiraganaStrict('hatsukaichi')).toBe('はつかいち')
    expect(toHiraganaStrict('kakamigahara')).toBe('かかみがはら')
  })

  it('拗音・促音・濁音', () => {
    expect(toHiraganaStrict('juusou')).toBe('じゅうそう')
    expect(toHiraganaStrict('kya')).toBe('きゃ')
    expect(toHiraganaStrict('kka')).toBe('っか')
    expect(toHiraganaStrict('kippu')).toBe('きっぷ')
  })

  it('撥音 n は nn / n+子音 / 単独末尾 のどれでも ん になる', () => {
    expect(toHiraganaStrict('nn')).toBe('ん')
    expect(toHiraganaStrict("n'")).toBe('ん')
    expect(toHiraganaStrict('monzen')).toBe('もんぜん')
    expect(toHiraganaStrict('n')).toBe('ん')
  })

  it('長音記号「-」は「ー」になる', () => {
    expect(toHiraganaStrict('kuma-ta')).toBe('くまーた')
  })

  it('大文字で打ってもカタカナにしない', () => {
    expect(toHiraganaStrict('SOUSA')).toBe('そうさ')
    expect(toHiraganaStrict('Sousa')).toBe('そうさ')
  })
})

describe('toHiraganaStrict — ひらがな以外を落とす', () => {
  it('カタカナはひらがなにする（半角カタカナも）', () => {
    expect(toHiraganaStrict('ソウサ')).toBe('そうさ')
    expect(toHiraganaStrict('ｿｳｻ')).toBe('そうさ')
  })

  it('漢字は取り除く', () => {
    expect(toHiraganaStrict('匝瑳そうさ')).toBe('そうさ')
  })

  it('空白・記号は取り除く', () => {
    expect(toHiraganaStrict('そう さ')).toBe('そうさ')
    expect(toHiraganaStrict('そうさ！')).toBe('そうさ')
    expect(toHiraganaStrict('そう　さ')).toBe('そうさ')
  })

  it('空文字はそのまま', () => {
    expect(toHiraganaStrict('')).toBe('')
  })

  it('長音「ー」と ゔ・ゐ・ゑ は残す', () => {
    expect(toHiraganaStrict('ゔゐゑー')).toBe('ゔゐゑー')
    expect(toHiraganaStrict('ヴヰヱー')).toBe('ゔゐゑー')
  })
})

describe('splitHiragana — 打ちかけのローマ字', () => {
  it('かなになっていない末尾は pending に分ける', () => {
    expect(splitHiragana('monzen')).toEqual({ kana: 'もんぜ', pending: 'n' })
    expect(splitHiragana('s')).toEqual({ kana: '', pending: 's' })
    expect(splitHiragana('ts')).toEqual({ kana: '', pending: 'ts' })
  })

  it('1 文字ずつ打っていくと、かなが順に確定する', () => {
    const steps: string[] = []
    let shown = ''
    for (const ch of 'sousa') {
      const parts = splitHiragana(shown + ch)
      shown = parts.kana + parts.pending
      steps.push(parts.kana)
    }
    expect(steps).toEqual(['', 'そ', 'そう', 'そう', 'そうさ'])
    expect(shown).toBe('そうさ')
  })

  it('確定しているときは pending が空', () => {
    expect(splitHiragana('sousa')).toEqual({ kana: 'そうさ', pending: '' })
    expect(splitHiragana('')).toEqual({ kana: '', pending: '' })
  })
})
