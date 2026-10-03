// @vitest-environment jsdom
/**
 * 表紙。氏名が入るまで主ボタンは押せず、「今日の10問」は全国・市区町村名・★★★・日付シードの
 * 共通セット（誰が・どの端末で押しても同じ setId）へ 1 タップで入る。
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DATA_VERSION } from '../engine/bank.ts'
import { NICKNAME_KEY } from '../hooks/useNickname.ts'
import { todaySeed } from '../engine/setId.ts'
import Cover from './Cover.tsx'

/** 全国 × 市区町村名 × ★★★ × 日付シード。★★★ は末尾の `-s3` */
const TODAY_SET = `${DATA_VERSION}-e-00-${todaySeed()}-s3`

function hash(): string {
  return window.location.hash
}

function startBtn(): HTMLElement {
  return screen.getByRole('button', { name: 'はじめる' })
}

function todayBtn(): HTMLElement {
  // 読み上げ名には難易度も入る（見える字は 375px に収めるため「今日の10問（全国）」のまま）
  return screen.getByRole('button', { name: '今日の10問（全国・難易度 3）' })
}

function typeNickname(value: string): void {
  fireEvent.change(screen.getByRole('textbox'), { target: { value } })
}

beforeEach(() => {
  localStorage.clear()
  window.location.hash = '#/'
})

afterEach(() => {
  cleanup()
})

describe('表紙のボタン', () => {
  it('氏名が未入力なら主ボタンは 2 つとも押せない', () => {
    render(<Cover />)
    expect(startBtn()).toBeDisabled()
    expect(todayBtn()).toBeDisabled()
  })

  it('「今日の10問」は「はじめる」と同じ主ボタンの格で置く', () => {
    render(<Cover />)
    expect(todayBtn().className).toContain('btn--primary')
    expect(startBtn().className).toContain('btn--primary')
  })

  it('見える字は「今日の10問（全国）」のままで、★★★ は下の注記で伝える', () => {
    render(<Cover />)
    expect(todayBtn().textContent).toBe('今日の10問（全国）')
    expect(document.querySelector('.cover__today-note')?.textContent).toBe('今日の10問は全国の★★★難易度 3から出題。')
    // ★ の記号は読み上げから外し、言い換えだけを読ませる
    expect(document.querySelector('.cover__today-note .stars')).toHaveAttribute('aria-hidden', 'true')
  })

  it('氏名を入れると「今日の10問」で全国・市区町村名・★★★・日付シードの出題へ移る', () => {
    render(<Cover />)
    typeNickname('たろう')
    expect(todayBtn()).toBeEnabled()

    fireEvent.click(todayBtn())
    expect(hash()).toBe(`#/q/${TODAY_SET}`)
    expect(localStorage.getItem(NICKNAME_KEY)).toBe('たろう')
  })

  it('同じ日なら何度押しても同じ setId（全員が同じ 10 問を解く）', () => {
    render(<Cover />)
    typeNickname('たろう')
    fireEvent.click(todayBtn())
    const first = hash()

    window.location.hash = '#/'
    cleanup()
    render(<Cover />)
    fireEvent.click(todayBtn())
    expect(hash()).toBe(first)
  })

  it('前後に空白のある氏名でも trim して保存する', () => {
    render(<Cover />)
    typeNickname('  はなこ  ')
    fireEvent.click(todayBtn())
    expect(localStorage.getItem(NICKNAME_KEY)).toBe('はなこ')
  })

  it('「はじめる」は範囲選択へ、Enter キーも範囲選択へ', () => {
    render(<Cover />)
    typeNickname('たろう')

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(hash()).toBe('#/select')

    window.location.hash = '#/'
    fireEvent.click(startBtn())
    expect(hash()).toBe('#/select')
  })
})
