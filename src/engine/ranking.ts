/**
 * ランキングの保存。デモでは localStorage に `ranking:{setId}` で置く。
 * テスト（node 環境）では localStorage が無いのでメモリ実装へフォールバックする。
 */
import type {
  ModeCount,
  PrefectureStat,
  RankingMode,
  RankingRow,
  RankingStore,
  ResultEntry,
  SubmitResult,
} from './types.ts'
import { ALL_RANKING_MODE } from './types.ts'
import { SCOPE_NATIONWIDE, parseSetId } from './setId.ts'
import { RANKING_MODES } from './modes.ts'

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  /** `ranking:*` を走査するために使う。localStorage の同名 API に合わせた任意項目 */
  readonly length?: number
  key?(index: number): string | null
}

export const CLIENT_TOKEN_KEY = 'clientToken'

export const RANKING_KEY_PREFIX = 'ranking:'

export function rankingKey(setId: string): string {
  return `${RANKING_KEY_PREFIX}${setId}`
}

/**
 * setId が属する都道府県コード。全国（scope '00'）は '00' に集める。
 * 読めない setId は null（集計から外す）。
 */
export function prefCodeOfSetId(setId: string): string | null {
  const parsed = parseSetId(setId)
  if (!parsed) return null
  return parsed.scope === SCOPE_NATIONWIDE ? SCOPE_NATIONWIDE : parsed.scope.slice(0, 2)
}

export function createMemoryStorage(initial?: Record<string, string>): KeyValueStorage {
  const map = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    get length() {
      return map.size
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
  }
}

/** localStorage が使える環境なら返す。使えなければ null */
export function browserStorage(): KeyValueStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const probe = '__probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return localStorage
  } catch {
    return null
  }
}

let fallbackStorage: KeyValueStorage | undefined

/** localStorage → 無ければプロセス内で共有するメモリ実装 */
export function defaultStorage(): KeyValueStorage {
  const browser = browserStorage()
  if (browser) return browser
  if (!fallbackStorage) fallbackStorage = createMemoryStorage()
  return fallbackStorage
}

/** crypto.randomUUID()。使えない環境では時刻＋乱数で代替する */
export function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 端末ごとの識別子。無ければ作って保存する */
export function getClientToken(storage: KeyValueStorage = defaultStorage()): string {
  const hit = storage.getItem(CLIENT_TOKEN_KEY)
  if (hit) return hit
  const token = randomId()
  storage.setItem(CLIENT_TOKEN_KEY, token)
  return token
}

export function isValidNickname(nickname: string): boolean {
  const len = [...nickname.trim()].length
  return len >= 1 && len <= 12
}

/** 得点降順 → 所要時間昇順 → 登録順 */
export function compareEntries(a: ResultEntry | RankingRow, b: ResultEntry | RankingRow): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
}

/** 順位の比較に要る最小の情報。まだ登録していない答案を表すのに使う */
export interface ScorableEntry {
  score: number
  timeMs: number
  createdAt: string
}

/**
 * まだ登録していない答案が、いまの上位 rows に混ざると何位になるか（1 始まり）。
 * 並びの規則は compareEntries と同じ（得点降順 → 所要時間昇順 → 登録順）なので、
 * 同点・同時間なら後から来た entry が下に付く。
 *
 * rows は上位 limit 件しか無いため、全員に負けたときは
 * `Math.min(rows.length, limit) + 1` を返す。rows が limit 件に達しているなら
 * これは「その順位以下」の下限であって、正確な順位ではない。
 */
export function provisionalRank(rows: readonly RankingRow[], entry: ScorableEntry, limit = 20): number {
  const me: RankingRow = { entryId: '', setId: '', nickname: '', ...entry }
  const sorted = [...rows].sort(compareEntries)
  const i = sorted.findIndex((r) => compareEntries(me, r) < 0)
  return i < 0 ? Math.min(sorted.length, limit) + 1 : i + 1
}

/** 保存済みエントリを公開用の 1 行へ。answers と clientToken は落とし、科目・範囲は setId から導く */
export function toRow(entry: ResultEntry): RankingRow {
  const parsed = parseSetId(entry.setId)
  const total = entry.answers.length
  return {
    // 旧データ（entryId が無い）は clientToken で代用する
    entryId: entry.entryId ?? entry.clientToken,
    setId: entry.setId,
    nickname: entry.nickname,
    score: entry.score,
    // 答案を持たない旧データでは省く（受け取る側が 10 問として復元する）
    ...(total === 0 ? {} : { correct: entry.answers.filter((a) => a.correct).length, total }),
    timeMs: entry.timeMs,
    createdAt: entry.createdAt,
    ...(parsed ? { mode: parsed.mode, scope: parsed.scope } : {}),
    ...(entry.timeLimitMs === undefined ? {} : { timeLimitMs: entry.timeLimitMs }),
  }
}

/** storage 内の `ranking:*` キーを全部。走査できない storage（length が無い）なら空 */
export function rankingKeys(storage: KeyValueStorage): string[] {
  const n = storage.length ?? 0
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const key = storage.key?.(i)
    if (key !== null && key !== undefined && key.startsWith(RANKING_KEY_PREFIX)) out.push(key)
  }
  return out
}

export class LocalRankingStore implements RankingStore {
  private readonly storage: KeyValueStorage

  constructor(storage: KeyValueStorage = defaultStorage()) {
    this.storage = storage
  }

  private read(setId: string): ResultEntry[] {
    const raw = this.storage.getItem(rankingKey(setId))
    if (!raw) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed as ResultEntry[]
    } catch {
      return []
    }
  }

  private write(setId: string, entries: ResultEntry[]): void {
    this.storage.setItem(rankingKey(setId), JSON.stringify(entries))
  }

  async submit(entry: ResultEntry): Promise<SubmitResult> {
    if (!isValidNickname(entry.nickname)) return { ok: false, reason: 'invalid' }
    const entries = this.read(entry.setId)
    if (entries.some((e) => e.clientToken === entry.clientToken)) {
      return { ok: false, reason: 'already_submitted' }
    }
    const entryId = entry.entryId ?? randomId()
    const saved: ResultEntry = { ...entry, nickname: entry.nickname.trim(), entryId }
    const next = [...entries, saved].sort(compareEntries)
    this.write(entry.setId, next)
    const rank = next.findIndex((e) => e.entryId === entryId) + 1
    return { ok: true, rank, entryId }
  }

  async list(setId: string, limit = 20): Promise<RankingRow[]> {
    return this.read(setId).sort(compareEntries).slice(0, limit).map(toRow)
  }

  /** 1 始まり。未登録なら null */
  async rank(setId: string, clientToken: string): Promise<number | null> {
    const sorted = this.read(setId).sort(compareEntries)
    const i = sorted.findIndex((e) => e.clientToken === clientToken)
    return i < 0 ? null : i + 1
  }

  /** 自分の登録済みエントリ（無ければ null） */
  async mine(setId: string, clientToken: string): Promise<ResultEntry | null> {
    return this.read(setId).find((e) => e.clientToken === clientToken) ?? null
  }

  /** 端末内の `ranking:*` を全部読む。setId が読めないキーは捨てる */
  private readAll(): { prefCode: string; rankingMode: RankingMode; entries: ResultEntry[] }[] {
    const out: { prefCode: string; rankingMode: RankingMode; entries: ResultEntry[] }[] = []
    for (const key of rankingKeys(this.storage)) {
      const setId = key.slice(RANKING_KEY_PREFIX.length)
      const parsed = parseSetId(setId)
      if (!parsed) continue
      const prefCode = parsed.scope === SCOPE_NATIONWIDE ? SCOPE_NATIONWIDE : parsed.scope.slice(0, 2)
      // 全市区町村名は 10 問とは別区分として数える
      const rankingMode: RankingMode = parsed.all ? ALL_RANKING_MODE : parsed.mode
      out.push({ prefCode, rankingMode, entries: this.read(setId) })
    }
    return out
  }

  async prefectureStats(): Promise<PrefectureStat[]> {
    interface Acc {
      entries: number
      players: Set<string>
      byMode: Record<RankingMode, { entries: number; players: Set<string> }>
    }
    const counts = new Map<string, Acc>()
    for (const { prefCode, rankingMode, entries } of this.readAll()) {
      let hit = counts.get(prefCode)
      if (!hit) {
        hit = {
          entries: 0,
          players: new Set<string>(),
          byMode: {
            e: { entries: 0, players: new Set<string>() },
            d: { entries: 0, players: new Set<string>() },
            all: { entries: 0, players: new Set<string>() },
          },
        }
        counts.set(prefCode, hit)
      }
      for (const e of entries) {
        hit.entries += 1
        hit.players.add(e.clientToken)
        hit.byMode[rankingMode].entries += 1
        hit.byMode[rankingMode].players.add(e.clientToken)
      }
    }
    const freeze = (v: { entries: number; players: Set<string> }): ModeCount => ({
      entries: v.entries,
      players: v.players.size,
    })
    return [...counts]
      .map(([prefCode, v]) => ({
        prefCode,
        entries: v.entries,
        players: v.players.size,
        byMode: { e: freeze(v.byMode.e), d: freeze(v.byMode.d), all: freeze(v.byMode.all) },
      }))
      .filter((s) => s.entries > 0 || RANKING_MODES.some((m) => s.byMode[m].entries > 0))
      .sort((a, b) => (a.prefCode < b.prefCode ? -1 : 1))
  }

  /** mode は区分（'e' | 'd' | 'all'）。省略すると 3 区分を混ぜて返す */
  async listByPrefecture(prefCode: string, limit = 30, mode?: RankingMode): Promise<RankingRow[]> {
    const rows = this.readAll()
      .filter((g) => g.prefCode === prefCode && (mode === undefined || g.rankingMode === mode))
      .flatMap((g) => g.entries)
    return rows.sort(compareEntries).slice(0, limit).map(toRow)
  }
}
