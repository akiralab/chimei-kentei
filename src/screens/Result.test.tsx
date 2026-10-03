// @vitest-environment jsdom
/**
 * 結果画面。登録する前から同じセットの順位表と「登録すると N 位」が出ることを確かめる。
 * ストアは Local（localStorage）を使い、問題バンクは fetch をモックしてフィクスチャを返す。
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AnswerRecord, ResultEntry } from '../engine/types.ts'
import { DATA_VERSION } from '../engine/bank.ts'
import { LocalRankingStore, rankingKey } from '../engine/ranking.ts'
import { readWrongList } from '../engine/wrongList.ts'
import { EASY_12, EASY_ALL, META } from '../engine/__fixtures__/questions.ts'
import { writeAnswerSheet } from '../hooks/answerSheet.ts'
import { NICKNAME_KEY } from '../hooks/useNickname.ts'
import Result from './Result.tsx'

/** 千葉県 × easy。seed は 4 桁なので「この問題」扱い */
const SET = `${DATA_VERSION}-e-12-1234`
/** 全国 × easy。seed が 8 桁なので「今日の10問」扱い */
const SET_TODAY = `${DATA_VERSION}-e-00-20261002`

/** 8 問正解・1 問 3 秒 → 80 点 / 30 秒 */
function answerSheet(): AnswerRecord[] {
  return Array.from({ length: 10 }, (_, i) => ({
    questionId: `q${String(i)}`,
    input: 'あ',
    correct: i < 8,
    ms: 3_000,
    passed: false,
  }))
}

function entry(over: Partial<ResultEntry> & { entryId: string }): ResultEntry {
  return {
    setId: SET,
    nickname: over.entryId,
    score: 80,
    timeMs: 50_000,
    answers: [],
    clientToken: `tok-${over.entryId}`,
    createdAt: '2026-10-02T00:00:00.000Z',
    ...over,
  }
}

function put(setId: string, entries: ResultEntry[]): void {
  localStorage.setItem(rankingKey(setId), JSON.stringify(entries))
}

/** 問題バンクだけ返す（結果画面は見直しのために出題を組み直す） */
function installFetchMock(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input)
      const body = url.endsWith('/meta.json') ? META : url.endsWith('/easy.json') ? EASY_ALL : undefined
      if (body === undefined) {
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('not found')) })
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
    }),
  )
}

function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.ranking__row')]
}

/** 赤ペンの一言（通知・仮の順位）をまとめて 1 本の文字列に */
function penComments(): string {
  return [...document.querySelectorAll<HTMLElement>('.pen-comment')].map((p) => p.textContent).join(' / ')
}

/** 3 人の登録。自分（80 点 / 30 秒）は たろう・はなこ の下、じろう の上に入る */
function putThree(setId = SET): void {
  put(setId, [
    entry({ entryId: 'a', setId, nickname: 'たろう', score: 100, timeMs: 40_000 }),
    entry({ entryId: 'b', setId, nickname: 'はなこ', score: 80, timeMs: 20_000 }),
    entry({ entryId: 'c', setId, nickname: 'じろう', score: 60, timeMs: 10_000 }),
  ])
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem(NICKNAME_KEY, 'かわい')
  writeAnswerSheet(SET, answerSheet())
  installFetchMock()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('登録する前の順位表', () => {
  it('未登録でも上位が見え、「登録すると N 位」が出る', async () => {
    putThree()
    render(<Result setId={SET} />)

    await waitFor(() => {
      expect(rows()).toHaveLength(3)
    })
    expect(rows().map((r) => r.querySelector('.ranking__name')?.textContent)).toEqual(['たろう', 'はなこ', 'じろう'])
    expect(penComments()).toContain('登録すると 3 位です。')
    // 未登録なので自分の行はまだ無い
    expect(document.querySelector('.ranking__row.is-me')).toBeNull()
    expect(screen.getByRole('button', { name: 'ランキングに登録' })).toBeEnabled()
  })

  it('登録が 1 件も無ければ「登録すると 1 位」', async () => {
    render(<Result setId={SET} />)

    await waitFor(() => {
      expect(screen.getByText('まだ登録がありません。')).toBeInTheDocument()
    })
    expect(penComments()).toContain('登録すると 1 位です。')
  })

  it('上位 20 件までを出し、その外に落ちるときは「21 位以下」と濁す', async () => {
    put(
      SET,
      Array.from({ length: 21 }, (_, i) => entry({ entryId: `e${String(i)}`, score: 100, timeMs: 10_000 })),
    )
    render(<Result setId={SET} />)

    await waitFor(() => {
      expect(rows()).toHaveLength(20)
    })
    expect(penComments()).toContain('登録すると 21 位以下です。')
  })

  it('seed が 8 桁なら見出しに日付を出す', async () => {
    writeAnswerSheet(SET_TODAY, answerSheet())
    putThree(SET_TODAY)
    render(<Result setId={SET_TODAY} />)

    await waitFor(() => {
      expect(rows()).toHaveLength(3)
    })
    expect(screen.getByRole('heading', { name: '今日の10問（2026-10-02）の順位表' })).toBeInTheDocument()
  })

  it('seed が 4 桁なら従来どおり「この問題の順位表」', async () => {
    putThree()
    render(<Result setId={SET} />)

    await waitFor(() => {
      expect(rows()).toHaveLength(3)
    })
    expect(screen.getByRole('heading', { name: 'この問題の順位表' })).toBeInTheDocument()
  })
})

describe('登録したあと', () => {
  it('自分の行に ★ が付き、仮の順位は消える', async () => {
    putThree()
    render(<Result setId={SET} />)

    await waitFor(() => {
      expect(rows()).toHaveLength(3)
    })
    fireEvent.click(screen.getByRole('button', { name: 'ランキングに登録' }))

    await waitFor(() => {
      expect(rows()).toHaveLength(4)
    })
    const mine = document.querySelector<HTMLElement>('.ranking__row.is-me')
    expect(mine).not.toBeNull()
    expect(mine?.textContent).toContain('★')
    expect(mine?.textContent).toContain('かわい')
    // 3 位（たろう・はなこ の下）
    expect(rows()[2]).toBe(mine)
    expect(penComments()).toContain('3 位で登録しました。')
    expect(penComments()).not.toContain('登録すると')
    expect(screen.getByRole('heading', { name: 'この問題の順位表 ／ あなたは 3 位' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ランキングに登録' })).toBeDisabled()
  })

  it('登録済みで開き直すと、最初から ★ 付きで出る', async () => {
    putThree()
    render(<Result setId={SET} />)
    await waitFor(() => {
      expect(rows()).toHaveLength(3)
    })
    fireEvent.click(screen.getByRole('button', { name: 'ランキングに登録' }))
    await waitFor(() => {
      expect(rows()).toHaveLength(4)
    })
    cleanup()

    render(<Result setId={SET} />)
    await waitFor(() => {
      expect(document.querySelector('.ranking__row.is-me')).not.toBeNull()
    })
    expect(penComments()).toContain('この問題にはすでに登録済みです。')
    expect(penComments()).not.toContain('登録すると')
  })
})

describe('ランキングに届かないとき', () => {
  it('順位表だけ出ず、答案の見直しと登録ボタンは普通に使える', async () => {
    const spy = vi
      .spyOn(LocalRankingStore.prototype, 'list')
      .mockRejectedValue(new Error('ランキングを取得できませんでした（503）'))
    render(<Result setId={SET} />)

    await waitFor(() => {
      expect(screen.getByText('ランキングに接続できませんでした。')).toBeInTheDocument()
    })
    expect(document.querySelector('.ranking')).toBeNull()
    expect(penComments()).not.toContain('登録すると')
    // 答案の見直し・各ボタンは残る
    await waitFor(() => {
      expect(document.querySelectorAll('.review__row')).toHaveLength(10)
    })
    expect(screen.getByRole('button', { name: 'ランキングに登録' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'この問題で挑ませる' })).toBeInTheDocument()
    expect(screen.getByText('80')).toBeInTheDocument()
    spy.mockRestore()
  })
})

describe('全市区町村名', () => {
  /** 千葉県の全市区町村名。フィクスチャの千葉県は 25 件 */
  const SET_ALL = `${DATA_VERSION}-e-12-0417-all`

  /** 問題バンク（千葉県 25 件）の実際の questionId で答案を作る（間違えた問題の記録に要る） */
  function answerAll(correct: number, total: number): AnswerRecord[] {
    return Array.from({ length: total }, (_, i) => ({
      questionId: EASY_12[i % EASY_12.length].id,
      input: 'あ',
      correct: i < correct,
      ms: 2_000,
      passed: false,
    }))
  }

  it('得点は正答率で、順位表も登録ボタンも 10 問と同じように出す', async () => {
    writeAnswerSheet(SET_ALL, answerAll(18, 25))
    putThree(SET_ALL)
    render(<Result setId={SET_ALL} />)

    await waitFor(() => {
      expect(document.querySelectorAll('.review__row')).toHaveLength(25)
    })
    // 18 / 25 = 72 点（「正答数 × 10」ではない）
    expect(document.querySelector('.stamp__num')?.textContent).toBe('72')
    expect(document.querySelector('.paper__subtitle')?.textContent).toContain('正解 18 / 25 問')
    expect(screen.getByRole('button', { name: 'ランキングに登録' })).toBeEnabled()
    expect(penComments()).not.toContain('順位表には載りません')
    // このセットの順位表を取りに行く（72 点なので 80 点の下・60 点の上）
    await waitFor(() => {
      expect(rows()).toHaveLength(3)
    })
    expect(penComments()).toContain('登録すると 3 位です。')
  })

  it('登録すると順位が付き、間違えた問題も 10 問と同じように記録する', async () => {
    writeAnswerSheet(SET_ALL, answerAll(18, 25))
    render(<Result setId={SET_ALL} />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'ランキングに登録' })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole('button', { name: 'ランキングに登録' }))
    await waitFor(() => {
      expect(penComments()).toContain('1 位で登録しました。')
    })
    expect(screen.getByRole('button', { name: '間違えた問題を見る' })).toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem(rankingKey(SET_ALL)) ?? '[]') as ResultEntry[]
    expect(saved.map((e) => e.score)).toEqual([72])
    expect(readWrongList()).not.toHaveLength(0)
  })

  it('順位表の行には「全市区町村名（N 問）」を得点の横に添える', async () => {
    writeAnswerSheet(SET_ALL, answerAll(18, 25))
    put(SET_ALL, [
      entry({
        entryId: 'a',
        setId: SET_ALL,
        nickname: 'たろう',
        score: 87,
        answers: answerAll(20, 23),
      }),
    ])
    render(<Result setId={SET_ALL} />)

    await waitFor(() => {
      expect(rows()).toHaveLength(1)
    })
    expect(rows()[0].querySelector('.ranking__score')?.textContent).toBe('87点［全市区町村名（23 問）］')
  })

  it('10 問のセットでは従来どおり正答数 × 10 点で、正解数も添える', async () => {
    putThree()
    render(<Result setId={SET} />)
    await waitFor(() => {
      expect(document.querySelector('.stamp__num')?.textContent).toBe('80')
    })
    expect(document.querySelector('.paper__subtitle')?.textContent).toContain('正解 8 / 10 問')
    expect(screen.getByRole('button', { name: 'ランキングに登録' })).toBeInTheDocument()
    // 10 問の行には注記を付けない
    await waitFor(() => {
      expect(rows()).toHaveLength(3)
    })
    expect(rows()[0].querySelector('.ranking__score')?.textContent).toBe('100点')
  })
})
