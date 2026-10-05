/**
 * 出題の種類（Mode）の表示名。
 *
 * 'e' / 'd' は難易度ではなく **出題する地名の種類**（市区町村名だけか、大字・町名も含むか）なので、
 * 画面では easy / difficult と呼ばない。識別子（セット ID・問題バンクのファイル名・API の mode）は
 * 互換のため 'e' / 'd' のまま。
 */
import type { Mode, RankingMode } from './types.ts'
import { ALL_RANKING_MODE } from './types.ts'

export const MODE_LABELS: Record<Mode, { name: string; short: string }> = {
  e: { name: '市区町村名', short: '市区町村' },
  d: { name: '市区町村名＋町名', short: '町名も' },
}

export const MODES: Mode[] = ['e', 'd']

export function modeName(mode: Mode): string {
  return MODE_LABELS[mode].name
}

/**
 * 順位表の区分（科目 2 つ ＋ 全問）の表示名。
 * 全問は 10 問とは得点の尺度が違うので、順位表では科目と並ぶ 3 つ目として見せる。
 *
 * 「全問」に **全市区町村名と全町名を同居させる**（Issue #46 の決定 5）。区分を 4 つに増やすと
 * API の sk・カウンタ・`?mode=` が全部増えるので、どちらなのかは行の注記
 * （engine/score.ts の `allRowNote`）で見分ける。`?mode=all` と DynamoDB の sk は変えない。
 */
export const RANKING_MODE_LABELS: Record<RankingMode, { name: string; short: string }> = {
  e: MODE_LABELS.e,
  d: MODE_LABELS.d,
  all: { name: '全問', short: '全問' },
}

export const RANKING_MODES: RankingMode[] = ['e', 'd', ALL_RANKING_MODE]

export function rankingModeName(mode: RankingMode): string {
  return RANKING_MODE_LABELS[mode].name
}

export function isRankingMode(v: string): v is RankingMode {
  return v === 'e' || v === 'd' || v === ALL_RANKING_MODE
}
