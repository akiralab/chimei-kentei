// @vitest-environment jsdom
/**
 * あそびかた（#/howto）。読み込みも通信も無い静的な 1 枚なので、確かめるのは
 * 骨組みだけ ——  見出しの階層（h1 → h2 が 7 つ）・表紙への戻り道・
 * 1 画面契約の例外（.board に board--scroll が付く）。
 *
 * .board を描くのは App なので、この画面だけ単体で描くと useBoardModifier の
 * 宣言が確かめられない。ハッシュを #/howto にして App ごと描く（Atlas.test と同じ）。
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { resetNavigated } from '../router.ts'
import App from '../App.tsx'

beforeEach(() => {
  localStorage.clear()
  resetNavigated()
  window.location.hash = '#/howto'
})

afterEach(cleanup)

describe('あそびかた', () => {
  it('見出しは h1「あそびかた」と 7 つの h2（階層を飛ばさない）', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('あそびかた')
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(7)
    // 中の見出しは h3 以降を使わない（h1 → h2 の 2 段だけ）
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0)
  })

  it('節 5「答え方」の蛍光マーカーは「市・区・町・村は書きません」の 1 か所だけ', () => {
    render(<App />)
    const markers = [...document.querySelectorAll('.howto .marker')]
    expect(markers.map((m) => m.textContent)).toEqual(['市・区・町・村は書きません'])
  })

  it('「表紙へ」で #/ へ戻れる。帯の右端と用紙の末尾の 2 か所に置く', () => {
    render(<App />)
    // jsdom はフラグメントへのリンクを click で辿らないので、行き先は href で見る
    // （表紙の副ボタンのテストと同じ流儀）
    const backs = screen.getAllByRole('link', { name: '表紙へ' })
    expect(backs).toHaveLength(2)
    for (const b of backs) {
      expect(b).toHaveAttribute('href', '#/')
      expect(b.className).toContain('btn--ghost')
    }
    // 1 つ目は帯の中（開いた直後に見える）、2 つ目は本文の後ろ（読み終えた位置から戻れる）
    expect(backs[0].closest('.paper__header')).not.toBeNull()
    expect(backs[1].closest('.paper__header')).toBeNull()
  })

  it('用紙ごと縦スクロールする画面なので .board に board--scroll が付く', () => {
    render(<App />)
    expect(document.querySelector('.board')).toHaveClass('board--scroll')
  })
})
