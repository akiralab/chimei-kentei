/**
 * 見えている高さが低い（＝ソフトキーボードが出ている）かを React の state として購読する。
 *
 * iOS の殻は Keyboard の `resize: native` で WebView ごと縮むので innerHeight でも分かるが、
 * Web の iOS Safari は innerHeight が変わらず visualViewport だけが縮む。両方を見るために
 * メディアクエリ（useMediaQuery）ではなく visualViewport を読む。
 * jsdom に visualViewport は無く innerHeight は 768 なので、テストは既定で低くない側を見る。
 */
import { useEffect, useState } from 'react'

/**
 * これ未満をキーボードありとみなす。縦持ちの iPhone でキーボードが無いときの最小は 667（SE）、
 * あるときの最大は 956 − 370 ＝ 586（Pro Max）で、その間を取る。
 * theme.css の `@media (max-height: 600px)` と同値（殻の詰めはそちらが受け持つ）
 */
const SHORT_VIEWPORT_PX = 600

function read(): boolean {
  return (window.visualViewport?.height ?? window.innerHeight) < SHORT_VIEWPORT_PX
}

export function useShortViewport(): boolean {
  const [short, setShort] = useState(read)

  useEffect(() => {
    const sync = () => setShort(read())
    // 初期化と購読開始の間に高さが変わっていた分の取りこぼし
    sync()
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', sync)
    addEventListener('resize', sync)
    return () => {
      viewport?.removeEventListener('resize', sync)
      removeEventListener('resize', sync)
    }
  }, [])

  return short
}
