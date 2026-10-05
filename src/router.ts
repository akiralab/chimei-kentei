/**
 * ハッシュルーティング。'#/' 表紙 / '#/select' 範囲・科目 / '#/q/{setId}' 出題 / '#/result/{setId}' 結果 /
 * '#/ranking' これまでのランキング / '#/ranking/{prefCode}' 都道府県の詳細 / '#/review' 間違えた問題 /
 * '#/atlas' 地名帳の入口 / '#/atlas/{scope}' 一覧 / '#/atlas/{scope}/{lgCode}' 行を選択 /
 * '#/howto' あそびかた。
 * 不明なハッシュは表紙へ。
 */
export type Route =
  | { name: 'cover' }
  | { name: 'select' }
  | { name: 'quiz'; setId: string }
  | { name: 'result'; setId: string }
  | { name: 'ranking' }
  | { name: 'rankingPref'; prefCode: string }
  | { name: 'review' }
  | { name: 'atlas' }
  | { name: 'atlasScope'; scope: string }
  | { name: 'atlasRow'; scope: string; lgCode: string }
  | { name: 'howto' }

export const COVER_PATH = '#/'
export const SELECT_PATH = '#/select'
export const RANKING_PATH = '#/ranking'
export const REVIEW_PATH = '#/review'
export const ATLAS_PATH = '#/atlas'
export const HOWTO_PATH = '#/howto'

/**
 * 地名帳の範囲の文法。セット ID と同じく 2 桁の都道府県か 3 文字の地域（`\d{2}[a-z]`）。
 * 全国 '00' は使わない（1,741 行を 1 枚に並べる画面ではないので入口で都道府県を選ばせる）
 */
const ATLAS_SCOPE = /^(?!00)\d{2}[a-z]?$/

/**
 * 地名帳のパス。scope を省けば入口、lgCode を省けば一覧。
 * 綴りの正しさだけをここで見る（実在する都道府県・地域か、その範囲にある市区町村かは画面側が判断する）
 */
export function atlasPath(scope?: string, lgCode?: string): string {
  if (scope === undefined) return ATLAS_PATH
  if (lgCode === undefined) return `${ATLAS_PATH}/${scope}`
  return `${ATLAS_PATH}/${scope}/${lgCode}`
}

/** prefCode は 2 桁（'00' は全国） */
export function rankingPrefPath(prefCode: string): string {
  return `#/ranking/${prefCode}`
}

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
  if (path === '/ranking') return { name: 'ranking' }
  if (path === '/review') return { name: 'review' }
  if (path === '/atlas') return { name: 'atlas' }
  if (path === '/howto') return { name: 'howto' }
  const ar = /^\/atlas\/([^/?#]+)(?:\/([^/?#]+))?$/.exec(path)
  if (ar) {
    // 綴りが合わなければ素直に表紙へ落とす（網羅的な検証はしない。設計 §12.4）
    if (!ATLAS_SCOPE.test(ar[1])) return { name: 'cover' }
    if (ar[2] === undefined) return { name: 'atlasScope', scope: ar[1] }
    if (!/^\d{6}$/.test(ar[2])) return { name: 'cover' }
    return { name: 'atlasRow', scope: ar[1], lgCode: ar[2] }
  }
  const rp = /^\/ranking\/(\d{2})$/.exec(path)
  if (rp) return { name: 'rankingPref', prefCode: rp[1] }
  const q = /^\/q\/([^/?#]+)$/.exec(path)
  if (q) return { name: 'quiz', setId: decodeURIComponent(q[1]) }
  const r = /^\/result\/([^/?#]+)$/.exec(path)
  if (r) return { name: 'result', setId: decodeURIComponent(r[1]) }
  return { name: 'cover' }
}

export function currentRoute(): Route {
  return parseHash(typeof location === 'undefined' ? '' : location.hash)
}

/**
 * ページ読み込み後にアプリ自身が navigate() でハッシュを動かしたか。
 * 共有リンク（`#/q/{setId}`）を直接開いた直後だけ false なので、
 * 出題画面が「着地」なのかアプリ内から来たのかを判定できる。
 */
let navigatedByApp = false

export function hasNavigated(): boolean {
  return navigatedByApp
}

/** 「ページを読み込んだ直後」の状態へ戻す（着地の経路を再現するテスト用） */
export function resetNavigated(): void {
  navigatedByApp = false
}

/** path は '#/select' のようにハッシュ付きで渡す */
export function navigate(path: string): void {
  navigatedByApp = true
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
