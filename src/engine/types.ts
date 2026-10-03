/**
 * エンジンと画面の契約（UI 非依存）。問題バンク JSON の形もここで定める。
 * 設計の正本: 地名読み検定-アプリ設計.md §4〜§6
 */

/**
 * 'e' = 市区町村名だけ / 'd' = 市区町村名 ＋ 大字・町名。
 * 難易度ではなく出題する地名の種類。画面の表示名は modes.ts（easy / difficult とは呼ばない）
 */
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
  /**
   * 市区町村の一覧（全 1,741 件）。easy.json は r2 以降かなだけの名前を除くので、こちらの方が多い。
   * 使い道は **範囲選択の「全54市町村」表示と difficult の絞り込み**。出題はしない
   * （全市区町村名が出すのも easy.json にある件だけ）
   */
  cities: { lgCode: string; prefCode: string; name: string; kana: string }[]
}

export interface QuestionSet {
  setId: string // `${dataVersion}-${mode}-${scope}-${seed}`（全市区町村名なら末尾に `-all`）
  dataVersion: string
  mode: Mode
  /** '00' = 全国、2 桁 = 都道府県、3 文字 = 都道府県の中の地域（src/geo/subregions.ts）、6 桁 = 市区町村 */
  scope: string
  seed: string
  /** 範囲が狭すぎて都道府県へ広げたとき true */
  widened: boolean
  /**
   * 全市区町村名: その範囲（都道府県か地域）の市区町村名を全部。
   * 母集団は easy.json にあるものだけで、問題バンクが除いた市区町村は出さない
   */
  all: boolean
  questions: Question[] // 出題順。all でなければ QUESTIONS_PER_SET 件
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
  /** 登録後にストアが付与する ID。自分の行の判定に使う */
  entryId?: string
  /** その回の時間制限。0 または省略 ＝ 制限なし、20000 ＝ 20 秒 */
  timeLimitMs?: number
}

export type SubmitResult =
  | { ok: true; rank: number; entryId: string }
  | { ok: false; reason: 'already_submitted' | 'invalid' | 'network' }

/** ランキングの保存先。Local（localStorage）と Remote（infra/API.md）が同じ契約を実装する */
export interface RankingStore {
  /** entry.score / correct はサーバー側では信用せず再採点する。answers の input / ms / passed だけが入力 */
  submit(entry: ResultEntry): Promise<SubmitResult>
  /** 得点降順 → 所要時間昇順 → 登録順。上位 limit 件（既定 20） */
  list(setId: string, limit?: number): Promise<RankingRow[]>
  /** 都道府県ごとの登録件数・人数。「これまでのランキング」のトップ画面で使う */
  prefectureStats(): Promise<PrefectureStat[]>
  /** ある都道府県の上位 limit 件（既定 30）。list と同じ並び。mode を渡すとその科目だけ */
  listByPrefecture(prefCode: string, limit?: number, mode?: Mode): Promise<RankingRow[]>
}

export const QUESTIONS_PER_SET = 10
/** 「20 秒」を選んだときの 1 問の持ち時間 */
export const TIME_LIMIT_MS = 20_000
/**
 * 母集団がこれ未満の市区町村 scope は都道府県まで広げる（widened）。
 * **都道府県と地域（3 文字）は広げない** — 選んだ範囲の外から出すと意図に反するため
 */
export const MIN_POOL_FOR_SCOPE = 20

/** 時間制限の設定として許す下限・上限（0 ＝ 制限なしは別扱い） */
export const TIME_LIMIT_MIN_MS = 1_000
export const TIME_LIMIT_MAX_MS = 60_000
/** 制限なしのとき 1 問に認める所要時間の上限（サーバー側の検証用） */
export const UNLIMITED_MAX_MS = 600_000

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
  /** setId から導ける出題条件。都道府県別の一覧で科目・範囲を見せるために添える */
  mode?: Mode
  /** '00' = 全国、2 桁 = 都道府県、3 文字 = 都道府県の中の地域、6 桁 = 市区町村 */
  scope?: string
  /** その回の時間制限。0 または省略 ＝ 制限なし。順位表の ⏳ 印に使う */
  timeLimitMs?: number
}

/** 件数と人数の組。科目別の内訳に使う */
export interface ModeCount {
  /** 登録された答案の件数 */
  entries: number
  /** 登録した端末の数（clientToken の distinct） */
  players: number
}

/**
 * 都道府県ごとの登録状況（`GET /stats/prefectures`）。
 * prefCode は setId の scope の先頭 2 桁。全国（scope '00'）は '00' に集める。
 * 地域（3 文字）のセットも先頭 2 桁が親の都道府県なので、その都道府県の一覧に入る。
 */
export interface PrefectureStat {
  prefCode: string
  /** 登録された答案の件数（easy ＋ difficult の合計） */
  entries: number
  /** 登録した端末の数（clientToken の distinct・科目をまたいだ合計） */
  players: number
  /** 科目別の内訳。古いデータには無いので任意 */
  byMode?: Record<Mode, ModeCount>
}
