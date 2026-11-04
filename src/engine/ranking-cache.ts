/**
 * 順位のキャッシュ。開いた瞬間に前回の順位を出し、古ければ裏で取り直す（Issue #70）。
 *
 * - 一覧（都道府県ごとの人数）と、都道府県の順位（都道府県 × 区分）を取得時刻つきで持つ
 * - メモリに持ち、localStorage にも写す。次の起動でも機内モードでも前回の順位が出る
 * - 同じものを同時に 2 回取りに行かない。失敗しても前の順位は消さない
 * - 画面へは subscribe で変化を伝える（React 側は hooks/useRankingCache.ts）
 *
 * 取り直すのは前面にいる間だけ。iOS は背面のアプリの JavaScript を止めるので、背面でも取るには
 * ネイティブの BGTaskScheduler が要る。順位のために足すほどではないので、前面での定期確認と
 * 戻ったときの確認で同じ体感にする。
 */
import type { PrefectureStat, RankingMode, RankingRow } from './types.ts'
import { defaultRankingStore } from './ranking-factory.ts'

/** これより古ければ取り直す */
export const STALE_MS = 5 * 60 * 1000
/** 前面にいる間に古くなったかを見る間隔。通信はしない */
const CHECK_MS = 60 * 1000
/** 都道府県の順位で一度に取る件数 */
export const PREF_LIMIT = 30
/** localStorage に残す都道府県の順位の数（新しく取ったものから） */
const LIST_KEEP = 8

const STORAGE_KEY = 'rankingCache:v1'
export const STATS_KEY = 'stats'

export function listKey(prefCode: string, mode: RankingMode): string {
  return `list:${prefCode}:${mode}`
}

export function loadStats(): Promise<PrefectureStat[]> {
  return defaultRankingStore().prefectureStats()
}

export function loadList(prefCode: string, mode: RankingMode): Promise<RankingRow[]> {
  return defaultRankingStore().listByPrefecture(prefCode, PREF_LIMIT, mode)
}

export interface CacheState<T> {
  data: T | null
  /** 手元の data を取得した時刻 */
  at: number | null
  refreshing: boolean
  /** 直近の取得が失敗した。data は前回のまま */
  failed: boolean
  /** 最後に取得を試みた時刻。失敗が続くときに 1 分ごとに叩かないため */
  triedAt: number | null
}

interface Stored {
  at: number
  data: unknown
}

const EMPTY: CacheState<never> = { data: null, at: null, refreshing: false, failed: false, triedAt: null }

let states = new Map<string, CacheState<unknown>>()
let hydrated = false
const inFlight = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
/** 捨てた回数。捨てる前に出た取得の結果を書き戻さないため */
let generation = 0

function hydrate(): void {
  if (hydrated) return
  hydrated = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return
    for (const [key, stored] of Object.entries(JSON.parse(raw) as Record<string, Stored>)) {
      states.set(key, { ...EMPTY, data: stored.data, at: stored.at, triedAt: stored.at })
    }
  } catch {
    // 読めなければキャッシュなしで始める
  }
}

function persist(): void {
  const lists = [...states.entries()]
    .filter(([key, s]) => key !== STATS_KEY && s.at !== null)
    .sort(([, a], [, b]) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, LIST_KEEP)
  const stats = states.get(STATS_KEY)
  const entries = stats?.at != null ? [[STATS_KEY, stats] as const, ...lists] : lists
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(entries.map(([key, s]) => [key, { at: s.at, data: s.data }]))),
    )
  } catch {
    // 残せなくても、このセッションの間はメモリから出せる
  }
}

function update(key: string, next: CacheState<unknown>): void {
  states.set(key, next)
  for (const listener of listeners) listener()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getState<T>(key: string): CacheState<T> {
  hydrate()
  return (states.get(key) ?? EMPTY) as CacheState<T>
}

/** 取り直す頃か。最後に試みてから STALE_MS 経っていれば（失敗していても）もう一度試す */
export function isDue(key: string): boolean {
  const { triedAt } = getState(key)
  return triedAt === null || Date.now() - triedAt >= STALE_MS
}

export function refresh(key: string, load: () => Promise<unknown>): Promise<void> {
  const running = inFlight.get(key)
  if (running) return running
  const started = generation
  update(key, { ...getState(key), refreshing: true, failed: false, triedAt: Date.now() })
  const run = load()
    .then((data) => {
      if (started !== generation) return
      update(key, { data, at: Date.now(), refreshing: false, failed: false, triedAt: Date.now() })
      persist()
    })
    .catch(() => {
      if (started !== generation) return
      update(key, { ...getState(key), refreshing: false, failed: true })
    })
    .finally(() => {
      if (inFlight.get(key) === run) inFlight.delete(key)
    })
  inFlight.set(key, run)
  return run
}

/** 全部捨てる。登録したあとに開くと自分の行が入っているように */
export function clearRankingCache(): void {
  generation++
  states = new Map()
  inFlight.clear()
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 消せなくても次の取得で上書きされる
  }
  for (const listener of listeners) listener()
}

/** テストのあいだでメモリのキャッシュを持ち越さない */
export function resetRankingCacheForTest(): void {
  clearRankingCache()
  hydrated = false
}

/** 前面にいる間の定期確認と、背面から戻ったときの確認。戻り値で止める */
export function whileForeground(check: () => void): () => void {
  const checkIfVisible = () => {
    if (document.visibilityState === 'visible') check()
  }
  const timer = setInterval(checkIfVisible, CHECK_MS)
  document.addEventListener('visibilitychange', checkIfVisible)
  // 殻の復帰で visibilitychange が飛ばないときの保険。古くなければ何もしないので重なってもよい
  addEventListener('focus', checkIfVisible)
  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', checkIfVisible)
    removeEventListener('focus', checkIfVisible)
  }
}

/** 起動直後に一覧を取り、前面にいる間は古くなるたびに取り直す（順位タブを開く前に温めておく） */
export function startStatsSync(): () => void {
  const check = () => {
    if (isDue(STATS_KEY)) void refresh(STATS_KEY, loadStats)
  }
  check()
  return whileForeground(check)
}
