// @vitest-environment jsdom
/**
 * これまでのランキング画面（トップ＋都道府県の詳細）。
 * ストアは Local（localStorage）を使い、問題バンクの meta と地図は fetch をモックして返す。
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ResultEntry } from '../engine/types.ts'
import { DATA_VERSION } from '../engine/bank.ts'
import { LocalRankingStore, rankingKey } from '../engine/ranking.ts'
import { resetGeoSource } from '../geo/load.ts'
import { JAPAN_FIXTURE } from '../geo/__fixtures__/geo.ts'
import { EASY_12, META } from '../engine/__fixtures__/questions.ts'
import { quizPath } from '../router.ts'
import Ranking from './Ranking.tsx'

const SET_12A = `${DATA_VERSION}-e-12-1234`
const SET_12B = `${DATA_VERSION}-d-120001-5678`
const SET_13 = `${DATA_VERSION}-e-13-1234`
const SET_00 = `${DATA_VERSION}-e-00-1234`

function entry(over: Partial<ResultEntry> & { entryId: string; setId: string }): ResultEntry {
  return {
    nickname: over.entryId,
    score: 70,
    timeMs: 30_000,
    answers: [],
    clientToken: 'tok-a',
    createdAt: '2026-10-02T01:00:00.000Z',
    ...over,
  }
}

function put(setId: string, entries: ResultEntry[]): void {
  localStorage.setItem(rankingKey(setId), JSON.stringify(entries))
}

/** meta.json と geo/japan.json を返す fetch。地図を使わない検証では withMap=false */
function installFetchMock(withMap = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url.endsWith('/meta.json')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(META) })
      }
      if (withMap && url.endsWith('/geo/japan.json')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JAPAN_FIXTURE) })
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('not found')) })
    }),
  )
}

function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.ranking__row')]
}

function hash(): string {
  return window.location.hash
}

beforeEach(() => {
  localStorage.clear()
  resetGeoSource()
  window.location.hash = '#/ranking'
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('トップ（都道府県ごとの人数）', () => {
  beforeEach(() => {
    // 千葉県は 2 セット・2 端末、東京都は 1 件、全国も 1 件
    put(SET_12A, [entry({ entryId: 'a', setId: SET_12A, clientToken: 'tok-a' })])
    put(SET_12B, [entry({ entryId: 'b', setId: SET_12B, clientToken: 'tok-b' })])
    put(SET_13, [entry({ entryId: 'c', setId: SET_13, clientToken: 'tok-a' })])
    put(SET_00, [entry({ entryId: 'd', setId: SET_00, clientToken: 'tok-a' })])
  })

  it('全国と都道府県の人数が並び、登録件数が見出しに出る', async () => {
    installFetchMock()
    render(<Ranking />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '千葉県 2人が回答' })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: '全国 1人が回答' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '東京都 1人が回答' })).toBeInTheDocument()
    expect(screen.getByText(/登録 4 件/)).toBeInTheDocument()
  })

  it('都道府県のボタンで #/ranking/{prefCode} へ移る', async () => {
    installFetchMock()
    render(<Ranking />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '千葉県 2人が回答' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '千葉県 2人が回答' }))
    expect(hash()).toBe('#/ranking/12')
  })

  it('地図の県をクリックしても詳細へ移る', async () => {
    installFetchMock()
    render(<Ranking />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '東京都' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '東京都' }))
    expect(hash()).toBe('#/ranking/13')
  })

  it('地図が読めなければ注記を出し、一覧だけで成立する', async () => {
    installFetchMock(false)
    render(<Ranking />)

    await waitFor(() => {
      expect(screen.getByText(/地図を読み込めませんでした/)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: '千葉県 2人が回答' })).toBeInTheDocument()
  })

  it('登録の無い都道府県のボタンは押せない', async () => {
    localStorage.clear()
    put(SET_13, [entry({ entryId: 'c', setId: SET_13 })])
    installFetchMock()
    render(<Ranking />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '東京都 1人が回答' })).toBeEnabled()
    })
    expect(screen.getByRole('button', { name: '千葉県 0人が回答' })).toBeDisabled()
  })
})

describe('都道府県の詳細', () => {
  beforeEach(() => {
    put(SET_12A, [
      entry({ entryId: 'a', setId: SET_12A, nickname: 'たろう', score: 80, timeMs: 40_000, clientToken: 'tok-a' }),
      entry({ entryId: 'b', setId: SET_12A, nickname: 'はなこ', score: 100, timeMs: 90_000, clientToken: 'tok-b' }),
    ])
    put(SET_12B, [
      entry({ entryId: 'c', setId: SET_12B, nickname: 'じろう', score: 60, timeMs: 20_000, clientToken: 'tok-c' }),
    ])
  })

  it('得点降順に並び、科目・範囲・登録日・挑戦リンクが出る', async () => {
    installFetchMock()
    render(<Ranking prefCode="12" />)

    await waitFor(() => {
      expect(rows()).toHaveLength(3)
    })
    expect(rows().map((r) => r.querySelector('.ranking__name')?.textContent)).toEqual(['はなこ', 'たろう', 'じろう'])
    expect(rows()[0].textContent).toContain('100点')
    expect(rows()[0].textContent).toContain('easy')
    expect(rows()[0].textContent).toContain('千葉県')
    expect(rows()[0].textContent).toContain('2026-10-02')
    // difficult の行は 6 桁スコープ → 市区町村名で出す
    expect(rows()[2].textContent).toContain('difficult')
    expect(rows()[2].textContent).toContain(EASY_12[0].display)

    const links = [...document.querySelectorAll<HTMLAnchorElement>('a.btn')]
    expect(links).toHaveLength(3)
    expect(links[0].getAttribute('href')).toBe(quizPath(SET_12A))
    expect(screen.getByRole('heading', { name: '千葉県のランキング' })).toBeInTheDocument()
  })

  it('科目で絞り込める', async () => {
    installFetchMock()
    render(<Ranking prefCode="12" />)
    await waitFor(() => {
      expect(rows()).toHaveLength(3)
    })

    fireEvent.click(screen.getByRole('button', { name: 'difficult' }))
    expect(rows()).toHaveLength(1)
    expect(rows()[0].textContent).toContain('じろう')

    fireEvent.click(screen.getByRole('button', { name: 'easy' }))
    expect(rows()).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'すべて' }))
    expect(rows()).toHaveLength(3)
  })

  it('登録が無ければ「まだ登録がありません。」', async () => {
    installFetchMock()
    render(<Ranking prefCode="47" />)
    await waitFor(() => {
      expect(screen.getByText('まだ登録がありません。')).toBeInTheDocument()
    })
    expect(rows()).toHaveLength(0)
  })

  it('タイトルへ戻る / もう一度 / 一覧へ の 3 つを置く', async () => {
    installFetchMock()
    render(<Ranking prefCode="12" />)
    await waitFor(() => {
      expect(rows()).toHaveLength(3)
    })

    expect(screen.getByRole('button', { name: 'もう一度（範囲選択へ）' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '都道府県の一覧へ' }))
    expect(hash()).toBe('#/ranking')

    fireEvent.click(screen.getByRole('button', { name: 'タイトルへ戻る' }))
    expect(hash()).toBe('#/')
  })
})

describe('ストアが失敗したとき', () => {
  it('「ランキングに接続できませんでした。」を出す', async () => {
    installFetchMock()
    const spy = vi
      .spyOn(LocalRankingStore.prototype, 'prefectureStats')
      .mockRejectedValue(new Error('ランキングを取得できませんでした（503）'))
    try {
      render(<Ranking />)
      await waitFor(() => {
        expect(screen.getByText('ランキングに接続できませんでした。')).toBeInTheDocument()
      })
      expect(document.querySelector('.pref-grid')).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })
})
