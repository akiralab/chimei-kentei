/**
 * 問題バンク（public/questions/{dataVersion}/）の読み込みと母集団の組み立て。
 * fetch 層は BankSource として差し替え可能（テストではフィクスチャを注入する）。
 */
import type { BankMeta, Mode, Question, QuestionSet } from './types.ts'
import { MIN_POOL_FOR_SCOPE, QUESTIONS_PER_SET } from './types.ts'
import { SCOPE_NATIONWIDE, buildSetId, canBeAll } from './setId.ts'
import { sampleQuestions } from './sampler.ts'

/**
 * 問題バンクの版。public/questions/{DATA_VERSION}/ に対応する。
 * r2 = easy から「幹に漢字が 1 字も無い」市区町村 41 件を除いた版。
 * 版を上げる手順（旧版を残す・Lambda の再デプロイ）は data/README.md の「版の扱い」。
 */
export const DATA_VERSION = 'abr20260925r2'

export interface BankSource {
  meta(): Promise<BankMeta>
  easy(): Promise<Question[]>
  difficult(prefCode: string): Promise<Question[]>
}

function bankBaseUrl(): string {
  const base = import.meta.env?.BASE_URL ?? '/'
  return `${base}questions/${DATA_VERSION}/`
}

/** fetch ＋ メモリキャッシュの BankSource */
export function createFetchSource(baseUrl: string = bankBaseUrl()): BankSource {
  let metaP: Promise<BankMeta> | undefined
  let easyP: Promise<Question[]> | undefined
  const difficultP = new Map<string, Promise<Question[]>>()

  async function getJson<T>(path: string): Promise<T> {
    const res = await fetch(baseUrl + path)
    if (!res.ok) throw new Error(`問題バンクを読み込めませんでした（${res.status}）: ${path}`)
    return (await res.json()) as T
  }

  return {
    meta() {
      if (!metaP) {
        metaP = getJson<BankMeta>('meta.json').catch((e: unknown) => {
          metaP = undefined
          throw e
        })
      }
      return metaP
    },
    easy() {
      if (!easyP) {
        easyP = getJson<Question[]>('easy.json').catch((e: unknown) => {
          easyP = undefined
          throw e
        })
      }
      return easyP
    },
    difficult(prefCode: string) {
      const hit = difficultP.get(prefCode)
      if (hit) return hit
      const p = getJson<Question[]>(`difficult/${prefCode}.json`).catch((e: unknown) => {
        difficultP.delete(prefCode)
        throw e
      })
      difficultP.set(prefCode, p)
      return p
    },
  }
}

let shared: BankSource | undefined

/** アプリ既定の BankSource（モジュール内でキャッシュを共有する） */
export function defaultSource(): BankSource {
  if (!shared) shared = createFetchSource()
  return shared
}

export function loadMeta(source: BankSource = defaultSource()): Promise<BankMeta> {
  return source.meta()
}

export function loadEasy(source: BankSource = defaultSource()): Promise<Question[]> {
  return source.easy()
}

export function loadDifficult(prefCode: string, source: BankSource = defaultSource()): Promise<Question[]> {
  return source.difficult(prefCode)
}

export interface Pool {
  /** 実際に使った範囲（widened のときは都道府県コード） */
  scope: string
  questions: Question[]
  widened: boolean
}

function uniqueById(list: Question[]): Question[] {
  const seen = new Set<string>()
  const out: Question[] = []
  for (const q of list) {
    if (seen.has(q.id)) continue
    seen.add(q.id)
    out.push(q)
  }
  return out
}

async function poolFor(mode: Mode, scope: string, source: BankSource): Promise<Question[]> {
  if (mode === 'e') {
    const easy = await source.easy()
    if (scope === SCOPE_NATIONWIDE) return easy.slice()
    if (scope.length === 2) return easy.filter((q) => q.prefCode === scope)
    return easy.filter((q) => q.lgCode === scope)
  }
  // difficult
  if (scope === SCOPE_NATIONWIDE) {
    throw new Error('全国 × difficult はこのデモでは対応していません。都道府県を選んでください。')
  }
  const prefCode = scope.slice(0, 2)
  const [easy, difficult] = await Promise.all([source.easy(), source.difficult(prefCode)])
  if (scope.length === 2) {
    return uniqueById([...easy.filter((q) => q.prefCode === scope), ...difficult.filter((q) => q.prefCode === scope)])
  }
  return uniqueById([...easy.filter((q) => q.lgCode === scope), ...difficult.filter((q) => q.lgCode === scope)])
}

/**
 * 母集団を組み立てる。MIN_POOL_FOR_SCOPE 未満なら都道府県（scope 先頭 2 桁）まで広げ widened: true。
 * 既に都道府県以上の範囲なら、足りなくてもそのまま返す（widened: false）。
 */
export async function buildPool(mode: Mode, scope: string, source: BankSource = defaultSource()): Promise<Pool> {
  const questions = await poolFor(mode, scope, source)
  if (questions.length >= MIN_POOL_FOR_SCOPE) return { scope, questions, widened: false }
  const prefCode = scope.slice(0, 2)
  if (scope === SCOPE_NATIONWIDE || prefCode === scope) return { scope, questions, widened: false }
  const wider = await poolFor(mode, prefCode, source)
  return { scope: prefCode, questions: wider, widened: true }
}

/** 接尾辞ごとの読みの末尾（data/build_questions.py のルール b と同じ。長い方から当てる） */
const SUFFIX_KANA: Record<string, string[]> = { 市: ['し'], 区: ['く'], 町: ['ちょう', 'まち'], 村: ['そん', 'むら'] }

/**
 * meta.cities の 1 件を easy と同じ形の Question にする（接尾辞と読みの末尾を外す）。
 * easy.json に無い市区町村（r2 で除いた、かなだけの名前）を「全市区町村名」で出すために使う。
 * 接尾辞か読みの末尾が合わなければ null（ABR 由来のデータでは起きない）
 */
export function questionFromCity(city: BankMeta['cities'][number], pref: string): Question | null {
  const suffix = city.name.slice(-1)
  const display = city.name.slice(0, -1)
  const tails = SUFFIX_KANA[suffix]
  if (!tails || display === '') return null
  const tail = tails.find((t) => city.kana.endsWith(t))
  if (tail === undefined || city.kana.length <= tail.length) return null
  return {
    id: `c:${city.lgCode}:${display}`,
    prefCode: city.prefCode,
    pref,
    lgCode: city.lgCode,
    display,
    suffix,
    answer: city.kana.slice(0, -tail.length),
  }
}

/**
 * ある都道府県の市区町村名を **全部**（easy.json の件に、meta.cities にしか無い件を足す）。
 * 並びは lgCode 順。母集団なので出題順はここでは決めない
 */
export async function municipalityQuestions(prefCode: string, source: BankSource = defaultSource()): Promise<Question[]> {
  const [easy, meta] = await Promise.all([source.easy(), source.meta()])
  const pref = meta.prefectures.find((p) => p.code === prefCode)
  if (!pref) throw new Error(`都道府県コードが問題バンクにありません: ${prefCode}`)
  const inBank = easy.filter((q) => q.prefCode === prefCode)
  const have = new Set(inBank.map((q) => q.lgCode))
  const extra: Question[] = []
  for (const city of meta.cities) {
    if (city.prefCode !== prefCode || have.has(city.lgCode)) continue
    const q = questionFromCity(city, pref.name)
    if (q) extra.push(q)
  }
  return [...inBank, ...extra].sort((a, b) => (a.lgCode < b.lgCode ? -1 : a.lgCode > b.lgCode ? 1 : 0))
}

/**
 * 問題セットを組み立てる。all なら「その都道府県の市区町村名を全部」（seed は出題順のシャッフルだけに効く）、
 * そうでなければ母集団から QUESTIONS_PER_SET 件を決定論的に抽出する。
 */
export async function buildQuestionSet(
  mode: Mode,
  scope: string,
  seed: string,
  source: BankSource = defaultSource(),
  all = false,
): Promise<QuestionSet> {
  if (all) {
    if (!canBeAll(mode, scope)) {
      throw new Error('全市区町村名は、市区町村名で都道府県を選んだときだけ出題できます。')
    }
    const setId = buildSetId(DATA_VERSION, mode, scope, seed, true)
    const questions = await municipalityQuestions(scope, source)
    if (questions.length === 0) throw new Error('この都道府県には出題できる市区町村がありませんでした。')
    return {
      setId,
      dataVersion: DATA_VERSION,
      mode,
      scope,
      seed,
      widened: false,
      all: true,
      questions: sampleQuestions(questions, setId, questions.length),
    }
  }
  const setId = buildSetId(DATA_VERSION, mode, scope, seed)
  const pool = await buildPool(mode, scope, source)
  if (pool.questions.length === 0) {
    throw new Error('この範囲には出題できる地名がありませんでした。')
  }
  return {
    setId,
    dataVersion: DATA_VERSION,
    mode,
    scope,
    seed,
    widened: pool.widened,
    all: false,
    questions: sampleQuestions(pool.questions, setId, QUESTIONS_PER_SET),
  }
}
