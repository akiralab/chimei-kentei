import { describe, expect, it } from 'vitest'
import {
  STARS_ALL,
  STARS_CHOICES,
  isStars,
  starsAria,
  starsHeaderNote,
  starsMark,
  starsRowNote,
  starsSwitchLabel,
} from './stars.ts'

describe('難易度の表示名', () => {
  it('記号は ★ の数（色に頼らず数で分かる）', () => {
    expect(starsMark(1)).toBe('★')
    expect(starsMark(2)).toBe('★★')
    expect(starsMark(3)).toBe('★★★')
  })

  it('読み上げは記号ではなく数で言う', () => {
    expect(starsAria(3)).toBe('難易度 3')
    expect(starsSwitchLabel(3)).toBe('難易度: ★3')
    expect(starsSwitchLabel(STARS_ALL)).toBe('難易度: 全部')
  })

  it('帯と順位表の注記', () => {
    expect(starsHeaderNote(2)).toBe('難易度: ★★')
    expect(starsRowNote(2)).toBe('★★のみ')
  })

  it('選べるのは 1〜3 の 3 つだけ', () => {
    expect(STARS_CHOICES).toEqual([1, 2, 3])
    expect(STARS_ALL).toBe(0)
    expect([0, 4, -1, 1.5].some(isStars)).toBe(false)
    expect(STARS_CHOICES.every(isStars)).toBe(true)
  })
})
