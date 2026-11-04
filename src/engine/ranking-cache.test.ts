// @vitest-environment jsdom
/**
 * 順位のキャッシュ（Issue #70）。取り直す頃合い・背面での停止・失敗・捨てたあとの扱い。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STALE_MS,
  STATS_KEY,
  clearRankingCache,
  getState,
  isDue,
  listKey,
  refresh,
  resetRankingCacheForTest,
  whileForeground,
} from './ranking-cache.ts'

const STORAGE_KEY = 'rankingCache:v1'

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  resetRankingCacheForTest()
  setVisibility('visible')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('refresh', () => {
  it('結果と時刻を持ち、localStorage に写す', async () => {
    await refresh(STATS_KEY, () => Promise.resolve(['a']))
    const state = getState<string[]>(STATS_KEY)
    expect(state.data).toEqual(['a'])
    expect(state.at).toBe(Date.now())
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)[STATS_KEY].data).toEqual(['a'])
  })

  it('同じものを同時に 2 回取りに行かない', async () => {
    const load = vi.fn(() => Promise.resolve(['a']))
    await Promise.all([refresh(STATS_KEY, load), refresh(STATS_KEY, load)])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('失敗しても前の結果と時刻は残り、failed が立つ。次に成功すれば降りる', async () => {
    await refresh(STATS_KEY, () => Promise.resolve(['a']))
    const at = getState(STATS_KEY).at

    vi.advanceTimersByTime(1000)
    await refresh(STATS_KEY, () => Promise.reject(new Error('503')))
    expect(getState(STATS_KEY)).toMatchObject({ data: ['a'], at, failed: true, refreshing: false })

    await refresh(STATS_KEY, () => Promise.resolve(['b']))
    expect(getState(STATS_KEY)).toMatchObject({ data: ['b'], failed: false })
  })

  it('localStorage が使えなくてもメモリから出せる', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    try {
      await refresh(STATS_KEY, () => Promise.resolve(['a']))
      expect(getState(STATS_KEY).data).toEqual(['a'])
    } finally {
      spy.mockRestore()
    }
  })

  it('localStorage の中身が壊れていてもキャッシュなしで始める', () => {
    localStorage.setItem(STORAGE_KEY, '{')
    resetRankingCacheForTest()
    localStorage.setItem(STORAGE_KEY, '{')
    expect(getState(STATS_KEY).data).toBeNull()
  })

  it('localStorage に残す都道府県の順位は新しい 8 件まで。一覧は別枠で残す', async () => {
    await refresh(STATS_KEY, () => Promise.resolve(['stats']))
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(1000)
      await refresh(listKey(String(10 + i), 'e'), () => Promise.resolve([i]))
    }
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(Object.keys(stored)).toHaveLength(9)
    expect(stored[STATS_KEY]).toBeDefined()
    expect(stored[listKey('10', 'e')]).toBeUndefined()
    expect(stored[listKey('19', 'e')]).toBeDefined()
  })
})

describe('isDue', () => {
  it('一度も取っていなければ取る。取った直後は取らず、5 分経つと取る', async () => {
    expect(isDue(STATS_KEY)).toBe(true)
    await refresh(STATS_KEY, () => Promise.resolve(['a']))
    expect(isDue(STATS_KEY)).toBe(false)

    vi.advanceTimersByTime(STALE_MS - 1)
    expect(isDue(STATS_KEY)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(isDue(STATS_KEY)).toBe(true)
  })

  it('失敗したあとも 5 分は叩き直さない（機内モードで毎分通信しない）', async () => {
    await refresh(STATS_KEY, () => Promise.reject(new Error('offline')))
    expect(isDue(STATS_KEY)).toBe(false)
    vi.advanceTimersByTime(STALE_MS)
    expect(isDue(STATS_KEY)).toBe(true)
  })
})

describe('clearRankingCache', () => {
  it('全部捨てる。自分の行が入る前の取得が後から届いても書き戻さない', async () => {
    await refresh(STATS_KEY, () => Promise.resolve(['old']))

    let finish: (rows: string[]) => void = () => {}
    const pending = refresh(listKey('12', 'e'), () => new Promise((resolve) => (finish = resolve)))
    clearRankingCache()
    expect(getState(STATS_KEY).data).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()

    finish(['before-register'])
    await pending
    expect(getState(listKey('12', 'e')).data).toBeNull()
  })
})

describe('whileForeground', () => {
  it('前面にいる間は定期的に確認し、背面では確認しない', () => {
    const check = vi.fn()
    const stop = whileForeground(check)

    vi.advanceTimersByTime(60_000)
    expect(check).toHaveBeenCalledTimes(1)

    setVisibility('hidden')
    vi.advanceTimersByTime(60_000 * 10)
    expect(check).toHaveBeenCalledTimes(1)

    stop()
  })

  it('背面から戻ったときに確認する。止めたあとは呼ばない', () => {
    const check = vi.fn()
    const stop = whileForeground(check)

    setVisibility('hidden')
    expect(check).not.toHaveBeenCalled()
    setVisibility('visible')
    expect(check).toHaveBeenCalledTimes(1)

    stop()
    setVisibility('hidden')
    setVisibility('visible')
    vi.advanceTimersByTime(60_000 * 5)
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('5 分ごとの確認と組み合わせると、前面で 1 回だけ取り直す', async () => {
    const load = vi.fn(() => Promise.resolve(['a']))
    await refresh(STATS_KEY, load)
    const stop = whileForeground(() => {
      if (isDue(STATS_KEY)) void refresh(STATS_KEY, load)
    })

    await vi.advanceTimersByTimeAsync(STALE_MS - 1)
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(load).toHaveBeenCalledTimes(2)

    stop()
  })
})
