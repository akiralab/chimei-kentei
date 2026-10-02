/**
 * ランキングの保存先を 1 か所で決める。
 * VITE_RANKING_API が設定されたビルドだけ共有ランキング（Remote）になり、
 * 無ければ端末内の localStorage（Local）に落ちる。
 */
import type { RankingStore } from './types.ts'
import { LocalRankingStore } from './ranking.ts'
import { RemoteRankingStore } from './ranking-remote.ts'

/** 共有ランキング API のベース URL。未設定なら空文字 */
export function rankingApiBaseUrl(): string {
  return (import.meta.env?.VITE_RANKING_API ?? '').trim()
}

export function isRemoteRanking(): boolean {
  return rankingApiBaseUrl() !== ''
}

export function createRankingStore(): RankingStore {
  const baseUrl = rankingApiBaseUrl()
  return baseUrl === '' ? new LocalRankingStore() : new RemoteRankingStore(baseUrl)
}

let shared: RankingStore | undefined

/** 画面どうしで 1 つのストアを共有する（Remote のときに接続設定を 1 か所に保つ） */
export function defaultRankingStore(): RankingStore {
  if (!shared) shared = createRankingStore()
  return shared
}
