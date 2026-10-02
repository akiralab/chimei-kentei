/**
 * 共有ランキング API（infra/API.md）を叩く RankingStore。
 * 採点はサーバーが行うので、送るのは setId と各問の入力だけ（score / correct は送らない）。
 */
import type { Mode, PrefectureStat, RankingRow, RankingStore, ResultEntry, SubmitResult } from './types.ts'

/** 1 リクエストあたりの待ち時間。これを超えたら network 扱い */
export const REMOTE_TIMEOUT_MS = 8000

/** テストから差し替えられるように fetch をポートにする */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

interface SubmitResponse {
  ok?: boolean
  rank?: number
  entry?: { entryId?: string }
}

interface ListResponse {
  entries?: RankingRow[]
}

interface StatsResponse {
  prefectures?: PrefectureStat[]
}

function trimBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

export class RemoteRankingStore implements RankingStore {
  private readonly baseUrl: string
  private readonly fetchImpl: FetchLike

  constructor(baseUrl: string, fetchImpl?: FetchLike) {
    this.baseUrl = trimBase(baseUrl)
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init))
  }

  /** AbortController でタイムアウトを付けた fetch */
  private async call(path: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS)
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  async submit(entry: ResultEntry): Promise<SubmitResult> {
    const body = {
      setId: entry.setId,
      nickname: entry.nickname,
      clientToken: entry.clientToken,
      // 0 ＝ 制限なし。サーバーは ms の許容範囲の判定にこれを使う
      timeLimitMs: entry.timeLimitMs ?? 0,
      answers: entry.answers.map((a) => ({
        questionId: a.questionId,
        input: a.input,
        ms: a.ms,
        passed: a.passed,
      })),
    }
    let res: Response
    try {
      res = await this.call('/results', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      return { ok: false, reason: 'network' }
    }
    if (res.status === 409) return { ok: false, reason: 'already_submitted' }
    if (res.status === 400) return { ok: false, reason: 'invalid' }
    if (res.status !== 201) return { ok: false, reason: 'network' }
    let parsed: SubmitResponse
    try {
      parsed = (await res.json()) as SubmitResponse
    } catch {
      return { ok: false, reason: 'network' }
    }
    const rank = parsed.rank
    const entryId = parsed.entry?.entryId
    if (typeof rank !== 'number' || typeof entryId !== 'string') return { ok: false, reason: 'network' }
    return { ok: true, rank, entryId }
  }

  /** 失敗は投げる（画面側で「接続できませんでした」を出すため） */
  async list(setId: string, limit = 20): Promise<RankingRow[]> {
    return this.listRows(`?setId=${encodeURIComponent(setId)}&limit=${String(limit)}`)
  }

  /** 都道府県ごとの登録件数・人数 */
  async prefectureStats(): Promise<PrefectureStat[]> {
    const res = await this.call('/stats/prefectures')
    if (!res.ok) throw new Error(`ランキングを取得できませんでした（${res.status}）`)
    const parsed = (await res.json()) as StatsResponse
    return Array.isArray(parsed.prefectures) ? parsed.prefectures : []
  }

  /** mode を渡すとサーバー側で科目を絞ってから上位を返す */
  async listByPrefecture(prefCode: string, limit = 30, mode?: Mode): Promise<RankingRow[]> {
    const modeQuery = mode === undefined ? '' : `&mode=${mode}`
    return this.listRows(`?prefCode=${encodeURIComponent(prefCode)}&limit=${String(limit)}${modeQuery}`)
  }

  private async listRows(query: string): Promise<RankingRow[]> {
    const res = await this.call(`/results${query}`)
    if (!res.ok) throw new Error(`ランキングを取得できませんでした（${res.status}）`)
    const parsed = (await res.json()) as ListResponse
    return Array.isArray(parsed.entries) ? parsed.entries : []
  }
}
