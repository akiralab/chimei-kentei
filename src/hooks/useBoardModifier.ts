/**
 * 画面（.paper を描く側）から、その外側の黒板（.board）に修飾子を 1 つ足す。
 *
 * .board は App.tsx が描くので、画面側からは手が届かない。けれど
 * 「この画面は用紙ごと縦スクロールする」（.board--scroll）は **画面の性質** なので、
 * App にルート名の分岐表を持たせるより、画面自身に宣言させたほうが読み違えない。
 *
 * 状態は増やさない（React の state も context も持たない）。マウントしている間だけ
 * class を足し、外れたら戻す。.board が無い環境（画面単体のテスト）では何もしない。
 */
import { useEffect } from 'react'

export function useBoardModifier(modifier: string): void {
  useEffect(() => {
    const board = document.querySelector('.board')
    if (!board) return
    board.classList.add(modifier)
    return () => {
      board.classList.remove(modifier)
    }
  }, [modifier])
}

/** 結果・間違えた問題・あそびかたの 3 画面だけが使う例外（src/styles/CONTRACT.md「1 画面運用」） */
export const BOARD_SCROLL = 'board--scroll'
