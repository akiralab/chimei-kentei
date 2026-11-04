// @vitest-environment jsdom
/**
 * 順位表の行の「…」（App Store Guideline 1.2）。報告と、この端末での非表示。
 * 実際のストアは Local なので、共有ランキングのときだけ出す条件を差し替えて画面ごと確かめる。
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DATA_VERSION } from '../engine/bank.ts'
import { LocalRankingStore, rankingKey } from '../engine/ranking.ts'
import { resetRankingCacheForTest } from '../engine/ranking-cache.ts'
import { META } from '../engine/__fixtures__/questions.ts'
import { CONTACT_EMAIL } from '../contact.ts'
import { HIDDEN_NAMES_KEY } from '../hooks/useHiddenNames.ts'
import { NICKNAME_KEY } from '../hooks/useNickname.ts'
import Ranking from '../screens/Ranking.tsx'

vi.mock('../engine/ranking-factory.ts', async (original) => ({
  ...(await original<typeof import('../engine/ranking-factory.ts')>()),
  isRemoteRanking: () => true,
}))

const SET = `${DATA_VERSION}-e-12-1234`

function entry(entryId: string, nickname: string, score: number) {
  return { entryId, setId: SET, nickname, score, timeMs: 30_000, answers: [], clientToken: `tok-${entryId}`, createdAt: '2026-10-02T01:00:00.000Z' }
}

function names(): string[] {
  return [...document.querySelectorAll('.ranking__row')].map((r) => r.querySelector('.ranking__name')?.textContent ?? '')
}

async function openRanking(): Promise<void> {
  render(<Ranking prefCode="12" />)
  await waitFor(() => {
    expect(names().length).toBeGreaterThan(0)
  })
}

beforeEach(async () => {
  localStorage.clear()
  resetRankingCacheForTest()
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url.endsWith('/meta.json')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(META) })
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('not found')) })
    }),
  )
  const store = new LocalRankingStore()
  localStorage.setItem(rankingKey(SET), JSON.stringify([]))
  await store.submit(entry('a', 'はなこ', 100))
  await store.submit(entry('b', 'わるい名前', 90))
  await store.submit(entry('c', 'たろう', 80))
  resetRankingCacheForTest()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('順位表の行の「…」', () => {
  it('非表示にすると行が消え、順位の数字は詰めない。端末に覚え、元に戻せる', async () => {
    await openRanking()
    fireEvent.click(screen.getByRole('button', { name: 'わるい名前 を報告・非表示にする' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'この名前を非表示にする' }))

    expect(names()).toEqual(['はなこ', 'たろう'])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect([...document.querySelectorAll('.ranking__rank')].map((r) => r.textContent)).toEqual(['1', '3'])
    expect(JSON.parse(localStorage.getItem(HIDDEN_NAMES_KEY) ?? '[]')).toEqual(['わるい名前'])
    expect(screen.getByText(/非表示 1 件/)).toBeInTheDocument()

    cleanup()
    await openRanking()
    expect(names()).toEqual(['はなこ', 'たろう'])

    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    expect(names()).toEqual(['はなこ', 'わるい名前', 'たろう'])
    expect(screen.queryByText(/非表示/)).toBeNull()
  })

  it('報告はメールで、行を特定できる情報が入り、押した行は隠す', async () => {
    await openRanking()
    fireEvent.click(screen.getByRole('button', { name: 'わるい名前 を報告・非表示にする' }))
    const link = within(screen.getByRole('dialog')).getByRole('link', { name: 'この名前を報告する' })

    const href = link.getAttribute('href') ?? ''
    expect(href.startsWith(`mailto:${CONTACT_EMAIL}?`)).toBe(true)
    const body = decodeURIComponent(href)
    expect(body).toContain('わるい名前')
    expect(body).toContain(SET)

    link.addEventListener('click', (e) => e.preventDefault())
    fireEvent.click(link)
    expect(names()).toEqual(['はなこ', 'たろう'])
  })

  it('メールが開かないときのために問い合わせ先も書いてある。やめると何も変わらない', async () => {
    await openRanking()
    fireEvent.click(screen.getByRole('button', { name: 'たろう を報告・非表示にする' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(CONTACT_EMAIL)
    expect(dialog).toHaveTextContent('24 時間以内')

    fireEvent.click(within(dialog).getByRole('button', { name: 'やめる' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(names()).toHaveLength(3)
  })

  it('Esc で閉じる', async () => {
    await openRanking()
    fireEvent.click(screen.getByRole('button', { name: 'たろう を報告・非表示にする' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('自分の行には出さない', async () => {
    localStorage.setItem(NICKNAME_KEY, 'はなこ')
    await openRanking()
    expect(screen.queryByRole('button', { name: 'はなこ を報告・非表示にする' })).toBeNull()
    expect(screen.getByRole('button', { name: 'たろう を報告・非表示にする' })).toBeInTheDocument()
  })

  it('順位表の下から利用条件を開ける', async () => {
    await openRanking()
    expect(screen.getByRole('link', { name: '順位表の利用条件' })).toHaveAttribute('href', '#/privacy')
  })
})
