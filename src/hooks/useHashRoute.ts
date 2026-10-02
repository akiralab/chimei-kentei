import { useEffect, useState } from 'react'
import type { Route } from '../router.ts'
import { currentRoute } from '../router.ts'

/** location.hash を購読して Route を返す */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => currentRoute())
  useEffect(() => {
    const onChange = () => setRoute(currentRoute())
    addEventListener('hashchange', onChange)
    onChange()
    return () => removeEventListener('hashchange', onChange)
  }, [])
  return route
}
