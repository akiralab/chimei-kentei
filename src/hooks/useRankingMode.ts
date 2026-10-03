/**
 * ランキング画面で見ている区分（市区町村名 / 市区町村名＋町名 / 全市区町村名）。
 * トップ（#/ranking）と都道府県の詳細（#/ranking/{prefCode}）で引き継ぐため、
 * ルートではなく localStorage `rankingMode` に持つ（URL を汚さずに戻ってきても同じ区分で開く）。
 */
import { useCallback, useState } from 'react'
import type { RankingMode } from '../engine/types.ts'
import { isRankingMode } from '../engine/modes.ts'

export const RANKING_MODE_KEY = 'rankingMode'

/** 未設定・壊れた値は市区町村名（'e'） */
export function readRankingMode(): RankingMode {
  try {
    const saved = localStorage.getItem(RANKING_MODE_KEY) ?? ''
    return isRankingMode(saved) ? saved : 'e'
  } catch {
    return 'e'
  }
}

export function writeRankingMode(mode: RankingMode): void {
  try {
    localStorage.setItem(RANKING_MODE_KEY, mode)
  } catch {
    // 保存できない環境では画面を離れると市区町村名に戻るだけ
  }
}

export function useRankingMode(): [RankingMode, (mode: RankingMode) => void] {
  const [mode, setState] = useState<RankingMode>(() => readRankingMode())
  const update = useCallback((next: RankingMode) => {
    setState(next)
    writeRankingMode(next)
  }, [])
  return [mode, update]
}
