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
  it('登録すると順位と entryId が返り、localStorage キーに入る', async () => {
    const storage = createMemoryStorage()
    const store = new LocalRankingStore(storage)
    const res = await store.submit(entry())
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('登録できていない')
    expect(res.rank).toBe(1)
    expect(res.entryId).toBeTruthy()
    expect(storage.getItem(rankingKey(SET_ID))).toContain('かわい')
    // 自分の行は entryId で見分ける（clientToken は一覧に出さない）
    const list = await store.list(SET_ID)
    expect(list[0].entryId).toBe(res.entryId)
  })

  it('list は RankingRow だけを返す（answers と clientToken は出さない）', async () => {
    const store = new LocalRankingStore(createMemoryStorage())
    await store.submit(entry({ answers: [{ questionId: 'q1', input: 'あ', correct: true, ms: 1000, passed: false }] }))
    const [row] = await store.list(SET_ID)
    expect(Object.keys(row).sort()).toEqual([
      'createdAt',
      'entryId',
      'mode',
      'nickname',
      'scope',
      'score',
      'setId',
      'timeMs',
    ])
    // 科目・範囲は setId から導く
    expect(row.mode).toBe('e')
    expect(row.scope).toBe('12')
  })

  it('同じ (setId, clientToken) の二重登録は already_submitted', async () => {
    const store = new LocalRankingStore(createMemoryStorage())
    expect((await store.submit(entry())).ok).toBe(true)
    expect(await store.submit(entry({ score: 100 }))).toEqual({ ok: false, reason: 'already_submitted' })
  })

  it('別 setId なら同じ clientToken でも登録できる', async () => {
    const store = new LocalRankingStore(createMemoryStorage())
    expect((await store.submit(entry())).ok).toBe(true)
    expect((await store.submit(entry({ setId: 'abr20260925-e-12-5678' }))).ok).toBe(true)
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

describe('LocalRankingStore の都道府県集計', () => {
  /** 端末 1 つで複数のセットを登録する */
  async function seed(store: LocalRankingStore): Promise<void> {
    await store.submit(entry({ setId: 'abr20260925-e-12-1234', clientToken: 'a', nickname: 'A', score: 80 }))
    await store.submit(entry({ setId: 'abr20260925-e-12-5678', clientToken: 'a', nickname: 'A', score: 100 }))
    await store.submit(entry({ setId: 'abr20260925-d-122165-1234', clientToken: 'b', nickname: 'B', score: 60 }))
    await store.submit(entry({ setId: 'abr20260925-e-13-1234', clientToken: 'a', nickname: 'A', score: 90 }))
    await store.submit(entry({ setId: 'abr20260925-e-00-1234', clientToken: 'a', nickname: 'A', score: 50 }))
  }

  it('entries は答案数・players は clientToken の distinct 数', async () => {
    const store = new LocalRankingStore(createMemoryStorage())
    await seed(store)
    expect(await store.prefectureStats()).toEqual([
      { prefCode: '00', entries: 1, players: 1 }, // 全国
      { prefCode: '12', entries: 3, players: 2 }, // 市区町村スコープも 12 に集まる
      { prefCode: '13', entries: 1, players: 1 },
    ])
  })

  it('listByPrefecture はその都道府県の全セットを横断して並べる', async () => {
    const store = new LocalRankingStore(createMemoryStorage())
    await seed(store)
    const rows = await store.listByPrefecture('12')
    expect(rows.map((r) => r.score)).toEqual([100, 80, 60])
    expect(rows.map((r) => r.setId)).toEqual([
      'abr20260925-e-12-5678',
      'abr20260925-e-12-1234',
      'abr20260925-d-122165-1234',
    ])
    expect(rows[2].mode).toBe('d')
    expect(rows[2].scope).toBe('122165')
  })

  it('limit の既定は 30', async () => {
    const store = new LocalRankingStore(createMemoryStorage())
    for (let i = 0; i < 35; i++) {
      await store.submit(entry({ setId: `abr20260925-e-12-${String(1000 + i)}`, clientToken: `t${i}`, score: 100 - i }))
    }
    expect(await store.listByPrefecture('12')).toHaveLength(30)
    expect(await store.listByPrefecture('12', 4)).toHaveLength(4)
  })

  it('読めない setId のキーと登録の無い都道府県は無視する', async () => {
    const storage = createMemoryStorage({ 'ranking:こわれた': '[]', other: 'x' })
    const store = new LocalRankingStore(storage)
    expect(await store.prefectureStats()).toEqual([])
    expect(await store.listByPrefecture('47')).toEqual([])
  })

  it('走査できない storage（key/length なし）でも落ちない', async () => {
    const map = new Map<string, string>()
    const store = new LocalRankingStore({
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => {
        map.set(k, v)
      },
    })
    await store.submit(entry())
    expect(await store.prefectureStats()).toEqual([])
  })
})
