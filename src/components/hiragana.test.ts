/**
 * hiragana.ts のテスト（純粋関数なので node 環境でよい）。
 * 「変換キーを押さなくても読みが入る」ことが要件なので、ローマ字入力の
 * 例外（拗音・促音・撥音・長音）を主に固定する。
 */
import { describe, expect, it } from 'vitest'
import {
  hasUnconvertible,
  isKanaOnly,
  pushStroke,
  romajiFromKeyCode,
  splitHiragana,
  toHiraganaStrict,
} from './hiragana.ts'

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

describe('isKanaOnly — IME が漢字に変換して確定したかの判定', () => {
  it('かな・長音・濁点だけなら true', () => {
    expect(isKanaOnly('そうさ')).toBe(true)
    expect(isKanaOnly('ソウサ')).toBe(true)
    expect(isKanaOnly('ｿｳｻ')).toBe(true)
    expect(isKanaOnly('くまーた')).toBe(true)
    expect(isKanaOnly('')).toBe(true)
  })

  it('漢字・英数・記号が混じれば false', () => {
    expect(isKanaOnly('匝瑳')).toBe(false)
    expect(isKanaOnly('はつかいち市')).toBe(false)
    expect(isKanaOnly('sousa')).toBe(false)
    expect(isKanaOnly('そうさ！')).toBe(false)
  })
})

describe('romajiFromKeyCode / pushStroke — 打鍵列の復元', () => {
  it('英字キーは配列によらず小文字のローマ字になる', () => {
    expect(romajiFromKeyCode('KeyS')).toBe('s')
    expect(romajiFromKeyCode('KeyA')).toBe('a')
  })

  it('Minus は長音の素（-）', () => {
    expect(romajiFromKeyCode('Minus')).toBe('-')
  })

  it('変換・スペース・Enter・矢印・数字は無視する', () => {
    for (const code of ['Space', 'Enter', 'Convert', 'NonConvert', 'ArrowLeft', 'Digit1', 'ShiftLeft', '']) {
      expect(romajiFromKeyCode(code)).toBe('')
    }
  })

  it('打鍵列を積んで Backspace で戻せる', () => {
    let buf = ''
    for (const code of ['KeyS', 'KeyO', 'KeyU', 'KeyS', 'KeyA']) buf = pushStroke(buf, code)
    expect(buf).toBe('sousa')
    expect(toHiraganaStrict(buf)).toBe('そうさ')

    for (const code of ['Backspace', 'Backspace', 'KeyK', 'KeyI']) buf = pushStroke(buf, code)
    expect(buf).toBe('souki')
    expect(toHiraganaStrict(buf)).toBe('そうき')
  })

  it('空の打鍵列への Backspace・無視キーは何も変えない', () => {
    expect(pushStroke('', 'Backspace')).toBe('')
    expect(pushStroke('sou', 'Space')).toBe('sou')
    expect(pushStroke('sou', '')).toBe('sou')
  })

  it('Minus を挟むと長音になる', () => {
    let buf = ''
    for (const code of ['KeyK', 'KeyU', 'KeyM', 'KeyA', 'Minus', 'KeyT', 'KeyA']) buf = pushStroke(buf, code)
    expect(toHiraganaStrict(buf)).toBe('くまーた')
  })
})

describe('hasUnconvertible — 捨てる文字が混じっているか', () => {
  it.each([['匝瑳'], ['銚子'], ['はつかいち市'], ['ちょうし。'], ['12'], ['そうさ？']])(
    '%s はひらがなに直せない文字を含む',
    (raw) => {
      expect(hasUnconvertible(raw)).toBe(true)
    },
  )

  it.each([
    [''],
    ['そうさ'],
    ['ソウサ'],
    ['ｿｳｻ'],
    ['choushi'],
    ['CHOUSHI'],
    ['monzen'],
    ['kuma-ta'],
    ['そう さ'],
    ["sin'you"],
    ['くまーた'],
  ])('%s は全部ひらがなに直せる（何も捨てない）', (raw) => {
    expect(hasUnconvertible(raw)).toBe(false)
  })
})
