// @vitest-environment jsdom
/**
 * 画面への組み込み（配線）の確認。App.flow.test.tsx は geo を 404 にしたまま通る設計なので、
 * 「地図データが実際に読める」経路はこちらで押さえる。
 *
 * - 範囲・科目: 地方 → 都道府県 の 2 段階で scope が変わる
 * - 範囲・科目: 「今日の10問」が選択中の範囲・科目を引き継ぐ（不具合報告の再発防止）
 * - 出題: 左パネルに県内地図が出て、解答後に情報カードの中身が出る
 */
import '@testing-library/jest-dom/vitest'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DATA_VERSION } from '../engine/bank.ts'
import { DIFFICULT_12, EASY_ALL, META } from '../engine/__fixtures__/questions.ts'
import { JAPAN_FIXTURE, PREF_GEO_FIXTURE, STATS_FIXTURE } from '../geo/__fixtures__/geo.ts'
import { resetGeoSource } from '../geo/load.ts'
import { NICKNAME_KEY } from '../hooks/useNickname.ts'
import { todaySeed } from '../engine/setId.ts'
import { quizPath } from '../router.ts'
import App from '../App.tsx'

/** 問題バンクと地図データの両方を返す fetch */
function installFetchMock(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      const body =
        url.endsWith('/meta.json') ? META
        : url.endsWith('/easy.json') ? EASY_ALL
        : url.endsWith('/difficult/12.json') ? DIFFICULT_12
        : url.endsWith('/geo/japan.json') ? JAPAN_FIXTURE
        : url.endsWith('/geo/municipalities.json') ? STATS_FIXTURE
        : /\/geo\/pref\/(\d{2})\.json$/.test(url) ? PREF_GEO_FIXTURE[/\/geo\/pref\/(\d{2})\.json$/.exec(url)![1]]
        : undefined
      if (body === undefined) {
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('not found')) })
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
    }),
  )
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function renderAt(hash: string): void {
  window.location.hash = hash
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

beforeEach(() => {
  installFetchMock()
  // 既定ソースはモジュール内キャッシュを持つので、テストごとに作り直す
  resetGeoSource()
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem(NICKNAME_KEY, 'たろう')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('範囲・科目 への組み込み', () => {
  it('地方 → 都道府県 の 2 段階で範囲が変わる', async () => {
    renderAt('#/select')
    await waitFor(() => {
      expect(document.querySelector('.jp-map__svg')).not.toBeNull()
    })

    // 段階 1。フィクスチャの 12・13 はどちらも関東なので、出る地方は関東だけ
    expect(screen.getByText('地方をえらぶ')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '千葉県' })).toBeNull()
    expect(screen.getByRole('button', { name: '全国' })).toBeInTheDocument()
    expect(screen.getByLabelText('市区町村で絞る')).toBeInTheDocument()

    // 段階 2 へ
    fireEvent.click(screen.getByRole('button', { name: '関東地方' }))
    expect(screen.getByText('関東の都道府県をえらぶ')).toBeInTheDocument()

    // 地図のチップでもボタングリッドでも選べる。ここはグリッド側を押す
    fireEvent.click([...document.querySelectorAll('.jp-map__cell')].find((b) => b.textContent === '千葉県')!)
    expect(screen.getByText(/いまの範囲: 千葉県/)).toBeInTheDocument()
    expect(document.querySelector('.jp-map__path--selected[data-pref-code="12"]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '始める' }))
    await settle()
    expect(window.location.hash).toMatch(new RegExp(`^#/q/${DATA_VERSION}-e-12-\\d{4}$`))
  })

  it('「地方を選び直す」で段階 1 に戻る', async () => {
    renderAt('#/select')
    await waitFor(() => {
      expect(document.querySelector('.jp-map__svg')).not.toBeNull()
    })

    fireEvent.click(screen.getByRole('button', { name: '関東地方' }))
    fireEvent.click(screen.getByRole('button', { name: '地方を選び直す' }))

    expect(screen.getByText('地方をえらぶ')).toBeInTheDocument()
    expect(document.querySelector('.jp-map__grid')).toBeNull()
  })

  /** 不具合報告「東京都を選んだのに山梨県が出た」の再発防止。原因は全国固定だった「今日の10問」 */
  it('「今日の10問」は選んでいる範囲・科目を引き継ぐ', async () => {
    renderAt('#/select')
    await waitFor(() => {
      expect(document.querySelector('.jp-map__svg')).not.toBeNull()
    })

    // 既定（範囲未選択）は全国 easy
    expect(screen.getByRole('button', { name: '今日の10問（全国・easy）' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '関東地方' }))
    fireEvent.click([...document.querySelectorAll('.jp-map__cell')].find((b) => b.textContent === '東京都')!)
    fireEvent.click(screen.getByRole('button', { name: '今日の10問（東京都・easy）' }))
    await settle()
    expect(window.location.hash).toBe(`#/q/${DATA_VERSION}-e-13-${todaySeed()}`)
  })

  it('「今日の10問」は difficult を選んでいれば difficult で始まる', async () => {
    renderAt('#/select')
    await waitFor(() => {
      expect(document.querySelector('.jp-map__svg')).not.toBeNull()
    })

    fireEvent.click(screen.getByRole('button', { name: '関東地方' }))
    fireEvent.click([...document.querySelectorAll('.jp-map__cell')].find((b) => b.textContent === '千葉県')!)
    fireEvent.click(screen.getByRole('button', { name: /^difficult/ }))
    fireEvent.click(screen.getByRole('button', { name: '今日の10問（千葉県・difficult）' }))
    await settle()
    expect(window.location.hash).toBe(`#/q/${DATA_VERSION}-d-12-${todaySeed()}`)
  })
})

describe('出題 への組み込み', () => {
  it('左パネルに県内地図が出て、用紙はそのまま右に載る', async () => {
    renderAt(quizPath(`${DATA_VERSION}-e-12-1234`))

    await waitFor(() => {
      expect(document.querySelectorAll('.map-muni__path')).toHaveLength(3)
    })
    expect(document.querySelector('.layout__map')).not.toBeNull()
    // 用紙の中身はそのまま（.answer-input のロジックは触っていない）
    expect(document.querySelector('.layout__quiz > .paper')).not.toBeNull()
    expect(screen.getByLabelText('読みをひらがなで入力')).toBeInTheDocument()
  })

  it('「タイトルへ戻る」で答案を捨てて表紙へ（確認ダイアログなし）', async () => {
    const setId = `${DATA_VERSION}-e-12-1234`
    renderAt(quizPath(setId))
    await waitFor(() => {
      expect(screen.getByLabelText('読みをひらがなで入力')).toBeInTheDocument()
    })

    // 1 問だけ答えてから抜ける
    fireEvent.click(screen.getByRole('button', { name: '解答' }))
    fireEvent.click(screen.getByRole('button', { name: 'タイトルへ戻る' }))
    await settle()

    expect(window.location.hash).toBe('#/')
    expect(sessionStorage.getItem(`result:${setId}`)).toBeNull()
  })

  it('difficult の大字でも所属市区町村が強調され、解答後だけ情報カードが出る', async () => {
    // 大字 30 件はすべて 120001 所属なので、どの問でも強調先は 120001
    renderAt(quizPath(`${DATA_VERSION}-d-120001-1234`))

    await waitFor(() => {
      expect(document.querySelector('.map-muni__path--target')).not.toBeNull()
    })
    expect(document.querySelector('.map-muni__path--target')).toHaveAttribute('data-lg-code', '120001')
    // 枠は最初からある（解答で高さが動かないように）が、中身は伏せたまま
    expect(document.querySelector('.info-card')).toHaveClass('info-card--placeholder')
    expect(screen.queryByText('1,234,567')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '解答' }))
    await waitFor(() => {
      expect(document.querySelector('.info-card')).not.toHaveClass('info-card--placeholder')
    })
    expect(screen.getByText('1,234,567')).toBeInTheDocument()
    expect(screen.getByText('出典: 2020 年国勢調査（e-Stat 境界データ）')).toBeInTheDocument()
    // difficult は市区町村の読みが分からないので読みは空
    expect(document.querySelector('.info-card__reading')?.textContent).toBe('')
  })
})
