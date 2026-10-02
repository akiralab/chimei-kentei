import { useEffect, useState } from 'react'
import type { Route } from '../router.ts'
import { currentRoute, hasNavigated } from '../router.ts'

export interface HashRouteState {
  route: Route
  /**
   * ページ読み込み後にハッシュ遷移が 1 度でも起きたか（hashchange か、アプリ自身の navigate()）。
   * false のあいだは「URL を直接開いた直後の画面」＝共有リンクからの着地を意味する。
   */
  navigated: boolean
}

/** location.hash を購読して Route と「アプリ内の遷移で来たか」を返す */
export function useHashRoute(): HashRouteState {
  const [route, setRoute] = useState<Route>(() => currentRoute())
  const [hashChanged, setHashChanged] = useState(false)
  useEffect(() => {
    const sync = () => setRoute(currentRoute())
    const onChange = () => {
      // hashchange 経由だけを「アプリ内の遷移」として数える
      setHashChanged(true)
      sync()
    }
    addEventListener('hashchange', onChange)
    // useState の初期化と購読開始の間に動いていた分の取りこぼし。遷移としては数えない
    sync()
    return () => removeEventListener('hashchange', onChange)
  }, [])
  // アンカー（<a href="#/...">）は hashchange、画面側のボタンは navigate()。どちらもアプリ内の遷移
  return { route, navigated: hashChanged || hasNavigated() }
}
