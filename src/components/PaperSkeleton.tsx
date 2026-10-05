/**
 * 読み込み中の答案用紙（スケルトン）。
 *
 * 「読み込み中…」の 1 行をやめ、**罫線だけの空の答案**に薄い長方形を数行置く。
 * 答案用紙テーマと喧嘩せず、どれくらいの中身が来るのかも伝わる（設計ノート §13.3 A4）。
 *
 * 読み上げには長方形を見せず、`.sr-only` の「読み込み中」だけを渡す
 * （`role="status"` ＋ `aria-busy` で、中身が差し替わったことも伝わる）。
 */
interface Props {
  /** 置く行数。3〜5 行。既定は 4 */
  lines?: number
}

export default function PaperSkeleton({ lines = 4 }: Props) {
  return (
    <div className="skeleton" role="status" aria-busy="true">
      <span className="sr-only">読み込み中</span>
      {Array.from({ length: lines }, (_, i) => (
        <span className="skeleton__line" key={i} aria-hidden="true" />
      ))}
    </div>
  )
}
