/**
 * 共有ランキング API（API Gateway HTTP API payload v2 → Lambda）。
 * 契約の正本は infra/API.md。
 *
 * 設計の要点:
 *  - 採点はここで行う。クライアントが送るのは setId と各問の入力だけ。
 *    setId から `src/engine` の buildQuestionSet() で問題セットを再導出し、grade() で採点する。
 *  - 1 セット 1 登録は DynamoDB の条件付き書き込み（予約アイテム）で担保する。
 *  - 依存（DynamoDB・問題バンク・時刻・ID 生成）は createHandler() に注入する。
 *    default export の handler は本番依存で組み立てたもの。
 */
import type { BankSource } from '../../../src/engine/bank.ts'
import { DATA_VERSION, buildQuestionSet, createFetchSource } from '../../../src/engine/bank.ts'
import { grade } from '../../../src/engine/grading.ts'
import { SCOPE_NATIONWIDE, parseSetId } from '../../../src/engine/setId.ts'
import type { Mode, PrefectureStat, Question, RankingRow } from '../../../src/engine/types.ts'
import { QUESTIONS_PER_SET, TIME_LIMIT_MS } from '../../../src/engine/types.ts'

// ---------------------------------------------------------------- 入出力の型

/** API Gateway HTTP API payload format 2.0 のうち、このハンドラが使う部分 */
export interface HttpApiEvent {
  headers?: Record<string, string | undefined>
  queryStringParameters?: Record<string, string | undefined> | null
  requestContext: { http: { method: string; path: string } }
  body?: string | null
  isBase64Encoded?: boolean
}

export interface HttpApiResult {
  statusCode: number
  headers: Record<string, string>
  body: string
}

// ---------------------------------------------------------------- DynamoDB ポート

/** pk = `set#{setId}`、sk = `token#{clientToken}`。1 セット 1 登録の予約 */
export interface ReservationItem {
  pk: string
  sk: string
  entryId: string
  createdAt: string
}

/**
 * 一覧に出す本体。同じ形で 2 か所に置く:
 *   - セット単位  pk = `set#{setId}`  … `GET /results?setId=`
 *   - 都道府県別  pk = `pref#{prefCode}` … `GET /results?prefCode=`
 */
export interface EntryItem {
  pk: string
  sk: string
  entryId: string
  setId: string
  nickname: string
  score: number
  timeMs: number
  createdAt: string
  mode: Mode
  /** '00' = 全国、2 桁 = 都道府県、6 桁 = 市区町村 */
  scope: string
}

/** pk = `pref#{prefCode}`、sk = `player#{clientToken}`。人数（players）を数えるための印 */
export interface MarkerItem {
  pk: string
  sk: string
  createdAt: string
}

/** pk = `stats#pref`、sk = prefCode。件数と人数のカウンタ */
export interface StatItem {
  pk: string
  sk: string
  entries?: number
  players?: number
}

/** ハンドラが必要とする DynamoDB 操作だけを切り出したポート */
export interface DdbPort {
  /** 予約と本体を一括で書く。予約済み（= 二重登録）なら false を返し、何も書かない */
  claimAndPut(reservation: ReservationItem, entry: EntryItem): Promise<boolean>
  /** pk の `entry#` 配下を全件返す（並び順は呼び出し側で決める） */
  listEntries(pk: string): Promise<EntryItem[]>
  /** 都道府県インデックスの 1 行を無条件に書く */
  putIndexEntry(item: EntryItem): Promise<void>
  /** 無ければ書いて true、既にあれば false（players の印） */
  putMarkerIfAbsent(item: MarkerItem): Promise<boolean>
  /** `stats#pref` の prefCode 行に ADD で加算する */
  addStats(prefCode: string, entries: number, players: number): Promise<void>
  /** `stats#pref` を全件 */
  listStats(): Promise<StatItem[]>
}

export interface HandlerDeps {
  ddb: DdbPort
  bankSource: BankSource
  now?: () => Date
  randomId?: () => string
  allowedOrigins?: string[]
}

// ---------------------------------------------------------------- 定数

export const DEFAULT_ALLOWED_ORIGINS = [
  'https://akiralab.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
]

export const DEFAULT_LIMIT = 20
/** 都道府県別の一覧（GET /results?prefCode=）の既定件数 */
export const DEFAULT_PREF_LIMIT = 30
export const MAX_LIMIT = 100
/** ニックネームの文字数（コードポイント）上限 */
export const NICKNAME_MAX = 12
/** 解答入力の文字数上限（防御的な上限。採点には影響しない） */
const INPUT_MAX = 64

export function setPk(setId: string): string {
  return `set#${setId}`
}

export function prefPk(prefCode: string): string {
  return `pref#${prefCode}`
}

/** 都道府県別カウンタの pk。sk が prefCode */
export const STATS_PK = 'stats#pref'

/** setId の scope が属する都道府県コード。全国（'00'）はそのまま '00' */
export function prefCodeOfScope(scope: string): string {
  return scope === SCOPE_NATIONWIDE ? SCOPE_NATIONWIDE : scope.slice(0, 2)
}

const PREF_CODE_RE = /^\d{2}$/

/** 問題バンクの置き場。BANK_BASE_URL は版ディレクトリの 1 つ上（例 `.../questions/`） */
export function bankSourceFor(baseUrl: string): BankSource {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return createFetchSource(`${base}${DATA_VERSION}/`)
}

// ---------------------------------------------------------------- 失敗の分類

/** 問題バンクが読めない = クライアントの入力の問題ではない */
class BankUnavailableError extends Error {}

/** BankSource の失敗を BankUnavailableError に包み直す（400 と 502 を切り分けるため） */
function guardSource(source: BankSource): BankSource {
  const wrap = async <T>(p: () => Promise<T>): Promise<T> => {
    try {
      return await p()
    } catch (e: unknown) {
      throw new BankUnavailableError(e instanceof Error ? e.message : String(e))
    }
  }
  return {
    meta: () => wrap(() => source.meta()),
    easy: () => wrap(() => source.easy()),
    difficult: (prefCode: string) => wrap(() => source.difficult(prefCode)),
  }
}

// ---------------------------------------------------------------- CORS

function originOf(event: HttpApiEvent): string {
  const headers = event.headers ?? {}
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'origin' && v) return v
  }
  return ''
}

function corsHeaders(event: HttpApiEvent, allowed: string[]): Record<string, string> {
  const origin = originOf(event)
  const base: Record<string, string> = { vary: 'Origin' }
  if (!origin || !allowed.includes(origin)) return base
  return {
    ...base,
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  }
}

// ---------------------------------------------------------------- 応答

function json(statusCode: number, body: unknown, headers: Record<string, string>): HttpApiResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    body: JSON.stringify(body),
  }
}

function invalid(detail: string, headers: Record<string, string>): HttpApiResult {
  return json(400, { ok: false, reason: 'invalid', detail }, headers)
}

// ---------------------------------------------------------------- 並び順

/** 得点降順 → 所要時間昇順 → 登録順（createdAt 昇順 → entryId 昇順で安定化） */
export function compareRows(a: EntryItem | RankingRow, b: EntryItem | RankingRow): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  return a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0
}

export function toRow(item: EntryItem): RankingRow {
  return {
    entryId: item.entryId,
    setId: item.setId,
    nickname: item.nickname,
    score: item.score,
    timeMs: item.timeMs,
    createdAt: item.createdAt,
    mode: item.mode,
    scope: item.scope,
  }
}

// ---------------------------------------------------------------- 入力の検証

interface AnswerInput {
  questionId: string
  input: string
  ms: number
  passed: boolean
}

interface SubmitBody {
  setId: string
  nickname: string
  clientToken: string
  answers: AnswerInput[]
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 検証に落ちたら detail（日本語）を返す。通れば null */
function validateSubmitBody(raw: unknown): { body: SubmitBody } | { detail: string } {
  if (!isObject(raw)) return { detail: 'JSON オブジェクトではありません。' }
  const { setId, nickname, clientToken, answers } = raw
  if (typeof setId !== 'string' || setId === '') return { detail: 'setId がありません。' }
  if (typeof nickname !== 'string') return { detail: 'nickname がありません。' }
  if (typeof clientToken !== 'string' || clientToken === '' || clientToken.length > 128) {
    return { detail: 'clientToken が不正です。' }
  }
  const trimmed = nickname.trim()
  const len = [...trimmed].length
  if (len < 1 || len > NICKNAME_MAX) return { detail: `nickname は 1〜${NICKNAME_MAX} 文字です。` }
  if (!Array.isArray(answers)) return { detail: 'answers が配列ではありません。' }
  if (answers.length !== QUESTIONS_PER_SET) return { detail: `answers は ${QUESTIONS_PER_SET} 件です。` }
  const checked: AnswerInput[] = []
  for (const a of answers) {
    if (!isObject(a)) return { detail: 'answers の要素がオブジェクトではありません。' }
    const { questionId, input, ms, passed } = a
    if (typeof questionId !== 'string' || questionId === '') return { detail: 'questionId がありません。' }
    if (typeof input !== 'string' || input.length > INPUT_MAX) return { detail: 'input が不正です。' }
    if (typeof passed !== 'boolean') return { detail: 'passed が真偽値ではありません。' }
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0 || ms > TIME_LIMIT_MS) {
      return { detail: `ms は 0〜${TIME_LIMIT_MS} です。` }
    }
    if (passed && ms !== TIME_LIMIT_MS) return { detail: `passed=true の ms は ${TIME_LIMIT_MS} です。` }
    checked.push({ questionId, input, ms: Math.round(ms), passed })
  }
  return { body: { setId, nickname: trimmed, clientToken, answers: checked } }
}

/** answers の questionId 集合が問題セットと一致するか */
function matchQuestionIds(answers: AnswerInput[], questions: Question[]): string | null {
  const expected = new Set(questions.map((q) => q.id))
  const got = new Set(answers.map((a) => a.questionId))
  if (got.size !== answers.length) return 'answers に同じ questionId が複数あります。'
  if (got.size !== expected.size) return '出題と answers の問題が一致しません。'
  for (const id of got) if (!expected.has(id)) return `出題にない questionId です: ${id}`
  return null
}

// ---------------------------------------------------------------- ハンドラ

export function createHandler(deps: HandlerDeps): (event: HttpApiEvent) => Promise<HttpApiResult> {
  const now = deps.now ?? (() => new Date())
  const randomId = deps.randomId ?? (() => crypto.randomUUID())
  const allowed = deps.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS
  const bank = guardSource(deps.bankSource)

  /**
   * 都道府県別の索引とカウンタ。本体の TransactWrite とは**分ける**:
   * player マーカーの条件失敗（= 2 セット目の同じ端末）で本体の登録を巻き戻さないため。
   */
  async function indexByPrefecture(item: EntryItem, clientToken: string): Promise<void> {
    const prefCode = prefCodeOfScope(item.scope)
    const pk = prefPk(prefCode)
    try {
      await deps.ddb.putIndexEntry({ ...item, pk })
      // マーカーが新規なら、その端末はこの都道府県で初めて = players +1
      const firstTime = await deps.ddb.putMarkerIfAbsent({
        pk,
        sk: `player#${clientToken}`,
        createdAt: item.createdAt,
      })
      await deps.ddb.addStats(prefCode, 1, firstTime ? 1 : 0)
    } catch (e: unknown) {
      console.error('[ranking-api] 都道府県インデックスの更新に失敗', e instanceof Error ? e.stack : e)
    }
  }

  async function handlePost(event: HttpApiEvent, cors: Record<string, string>): Promise<HttpApiResult> {
    let raw: unknown
    try {
      const text = event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
      raw = JSON.parse(text ?? '')
    } catch {
      return invalid('body が JSON ではありません。', cors)
    }
    const checked = validateSubmitBody(raw)
    if ('detail' in checked) return invalid(checked.detail, cors)
    const body = checked.body

    const parsed = parseSetId(body.setId)
    if (!parsed) return invalid(`setId が読めません: ${body.setId}`, cors)

    let set
    try {
      set = await buildQuestionSet(parsed.mode, parsed.scope, parsed.seed, bank)
    } catch (e: unknown) {
      if (e instanceof BankUnavailableError) throw e
      return invalid(e instanceof Error ? e.message : '問題セットを再導出できませんでした。', cors)
    }
    // dataVersion が違う setId は再導出した setId と一致しない
    if (set.setId !== body.setId) return invalid(`この版では再現できない setId です: ${body.setId}`, cors)
    if (set.questions.length !== QUESTIONS_PER_SET) {
      return invalid(`${QUESTIONS_PER_SET} 問を再導出できませんでした。`, cors)
    }
    const mismatch = matchQuestionIds(body.answers, set.questions)
    if (mismatch) return invalid(mismatch, cors)

    // 再採点。クライアントが送ってきた correct / score は使わない
    const byId = new Map(set.questions.map((q) => [q.id, q]))
    let correct = 0
    let timeMs = 0
    for (const a of body.answers) {
      const q = byId.get(a.questionId)
      if (!q) return invalid(`出題にない questionId です: ${a.questionId}`, cors)
      if (!a.passed && grade(a.input, q.answer)) correct += 1
      timeMs += a.ms
    }
    const score = correct * 10

    const createdAt = now().toISOString()
    const entryId = randomId()
    const pk = setPk(body.setId)
    const sk = `entry#${createdAt}#${entryId}`
    const item: EntryItem = {
      pk,
      sk,
      entryId,
      setId: body.setId,
      nickname: body.nickname,
      score,
      timeMs,
      createdAt,
      mode: parsed.mode,
      scope: parsed.scope,
    }
    const reservation: ReservationItem = {
      pk,
      sk: `token#${body.clientToken}`,
      entryId,
      createdAt,
    }
    const claimed = await deps.ddb.claimAndPut(reservation, item)
    if (!claimed) return json(409, { ok: false, reason: 'already_submitted' }, cors)

    // ここから先は「あると嬉しい」索引。失敗しても登録そのものは成立させる
    // （本体は書けているので 500 を返すと、二重登録を弾かれて永久に登録できなくなる）
    await indexByPrefecture(item, body.clientToken)

    const all = (await deps.ddb.listEntries(pk)).sort(compareRows)
    const rank = all.findIndex((e) => e.entryId === entryId) + 1
    return json(201, { ok: true, rank: rank > 0 ? rank : all.length, entry: toRow(item) }, cors)
  }

  async function handleGet(event: HttpApiEvent, cors: Record<string, string>): Promise<HttpApiResult> {
    const qs = event.queryStringParameters ?? {}
    const prefCode = qs.prefCode ?? ''
    const setId = qs.setId ?? ''

    // limit の既定は setId 引き 20 / 都道府県引き 30
    const defaultLimit = prefCode === '' ? DEFAULT_LIMIT : DEFAULT_PREF_LIMIT
    let limit = defaultLimit
    if (qs.limit !== undefined && qs.limit !== '') {
      const n = Number(qs.limit)
      if (!Number.isInteger(n) || n < 1) return invalid('limit が不正です。', cors)
      limit = Math.min(n, MAX_LIMIT)
    }

    let pk: string
    if (prefCode !== '') {
      if (!PREF_CODE_RE.test(prefCode)) return invalid(`prefCode が読めません: ${prefCode}`, cors)
      pk = prefPk(prefCode)
    } else {
      if (!parseSetId(setId)) return invalid(`setId が読めません: ${setId}`, cors)
      pk = setPk(setId)
    }
    const rows = (await deps.ddb.listEntries(pk)).sort(compareRows).slice(0, limit).map(toRow)
    return json(200, { entries: rows }, cors)
  }

  /** GET /stats/prefectures。全国（scope '00'）は prefCode '00' の 1 件として返る */
  async function handleStats(cors: Record<string, string>): Promise<HttpApiResult> {
    const prefectures: PrefectureStat[] = (await deps.ddb.listStats())
      .map((s) => ({ prefCode: s.sk, entries: s.entries ?? 0, players: s.players ?? 0 }))
      .filter((s) => s.entries > 0)
      .sort((a, b) => (a.prefCode < b.prefCode ? -1 : 1))
    return json(200, { prefectures }, cors)
  }

  return async function handler(event: HttpApiEvent): Promise<HttpApiResult> {
    const cors = corsHeaders(event, allowed)
    const method = (event.requestContext?.http?.method ?? '').toUpperCase()
    const path = event.requestContext?.http?.path ?? ''
    try {
      if (method === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' }
      const isResults = path === '/results' || path.endsWith('/results')
      const isStats = path === '/stats/prefectures' || path.endsWith('/stats/prefectures')
      if (method === 'POST' && isResults) return await handlePost(event, cors)
      if (method === 'GET' && isResults) return await handleGet(event, cors)
      if (method === 'GET' && isStats) return await handleStats(cors)
      return json(404, { ok: false, reason: 'invalid', detail: `${method} ${path} は扱いません。` }, cors)
    } catch (e: unknown) {
      // 想定外はクライアントの入力のせいにしない（契約上 reason: 'invalid' は 400 だけ）
      console.error('[ranking-api]', e instanceof Error ? e.stack : e)
      const unavailable = e instanceof BankUnavailableError
      return json(
        unavailable ? 502 : 500,
        {
          ok: false,
          reason: 'unavailable',
          detail: unavailable
            ? '問題バンクを読み込めませんでした。しばらくして試してください。'
            : 'サーバー側でエラーが起きました。',
        },
        cors,
      )
    }
  }
}

// ---------------------------------------------------------------- 本番の依存

/** @aws-sdk/lib-dynamodb の DocumentClient のうち、ここで使う部分 */
interface DocClientLike {
  send(command: unknown): Promise<unknown>
}

/** DynamoDB コマンドの生成。SDK の型を handler.ts に持ち込まないため関数で受け取る */
export interface DdbCommands {
  transactWrite(input: TransactWriteInput): unknown
  query(input: QueryInput): unknown
  put(input: PutInput): unknown
  update(input: UpdateInput): unknown
}

interface TransactWriteInput {
  TransactItems: {
    Put: { TableName: string; Item: ReservationItem | EntryItem; ConditionExpression?: string }
  }[]
}

interface PutInput {
  TableName: string
  Item: EntryItem | MarkerItem
  ConditionExpression?: string
}

interface UpdateInput {
  TableName: string
  Key: { pk: string; sk: string }
  UpdateExpression: string
  ExpressionAttributeNames: Record<string, string>
  ExpressionAttributeValues: Record<string, number>
}

interface QueryInput {
  TableName: string
  KeyConditionExpression: string
  ExpressionAttributeNames: Record<string, string>
  ExpressionAttributeValues: Record<string, string>
  ExclusiveStartKey?: Record<string, unknown>
}

export function createDdbPort(doc: DocClientLike, tableName: string, commands: DdbCommands): DdbPort {
  return {
    async claimAndPut(reservation, entry) {
      try {
        // 予約（条件付き）と本体を 1 トランザクションで書く。どちらかだけ残ることがない
        await doc.send(
          commands.transactWrite({
            TransactItems: [
              {
                Put: { TableName: tableName, Item: reservation, ConditionExpression: 'attribute_not_exists(pk)' },
              },
              { Put: { TableName: tableName, Item: entry } },
            ],
          }),
        )
        return true
      } catch (e: unknown) {
        if (isConditionalFailure(e)) return false
        throw e
      }
    },
    async listEntries(pk) {
      return queryAll<EntryItem>(doc, commands, tableName, pk, 'entry#')
    },
    async putIndexEntry(item) {
      await doc.send(commands.put({ TableName: tableName, Item: item }))
    },
    async putMarkerIfAbsent(item) {
      try {
        await doc.send(
          commands.put({ TableName: tableName, Item: item, ConditionExpression: 'attribute_not_exists(pk)' }),
        )
        return true
      } catch (e: unknown) {
        if (isConditionalFailure(e)) return false
        throw e
      }
    },
    async addStats(prefCode, entries, players) {
      // ADD は未作成のアイテム・属性にも効く（0 からの加算になる）
      await doc.send(
        commands.update({
          TableName: tableName,
          Key: { pk: STATS_PK, sk: prefCode },
          UpdateExpression: 'ADD #entries :entries, #players :players',
          ExpressionAttributeNames: { '#entries': 'entries', '#players': 'players' },
          ExpressionAttributeValues: { ':entries': entries, ':players': players },
        }),
      )
    },
    async listStats() {
      return queryAll<StatItem>(doc, commands, tableName, STATS_PK, '')
    },
  }
}

/** pk（＋ sk の接頭辞）で Query してページングを使い切る */
async function queryAll<T>(
  doc: DocClientLike,
  commands: DdbCommands,
  tableName: string,
  pk: string,
  skPrefix: string,
): Promise<T[]> {
  const out: T[] = []
  let startKey: Record<string, unknown> | undefined
  do {
    const res = (await doc.send(
      commands.query(
        skPrefix === ''
          ? {
              TableName: tableName,
              KeyConditionExpression: '#pk = :pk',
              ExpressionAttributeNames: { '#pk': 'pk' },
              ExpressionAttributeValues: { ':pk': pk },
              ExclusiveStartKey: startKey,
            }
          : {
              TableName: tableName,
              KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
              ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
              ExpressionAttributeValues: { ':pk': pk, ':prefix': skPrefix },
              ExclusiveStartKey: startKey,
            },
      ),
    )) as { Items?: T[]; LastEvaluatedKey?: Record<string, unknown> }
    for (const it of res.Items ?? []) out.push(it)
    startKey = res.LastEvaluatedKey
  } while (startKey)
  return out
}

function isConditionalFailure(e: unknown): boolean {
  if (!isObject(e)) return false
  const name = typeof e.name === 'string' ? e.name : ''
  if (name === 'ConditionalCheckFailedException') return true
  if (name !== 'TransactionCanceledException') return false
  const reasons = e.CancellationReasons
  if (!Array.isArray(reasons)) return false
  return reasons.some((r) => isObject(r) && r.Code === 'ConditionalCheckFailed')
}

let lazy: ((event: HttpApiEvent) => Promise<HttpApiResult>) | undefined

/** Lambda のエントリポイント。依存は初回呼び出し時に 1 度だけ組み立て、以降は再利用する */
export const handler = async (event: HttpApiEvent): Promise<HttpApiResult> => {
  if (!lazy) {
    const [{ DynamoDBClient }, { DynamoDBDocumentClient, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand }] =
      await Promise.all([
      import('@aws-sdk/client-dynamodb'),
      import('@aws-sdk/lib-dynamodb'),
    ])
    const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    })
    const tableName = process.env.TABLE_NAME ?? ''
    const bankBase = process.env.BANK_BASE_URL ?? 'https://akiralab.github.io/chimei-kentei/questions/'
    const origins = (process.env.ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS.join(','))
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '')
    lazy = createHandler({
      ddb: createDdbPort(doc, tableName, {
        query: (input) => new QueryCommand(input as unknown as ConstructorParameters<typeof QueryCommand>[0]),
        transactWrite: (input) =>
          new TransactWriteCommand(input as unknown as ConstructorParameters<typeof TransactWriteCommand>[0]),
        put: (input) => new PutCommand(input as unknown as ConstructorParameters<typeof PutCommand>[0]),
        update: (input) => new UpdateCommand(input as unknown as ConstructorParameters<typeof UpdateCommand>[0]),
      }),
      bankSource: bankSourceFor(bankBase),
      allowedOrigins: origins,
    })
  }
  return lazy(event)
}

export default handler
