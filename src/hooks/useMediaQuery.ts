/**
 * メディアクエリの判定を React の state として購読する。
 *
 * CSS だけで出し分けられない「どちらの中身を描くか」に使う
 * （地名帳は 900px 以上で一覧と詳細を並べ、899px 以下では切り替える＝DOM そのものが違う）。
 *
 * `matchMedia` が無い環境（jsdom）では **常に false** を返す。
 * 幅の広い側を「足し算」として扱う約束にしておけば、テストは狭い側の DOM を見ることになり、
 * どちらの分岐も jsdom で確かめられる（広い側の確認は CDP の実測で行う）。
 */
import { useEffect, useState } from 'react'

/** 地名帳・出題画面の 2 カラムの境目（map.css の `@media (min-width: 900px)` と同値） */
export const WIDE_QUERY = '(min-width: 900px)'

function read(query: string): boolean {
  if (typeof matchMedia !== 'function') return false
  try {
    return matchMedia(query).matches
  } catch {
    // 実装の無い環境では「狭い側」に寄せる
    return false
  }
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => read(query))

  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const sync = () => setMatches(read(query))
    // 初期化と購読開始の間に幅が変わっていた分の取りこぼし
    sync()
    const mql = matchMedia(query)
    mql.addEventListener?.('change', sync)
    // 端末の回転など change が飛ばない環境の保険
    addEventListener('resize', sync)
    return () => {
      mql.removeEventListener?.('change', sync)
      removeEventListener('resize', sync)
    }
  }, [query])

  return matches
}
