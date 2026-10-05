/**
 * 下タブバー（第 3 波 D1）。全画面で同じ位置に戻る導線を 1 本だけ置く。
 *
 * 置き場所は `.board` の中・`.paper` の **外**（App.tsx）。用紙の中のボタンではないので、
 * 1 画面契約の画面（表紙・範囲・出題）でも用紙ごとスクロールする画面（`.board--scroll`）でも
 * 位置が変わらない。高さは `--tabbar-h` で、`.board` 側が同じだけ下余白を取っている
 * （src/styles/CONTRACT.md「1 画面運用」）。
 *
 * 意匠は教科書の小口インデックス（黒板色の帯に用紙色のタブ 4 枚、選択中は蛍光マーカー）。
 * 文字だけで絵文字は使わない。枚数と経路の対応は `tabs.ts`。
 */
import type { Route } from '../router.ts'
import { TABS, tabGroupOf } from './tabs.ts'

interface Props {
  route: Route
  /**
   * タブで画面を離れる直前に呼ぶ始末。出題中は進行中の答案を捨てる
   * （確認ダイアログは出さない ＝ 旧「タイトルへ戻る」と同じ挙動。Issue #51 決定 ③）
   */
  onLeave?: () => void
}

export default function TabBar({ route, onLeave }: Props) {
  const current = tabGroupOf(route)
  return (
    <nav className="tabbar" aria-label="メインメニュー">
      {TABS.map((tab) => {
        const isCurrent = tab.key === current
        return (
          <a
            key={tab.key}
            className={isCurrent ? 'tabbar__item is-current' : 'tabbar__item'}
            href={tab.href}
            // 色（蛍光マーカー）だけに頼らず、現在地は aria-current でも示す
            aria-current={isCurrent ? 'page' : undefined}
            onClick={() => onLeave?.()}
          >
            {tab.label}
          </a>
        )
      })}
    </nav>
  )
}
