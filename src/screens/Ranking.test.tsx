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
import { RANKING_MODE_KEY } from '../hooks/useRankingMode.ts'
import { EASY_12, META } from '../engine/__fixtures__/questions.ts'
import { quizPath } from '../router.ts'
import Ranking from './Ranking.tsx'

const SET_12A = `${DATA_VERSION}-e-12-1234`
const SET_12B = `${DATA_VERSION}-d-120001-5678`
const SET_13 = `${DATA_VERSION}-e-13-1234`
const SET_00 = `${DATA_VERSION}-e-00-1234`
/** 千葉県の全市区町村名（10 問の 2 科目とは別区分） */
const SET_12ALL = `${DATA_VERSION}-e-12-0417-all`

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

/** 都道府県名の引き当てに meta.json だけ返す（この画面は地図を使わない） */
function installFetchMock(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url.endsWith('/meta.json')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(META) })
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('not found')) })
    }),
  )
}

function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.ranking__row')]
}

function el(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector)
  if (!found) throw new Error(`見つかりません: ${selector}`)
  return found
}

function hash(): string {
  return window.location.hash
}

beforeEach(() => {
  localStorage.clear() // 科目の設定（rankingMode）も毎回 easy に戻る
  window.location.hash = '#/ranking'
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('トップ（都道府県ごとの人数）', () => {
  beforeEach(() => {
    // 千葉県: easy 1 件（tok-a）＋ difficult 1 件（tok-b）、東京都: easy 1 件、全国: easy 1 件
    put(SET_12A, [entry({ entryId: 'a', setId: SET_12A, clientToken: 'tok-a' })])
    put(SET_12B, [entry({ entryId: 'b', setId: SET_12B, clientToken: 'tok-b' })])
    put(SET_13, [entry({ entryId: 'c', setId: SET_13, clientToken: 'tok-a' })])
    put(SET_00, [entry({ entryId: 'd', setId: SET_00, clientToken: 'tok-a' })])
  })

  it('地図は出さず、都道府県ボタンの一覧だけを出す', async () => {
    installFetchMock()
    render(<Ranking />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '千葉県 1人が回答（市区町村名）' })).toBeInTheDocument()
    })
    expect(document.querySelector('.jp-map')).toBeNull()
    expect(document.querySelector('.jp-map__svg')).toBeNull()
    expect(document.querySelector('.pref-grid')).not.toBeNull()
  })

  it('選んだ科目の人数だけを数える（既定は easy）', async () => {
    installFetchMock()
    render(<Ranking />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '千葉県 1人が回答（市区町村名）' })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: '全国 1人が回答（市区町村名）' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '東京都 1人が回答（市区町村名）' })).toBeInTheDocument()
    expect(screen.getByText(/市区町村名 ／ 登録 3 件/)).toBeInTheDocument()
  })

  it('difficult に切り替えると集計と色分けが切り替わる', async () => {
    installFetchMock()
    render(<Ranking />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '千葉県 1人が回答（市区町村名）' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '市区町村名＋町名' }))

    // difficult は千葉県だけ 1 件（tok-b）。東京都・全国は 0 件で押せない
    expect(screen.getByRole('button', { name: '千葉県 1人が回答（市区町村名＋町名）' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '東京都 0人が回答（市区町村名＋町名）' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '全国 0人が回答（市区町村名＋町名）' })).toBeDisabled()
    expect(screen.getByText(/市区町村名＋町名 ／ 登録 1 件/)).toBeInTheDocument()
  })

  it('登録がある都道府県だけラベルを蛍光マーカーで塗る', async () => {
    installFetchMock()
    render(<Ranking />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '千葉県 1人が回答（市区町村名）' })).toBeInTheDocument()
    })

    const marked = [...document.querySelectorAll<HTMLElement>('.pref-grid__item .marker--yellow')]
    expect(marked.map((m) => m.textContent)).toEqual(['全国 1人', '千葉県 1人', '東京都 1人'])
    // 0 件の県は塗らず、押せない
    expect(screen.getByRole('button', { name: '千葉県 1人が回答（市区町村名）' })).toBeEnabled()
  })

  it('都道府県のボタンで #/ranking/{prefCode} へ移る', async () => {
    installFetchMock()
    render(<Ranking />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '千葉県 1人が回答（市区町村名）' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: '千葉県 1人が回答（市区町村名）' }))
    expect(hash()).toBe('#/ranking/12')
  })

  it('科目の選択は localStorage に残り、詳細画面にも引き継ぐ', async () => {
    installFetchMock()
    render(<Ranking />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '千葉県 1人が回答（市区町村名）' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '市区町村名＋町名' }))
    expect(localStorage.getItem(RANKING_MODE_KEY)).toBe('d')

    cleanup()
    render(<Ranking prefCode="12" />)
    await waitFor(() => {
      expect(rows()).toHaveLength(1)
    })
    expect(rows()[0].textContent).toContain('市区町村名＋町名')
  })

  it('登録の無い都道府県のボタンは押せない', async () => {
    localStorage.clear()
    put(SET_13, [entry({ entryId: 'c', setId: SET_13 })])
    installFetchMock()
    render(<Ranking />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '東京都 1人が回答（市区町村名）' })).toBeEnabled()
    })
    expect(screen.getByRole('button', { name: '千葉県 0人が回答（市区町村名）' })).toBeDisabled()
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

  it('得点降順に並び、範囲・登録日・挑戦リンクが出る（既定の easy）', async () => {
    installFetchMock()
    render(<Ranking prefCode="12" />)

    await waitFor(() => {
      expect(rows()).toHaveLength(2)
    })
    expect(rows().map((r) => r.querySelector('.ranking__name')?.textContent)).toEqual(['はなこ', 'たろう'])
    expect(rows()[0].textContent).toContain('100点')
    expect(rows()[0].textContent).toContain('市区町村名')
    expect(rows()[0].textContent).toContain('千葉県')
    expect(rows()[0].textContent).toContain('2026-10-02')

    const links = [...document.querySelectorAll<HTMLAnchorElement>('a.btn')]
    expect(links).toHaveLength(2)
    expect(links[0].getAttribute('href')).toBe(quizPath(SET_12A))
    expect(screen.getByRole('heading', { name: '千葉県のランキング' })).toBeInTheDocument()
  })

  it('科目を切り替えるとストアから取り直す（6 桁スコープは市区町村名で出す）', async () => {
    installFetchMock()
    render(<Ranking prefCode="12" />)
    await waitFor(() => {
      expect(rows()).toHaveLength(2)
    })

    fireEvent.click(screen.getByRole('button', { name: '市区町村名＋町名' }))
    await waitFor(() => {
      expect(rows()).toHaveLength(1)
    })
    expect(rows()[0].textContent).toContain('じろう')
    expect(rows()[0].textContent).toContain('市区町村名＋町名')
    expect(rows()[0].textContent).toContain(EASY_12[0].display)

    fireEvent.click(screen.getByRole('button', { name: '市区町村名' }))
    await waitFor(() => {
      expect(rows()).toHaveLength(2)
    })
  })

  it('制限ありの行には ⏳ の印が付く', async () => {
    put(SET_13, [
      entry({ entryId: 'z', setId: SET_13, nickname: 'ぜろ', clientToken: 'tok-z', timeLimitMs: 20_000 }),
    ])
    installFetchMock()
    render(<Ranking prefCode="13" />)
    await waitFor(() => {
      expect(rows()).toHaveLength(1)
    })
    expect(el('.ranking__time').textContent).toContain('⏳20秒')
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
      expect(rows()).toHaveLength(2)
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

  it('「もう一度ためす」で取り直し、2 回目に成功すれば一覧が出る', async () => {
    installFetchMock()
    put(SET_12A, [entry({ entryId: 'a', setId: SET_12A, clientToken: 'tok-a' })])
    const spy = vi
      .spyOn(LocalRankingStore.prototype, 'prefectureStats')
      .mockRejectedValueOnce(new Error('ランキングを取得できませんでした（503）'))
    try {
      render(<Ranking />)
      await waitFor(() => {
        expect(screen.getByText('ランキングに接続できませんでした。')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'もう一度ためす' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '千葉県 1人が回答（市区町村名）' })).toBeInTheDocument()
      })
      expect(screen.queryByText('ランキングに接続できませんでした。')).toBeNull()
      expect(screen.queryByRole('button', { name: 'もう一度ためす' })).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })

  it('オフラインのときは原因を言い分け、ボタンは残す', async () => {
    installFetchMock()
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const spy = vi
      .spyOn(LocalRankingStore.prototype, 'prefectureStats')
      .mockRejectedValue(new Error('ランキングを取得できませんでした（503）'))
    try {
      render(<Ranking />)
      await waitFor(() => {
        expect(screen.getByText('いまオフラインです。順位表は後で見られます。')).toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: 'もう一度ためす' })).toBeInTheDocument()
    } finally {
      spy.mockRestore()
      online.mockRestore()
    }
  })
})

describe('全市区町村名（3 つ目の区分）', () => {
  /** 正解 correct / total 問の答案（行の「正解 n / N 問」はこれから数える） */
  function answers(correct: number, total: number) {
    return Array.from({ length: total }, (_, i) => ({
      questionId: `q${String(i)}`,
      input: 'あ',
      correct: i < correct,
      ms: 2_000,
      passed: false,
    }))
  }

  beforeEach(() => {
    put(SET_12A, [entry({ entryId: 'a', setId: SET_12A, nickname: 'じゅっもん', clientToken: 'tok-a' })])
    put(SET_12ALL, [
      entry({
        entryId: 'z',
        setId: SET_12ALL,
        nickname: 'ぜんぶ',
        score: 87,
        clientToken: 'tok-z',
        answers: answers(20, 23),
      }),
    ])
  })

  it('トップの切替は 3 つで、全市区町村名だけを数える', async () => {
    installFetchMock()
    render(<Ranking />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '千葉県 1人が回答（市区町村名）' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '全市区町村名' }))

    expect(screen.getByRole('button', { name: '千葉県 1人が回答（全市区町村名）' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '東京都 0人が回答（全市区町村名）' })).toBeDisabled()
    // 全国に全市区町村名は無い
    expect(screen.getByRole('button', { name: '全国 0人が回答（全市区町村名）' })).toBeDisabled()
    expect(screen.getByText(/全市区町村名 ／ 登録 1 件/)).toBeInTheDocument()
  })

  it('詳細では 10 問と混ざらず、正解数と問題数も見せる', async () => {
    localStorage.setItem(RANKING_MODE_KEY, 'all')
    installFetchMock()
    render(<Ranking prefCode="12" />)

    await waitFor(() => {
      expect(rows()).toHaveLength(1)
    })
    expect(el('.ranking__name').textContent).toBe('ぜんぶ')
    expect(el('.ranking__score').textContent).toBe('正解 20 / 23 問・87点')
    expect(rows()[0].textContent).toContain('全市区町村名')

    // 10 問の科目に戻すと別の一覧になる
    fireEvent.click(screen.getByRole('button', { name: '市区町村名' }))
    await waitFor(() => {
      expect(el('.ranking__name').textContent).toBe('じゅっもん')
    })
    expect(el('.ranking__score').textContent).toBe('70点')
  })

  it('全国の詳細では全市区町村名を選べない', async () => {
    installFetchMock()
    render(<Ranking prefCode="00" />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '全市区町村名' })).toBeDisabled()
    })
    expect(screen.getByRole('button', { name: '市区町村名＋町名' })).toBeEnabled()
  })
})
