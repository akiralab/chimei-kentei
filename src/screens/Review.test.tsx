// @vitest-environment jsdom
/**
 * 「間違えた問題」画面。localStorage だけを見るので通信は出てこない。
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { WrongItem } from '../engine/wrongList.ts'
import { WRONG_LIST_KEY, readWrongList, writeWrongList } from '../engine/wrongList.ts'
import { DATA_VERSION } from '../engine/bank.ts'
import Review from './Review.tsx'

function item(over: Partial<WrongItem> & { questionId: string }): WrongItem {
  return {
    display: '匝瑳',
    answer: 'そうさ',
    input: 'しょうさ',
    pref: '千葉県',
    prefCode: '12',
    setId: `${DATA_VERSION}-e-12-1234`,
    mode: 'e',
    at: '2026-10-02T01:00:00.000Z',
    ...over,
  }
}

/** 古い順に並べて保存する（画面は新しい順に出す） */
function seed(items: WrongItem[]): void {
  writeWrongList(items)
}

function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.review__row')]
}

function hash(): string {
  return window.location.hash
}

beforeEach(() => {
  localStorage.clear()
  window.location.hash = '#/review'
})

afterEach(cleanup)

describe('記録があるとき', () => {
  beforeEach(() => {
    seed([
      item({ questionId: 'c:120001:匝瑳', display: '匝瑳', answer: 'そうさ', at: '2026-10-01T00:00:00.000Z' }),
      item({
        questionId: 'o:130001:放出東',
        display: '放出東',
        answer: 'はなてんひがし',
        input: '',
        pref: '東京都',
        prefCode: '13',
        city: '大阪市淀川区',
        setId: `${DATA_VERSION}-d-130001-1234`,
        mode: 'd',
        at: '2026-10-03T00:00:00.000Z',
      }),
    ])
  })

  it('新しい順に並び、漢字・正解・自分の入力・場所・日付が出る', () => {
    render(<Review />)

    expect(rows()).toHaveLength(2)
    expect(rows()[0].textContent).toContain('放出東')
    expect(rows()[1].textContent).toContain('匝瑳')

    // 正解は蛍光マーカー
    const markers = [...document.querySelectorAll<HTMLElement>('.review__answer .marker--yellow')]
    expect(markers.map((m) => m.textContent)).toEqual(['はなてんひがし', 'そうさ'])

    // 無記入は（無記入）と出す
    expect(rows()[0].querySelector('.review__mine')?.textContent).toBe('（無記入）')
    expect(rows()[1].querySelector('.review__mine')?.textContent).toBe('しょうさ')

    // difficult は所属市区町村まで、日付も出す
    expect(rows()[0].textContent).toContain('東京都・大阪市淀川区')
    expect(rows()[0].textContent).toContain('difficult')
    expect(rows()[0].textContent).toContain('2026-10-03')
    expect(rows()[1].textContent).toContain('easy')
    expect(screen.getByText(/2 問（新しい順）/)).toBeInTheDocument()
  })

  it('都道府県で絞り込める', () => {
    render(<Review />)
    const select = screen.getByLabelText('都道府県で絞り込む') as HTMLSelectElement

    // 記録がある県だけが選択肢に出る
    expect([...select.options].map((o) => o.textContent)).toEqual(['すべて（2問）', '千葉県', '東京都'])

    fireEvent.change(select, { target: { value: '12' } })
    expect(rows()).toHaveLength(1)
    expect(rows()[0].textContent).toContain('匝瑳')

    fireEvent.change(select, { target: { value: '13' } })
    expect(rows()).toHaveLength(1)
    expect(rows()[0].textContent).toContain('放出東')

    fireEvent.change(select, { target: { value: '' } })
    expect(rows()).toHaveLength(2)
  })

  it('「一覧を消す」は 2 回押しで確定する（確認ダイアログは出さない）', () => {
    render(<Review />)

    fireEvent.click(screen.getByRole('button', { name: '一覧を消す' }))
    // 1 回目は消えない。ラベルが確認に変わるだけ
    expect(rows()).toHaveLength(2)
    expect(readWrongList()).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'もう一度押すと消えます' }))
    expect(rows()).toHaveLength(0)
    expect(readWrongList()).toEqual([])
    expect(screen.getByText(/まだ記録がありません/)).toBeInTheDocument()
    // 消したら「一覧を消す」自体も消える
    expect(screen.queryByRole('button', { name: '一覧を消す' })).toBeNull()
  })

  it('「この県でもう一度」で範囲選択へ、「タイトルへ戻る」で表紙へ', () => {
    render(<Review />)

    fireEvent.click(screen.getByRole('button', { name: 'この県でもう一度' }))
    expect(hash()).toBe('#/select')

    fireEvent.click(screen.getByRole('button', { name: 'タイトルへ戻る' }))
    expect(hash()).toBe('#/')
  })
})

describe('記録が無いとき', () => {
  it('案内文を出し、絞り込みも消去ボタンも出さない', () => {
    render(<Review />)

    expect(screen.getByText(/まだ記録がありません/)).toBeInTheDocument()
    expect(rows()).toHaveLength(0)
    expect(screen.queryByLabelText('都道府県で絞り込む')).toBeNull()
    expect(screen.queryByRole('button', { name: '一覧を消す' })).toBeNull()
    // 戻る動線は残す
    expect(screen.getByRole('button', { name: 'タイトルへ戻る' })).toBeInTheDocument()
  })

  it('壊れた記録は無視して案内文を出す', () => {
    localStorage.setItem(WRONG_LIST_KEY, '{')
    render(<Review />)
    expect(screen.getByText(/まだ記録がありません/)).toBeInTheDocument()
  })
})
