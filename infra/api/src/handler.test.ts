/**
 * 共有ランキング API のハンドラ単体テスト（node 環境）。
 * DynamoDB はメモリ上の偽物、問題バンクは src/engine/__fixtures__ に差し替える。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { fixtureSource } from '../../../src/engine/__fixtures__/questions.ts'
import { DATA_VERSION, buildQuestionSet } from '../../../src/engine/bank.ts'
import type { QuestionSet } from '../../../src/engine/types.ts'
import type {
  DdbPort,
  EntryItem,
  HttpApiEvent,
  HttpApiResult,
  MarkerItem,
  ReservationItem,
  StatItem,
} from './handler.ts'
import { STATS_PK, createHandler, prefPk, setPk } from './handler.ts'

const SET_ID = `${DATA_VERSION}-e-12-1234`
/** 千葉県の全市区町村名。フィクスチャの千葉県は 25 市区町村なので 25 問になる */
const SET_ALL = `${DATA_VERSION}-e-12-0417-all`
const ORIGIN = 'https://akiralab.github.io'

/** pk|sk → item のメモリ実装。条件付き書き込みと ADD の加算だけを再現する */
function memoryDdb(seed: EntryItem[] = []): DdbPort & { items: Map<string, Record<string, unknown>> } {
  const items = new Map<string, Record<string, unknown>>()
  for (const e of seed) items.set(`${e.pk}|${e.sk}`, { ...e })
  return {
    items,
    async claimAndPut(reservation: ReservationItem, entry: EntryItem) {
      const key = `${reservation.pk}|${reservation.sk}`
      if (items.has(key)) return false
      items.set(key, { ...reservation })
      items.set(`${entry.pk}|${entry.sk}`, { ...entry })
      return true
    },
    async listEntries(pk: string) {
      const out: EntryItem[] = []
      for (const [key, value] of items) {
        if (key.startsWith(`${pk}|entry#`)) out.push(value as unknown as EntryItem)
      }
      // DynamoDB の返り順には依存しない前提を明示するため、あえて逆順で返す
      return out.reverse()
    },
    async putIndexEntry(item: EntryItem) {
      items.set(`${item.pk}|${item.sk}`, { ...item })
    },
    async putMarkerIfAbsent(item: MarkerItem) {
      const key = `${item.pk}|${item.sk}`
      if (items.has(key)) return false
      items.set(key, { ...item })
      return true
    },
    async addStats(prefCode: string, entries: number, players: number) {
      const key = `${STATS_PK}|${prefCode}`
      const cur = (items.get(key) ?? { pk: STATS_PK, sk: prefCode, entries: 0, players: 0 }) as unknown as StatItem
      items.set(key, {
        ...cur,
        entries: (cur.entries ?? 0) + entries,
        players: (cur.players ?? 0) + players,
      })
    },
    async listStats() {
      const out: StatItem[] = []
      for (const [key, value] of items) {
        if (key.startsWith(`${STATS_PK}|`)) out.push(value as unknown as StatItem)
      }
      return out
    },
  }
}

function entryItem(over: Partial<EntryItem> & { entryId: string }): EntryItem {
  const createdAt = over.createdAt ?? '2026-10-02T00:00:00.000Z'
  return {
    pk: setPk(SET_ID),
    sk: `entry#${createdAt}#${over.entryId}`,
    setId: SET_ID,
    nickname: over.entryId,
    score: 50,
    timeMs: 50_000,
    mode: 'e',
    scope: '12',
    timeLimitMs: 0,
    ...over,
    createdAt,
  }
}

let EXPECTED: QuestionSet
/** 全市区町村名のセット（千葉県の 25 市区町村ぜんぶ） */
let EXPECTED_ALL: QuestionSet
let seq = 0

function makeHandler(ddb: DdbPort) {
  seq = 0
  return createHandler({
    ddb,
    bankSource: fixtureSource(),
    now: () => new Date('2026-10-02T12:00:00.000Z'),
    randomId: () => `id-${++seq}`,
  })
}

function postEvent(body: unknown, origin: string = ORIGIN): HttpApiEvent {
  return {
    headers: { Origin: origin, 'content-type': 'application/json' },
    requestContext: { http: { method: 'POST', path: '/results' } },
    body: JSON.stringify(body),
  }
}

function getEvent(query: Record<string, string>, origin: string = ORIGIN): HttpApiEvent {
  return {
    headers: { origin },
    queryStringParameters: query,
    requestContext: { http: { method: 'GET', path: '/results' } },
  }
}

function answersFor(correctCount: number) {
  return EXPECTED.questions.map((q, i) => ({
    questionId: q.id,
    input: i < correctCount ? q.answer : 'ちがう',
    ms: 3000,
    passed: false,
  }))
}

function parse(res: HttpApiResult): Record<string, unknown> {
  return JSON.parse(res.body) as Record<string, unknown>
}

/** 全市区町村名のセットの答案。先頭 correctCount 件だけ正解を入れる */
function answersForAll(correctCount: number) {
  return EXPECTED_ALL.questions.map((q, i) => ({
    questionId: q.id,
    input: i < correctCount ? q.answer : 'ちがう',
    ms: 2000,
    passed: false,
  }))
}

beforeEach(async () => {
  EXPECTED = await buildQuestionSet('e', '12', '1234', fixtureSource())
  EXPECTED_ALL = await buildQuestionSet('e', '12', '0417', fixtureSource(), true)
})

describe('POST /results', () => {
  it('201 で順位と entry を返し、得点はサーバーで再採点する', async () => {
    const handler = makeHandler(memoryDdb())
    const res = await handler(
      // クライアントが申告した score は body に含めない契約。入力だけから 70 点になる
      postEvent({ setId: SET_ID, nickname: ' たろう ', clientToken: 'tok-a', answers: answersFor(7) }),
    )
    expect(res.statusCode).toBe(201)
    const out = parse(res)
    expect(out.ok).toBe(true)
    expect(out.rank).toBe(1)
    expect(out.entry).toEqual({
      entryId: 'id-1',
      setId: SET_ID,
      nickname: 'たろう', // 前後空白は落とす
      score: 70,
      correct: 7,
      total: 10,
      timeMs: 30_000,
      createdAt: '2026-10-02T12:00:00.000Z',
      mode: 'e',
      scope: '12',
      timeLimitMs: 0,
    })
  })

  it('パスした問題は正解にしない（制限なしのパスは実測の ms）', async () => {
    const handler = makeHandler(memoryDdb())
    const answers = answersFor(10).map((a, i) => (i < 2 ? { ...a, input: '', ms: 1234, passed: true } : a))
    const res = await handler(postEvent({ setId: SET_ID, nickname: 'たろう', clientToken: 'tok-a', answers }))
    expect(res.statusCode).toBe(201)
    expect((parse(res).entry as { score: number }).score).toBe(80)
  })

  it('先に登録した人より良い点なら上位の rank が返る', async () => {
    const ddb = memoryDdb([
      entryItem({ entryId: 'old-1', nickname: 'せんぱい', score: 100, timeMs: 10_000 }),
      entryItem({ entryId: 'old-2', nickname: 'どうはい', score: 50, timeMs: 10_000 }),
    ])
    const handler = makeHandler(ddb)
    const res = await handler(postEvent({ setId: SET_ID, nickname: 'たろう', clientToken: 'tok-a', answers: answersFor(7) }))
    expect(parse(res).rank).toBe(2)
  })

  it('同じ clientToken の 2 回目は 409 already_submitted', async () => {
    const handler = makeHandler(memoryDdb())
    const body = { setId: SET_ID, nickname: 'たろう', clientToken: 'tok-a', answers: answersFor(7) }
    expect((await handler(postEvent(body))).statusCode).toBe(201)
    const res = await handler(postEvent({ ...body, answers: answersFor(10) }))
    expect(res.statusCode).toBe(409)
    expect(parse(res)).toEqual({ ok: false, reason: 'already_submitted' })
  })

  it('別 clientToken なら同じ setId へ登録できる', async () => {
    const ddb = memoryDdb()
    const handler = makeHandler(ddb)
    await handler(postEvent({ setId: SET_ID, nickname: 'A', clientToken: 'tok-a', answers: answersFor(7) }))
    const res = await handler(postEvent({ setId: SET_ID, nickname: 'B', clientToken: 'tok-b', answers: answersFor(9) }))
    expect(res.statusCode).toBe(201)
    expect(parse(res).rank).toBe(1) // 90 点が 70 点より上
  })

  it('questionId が出題と一致しなければ 400', async () => {
    const handler = makeHandler(memoryDdb())
    const answers = answersFor(10)
    answers[3] = { ...answers[3], questionId: 'c:120001:よその町' }
    const res = await handler(postEvent({ setId: SET_ID, nickname: 'たろう', clientToken: 'tok-a', answers }))
    expect(res.statusCode).toBe(400)
    expect(parse(res).reason).toBe('invalid')
    expect(String(parse(res).detail)).toContain('questionId')
  })

  it('answers が再導出した問題数（10 問）と違えば 400', async () => {
    const handler = makeHandler(memoryDdb())
    const res = await handler(
      postEvent({ setId: SET_ID, nickname: 'たろう', clientToken: 'tok-a', answers: answersFor(7).slice(0, 9) }),
    )
    expect(res.statusCode).toBe(400)
  })

  it('nickname が 1〜12 文字でなければ 400', async () => {
    const handler = makeHandler(memoryDdb())
    for (const nickname of ['', '   ', 'あいうえおかきくけこさしす']) {
      const res = await handler(postEvent({ setId: SET_ID, nickname, clientToken: 'tok-a', answers: answersFor(7) }))
      expect(res.statusCode).toBe(400)
      expect(parse(res).reason).toBe('invalid')
    }
  })

  it('制限なし（省略 / 0）は ms 0〜600000 を許し、passed の ms は縛らない', async () => {
    const handler = makeHandler(memoryDdb())
    const slow = answersFor(10).map((a, i) => (i === 0 ? { ...a, ms: 120_000 } : a))
    expect(
      (await handler(postEvent({ setId: SET_ID, nickname: 'た', clientToken: 'x', answers: slow }))).statusCode,
    ).toBe(201)

    const freePass = answersFor(10).map((a, i) => (i === 0 ? { ...a, passed: true, ms: 100 } : a))
    expect(
      (
        await handler(
          postEvent({ setId: SET_ID, nickname: 'た', clientToken: 'y', timeLimitMs: 0, answers: freePass }),
        )
      ).statusCode,
    ).toBe(201)

    const tooSlow = answersFor(10).map((a, i) => (i === 0 ? { ...a, ms: 600_001 } : a))
    expect(
      (await handler(postEvent({ setId: SET_ID, nickname: 'た', clientToken: 'z', answers: tooSlow }))).statusCode,
    ).toBe(400)
  })

  it('制限ありは ms が制限超過・passed の ms が制限と違えば 400', async () => {
    const handler = makeHandler(memoryDdb())
    const base = { setId: SET_ID, nickname: 'た', clientToken: 'x', timeLimitMs: 20_000 }
    const over = answersFor(10).map((a, i) => (i === 0 ? { ...a, ms: 20_001 } : a))
    expect((await handler(postEvent({ ...base, answers: over }))).statusCode).toBe(400)

    const badPass = answersFor(10).map((a, i) => (i === 0 ? { ...a, passed: true, ms: 100 } : a))
    expect((await handler(postEvent({ ...base, answers: badPass }))).statusCode).toBe(400)

    const okPass = answersFor(10).map((a, i) => (i === 0 ? { ...a, input: '', passed: true, ms: 20_000 } : a))
    const res = await handler(postEvent({ ...base, answers: okPass }))
    expect(res.statusCode).toBe(201)
    expect((parse(res).entry as { timeLimitMs: number }).timeLimitMs).toBe(20_000)
  })

  it('timeLimitMs が 0 でも 1000〜60000 でもなければ 400', async () => {
    const handler = makeHandler(memoryDdb())
    for (const timeLimitMs of [999, 60_001, -1, 1.5, '20000']) {
      const res = await handler(
        postEvent({ setId: SET_ID, nickname: 'た', clientToken: 'x', timeLimitMs, answers: answersFor(7) }),
      )
      expect(res.statusCode).toBe(400)
    }
  })

  it('setId が読めない・版が違うなら 400', async () => {
    const handler = makeHandler(memoryDdb())
    for (const setId of ['こわれた', `${DATA_VERSION}-e-12-12`, 'abr20991231-e-12-1234']) {
      const res = await handler(postEvent({ setId, nickname: 'た', clientToken: 'x', answers: answersFor(7) }))
      expect(res.statusCode).toBe(400)
    }
  })

  it('body が JSON でなければ 400', async () => {
    const handler = makeHandler(memoryDdb())
    const res = await handler({
      headers: { origin: ORIGIN },
      requestContext: { http: { method: 'POST', path: '/results' } },
      body: '{',
    })
    expect(res.statusCode).toBe(400)
  })

  it('base64 の body も読む', async () => {
    const handler = makeHandler(memoryDdb())
    const body = JSON.stringify({ setId: SET_ID, nickname: 'たろう', clientToken: 'tok-a', answers: answersFor(7) })
    const res = await handler({
      headers: { origin: ORIGIN },
      requestContext: { http: { method: 'POST', path: '/results' } },
      body: Buffer.from(body, 'utf8').toString('base64'),
      isBase64Encoded: true,
    })
    expect(res.statusCode).toBe(201)
  })

  it('問題バンクが読めないときは 400 にせず 502 を返す', async () => {
    const handler = createHandler({
      ddb: memoryDdb(),
      bankSource: {
        async meta() {
          throw new Error('問題バンクを読み込めませんでした（503）: meta.json')
        },
        async easy() {
          throw new Error('問題バンクを読み込めませんでした（503）: easy.json')
        },
        async difficult() {
          throw new Error('問題バンクを読み込めませんでした（503）: difficult/12.json')
        },
      },
    })
    const res = await handler(postEvent({ setId: SET_ID, nickname: 'た', clientToken: 'x', answers: answersFor(7) }))
    expect(res.statusCode).toBe(502)
    expect(parse(res).reason).not.toBe('invalid')
  })
})

describe('GET /results', () => {
  const seedRows = [
    entryItem({ entryId: 'a', nickname: 'A', score: 80, timeMs: 40_000, createdAt: '2026-10-02T00:00:03.000Z' }),
    entryItem({ entryId: 'b', nickname: 'B', score: 100, timeMs: 90_000, createdAt: '2026-10-02T00:00:02.000Z' }),
    entryItem({ entryId: 'c', nickname: 'C', score: 80, timeMs: 30_000, createdAt: '2026-10-02T00:00:01.000Z' }),
    entryItem({ entryId: 'd', nickname: 'D', score: 80, timeMs: 40_000, createdAt: '2026-10-02T00:00:00.000Z' }),
  ]

  it('得点降順 → 所要時間昇順 → 登録順に並ぶ', async () => {
    const handler = makeHandler(memoryDdb(seedRows))
    const res = await handler(getEvent({ setId: SET_ID }))
    expect(res.statusCode).toBe(200)
    const entries = parse(res).entries as { nickname: string }[]
    expect(entries.map((e) => e.nickname)).toEqual(['B', 'C', 'D', 'A'])
  })

  it('answers と clientToken は返さない', async () => {
    const handler = makeHandler(memoryDdb(seedRows))
    const entries = parse(await handler(getEvent({ setId: SET_ID }))).entries as Record<string, unknown>[]
    expect(Object.keys(entries[0]).sort()).toEqual([
      'correct',
      'createdAt',
      'entryId',
      'mode',
      'nickname',
      'scope',
      'score',
      'setId',
      'timeLimitMs',
      'timeMs',
      'total',
    ])
  })

  it('limit 既定 20・最大 100・指定も効く', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      entryItem({ entryId: `e${i}`, nickname: `N${i}`, score: 100 - i }),
    )
    const handler = makeHandler(memoryDdb(many))
    expect((parse(await handler(getEvent({ setId: SET_ID }))).entries as unknown[]).length).toBe(20)
    expect((parse(await handler(getEvent({ setId: SET_ID, limit: '3' }))).entries as unknown[]).length).toBe(3)
    expect((parse(await handler(getEvent({ setId: SET_ID, limit: '1000' }))).entries as unknown[]).length).toBe(25)
  })

  it('setId が無い・読めなければ 400', async () => {
    const handler = makeHandler(memoryDdb())
    expect((await handler(getEvent({}))).statusCode).toBe(400)
    expect((await handler(getEvent({ setId: 'だめ' }))).statusCode).toBe(400)
  })

  it('登録が無ければ空配列', async () => {
    const handler = makeHandler(memoryDdb())
    expect(parse(await handler(getEvent({ setId: SET_ID }))).entries).toEqual([])
  })
})

describe('CORS', () => {
  it('許可 Origin には Access-Control-Allow-Origin を返す', async () => {
    const handler = makeHandler(memoryDdb())
    for (const origin of ['https://akiralab.github.io', 'http://localhost:5173', 'http://localhost:4173']) {
      const res = await handler(getEvent({ setId: SET_ID }, origin))
      expect(res.headers['access-control-allow-origin']).toBe(origin)
      expect(res.headers.vary).toBe('Origin')
    }
  })

  it('許可外 Origin には返さない', async () => {
    const handler = makeHandler(memoryDdb())
    const res = await handler(getEvent({ setId: SET_ID }, 'https://evil.example.com'))
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('OPTIONS は 204 でメソッド・ヘッダを返す', async () => {
    const handler = makeHandler(memoryDdb())
    const res = await handler({
      headers: { origin: ORIGIN },
      requestContext: { http: { method: 'OPTIONS', path: '/results' } },
    })
    expect(res.statusCode).toBe(204)
    expect(res.headers['access-control-allow-methods']).toContain('POST')
    expect(res.headers['access-control-allow-headers']).toContain('content-type')
  })

  it('ALLOWED_ORIGINS は差し替えできる', async () => {
    const handler = createHandler({
      ddb: memoryDdb(),
      bankSource: fixtureSource(),
      allowedOrigins: ['https://example.test'],
    })
    expect((await handler(getEvent({ setId: SET_ID }, 'https://example.test'))).headers['access-control-allow-origin']).toBe(
      'https://example.test',
    )
    expect((await handler(getEvent({ setId: SET_ID }, ORIGIN))).headers['access-control-allow-origin']).toBeUndefined()
  })
})

// --------------------------------------------------------- 都道府県インデックス

describe('都道府県別の集計', () => {
  /** scope が異なる setId で投稿するためのヘルパー。seed は 4 桁 */
  function setIdOf(mode: 'e' | 'd', scope: string, seed: string): string {
    return `${DATA_VERSION}-${mode}-${scope}-${seed}`
  }

  async function post(
    handler: (e: HttpApiEvent) => Promise<HttpApiResult>,
    setId: string,
    clientToken: string,
    nickname: string,
    correctCount: number,
  ): Promise<HttpApiResult> {
    const set = await buildQuestionSet(
      setId.split('-')[1] as 'e' | 'd',
      setId.split('-')[2],
      setId.split('-')[3],
      fixtureSource(),
    )
    const answers = set.questions.map((q, i) => ({
      questionId: q.id,
      input: i < correctCount ? q.answer : 'ちがう',
      ms: 3000,
      passed: false,
    }))
    return handler(postEvent({ setId, nickname, clientToken, answers }))
  }

  it('登録すると pref# の索引・player マーカー・stats# カウンタが揃う', async () => {
    const ddb = memoryDdb()
    const handler = makeHandler(ddb)
    expect((await post(handler, SET_ID, 'tok-a', 'たろう', 7)).statusCode).toBe(201)

    const keys = [...ddb.items.keys()]
    expect(keys.filter((k) => k.startsWith(`${prefPk('12')}|entry#`))).toHaveLength(1)
    expect(keys).toContain(`${prefPk('12')}|player#tok-a`)
    expect(ddb.items.get(`${STATS_PK}|12`)).toMatchObject({ entries: 1, players: 1 })
  })

  it('科目別のカウンタとマーカーも一緒に増える', async () => {
    const ddb = memoryDdb()
    const handler = makeHandler(ddb)
    expect((await post(handler, setIdOf('e', '12', '1234'), 'tok-a', 'たろう', 7)).statusCode).toBe(201)
    expect((await post(handler, setIdOf('d', '120001', '1234'), 'tok-a', 'たろう', 5)).statusCode).toBe(201)

    expect(ddb.items.get(`${STATS_PK}|12`)).toMatchObject({ entries: 2, players: 1 })
    expect(ddb.items.get(`${STATS_PK}|12#e`)).toMatchObject({ entries: 1, players: 1 })
    expect(ddb.items.get(`${STATS_PK}|12#d`)).toMatchObject({ entries: 1, players: 1 })
    expect([...ddb.items.keys()]).toContain(`${prefPk('12')}|player#e#tok-a`)
    expect([...ddb.items.keys()]).toContain(`${prefPk('12')}|player#d#tok-a`)
  })

  it('同じ科目の 2 セット目は科目別 players も増えない', async () => {
    const ddb = memoryDdb()
    const handler = makeHandler(ddb)
    await post(handler, setIdOf('e', '12', '1234'), 'tok-a', 'たろう', 7)
    await post(handler, setIdOf('e', '12', '5678'), 'tok-a', 'たろう', 9)
    expect(ddb.items.get(`${STATS_PK}|12#e`)).toMatchObject({ entries: 2, players: 1 })
  })

  it('同じ clientToken の 2 セット目は players が増えず entries だけ増える', async () => {
    const ddb = memoryDdb()
    const handler = makeHandler(ddb)
    expect((await post(handler, setIdOf('e', '12', '1234'), 'tok-a', 'たろう', 7)).statusCode).toBe(201)
    expect((await post(handler, setIdOf('e', '12', '5678'), 'tok-a', 'たろう', 9)).statusCode).toBe(201)

    expect(ddb.items.get(`${STATS_PK}|12`)).toMatchObject({ entries: 2, players: 1 })

    // 別の端末が入れば players も増える
    expect((await post(handler, setIdOf('e', '12', '5678'), 'tok-b', 'はなこ', 5)).statusCode).toBe(201)
    expect(ddb.items.get(`${STATS_PK}|12`)).toMatchObject({ entries: 3, players: 2 })
  })

  it('全国（scope 00）は prefCode 00 に集まる', async () => {
    const ddb = memoryDdb()
    const handler = makeHandler(ddb)
    expect((await post(handler, setIdOf('e', '00', '1234'), 'tok-a', 'たろう', 7)).statusCode).toBe(201)
    expect(ddb.items.get(`${STATS_PK}|00`)).toMatchObject({ entries: 1, players: 1 })
  })

  it('市区町村スコープは先頭 2 桁の都道府県に集まる', async () => {
    const ddb = memoryDdb()
    const handler = makeHandler(ddb)
    expect((await post(handler, setIdOf('d', '120001', '1234'), 'tok-a', 'たろう', 7)).statusCode).toBe(201)
    expect(ddb.items.get(`${STATS_PK}|12`)).toMatchObject({ entries: 1, players: 1 })
    const rows = parse(await handler(getEvent({ prefCode: '12' }))).entries as { scope: string; mode: string }[]
    expect(rows[0].scope).toBe('120001')
    expect(rows[0].mode).toBe('d')
  })

  it('索引の書き込みに失敗しても登録自体は 201 のまま', async () => {
    const ddb = memoryDdb()
    const broken: DdbPort = {
      ...ddb,
      putIndexEntry() {
        return Promise.reject(new Error('DynamoDB が不調'))
      },
    }
    const handler = makeHandler(broken)
    expect((await post(handler, SET_ID, 'tok-a', 'たろう', 7)).statusCode).toBe(201)
  })
})

describe('GET /results?prefCode=', () => {
  const seedRows = [
    entryItem({ entryId: 'a', nickname: 'A', score: 80, timeMs: 40_000, createdAt: '2026-10-02T00:00:03.000Z' }),
    entryItem({ entryId: 'b', nickname: 'B', score: 100, timeMs: 90_000, createdAt: '2026-10-02T00:00:02.000Z' }),
    entryItem({ entryId: 'c', nickname: 'C', score: 80, timeMs: 30_000, createdAt: '2026-10-02T00:00:01.000Z' }),
    entryItem({ entryId: 'd', nickname: 'D', score: 80, timeMs: 40_000, createdAt: '2026-10-02T00:00:00.000Z' }),
  ].map((e) => ({ ...e, pk: prefPk('12') }))

  it('得点降順 → 所要時間昇順 → 登録順に並び、mode と scope が入る', async () => {
    const handler = makeHandler(memoryDdb(seedRows))
    const res = await handler(getEvent({ prefCode: '12' }))
    expect(res.statusCode).toBe(200)
    const entries = parse(res).entries as { nickname: string; mode: string; scope: string }[]
    expect(entries.map((e) => e.nickname)).toEqual(['B', 'C', 'D', 'A'])
    expect(entries[0].mode).toBe('e')
    expect(entries[0].scope).toBe('12')
  })

  it('既定は 30 件・limit 指定も効く', async () => {
    const many = Array.from({ length: 35 }, (_, i) =>
      entryItem({ entryId: `e${i}`, nickname: `N${i}`, score: 100 - i, pk: prefPk('13') }),
    )
    const handler = makeHandler(memoryDdb(many))
    expect((parse(await handler(getEvent({ prefCode: '13' }))).entries as unknown[]).length).toBe(30)
    expect((parse(await handler(getEvent({ prefCode: '13', limit: '5' }))).entries as unknown[]).length).toBe(5)
  })

  it('mode を渡すとサーバー側で科目を絞る', async () => {
    const mixed = [
      ...seedRows,
      { ...entryItem({ entryId: 'z', nickname: 'Z', score: 90, mode: 'd' as const, scope: '120001' }), pk: prefPk('12') },
    ]
    const handler = makeHandler(memoryDdb(mixed))
    const easy = parse(await handler(getEvent({ prefCode: '12', mode: 'e' }))).entries as { nickname: string }[]
    expect(easy.map((e) => e.nickname)).toEqual(['B', 'C', 'D', 'A'])

    const hard = parse(await handler(getEvent({ prefCode: '12', mode: 'd' }))).entries as { nickname: string }[]
    expect(hard.map((e) => e.nickname)).toEqual(['Z'])

    // 省略すれば両方
    expect((parse(await handler(getEvent({ prefCode: '12' }))).entries as unknown[]).length).toBe(5)
    expect((await handler(getEvent({ prefCode: '12', mode: 'x' }))).statusCode).toBe(400)
  })

  it('別の都道府県は混ざらない / prefCode が 2 桁でなければ 400', async () => {
    const handler = makeHandler(memoryDdb(seedRows))
    expect(parse(await handler(getEvent({ prefCode: '13' }))).entries).toEqual([])
    expect((await handler(getEvent({ prefCode: 'xx' }))).statusCode).toBe(400)
    expect((await handler(getEvent({ prefCode: '123' }))).statusCode).toBe(400)
  })
})

describe('GET /stats/prefectures', () => {
  function statsEvent(origin: string = ORIGIN): HttpApiEvent {
    return {
      headers: { origin },
      requestContext: { http: { method: 'GET', path: '/stats/prefectures' } },
    }
  }

  it('prefCode 昇順で合計と科目別の内訳を返す', async () => {
    const ddb = memoryDdb()
    await ddb.addStats('13', 5, 3)
    await ddb.addStats('13#e', 4, 2)
    await ddb.addStats('13#d', 1, 1)
    await ddb.addStats('00', 2, 2)
    await ddb.addStats('12', 1, 1)
    const handler = makeHandler(ddb)
    const res = await handler(statsEvent())
    expect(res.statusCode).toBe(200)
    expect(parse(res).prefectures).toEqual([
      {
        prefCode: '00',
        entries: 2,
        players: 2,
        byMode: { e: { entries: 0, players: 0 }, d: { entries: 0, players: 0 }, all: { entries: 0, players: 0 } },
      },
      {
        prefCode: '12',
        entries: 1,
        players: 1,
        byMode: { e: { entries: 0, players: 0 }, d: { entries: 0, players: 0 }, all: { entries: 0, players: 0 } },
      },
      {
        prefCode: '13',
        entries: 5,
        players: 3,
        byMode: { e: { entries: 4, players: 2 }, d: { entries: 1, players: 1 }, all: { entries: 0, players: 0 } },
      },
    ])
  })

  it('合計行が無く科目別だけでも、合計を足し上げて返す', async () => {
    const ddb = memoryDdb()
    await ddb.addStats('12#e', 3, 2)
    await ddb.addStats('12#d', 2, 1)
    const handler = makeHandler(ddb)
    expect(parse(await handler(statsEvent())).prefectures).toEqual([
      {
        prefCode: '12',
        entries: 5,
        players: 3,
        byMode: { e: { entries: 3, players: 2 }, d: { entries: 2, players: 1 }, all: { entries: 0, players: 0 } },
      },
    ])
  })

  it('登録が無ければ空配列・CORS も付く', async () => {
    const handler = makeHandler(memoryDdb())
    const res = await handler(statsEvent())
    expect(parse(res).prefectures).toEqual([])
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN)
  })
})

describe('ルーティング', () => {
  it('知らないパスは 404', async () => {
    const handler = makeHandler(memoryDdb())
    const res = await handler({
      headers: { origin: ORIGIN },
      requestContext: { http: { method: 'GET', path: '/nope' } },
    })
    expect(res.statusCode).toBe(404)
  })
})

// ---------------------------------------------------------------- 全市区町村名

describe('POST /results（全市区町村名の `-all` セット）', () => {
  it('問題数は再導出したセットに合わせ、得点は正答率を 100 点満点に丸めた値で保存する', async () => {
    expect(EXPECTED_ALL.questions).toHaveLength(25)
    const ddb = memoryDdb()
    const handler = makeHandler(ddb)
    const res = await handler(
      postEvent({ setId: SET_ALL, nickname: 'たろう', clientToken: 'tok-a', answers: answersForAll(19) }),
    )
    expect(res.statusCode).toBe(201)
    // 19 / 25 = 76 点（10 問のときの「正答数 × 10」ではない）
    expect(parse(res).entry).toEqual({
      entryId: 'id-1',
      setId: SET_ALL,
      nickname: 'たろう',
      score: 76,
      correct: 19,
      total: 25,
      timeMs: 50_000,
      createdAt: '2026-10-02T12:00:00.000Z',
      mode: 'e',
      scope: '12',
      timeLimitMs: 0,
    })
    // 保存したアイテムにも区分の印が残る（都道府県別の絞り込みに使う）
    expect(ddb.items.get(`${setPk(SET_ALL)}|entry#2026-10-02T12:00:00.000Z#id-1`)).toMatchObject({
      all: true,
      correct: 19,
      total: 25,
    })
  })

  it('answers が 10 件でも 24 件でも、セットの件数と違えば 400', async () => {
    const handler = makeHandler(memoryDdb())
    for (const answers of [answersForAll(10).slice(0, 10), answersForAll(24).slice(0, 24)]) {
      const res = await handler(postEvent({ setId: SET_ALL, nickname: 'たろう', clientToken: 'tok-a', answers }))
      expect(res.statusCode).toBe(400)
      expect(String(parse(res).detail)).toContain('25 件')
    }
  })

  it('都道府県別では 10 問の科目と混ざらず、`?mode=all` で引ける', async () => {
    const ddb = memoryDdb()
    const handler = makeHandler(ddb)
    expect(
      (
        await handler(postEvent({ setId: SET_ALL, nickname: 'たろう', clientToken: 'tok-a', answers: answersForAll(19) }))
      ).statusCode,
    ).toBe(201)
    expect(
      (
        await handler(postEvent({ setId: SET_ID, nickname: 'はなこ', clientToken: 'tok-b', answers: answersFor(7) }))
      ).statusCode,
    ).toBe(201)

    const allRows = parse(await handler(getEvent({ prefCode: '12', mode: 'all' }))).entries as { nickname: string }[]
    expect(allRows.map((r) => r.nickname)).toEqual(['たろう'])
    const easyRows = parse(await handler(getEvent({ prefCode: '12', mode: 'e' }))).entries as { nickname: string }[]
    expect(easyRows.map((r) => r.nickname)).toEqual(['はなこ'])

    // カウンタも区分別（`{prefCode}#all`）に分かれる
    expect(ddb.items.get(`${STATS_PK}|12#all`)).toMatchObject({ entries: 1, players: 1 })
    expect(ddb.items.get(`${STATS_PK}|12#e`)).toMatchObject({ entries: 1, players: 1 })
    const stats = parse(
      await handler({
        headers: { origin: ORIGIN },
        requestContext: { http: { method: 'GET', path: '/stats/prefectures' } },
      }),
    ).prefectures as { prefCode: string; byMode: Record<string, { entries: number }> }[]
    expect(stats.find((s) => s.prefCode === '12')?.byMode.all.entries).toBe(1)
  })

  it('知らない mode は 400 のまま', async () => {
    const handler = makeHandler(memoryDdb())
    const res = await handler(getEvent({ prefCode: '12', mode: 'x' }))
    expect(res.statusCode).toBe(400)
  })
})
