import { describe, expect, it, vi } from 'vitest'
import type { AnswerRecord, RankingRow, ResultEntry } from './types.ts'
import { REMOTE_TIMEOUT_MS, RemoteRankingStore } from './ranking-remote.ts'

const SET_ID = 'abr20260925-e-12-1234'

function answers(): AnswerRecord[] {
  return [{ questionId: 'c:120001:千市1', input: 'し1', correct: true, ms: 3000, passed: false }]
}

function entry(over: Partial<ResultEntry> = {}): ResultEntry {
  return {
    setId: SET_ID,
    nickname: 'たろう',
    score: 70,
    timeMs: 30_000,
    answers: answers(),
    clientToken: 'tok-a',
    createdAt: '2026-10-02T00:00:00.000Z',
    ...over,
  }
}

function row(over: Partial<RankingRow> = {}): RankingRow {
  return {
    entryId: 'id-1',
    setId: SET_ID,
    nickname: 'たろう',
    score: 70,
    timeMs: 30_000,
    createdAt: '2026-10-02T00:00:00.000Z',
    ...over,
  }
}

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

describe('RemoteRankingStore.submit', () => {
  it('契約どおりの body を POST し、201 なら rank と entryId を返す', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return Promise.resolve(response(201, { ok: true, rank: 3, entry: row({ entryId: 'id-9' }) }))
    })
    const store = new RemoteRankingStore('https://api.example.test/', fetchImpl)
    expect(await store.submit(entry())).toEqual({ ok: true, rank: 3, entryId: 'id-9' })

    expect(calls[0].url).toBe('https://api.example.test/results')
    expect(calls[0].init?.method).toBe('POST')
    const sent = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>
    // 採点はサーバーの仕事。score / correct / createdAt は送らない
    expect(Object.keys(sent).sort()).toEqual(['answers', 'clientToken', 'nickname', 'setId'])
    expect(sent.answers).toEqual([{ questionId: 'c:120001:千市1', input: 'し1', ms: 3000, passed: false }])
  })

  it('409 は already_submitted、400 は invalid', async () => {
    const store409 = new RemoteRankingStore('https://api.example.test', () =>
      Promise.resolve(response(409, { ok: false, reason: 'already_submitted' })),
    )
    expect(await store409.submit(entry())).toEqual({ ok: false, reason: 'already_submitted' })

    const store400 = new RemoteRankingStore('https://api.example.test', () =>
      Promise.resolve(response(400, { ok: false, reason: 'invalid', detail: 'だめ' })),
    )
    expect(await store400.submit(entry())).toEqual({ ok: false, reason: 'invalid' })
  })

  it('5xx・通信失敗・壊れた応答は network', async () => {
    const store500 = new RemoteRankingStore('https://api.example.test', () => Promise.resolve(response(500, {})))
    expect(await store500.submit(entry())).toEqual({ ok: false, reason: 'network' })

    const storeThrow = new RemoteRankingStore('https://api.example.test', () => Promise.reject(new Error('offline')))
    expect(await storeThrow.submit(entry())).toEqual({ ok: false, reason: 'network' })

    const storeBroken = new RemoteRankingStore('https://api.example.test', () =>
      Promise.resolve(response(201, { ok: true })),
    )
    expect(await storeBroken.submit(entry())).toEqual({ ok: false, reason: 'network' })
  })

  it('8 秒で abort する', async () => {
    vi.useFakeTimers()
    try {
      const store = new RemoteRankingStore('https://api.example.test', (_url, init) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
      })
      const promise = store.submit(entry())
      await vi.advanceTimersByTimeAsync(REMOTE_TIMEOUT_MS + 1)
      expect(await promise).toEqual({ ok: false, reason: 'network' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('RemoteRankingStore.list', () => {
  it('setId と limit をクエリに載せて GET し、entries を返す', async () => {
    const calls: string[] = []
    const store = new RemoteRankingStore('https://api.example.test', (url) => {
      calls.push(url)
      return Promise.resolve(response(200, { entries: [row(), row({ entryId: 'id-2', nickname: 'はなこ' })] }))
    })
    const list = await store.list(SET_ID, 5)
    expect(list.map((r) => r.nickname)).toEqual(['たろう', 'はなこ'])
    expect(calls[0]).toBe(`https://api.example.test/results?setId=${SET_ID}&limit=5`)
  })

  it('limit 既定は 20', async () => {
    const calls: string[] = []
    const store = new RemoteRankingStore('https://api.example.test', (url) => {
      calls.push(url)
      return Promise.resolve(response(200, { entries: [] }))
    })
    expect(await store.list(SET_ID)).toEqual([])
    expect(calls[0]).toContain('limit=20')
  })

  it('失敗は例外にする（画面で「接続できませんでした」を出すため）', async () => {
    const store = new RemoteRankingStore('https://api.example.test', () => Promise.resolve(response(503, {})))
    await expect(store.list(SET_ID)).rejects.toThrow(/503/)

    const offline = new RemoteRankingStore('https://api.example.test', () => Promise.reject(new Error('offline')))
    await expect(offline.list(SET_ID)).rejects.toThrow()
  })
})

describe('RemoteRankingStore の都道府県エンドポイント', () => {
  it('prefectureStats は GET /stats/prefectures を叩く', async () => {
    const calls: string[] = []
    const store = new RemoteRankingStore('https://api.example.test', (url) => {
      calls.push(url)
      return Promise.resolve(
        response(200, {
          prefectures: [
            { prefCode: '00', entries: 2, players: 2 },
            { prefCode: '12', entries: 5, players: 3 },
          ],
        }),
      )
    })
    expect(await store.prefectureStats()).toEqual([
      { prefCode: '00', entries: 2, players: 2 },
      { prefCode: '12', entries: 5, players: 3 },
    ])
    expect(calls[0]).toBe('https://api.example.test/stats/prefectures')
  })

  it('listByPrefecture は GET /results?prefCode=…&limit=30（既定）', async () => {
    const calls: string[] = []
    const store = new RemoteRankingStore('https://api.example.test', (url) => {
      calls.push(url)
      return Promise.resolve(response(200, { entries: [row({ mode: 'd', scope: '122165' })] }))
    })
    const rows = await store.listByPrefecture('12')
    expect(rows[0].mode).toBe('d')
    expect(calls[0]).toBe('https://api.example.test/results?prefCode=12&limit=30')

    await store.listByPrefecture('13', 5)
    expect(calls[1]).toBe('https://api.example.test/results?prefCode=13&limit=5')
  })

  it('どちらも失敗は例外にする', async () => {
    const store = new RemoteRankingStore('https://api.example.test', () => Promise.resolve(response(500, {})))
    await expect(store.prefectureStats()).rejects.toThrow(/500/)
    await expect(store.listByPrefecture('12')).rejects.toThrow(/500/)
  })

  it('壊れた応答は空配列として扱う', async () => {
    const store = new RemoteRankingStore('https://api.example.test', () => Promise.resolve(response(200, {})))
    expect(await store.prefectureStats()).toEqual([])
    expect(await store.listByPrefecture('12')).toEqual([])
  })
})
