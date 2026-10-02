/**
 * セットID の組み立て・分解。
 * 形式: `${dataVersion}-${mode}-${scope}-${seed}`
 *  - dataVersion: 問題バンクの版（例 'abr20260925'）。英小文字と数字のみ
 *  - mode: 'e' | 'd'
 *  - scope: '00'（全国）| 2 桁（都道府県）| 6 桁（市区町村）
 *  - seed: 4〜8 桁の数字
 */
import type { Mode } from './types.ts'

export interface ParsedSetId {
  dataVersion: string
  mode: Mode
  scope: string
  seed: string
}

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

export function buildSetId(dataVersion: string, mode: Mode, scope: string, seed: string): string {
  const m: string = mode
  if (!DATA_VERSION_RE.test(dataVersion)) throw new Error(`dataVersion が不正です: ${dataVersion}`)
  if (!isMode(m)) throw new Error(`mode が不正です: ${m}`)
  if (!isScope(scope)) throw new Error(`scope が不正です: ${scope}`)
  if (!isSeed(seed)) throw new Error(`seed が不正です: ${seed}`)
  return `${dataVersion}-${m}-${scope}-${seed}`
}

/** 不正なら null */
export function parseSetId(str: string): ParsedSetId | null {
  if (!str) return null
  const parts = str.split('-')
  if (parts.length !== 4) return null
  const dataVersion = parts[0]
  const mode = parts[1]
  const scope = parts[2]
  const seed = parts[3]
  if (!DATA_VERSION_RE.test(dataVersion)) return null
  if (!isMode(mode)) return null
  if (!isScope(scope)) return null
  if (!isSeed(seed)) return null
  return { dataVersion, mode, scope, seed }
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
