/**
 * 順位のキャッシュ（engine/ranking-cache.ts）を React の state として購読する。
 * 開いたとき・前面にいる間・背面から戻ったときに、古ければ取り直す。
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { getState, isDue, refresh, subscribe, whileForeground } from '../engine/ranking-cache.ts'

export function useRankingCache<T>(key: string, load: () => Promise<T>) {
  const state = useSyncExternalStore(subscribe, () => getState<T>(key))

  useEffect(() => {
    // 手元に何も無ければ、前の失敗から間がなくても開いた時点で試す
    if (getState(key).data === null || isDue(key)) void refresh(key, load)
    return whileForeground(() => {
      if (isDue(key)) void refresh(key, load)
    })
  }, [key, load])

  const refreshNow = useCallback(() => {
    void refresh(key, load)
  }, [key, load])

  return { ...state, refresh: refreshNow }
}
