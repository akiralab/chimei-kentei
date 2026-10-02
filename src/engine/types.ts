/**
 * エンジンと画面の契約（UI 非依存）。問題バンク JSON の形もここで定める。
 * 設計の正本: 地名読み検定-アプリ設計.md §4〜§6
 */

/** 'e' = easy（市区町村名） / 'd' = difficult（市区町村名 ＋ 大字・町名） */
export type Mode = 'e' | 'd'

/** 問題バンク 1 件。easy.json / difficult/{prefCode}.json の要素 */
export interface Question {
  /** 安定 ID。`${level}:${lgCode}:${kanji}`（level は 'c'=市区町村, 'o'=大字・町）。同じ入力なら同じ ID */
  id: string
  /** 都道府県コード 2 桁（例 '12'） */
  prefCode: string
  /** 都道府県名（例 '千葉県'） */
  pref: string
  /** 市区町村コード 6 桁。政令指定都市は市のコード（例 大阪市 '271004'）。easy では自治体そのもの、difficult では所属自治体 */
  lgCode: string
  /** 所属市区町村の表示名（例 '大阪市淀川区'、'双葉郡浪江町'）。difficult のみ。easy では undefined */
  city?: string
  /** 画面に出す漢字（幹）。例 '匝瑳'、'放出東'。冠「大字/字」と接尾辞「市/区/町/村」は含まない */
  display: string
  /** easy のみ。外した接尾辞 '市' | '区' | '町' | '村' */
  suffix?: string
  /** 正解（ひらがなの幹）。例 'そうさ'、'はなてんひがし' */
  answer: string
}

/** meta.json */
export interface BankMeta {
  dataVersion: string // 'abr20260925'
  generatedAt: string // ISO 8601
  source: string // 出典の一文
  prefectures: { code: string; name: string; easyCount: number; difficultCount: number }[]
  /** 市区町村の検索用一覧（easy の自治体と同じ集合） */
  cities: { lgCode: string; prefCode: string; name: string; kana: string }[]
}

export interface QuestionSet {
  setId: string // `${dataVersion}-${mode}-${scope}-${seed}`
  dataVersion: string
  mode: Mode
  /** '00' = 全国、2 桁 = 都道府県、6 桁 = 市区町村 */
  scope: string
  seed: string
  /** 範囲が狭すぎて都道府県へ広げたとき true */
  widened: boolean
  questions: Question[] // 10 件・出題順
}

export interface AnswerRecord {
  questionId: string
  input: string
  correct: boolean
  /** 解答にかかった時間。パス・時間切れは 20000 */
  ms: number
  passed: boolean
}

export interface ResultEntry {
  setId: string
  nickname: string
  score: number // 正答数 × 10
  timeMs: number // 10 問の合計
  answers: AnswerRecord[]
  clientToken: string
  createdAt: string // ISO 8601
}

export type SubmitResult = { ok: true; rank: number } | { ok: false; reason: 'already_submitted' | 'invalid' }

export interface RankingStore {
  submit(entry: ResultEntry): Promise<SubmitResult>
  /** 得点降順 → 所要時間昇順 → 登録順。上位 limit 件 */
  list(setId: string, limit?: number): Promise<ResultEntry[]>
}

export const QUESTIONS_PER_SET = 10
export const TIME_LIMIT_MS = 20_000
export const MIN_POOL_FOR_SCOPE = 20

// ---------------------------------------------------------------------------
// 地図・統計（v1）。出典: 総務省統計局 e-Stat 境界データ（2020 年国勢調査・小地域）を市区町村に集約
// ---------------------------------------------------------------------------

/** 市区町村の統計。`public/geo/municipalities.json` は Record<lgCode, MunicipalityStats> */
export interface MunicipalityStats {
  /** 問題バンクと同じ 6 桁コード（政令指定都市は市のコード） */
  lgCode: string
  prefCode: string
  /** 表示名。郡名を含まない市区町村名（例 '匝瑳市'、'浪江町'）。政令市は市名 */
  name: string
  population: number
  households: number
  /** 面積 km²（小数 2 桁） */
  areaKm2: number
  /** 人口密度 人/km²（整数） */
  densityPerKm2: number
  /** 代表点 [経度, 緯度] */
  centroid: [number, number]
  source: 'census2020'
}

/** `public/geo/pref/{prefCode}.json`（GeoJSON FeatureCollection, WGS84, 市区町村ポリゴン）の properties */
export interface MunicipalityFeatureProps {
  lgCode: string
  prefCode: string
  name: string
}

/** `public/geo/japan.json`（GeoJSON FeatureCollection, WGS84, 都道府県ポリゴン・強く簡略化）の properties */
export interface PrefectureFeatureProps {
  prefCode: string
  name: string
}

/** 共有ランキング API（infra/API.md）が返す 1 行。answers と clientToken は公開しない */
export interface RankingRow {
  entryId: string
  setId: string
  nickname: string
  score: number
  timeMs: number
  createdAt: string
}
