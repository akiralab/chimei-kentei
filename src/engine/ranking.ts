/**
 * ランキングの保存。デモでは localStorage に `ranking:{setId}` で置く。
 * テスト（node 環境）では localStorage が無いのでメモリ実装へフォールバックする。
 */
import type { RankingStore, ResultEntry, SubmitResult } from './types.ts'

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const CLIENT_TOKEN_KEY = 'clientToken'

export function rankingKey(setId: string): string {
  return `ranking:${setId}`
}

export function createMemoryStorage(initial?: Record<string, string>): KeyValueStorage {
  const map = new Map<string, string>(Object.entries(initial ?? {}))
  return {
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

function randomToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 端末ごとの識別子。無ければ作って保存する */
export function getClientToken(storage: KeyValueStorage = defaultStorage()): string {
  const hit = storage.getItem(CLIENT_TOKEN_KEY)
  if (hit) return hit
  const token = randomToken()
  storage.setItem(CLIENT_TOKEN_KEY, token)
  return token
}

export function isValidNickname(nickname: string): boolean {
  const len = [...nickname.trim()].length
  return len >= 1 && len <= 12
}

/** 得点降順 → 所要時間昇順 → 登録順 */
export function compareEntries(a: ResultEntry, b: ResultEntry): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
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
    const saved: ResultEntry = { ...entry, nickname: entry.nickname.trim() }
    const next = [...entries, saved].sort(compareEntries)
    this.write(entry.setId, next)
    const rank = next.findIndex((e) => e.clientToken === saved.clientToken) + 1
    return { ok: true, rank }
  }

  async list(setId: string, limit = 20): Promise<ResultEntry[]> {
    return this.read(setId).sort(compareEntries).slice(0, limit)
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
}
