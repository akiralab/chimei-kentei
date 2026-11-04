import { describe, expect, it } from 'vitest'
import { containsNgWord, normalizeNickname } from './ngwords.ts'

describe('normalizeNickname', () => {
  it('全角英字・カタカナ・記号と長音をならす', () => {
    expect(normalizeNickname('ＡＤＭＩＮ')).toBe('admin')
    expect(normalizeNickname('バ カ')).toBe('ばか')
    expect(normalizeNickname('ア-ホ!')).toBe('あほ')
    expect(normalizeNickname('ウーン')).toBe('うん')
  })
})

describe('containsNgWord', () => {
  it.each(['死ね', 'ADMIN', 'ａｄｍｉｎ', '公式です', 'バカ', 'ば か', 'キチガイ', 'き.ち.が.い', '運営スタッフ'])(
    '%s は弾く',
    (name) => {
      expect(containsNgWord(name)).toBe(true)
    },
  )

  it.each(['https://x.jp', 'www.example', 'a@example.com', '09012345678'])('連絡先に見える %s は弾く', (name) => {
    expect(containsNgWord(name)).toBe(true)
  })

  // 完全一致の語を含むだけの普通の言葉や地名を巻き込まない
  it.each(['あきら', 'たろう', 'Ayako', '地図好き', 'しねま', 'かえろう', 'ばかうけ', '葛飾', 'くずは', 'かすみ', 'はげやま', '2026年組', 'フェラーリ', 'ころすけ', 'pineapple'])(
    '%s は通す',
    (name) => {
      expect(containsNgWord(name)).toBe(false)
    },
  )
})
