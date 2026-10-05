/**
 * セットID の組み立て・分解。
 * 形式: `${dataVersion}-${mode}-${scope}-${seed}[-all][-s{1,2,3}]`
 *  - dataVersion: 問題バンクの版（例 'abr20260925'）。英小文字と数字のみ
 *  - mode: 'e' | 'd'
 *  - scope: '00'（全国）| 2 桁（都道府県）| 3 文字 `\d{2}[a-z]`（都道府県の中の地域。src/geo/subregions.ts）| 6 桁（市区町村）
 *  - seed: 4〜8 桁の数字
 *  - all: 母集団を全部出す。seed は出題順にだけ効く。単位は科目で違い、
 *         mode 'e' × 都道府県／地域 ＝ 全市区町村名、mode 'd' × 市区町村（6 桁）＝ 全町名
 *  - s1 / s2 / s3: 難易度 ★ の絞り込み（両科目）。無ければ絞らない
 *
 * **並びは固定**（`-all` が先、`-s{n}` が後）。順番を入れ替えた ID は読まない。
 * 形式を増やしたときは、API（infra/api/src/handler.ts）も同じ parseSetId を使うので
 * **Lambda の再デプロイが要る**（`npm run deploy:api`）。
 */
import { isSubregionScope } from '../geo/subregions.ts'
import type { Mode, Stars } from './types.ts'

export interface ParsedSetId {
  dataVersion: string
  mode: Mode
  scope: string
  seed: string
  /** 10 問ではなく母集団を全部（'e' なら全市区町村名、'd' なら全町名） */
  all: boolean
  /** 難易度 ★ の絞り込み。null ＝ 絞っていない（全部） */
  stars: Stars | null
}

/** 母集団を全部出すことを表す末尾の区切り（全市区町村名・全町名の共通） */
export const ALL_SEGMENT = 'all'

/** 難易度の区切りの接頭辞（`-s3` の 's'） */
export const STARS_PREFIX = 's'

const STARS_RE = /^s([123])$/

/**
 * 難易度の区切り（'s1' | 's2' | 's3'）を ★ の数に直す。読めなければ null。
 * '-s0' / '-s4' / '-s' / '-s12' は不正
 */
export function parseStarsSegment(segment: string): Stars | null {
  const m = STARS_RE.exec(segment)
  return m === null ? null : (Number(m[1]) as Stars)
}

/**
 * 難易度を絞れる科目。**両科目**（Issue #46 で町名にも ★ が付いた）。
 * 絞れない科目が将来できたらここから外す（判定は 1 か所にまとめておく）
 */
const STARS_MODES: Mode[] = ['e', 'd']

/** 難易度を絞れる条件: 市区町村名・町名のどちらも問題ごとに ★1〜3 を持つので true */
export function canHaveStars(mode: Mode): boolean {
  return STARS_MODES.includes(mode)
}

const DATA_VERSION_RE = /^[0-9a-z]+$/
const SCOPE_RE = /^(?:\d{2}|\d{2}[a-z]|\d{6})$/
const SEED_RE = /^\d{4,8}$/

/** 全国を表す scope */
export const SCOPE_NATIONWIDE = '00'

export function isMode(v: string): v is Mode {
  return v === 'e' || v === 'd'
}

export function isScope(v: string): boolean {
  if (!SCOPE_RE.test(v)) return false
  // 3 文字は綴りが合っていても実在しなければ受け付けない（'01z' のような scope を作らせない）
  return v.length === 3 ? isSubregionScope(v) : true
}

export function isSeed(v: string): boolean {
  return SEED_RE.test(v)
}

/**
 * all を立てられる条件。**科目で単位が違う**（Issue #46 の決定 1）:
 *  - 市区町村名（'e'）… 都道府県（2 桁・全国以外）かその中の地域（3 文字）。
 *    市区町村（6 桁）は 1 問になるので不可
 *  - 町名（'d'）… 市区町村（6 桁）だけ。都道府県・地域は 665〜6,743 問で
 *    1 回の答案として成立しないので不可
 */
export function canBeAll(mode: Mode, scope: string): boolean {
  if (mode === 'd') return scope.length === 6
  if (scope.length === 3) return isSubregionScope(scope)
  return scope.length === 2 && scope !== SCOPE_NATIONWIDE
}

export function buildSetId(
  dataVersion: string,
  mode: Mode,
  scope: string,
  seed: string,
  all = false,
  stars?: Stars,
): string {
  const m: string = mode
  if (!DATA_VERSION_RE.test(dataVersion)) throw new Error(`dataVersion が不正です: ${dataVersion}`)
  if (!isMode(m)) throw new Error(`mode が不正です: ${m}`)
  if (!isScope(scope)) throw new Error(`scope が不正です: ${scope}`)
  if (!isSeed(seed)) throw new Error(`seed が不正です: ${seed}`)
  if (all && !canBeAll(m, scope)) {
    throw new Error('全部の出題は、市区町村名 × 都道府県／地域（全市区町村名）か町名 × 市区町村（全町名）のときだけです')
  }
  if (stars !== undefined) {
    if (stars !== 1 && stars !== 2 && stars !== 3) throw new Error(`難易度が不正です: ${String(stars)}`)
    if (!canHaveStars(m)) throw new Error(`難易度を選べない科目です: ${m}`)
  }
  const allPart = all ? `-${ALL_SEGMENT}` : ''
  const starsPart = stars === undefined ? '' : `-${STARS_PREFIX}${stars}`
  return `${dataVersion}-${m}-${scope}-${seed}${allPart}${starsPart}`
}

/** 不正なら null */
export function parseSetId(str: string): ParsedSetId | null {
  if (!str) return null
  const parts = str.split('-')
  if (parts.length < 4 || parts.length > 6) return null
  const dataVersion = parts[0]
  const mode = parts[1]
  const scope = parts[2]
  const seed = parts[3]
  // 5 つ目以降は `-all`（先）→ `-s{n}`（後）の並びに決める。並べ替えや重複は読まない
  const rest = parts.slice(4)
  const all = rest[0] === ALL_SEGMENT
  const starsSegment = all ? rest[1] : rest[0]
  if (rest.length > (all ? 2 : 1)) return null
  let stars: Stars | null = null
  if (starsSegment !== undefined) {
    stars = parseStarsSegment(starsSegment)
    if (stars === null) return null
  }
  if (!DATA_VERSION_RE.test(dataVersion)) return null
  if (!isMode(mode)) return null
  if (!isScope(scope)) return null
  if (!isSeed(seed)) return null
  if (all && !canBeAll(mode, scope)) return null
  if (stars !== null && !canHaveStars(mode)) return null
  return { dataVersion, mode, scope, seed, all, stars }
}

/**
 * JST（Asia/Tokyo）の暦日の 'YYYYMMDD'。
 * 「今日の10問」は全員が同じ 10 問を解く前提なので、端末のタイムゾーンで
 * 日付が前後しないよう JST 固定にする（UTC+9 のオフセットを足して UTC 日付を読む）。
 */
export function todaySeed(date: Date = new Date()): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  const y = String(jst.getUTCFullYear()).padStart(4, '0')
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0')
  const d = String(jst.getUTCDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

/** 4 桁の数字文字列（先頭 0 もあり得る） */
export function randomSeed(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0')
}
