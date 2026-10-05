/**
 * 下タブバーの枚数と、経路 → タブの対応（`TabBar.tsx` の表示部から切り離した定義）。
 *
 * タブは 4 枚。「？」（あそびかた）はタブにせず見出し行に残す（Issue #51 決定 ①）。
 * 現在地は **経路のグループ**で決める。「検定」は表紙・範囲・科目・出題・結果・挑戦状・
 * あそびかたの一連をまとめて 1 枚で表すので、出題中もどこにいるか分かる。
 *
 * （部品と純粋な定義を同じファイルに置くと Fast Refresh が効かなくなるため、
 *   `HiraganaInput.tsx` と `hiragana.ts` と同じ分け方にしている）
 */
import type { Route } from '../router.ts'
import { ATLAS_PATH, COVER_PATH, RANKING_PATH, REVIEW_PATH } from '../router.ts'

/** タブの識別子（＝経路のグループ） */
export type TabKey = 'quiz' | 'atlas' | 'ranking' | 'review'

export interface Tab {
  key: TabKey
  /** 見える字。絵文字は使わない */
  label: string
  href: string
}

export const TABS: readonly Tab[] = [
  { key: 'quiz', label: '検定', href: COVER_PATH },
  { key: 'atlas', label: '地名帳', href: ATLAS_PATH },
  { key: 'ranking', label: '順位', href: RANKING_PATH },
  { key: 'review', label: '見直し', href: REVIEW_PATH },
]

/** その経路がどのタブに属するか。表紙・範囲・出題・結果・あそびかたはすべて「検定」 */
export function tabGroupOf(route: Route): TabKey {
  switch (route.name) {
    case 'atlas':
    case 'atlasScope':
    case 'atlasRow':
      return 'atlas'
    case 'ranking':
    case 'rankingPref':
      return 'ranking'
    case 'review':
      return 'review'
    default:
      return 'quiz'
  }
}
