/**
 * ハッシュルーティング。'#/' 表紙 / '#/select' 範囲・科目 / '#/q/{setId}' 出題 / '#/result/{setId}' 結果。
 * 不明なハッシュは表紙へ。
 */
export type Route =
  | { name: 'cover' }
  | { name: 'select' }
  | { name: 'quiz'; setId: string }
  | { name: 'result'; setId: string }

export const COVER_PATH = '#/'
export const SELECT_PATH = '#/select'

export function quizPath(setId: string): string {
  return `#/q/${setId}`
}

export function resultPath(setId: string): string {
  return `#/result/${setId}`
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '')
  const path = raw === '' ? '/' : raw
  if (path === '/') return { name: 'cover' }
  if (path === '/select') return { name: 'select' }
  const q = /^\/q\/([^/?#]+)$/.exec(path)
  if (q) return { name: 'quiz', setId: decodeURIComponent(q[1]) }
  const r = /^\/result\/([^/?#]+)$/.exec(path)
  if (r) return { name: 'result', setId: decodeURIComponent(r[1]) }
  return { name: 'cover' }
}

export function currentRoute(): Route {
  return parseHash(typeof location === 'undefined' ? '' : location.hash)
}

/** path は '#/select' のようにハッシュ付きで渡す */
export function navigate(path: string): void {
  const next = path.startsWith('#') ? path : `#${path}`
  if (location.hash === next) {
    // 同じハッシュだと hashchange が飛ばないので手動で通知する
    dispatchEvent(new HashChangeEvent('hashchange'))
    return
  }
  location.hash = next
}

/** 共有用の絶対 URL（クエリを落とし、ハッシュだけ差し替える） */
export function absoluteUrl(path: string): string {
  const hash = path.startsWith('#') ? path : `#${path}`
  return `${location.origin}${location.pathname}${hash}`
}
