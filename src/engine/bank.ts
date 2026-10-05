/**
 * 問題バンク（public/questions/{dataVersion}/）の読み込みと母集団の組み立て。
 * fetch 層は BankSource として差し替え可能（テストではフィクスチャを注入する）。
 */
import { subregionById, subregionOf } from '../geo/subregions.ts'
import type { BankMeta, Mode, Question, QuestionSet, Stars } from './types.ts'
import { ALL_TOWNS_MAX, ALL_TOWNS_MIN, MIN_POOL_FOR_SCOPE, QUESTIONS_PER_SET } from './types.ts'
import { modeName } from './modes.ts'
import { starsMark } from './stars.ts'
import { SCOPE_NATIONWIDE, buildSetId, canBeAll, canHaveStars } from './setId.ts'
import { sampleQuestions } from './sampler.ts'

/**
 * 問題バンクの版。public/questions/{DATA_VERSION}/ に対応する。
 * r2 = easy から「幹に漢字が 1 字も無い」市区町村 41 件を除いた版。
 * 版を上げる手順（旧版を残す・Lambda の再デプロイ）は data/README.md の「版の扱い」。
 */
export const DATA_VERSION = 'abr20260925r2'

/**
 * 旧版のセットID（`abr20260925-...` など）を共有リンクで開いたときの案内。
 * 同梱しているのは現行版だけなので、旧版の setId からは同じ 10 問を再現できない。
 * 黙って現行版で組み直すと「共有された問題と違う 10 問」が出てしまうので、出題も結果も止める。
 */
export const OUTDATED_SET_MESSAGE = 'この問題セットは古い版のため開けません。'

/** セットID の版が、いま同梱している問題バンクの版かどうか */
export function isCurrentDataVersion(dataVersion: string): boolean {
  return dataVersion === DATA_VERSION
}

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

/**
 * 出題できる問だけ（`skip` が付いていないもの。types.ts の `Question.skip`）。
 * meta.json の件数も同じ数え方なので、ここを通せば画面の件数と出題が揃う（Issue #50）
 */
function askable(list: Question[]): Question[] {
  return list.filter((q) => q.skip === undefined)
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

/**
 * scope が受け持つ範囲に入るかの判定。
 * 2 桁 = 都道府県 ／ 3 文字 = 都道府県の中の地域（src/geo/subregions.ts）／ 6 桁 = 市区町村
 */
function scopeMatcher(scope: string): (q: Question) => boolean {
  if (scope.length === 2) return (q) => q.prefCode === scope
  if (scope.length === 3) return (q) => subregionOf(q.lgCode)?.id === scope
  return (q) => q.lgCode === scope
}

async function poolFor(mode: Mode, scope: string, source: BankSource): Promise<Question[]> {
  if (mode === 'e') {
    const easy = await source.easy()
    if (scope === SCOPE_NATIONWIDE) return easy.slice()
    return easy.filter(scopeMatcher(scope))
  }
  // difficult
  if (scope === SCOPE_NATIONWIDE) {
    throw new Error('全国 × difficult はこのデモでは対応していません。都道府県を選んでください。')
  }
  // 地域（3 文字）も 6 桁と同じく、都道府県ファイルを読んでから絞る
  const prefCode = scope.slice(0, 2)
  const [easy, difficult] = await Promise.all([source.easy(), source.difficult(prefCode)])
  const inScope = scopeMatcher(scope)
  return uniqueById([...easy.filter(inScope), ...difficult.filter(inScope)])
}

/**
 * 母集団を組み立てる。MIN_POOL_FOR_SCOPE 未満なら都道府県（scope 先頭 2 桁）まで広げ widened: true。
 * 既に都道府県以上の範囲なら、足りなくてもそのまま返す（widened: false）。
 *
 * **地域（3 文字）は都道府県と同じ扱いで広げない。**「道東を選んだのに全道が出た」は
 * 範囲を選んだ意図に反するため（Issue #34）。足りなければ buildQuestionSet が案内して止める
 */
export async function buildPool(mode: Mode, scope: string, source: BankSource = defaultSource()): Promise<Pool> {
  const questions = await poolFor(mode, scope, source)
  if (questions.length >= MIN_POOL_FOR_SCOPE) return { scope, questions, widened: false }
  const prefCode = scope.slice(0, 2)
  if (scope === SCOPE_NATIONWIDE || prefCode === scope || scope.length === 3) {
    return { scope, questions, widened: false }
  }
  const wider = await poolFor(mode, prefCode, source)
  return { scope: prefCode, questions: wider, widened: true }
}

/**
 * 10 問ではなく母集団を **全部** 出すセットの母集団。**科目で単位が違う**（Issue #46）:
 *
 *  - `'e'` 全市区町村名 … scope は 2 桁（都道府県）か 3 文字（その中の地域）。母集団は
 *    **easy.json にあるものだけ**で、問題バンクが除いた市区町村（ひらがなの さいたま・
 *    ニセコ・むかわ など）は出さない ＝「問題バンクで除外した市区町村はクイズに出さない」に揃える
 *  - `'d'` 全町名 … scope は 6 桁（市区町村）。その市区町村の町名（difficult）だけで、
 *    **市区町村名そのものは含めない**（「全町名（97 問）」の 97 を `meta.cities[].towns` と一致させる）
 *
 * どちらも **`skip` の問は外す**（正解できない問題なので全問の答案にも入れない。Issue #50）。
 * これで件数が `meta.cities[].towns` と一致する。
 *
 * 並びは id 順。母集団なので出題順はここでは決めない（sampleQuestions の担当）
 */
export async function allQuestions(
  mode: Mode,
  scope: string,
  source: BankSource = defaultSource(),
): Promise<Question[]> {
  const prefCode = scope.slice(0, 2)
  if (scope.length === 3 && !subregionById(scope)) throw new Error(`地域コードがありません: ${scope}`)
  const meta = await source.meta()
  if (!meta.prefectures.some((p) => p.code === prefCode)) {
    throw new Error(`都道府県コードが問題バンクにありません: ${prefCode}`)
  }
  const pool = mode === 'e' ? await source.easy() : await source.difficult(prefCode)
  return askable(pool.filter(scopeMatcher(scope))).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** 母集団が足りないときの案内に使う範囲名。地域は「島しょ」、都道府県は出題の pref から */
function poolRangeName(scope: string, questions: Question[]): string {
  return subregionById(scope)?.name ?? questions[0]?.pref ?? scope
}

/**
 * 難易度で母集団を絞る。★ は両科目の全問が持つ（Issue #46）ので、
 * stars が null のときだけ何もしない。
 *
 * **絞った結果が足りなくても範囲を広げない。**「★3 を選んだのに ★1 が出た」は
 * 「道東を選んだのに全道が出た」と同じく選んだ条件に反するため（Issue #34 と同じ理屈）
 */
function filterByStars(questions: Question[], stars: Stars | null): Question[] {
  if (stars === null) return questions
  return questions.filter((q) => q.stars === stars)
}

/** 足りないときの案内に出す条件名。「市区町村名」または「市区町村名（★★★）」 */
function poolConditionName(mode: Mode, stars: Stars | null): string {
  return stars === null ? modeName(mode) : `${modeName(mode)}（${starsMark(stars)}）`
}

/**
 * 全町名が 1 回の答案として成立する件数かを確かめる。成立しなければ理由を日本語で投げる。
 *
 * **全市区町村名（'e'）には効かせない** — 島しょ（9 問）のように既に登録された行があるため
 * （下限の理由は types.ts の ALL_TOWNS_MIN）。エンジンは Lambda と共有しているので、
 * この判定だけでクライアントとサーバーの条件が揃う
 */
function assertTownsCount(questions: Question[], stars: Stars | null): void {
  const n = questions.length
  if (n >= ALL_TOWNS_MIN && n <= ALL_TOWNS_MAX) return
  const name = questions[0]?.city ?? questions[0]?.pref ?? ''
  const what = stars === null ? '町名' : `${starsMark(stars)}の町名`
  if (n < ALL_TOWNS_MIN) {
    throw new Error(`${name}の${what}は ${n} 件しかないので、全町名（${ALL_TOWNS_MIN} 問以上）を組めません。`)
  }
  throw new Error(`${name}の${what}は ${n.toLocaleString('ja-JP')} 件あり多すぎるので、全町名を組めません。`)
}

/**
 * 問題セットを組み立てる。all なら母集団を全部（'e' ならその範囲の市区町村名、
 * 'd' ならその市区町村の町名。seed は出題順のシャッフルだけに効く）、
 * そうでなければ母集団から QUESTIONS_PER_SET 件を決定論的に抽出する。
 *
 * stars を渡すと母集団をその難易度だけに絞る（両科目。all でも効いて
 * 「その範囲の ★3 を全部」になる）。絞って足りなくても範囲は広げず、案内して止める。
 */
export async function buildQuestionSet(
  mode: Mode,
  scope: string,
  seed: string,
  source: BankSource = defaultSource(),
  all = false,
  stars: Stars | null = null,
): Promise<QuestionSet> {
  if (stars !== null && !canHaveStars(mode)) {
    throw new Error('この科目では難易度を選べません。')
  }
  if (all) {
    if (!canBeAll(mode, scope)) {
      throw new Error(
        '全市区町村名は市区町村名 × 都道府県／地域、全町名は町名 × 市区町村のときだけ出題できます。',
      )
    }
    const setId = buildSetId(DATA_VERSION, mode, scope, seed, true, stars ?? undefined)
    const questions = filterByStars(await allQuestions(mode, scope, source), stars)
    if (questions.length === 0) {
      const unit = mode === 'e' ? '市区町村' : '町名'
      const what = stars === null ? unit : `${starsMark(stars)}の${unit}`
      throw new Error(`この範囲には出題できる${what}がありませんでした。`)
    }
    // 全町名だけ 1 回の答案として成立する件数（ALL_TOWNS_MIN〜ALL_TOWNS_MAX）に縛る
    if (mode === 'd') assertTownsCount(questions, stars)
    return {
      setId,
      dataVersion: DATA_VERSION,
      mode,
      scope,
      seed,
      widened: false,
      all: true,
      stars,
      questions: sampleQuestions(questions, setId, questions.length),
    }
  }
  const setId = buildSetId(DATA_VERSION, mode, scope, seed, false, stars ?? undefined)
  const pool = await buildPool(mode, scope, source)
  if (pool.questions.length === 0) {
    throw new Error('この範囲には出題できる地名がありませんでした。')
  }
  // 難易度で絞るのは広げ判定（buildPool）の **あと**。絞って足りなくても広げない
  const narrowed = filterByStars(pool.questions, stars)
  // 「足りない」は **出題できる件数**（skip を除く）で判定する。sampleQuestions には
  // skip を含む narrowed をそのまま渡す — シャッフルを母集団全体に対して回すことで、
  // skip を引かなかった既存セットが前と同じ 10 問のままになる（Issue #50）
  const askableCount = askable(narrowed).length
  // 地域は都道府県へ広げないので、ここで初めて「10 問に足りない」が起こり得る（例 島しょ × 市区町村名 9 件）。
  // 難易度で絞ったときも同じ案内に乗せる（例 鳥取県 × ★★★ は 4 件）
  if (askableCount < QUESTIONS_PER_SET) {
    const hint = mode === 'e' ? '全市区町村名で解いてください。' : '範囲を広げてください。'
    throw new Error(
      `${poolRangeName(pool.scope, pool.questions)}の${poolConditionName(mode, stars)}は ` +
        `${askableCount} 件しかないので、${QUESTIONS_PER_SET} 問を組めません。${hint}`,
    )
  }
  return {
    setId,
    dataVersion: DATA_VERSION,
    mode,
    scope,
    seed,
    widened: pool.widened,
    all: false,
    stars,
    questions: sampleQuestions(narrowed, setId, QUESTIONS_PER_SET),
  }
}
