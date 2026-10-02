/**
 * 問題バンク（public/questions/{dataVersion}/）の読み込みと母集団の組み立て。
 * fetch 層は BankSource として差し替え可能（テストではフィクスチャを注入する）。
 */
import type { BankMeta, Mode, Question, QuestionSet } from './types.ts'
import { MIN_POOL_FOR_SCOPE, QUESTIONS_PER_SET } from './types.ts'
import { SCOPE_NATIONWIDE, buildSetId } from './setId.ts'
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
    throw new Error('全国 × difficult はこのデモでは対応していません。都道府県か市区町村を選んでください。')
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

export async function buildQuestionSet(
  mode: Mode,
  scope: string,
  seed: string,
  source: BankSource = defaultSource(),
): Promise<QuestionSet> {
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
    questions: sampleQuestions(pool.questions, setId, QUESTIONS_PER_SET),
  }
}
