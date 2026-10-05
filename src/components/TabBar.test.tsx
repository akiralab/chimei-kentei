// @vitest-environment jsdom
/**
 * 下タブバー（第 3 波 D1）。4 枚・現在地のグループ・置き場所（用紙の外）を確かめる。
 *
 * .board を描くのは App なので、置き場所は App ごと描いて見る（HowTo.test と同じ流儀）。
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { parseHash, resetNavigated } from '../router.ts'
import { tabGroupOf } from './tabs.ts'
import TabBar from './TabBar.tsx'
import App from '../App.tsx'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  resetNavigated()
  window.location.hash = '#/'
})

afterEach(cleanup)

/** タブの見える字を並び順で取る */
function labels(): string[] {
  return [...document.querySelectorAll('.tabbar__item')].map((el) => (el.textContent ?? '').trim())
}

describe('タブの枚数と行き先', () => {
  it('4 枚（検定・地名帳・順位・見直し）を <nav aria-label="メインメニュー"> に置く', () => {
    render(<TabBar route={parseHash('#/')} />)

    const nav = screen.getByRole('navigation', { name: 'メインメニュー' })
    expect(nav).toHaveClass('tabbar')
    expect(labels()).toEqual(['検定', '地名帳', '順位', '見直し'])
    expect([...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '#/',
      '#/atlas',
      '#/ranking',
      '#/review',
    ])
  })

  it('絵文字は使わない（文字だけ）', () => {
    render(<TabBar route={parseHash('#/')} />)
    // 絵文字・記号（U+1F300〜 と U+2190〜U+27BF）を 1 つも含まない
    for (const label of labels()) expect(label).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2190}-\u{27BF}]/u)
  })
})

describe('現在地（経路のグループ）', () => {
  // 「検定」は表紙から結果までの一連。あそびかた・挑戦状（＝出題）も検定に属する
  const cases: [string, string][] = [
    ['#/', '検定'],
    ['#/select', '検定'],
    ['#/q/abr20260925r2-e-12-1234', '検定'],
    ['#/result/abr20260925r2-e-12-1234', '検定'],
    ['#/howto', '検定'],
    ['#/atlas', '地名帳'],
    ['#/atlas/13', '地名帳'],
    ['#/atlas/13/131016', '地名帳'],
    ['#/ranking', '順位'],
    ['#/ranking/12', '順位'],
    ['#/review', '見直し'],
  ]

  for (const [path, expected] of cases) {
    it(`${path} は「${expected}」が現在地`, () => {
      render(<TabBar route={parseHash(path)} />)
      const current = [...document.querySelectorAll('.tabbar__item.is-current')]
      expect(current).toHaveLength(1)
      expect((current[0].textContent ?? '').trim()).toBe(expected)
      // 色（蛍光マーカー）だけに頼らず aria-current も付ける
      expect(current[0]).toHaveAttribute('aria-current', 'page')
      // 現在地以外には付けない
      expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    })
  }

  it('知らないハッシュは表紙に落ちるので「検定」', () => {
    expect(tabGroupOf(parseHash('#/nope'))).toBe('quiz')
  })
})

describe('置き場所と始末', () => {
  it('用紙（.paper）の外・黒板（.board）の中に 1 本だけ置く', () => {
    render(<App />)

    const navs = [...document.querySelectorAll('.tabbar')]
    expect(navs).toHaveLength(1)
    expect(navs[0].closest('.paper')).toBeNull()
    expect(navs[0].closest('.board')).not.toBeNull()
  })

  it('用紙ごとスクロールする画面（.board--scroll）でも同じ 1 本', () => {
    window.location.hash = '#/howto'
    render(<App />)

    expect(document.querySelector('.board')).toHaveClass('board--scroll')
    expect(document.querySelectorAll('.tabbar')).toHaveLength(1)
    expect(document.querySelector('.tabbar')?.closest('.paper')).toBeNull()
  })

  it('onLeave を渡すと、どのタブを押しても画面を離れる前に 1 回呼ぶ', () => {
    const onLeave = vi.fn()
    render(<TabBar route={parseHash('#/q/abr20260925r2-e-12-1234')} onLeave={onLeave} />)

    fireEvent.click(screen.getByRole('link', { name: '地名帳' }))
    expect(onLeave).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('link', { name: '検定' }))
    expect(onLeave).toHaveBeenCalledTimes(2)
  })

  it('onLeave が無くても押せる（出題以外の画面）', () => {
    render(<TabBar route={parseHash('#/')} />)
    fireEvent.click(screen.getByRole('link', { name: '見直し' }))
    expect(labels()).toHaveLength(4)
  })
})
