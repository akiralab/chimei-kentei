// @vitest-environment jsdom
/**
 * あそびかた（#/howto）。読み込みも通信も無い静的な 1 枚なので、確かめるのは
 * 骨組みだけ ——  見出しの階層（h1 → h2 が 7 つ）・節 7 の出典リンク・
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

  it('用紙の中に「表紙へ」は置かない。戻るのは下タブバーの「検定」（第 3 波 D1）', () => {
    render(<App />)
    expect(screen.queryByRole('link', { name: '表紙へ' })).toBeNull()
    expect(document.querySelector('.howto__exit')).toBeNull()
    // jsdom はフラグメントへのリンクを click で辿らないので、行き先は href で見る
    const tab = screen.getByRole('link', { name: '検定' })
    expect(tab).toHaveAttribute('href', '#/')
    expect(tab.closest('.paper')).toBeNull()
  })

  it('節 7 に CC BY 4.0 のリンクと「加工して利用」がある（出典の正本。第 3 波 決定 ②）', () => {
    render(<App />)
    const link = screen.getByRole('link', { name: 'CC BY 4.0' })
    expect(link).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/deed.ja')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
    // 節 7 の中にあること（アプリ内で外部へ出るのはここ 1 か所だけ）
    const sections = [...document.querySelectorAll('.howto__section')]
    expect(sections[6]).toContainElement(link)
    expect(sections[6].textContent).toContain('加工して利用')
    // 用紙の外（.footer-credit）には出典を置かない
    expect(document.querySelector('.footer-credit')).toBeNull()
  })

  it('用紙ごと縦スクロールする画面なので .board に board--scroll が付く', () => {
    render(<App />)
    expect(document.querySelector('.board')).toHaveClass('board--scroll')
  })
})
