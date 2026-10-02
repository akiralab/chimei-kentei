import { describe, expect, it } from 'vitest'
import type { ResultEntry } from './types.ts'
import {
  CLIENT_TOKEN_KEY,
  LocalRankingStore,
  createMemoryStorage,
  getClientToken,
  isValidNickname,
  rankingKey,
} from './ranking.ts'

const SET_ID = 'abr20260925-e-12-1234'

function entry(over: Partial<ResultEntry> = {}): ResultEntry {
  return {
    setId: SET_ID,
    nickname: 'かわい',
    score: 80,
    timeMs: 50_000,
    answers: [],
    clientToken: 'token-a',
    createdAt: '2026-10-02T00:00:00.000Z',
    ...over,
  }
}

describe('getClientToken', () => {
  it('無ければ作って保存し、次回は同じ値を返す', () => {
    const storage = createMemoryStorage()
    const first = getClientToken(storage)
    expect(first).toBeTruthy()
    expect(storage.getItem(CLIENT_TOKEN_KEY)).toBe(first)
    expect(getClientToken(storage)).toBe(first)
  })
})

describe('isValidNickname', () => {
  it('1〜12 文字のみ有効', () => {
    expect(isValidNickname('あ')).toBe(true)
    expect(isValidNickname('あいうえおかきくけこさし')).toBe(true)
    expect(isValidNickname('')).toBe(false)
    expect(isValidNickname('   ')).toBe(false)
    expect(isValidNickname('あいうえおかきくけこさしす')).toBe(false)
  })
})

describe('LocalRankingStore', () => {
  it('登録すると順位が返り、localStorage キーに入る', async () => {
    const storage = createMemoryStorage()
    const store = new LocalRankingStore(storage)
    const res = await store.submit(entry())
    expect(res).toEqual({ ok: true, rank: 1 })
    expect(storage.getItem(rankingKey(SET_ID))).toContain('かわい')
  })

  it('同じ (setId, clientToken) の二重登録は already_submitted', async () => {
    const store = new LocalRankingStore(createMemoryStorage())
    expect(await store.submit(entry())).toEqual({ ok: true, rank: 1 })
    expect(await store.submit(entry({ score: 100 }))).toEqual({ ok: false, reason: 'already_submitted' })
  })

  it('別 setId なら同じ clientToken でも登録できる', async () => {
    const store = new LocalRankingStore(createMemoryStorage())
    expect(await store.submit(entry())).toEqual({ ok: true, rank: 1 })
    expect(await store.submit(entry({ setId: 'abr20260925-e-12-5678' }))).toEqual({ ok: true, rank: 1 })
  })

  it('ニックネームが 1〜12 文字でなければ invalid', async () => {
    const store = new LocalRankingStore(createMemoryStorage())
    expect(await store.submit(entry({ nickname: '' }))).toEqual({ ok: false, reason: 'invalid' })
    expect(await store.submit(entry({ nickname: 'あいうえおかきくけこさしす' }))).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('得点降順 → 所要時間昇順 → 登録順に並ぶ', async () => {
    const store = new LocalRankingStore(createMemoryStorage())
    await store.submit(entry({ clientToken: 'a', nickname: 'A', score: 80, timeMs: 40_000, createdAt: '2026-10-02T00:00:03.000Z' }))
    await store.submit(entry({ clientToken: 'b', nickname: 'B', score: 100, timeMs: 90_000, createdAt: '2026-10-02T00:00:02.000Z' }))
    await store.submit(entry({ clientToken: 'c', nickname: 'C', score: 80, timeMs: 30_000, createdAt: '2026-10-02T00:00:01.000Z' }))
    await store.submit(entry({ clientToken: 'd', nickname: 'D', score: 80, timeMs: 40_000, createdAt: '2026-10-02T00:00:00.000Z' }))
    const list = await store.list(SET_ID)
    expect(list.map((e) => e.nickname)).toEqual(['B', 'C', 'D', 'A'])
    expect(await store.rank(SET_ID, 'd')).toBe(3)
    expect(await store.rank(SET_ID, 'zzz')).toBeNull()
  })

  it('list の既定上限は 20 件、limit も効く', async () => {
    const store = new LocalRankingStore(createMemoryStorage())
    for (let i = 0; i < 25; i++) {
      await store.submit(entry({ clientToken: `t${i}`, nickname: `N${i}`, score: 100 - i }))
    }
    expect(await store.list(SET_ID)).toHaveLength(20)
    expect(await store.list(SET_ID, 3)).toHaveLength(3)
  })

  it('未登録の setId は空配列', async () => {
    const store = new LocalRankingStore(createMemoryStorage())
    expect(await store.list('abr20260925-e-00-0001')).toEqual([])
    expect(await store.mine(SET_ID, 'token-a')).toBeNull()
  })

  it('壊れた JSON が入っていても空配列として扱う', async () => {
    const storage = createMemoryStorage({ [rankingKey(SET_ID)]: '{' })
    const store = new LocalRankingStore(storage)
    expect(await store.list(SET_ID)).toEqual([])
  })
})
