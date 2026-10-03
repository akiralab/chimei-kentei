import { describe, expect, it } from 'vitest'
import type { RankingRow, ResultEntry } from './types.ts'
import {
  CLIENT_TOKEN_KEY,
  LocalRankingStore,
  createMemoryStorage,
  getClientToken,
  isValidNickname,
  provisionalRank,
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
      'correct',
      'createdAt',
      'entryId',
      'mode',
      'nickname',
      'scope',
      'score',
      'setId',
      'timeMs',
      'total',
    ])
    // 科目・範囲は setId から導く
    expect(row.mode).toBe('e')
    expect(row.scope).toBe('12')
    // 正解数・問題数は答案から数える（「正解 n / N 問」の表示に使う）
    expect(row.correct).toBe(1)
    expect(row.total).toBe(1)
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

  it('entries は答案数・players は clientToken の distinct 数。科目別の内訳も出す', async () => {
    const store = new LocalRankingStore(createMemoryStorage())
    await seed(store)
    expect(await store.prefectureStats()).toEqual([
      {
        prefCode: '00', // 全国
        entries: 1,
        players: 1,
        byMode: { e: { entries: 1, players: 1 }, d: { entries: 0, players: 0 }, all: { entries: 0, players: 0 } },
      },
      {
        prefCode: '12', // 市区町村スコープ（difficult）も 12 に集まる
        entries: 3,
        players: 2,
        byMode: { e: { entries: 2, players: 1 }, d: { entries: 1, players: 1 }, all: { entries: 0, players: 0 } },
      },
      {
        prefCode: '13',
        entries: 1,
        players: 1,
        byMode: { e: { entries: 1, players: 1 }, d: { entries: 0, players: 0 }, all: { entries: 0, players: 0 } },
      },
    ])
  })

  it('全市区町村名は科目とは別の区分（all）として数え、mode で絞り込める', async () => {
    const store = new LocalRankingStore(createMemoryStorage())
    await seed(store)
    // 千葉県の全市区町村名を 1 件足す（10 問の 'e' には混ざらない）
    await store.submit(entry({ setId: 'abr20260925-e-12-1234-all', clientToken: 'c', nickname: 'C', score: 87 }))
    const chiba = (await store.prefectureStats()).find((s) => s.prefCode === '12')
    expect(chiba?.byMode).toEqual({
      e: { entries: 2, players: 1 },
      d: { entries: 1, players: 1 },
      all: { entries: 1, players: 1 },
    })
    expect(chiba?.entries).toBe(4)
    expect((await store.listByPrefecture('12', 30, 'all')).map((r) => r.score)).toEqual([87])
    expect((await store.listByPrefecture('12', 30, 'e')).map((r) => r.score)).toEqual([100, 80])
  })

  it('listByPrefecture は mode で絞れる', async () => {
    const store = new LocalRankingStore(createMemoryStorage())
    await seed(store)
    expect((await store.listByPrefecture('12', 30, 'e')).map((r) => r.score)).toEqual([100, 80])
    expect((await store.listByPrefecture('12', 30, 'd')).map((r) => r.score)).toEqual([60])
    expect(await store.listByPrefecture('12', 30)).toHaveLength(3)
  })

  it('timeLimitMs は保存して list で返す', async () => {
    const store = new LocalRankingStore(createMemoryStorage())
    await store.submit(entry({ clientToken: 'x', timeLimitMs: 20_000 }))
    expect((await store.list(SET_ID))[0].timeLimitMs).toBe(20_000)
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

describe('provisionalRank', () => {
  function row(over: Partial<RankingRow> & { entryId: string }): RankingRow {
    return {
      setId: SET_ID,
      nickname: over.entryId,
      score: 80,
      timeMs: 50_000,
      createdAt: '2026-10-02T00:00:00.000Z',
      ...over,
    }
  }

  const me = { score: 80, timeMs: 30_000, createdAt: '2026-10-02T09:00:00.000Z' }

  it('登録が無ければ 1 位', () => {
    expect(provisionalRank([], me)).toBe(1)
  })

  it('得点の高い行の下、低い行の上に入る', () => {
    const rows = [row({ entryId: 'a', score: 100 }), row({ entryId: 'b', score: 60 })]
    expect(provisionalRank(rows, me)).toBe(2)
  })

  it('同点なら所要時間の短いほうが上', () => {
    const rows = [row({ entryId: 'a', score: 80, timeMs: 20_000 }), row({ entryId: 'b', score: 80, timeMs: 40_000 })]
    expect(provisionalRank(rows, me)).toBe(2)
  })

  it('同点・同時間なら後から登録する自分が下（compareEntries と同じ）', () => {
    const rows = [row({ entryId: 'a', score: 80, timeMs: 30_000, createdAt: '2026-10-02T08:00:00.000Z' })]
    expect(provisionalRank(rows, me)).toBe(2)
    // 自分のほうが先に登録していた並びなら上
    expect(provisionalRank(rows, { ...me, createdAt: '2026-10-02T07:00:00.000Z' })).toBe(1)
  })

  it('並び替えていない rows でも同じ順位になる', () => {
    const rows = [row({ entryId: 'b', score: 60 }), row({ entryId: 'a', score: 100 })]
    expect(provisionalRank(rows, me)).toBe(2)
  })

  it('limit に届かない行数なら、全員に負けても正確な最下位を返す', () => {
    const rows = [row({ entryId: 'a', score: 100 }), row({ entryId: 'b', score: 90 })]
    expect(provisionalRank(rows, me, 20)).toBe(3)
  })

  it('limit 件すべてに負けたら limit + 1（「その順位以下」の下限）', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row({ entryId: `e${String(i)}`, score: 100 }))
    expect(provisionalRank(rows, me, 20)).toBe(21)
    // limit より多く渡されても limit + 1 で止める
    expect(provisionalRank([...rows, row({ entryId: 'x', score: 100 })], me, 20)).toBe(21)
  })
})
