/**
 * 順位表に届かなかったときの文言。原因を言い分ける（設計ノート §13.3 A4）。
 *
 * 「つながらない」と「いま圏外」は、利用者から見れば次にやることが違う。
 * 前者はもう一度ためす価値があり、後者は後で見ればよい。どちらでも
 * 「もう一度ためす」ボタン自体は残す（機内モードを切ってすぐ押せるように）。
 */

export const OFFLINE_MESSAGE = 'いまオフラインです。順位表は後で見られます。'
export const NETWORK_MESSAGE = 'ランキングに接続できませんでした。'

/** `navigator.onLine === false` のときだけオフライン扱い（判定が無い環境は通信失敗扱い）*/
export function connectionMessage(): string {
  return typeof navigator !== 'undefined' && navigator.onLine === false ? OFFLINE_MESSAGE : NETWORK_MESSAGE
}
