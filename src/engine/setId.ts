/**
 * セットID の組み立て・分解。
 * 形式: `${dataVersion}-${mode}-${scope}-${seed}` に、全市区町村名のときだけ `-all` が付く
 *  - dataVersion: 問題バンクの版（例 'abr20260925'）。英小文字と数字のみ
 *  - mode: 'e' | 'd'
 *  - scope: '00'（全国）| 2 桁（都道府県）| 6 桁（市区町村）
 *  - seed: 4〜8 桁の数字
 *  - all: 都道府県の市区町村名を全部出す（mode 'e'・2 桁 scope のみ）。seed は出題順にだけ効く
 */
import type { Mode } from './types.ts'

export interface ParsedSetId {
  dataVersion: string
  mode: Mode
  scope: string
  seed: string
  /** 全市区町村名（10 問ではなく、その都道府県の市区町村を全部） */
  all: boolean
}

/** 全市区町村名を表す末尾の区切り */
export const ALL_SEGMENT = 'all'

const DATA_VERSION_RE = /^[0-9a-z]+$/
const SCOPE_RE = /^(?:\d{2}|\d{6})$/
const SEED_RE = /^\d{4,8}$/

/** 全国を表す scope */
export const SCOPE_NATIONWIDE = '00'

export function isMode(v: string): v is Mode {
  return v === 'e' || v === 'd'
}

export function isScope(v: string): boolean {
  return SCOPE_RE.test(v)
}

export function isSeed(v: string): boolean {
  return SEED_RE.test(v)
}

/** all を立てられる条件: 市区町村名（'e'）で、都道府県（2 桁・全国以外）を選んでいる */
export function canBeAll(mode: Mode, scope: string): boolean {
  return mode === 'e' && scope.length === 2 && scope !== SCOPE_NATIONWIDE
}

export function buildSetId(dataVersion: string, mode: Mode, scope: string, seed: string, all = false): string {
  const m: string = mode
  if (!DATA_VERSION_RE.test(dataVersion)) throw new Error(`dataVersion が不正です: ${dataVersion}`)
  if (!isMode(m)) throw new Error(`mode が不正です: ${m}`)
  if (!isScope(scope)) throw new Error(`scope が不正です: ${scope}`)
  if (!isSeed(seed)) throw new Error(`seed が不正です: ${seed}`)
  if (all && !canBeAll(m, scope)) throw new Error('全市区町村名は市区町村名 × 都道府県のときだけです')
  return `${dataVersion}-${m}-${scope}-${seed}${all ? `-${ALL_SEGMENT}` : ''}`
}

/** 不正なら null */
export function parseSetId(str: string): ParsedSetId | null {
  if (!str) return null
  const parts = str.split('-')
  if (parts.length !== 4 && parts.length !== 5) return null
  const dataVersion = parts[0]
  const mode = parts[1]
  const scope = parts[2]
  const seed = parts[3]
  const all = parts.length === 5
  if (all && parts[4] !== ALL_SEGMENT) return null
  if (!DATA_VERSION_RE.test(dataVersion)) return null
  if (!isMode(mode)) return null
  if (!isScope(scope)) return null
  if (!isSeed(seed)) return null
  if (all && !canBeAll(mode, scope)) return null
  return { dataVersion, mode, scope, seed, all }
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
