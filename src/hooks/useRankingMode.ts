/**
 * ランキング画面で見ている科目（easy / difficult）。
 * トップ（#/ranking）と都道府県の詳細（#/ranking/{prefCode}）で引き継ぐため、
 * ルートではなく localStorage `rankingMode` に持つ（URL を汚さずに戻ってきても同じ科目で開く）。
 */
import { useCallback, useState } from 'react'
import type { Mode } from '../engine/types.ts'

export const RANKING_MODE_KEY = 'rankingMode'

/** 未設定・壊れた値は easy */
export function readRankingMode(): Mode {
  try {
    return localStorage.getItem(RANKING_MODE_KEY) === 'd' ? 'd' : 'e'
  } catch {
    return 'e'
  }
}

export function writeRankingMode(mode: Mode): void {
  try {
    localStorage.setItem(RANKING_MODE_KEY, mode)
  } catch {
    // 保存できない環境では画面を離れると easy に戻るだけ
  }
}

export function useRankingMode(): [Mode, (mode: Mode) => void] {
  const [mode, setState] = useState<Mode>(() => readRankingMode())
  const update = useCallback((next: Mode) => {
    setState(next)
    writeRankingMode(next)
  }, [])
  return [mode, update]
}
