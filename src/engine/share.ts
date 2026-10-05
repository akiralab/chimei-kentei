/**
 * 共有の文面（UI 非依存）。
 *
 * 共有シート（`navigator.share`）とリンクのコピーで同じ 1 文を使うため、組み立てはここ 1 か所。
 * 文面を変えるときは `share.test.ts` が固定している例も一緒に直す。
 *
 *   地名読み検定 千葉県・市区町村名 80 点。この問題で挑戦 → https://…/#/q/…
 *
 * 得点は任意（`null` なら省く）。結果を出す前の画面から共有する経路でも同じ文で済む。
 */

/** 共有シートの題名。アプリ名そのもの */
export const APP_NAME = '地名読み検定'

export interface SharePayload {
  /** `navigator.share` の title */
  title: string
  /** 本文。末尾にリンクを含む 1 文 */
  text: string
  /** 出題の URL（`navigator.share` の url ／ コピーする文字列） */
  url: string
}

export interface ShareInput {
  /** 範囲の表示名（「千葉県」「東京都・23区」「全国」）。空なら省く */
  range?: string
  /** 科目の表示名（「市区町村名」「市区町村名＋町名」）。空なら省く */
  subject?: string
  /** 得点。null ＝ 結果がまだ無い（得点を省く） */
  score?: number | null
  /** 出題の絶対 URL */
  url: string
}

export function buildShare({ range = '', subject = '', score = null, url }: ShareInput): SharePayload {
  /** 「千葉県・市区町村名」。どちらか欠けていても中黒が余らない */
  const condition = [range, subject].filter((s) => s !== '').join('・')
  const head = [APP_NAME, condition, score === null ? '' : `${score} 点`].filter((s) => s !== '').join(' ')
  return { title: APP_NAME, text: `${head}。この問題で挑戦 → ${url}`, url }
}
