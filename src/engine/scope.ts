/**
 * scope（セット ID の範囲）の表示名。選択・出題・着地・結果・順位表で同じ文字列を出すために
 * **ここが唯一の実装**。地域は「北海道・道央」「東京都・23区」のように親の都道府県と連ねる。
 */
import { subregionById } from '../geo/subregions.ts'
import { SCOPE_NATIONWIDE } from './setId.ts'
import type { QuestionSet } from './types.ts'

/**
 * '00' → 全国 ／ 2 桁 → 都道府県名 ／ 3 文字 → 「北海道・道央」 ／ 6 桁 → 市区町村名。
 *
 * 名前の引き方は画面ごとに違う（meta.prefectures / 出題の pref / meta.cities）ので関数で渡す。
 * 引けなかったときは scope をそのまま返す（表示が空にならないように）
 */
export function scopeLabel(
  scope: string | undefined,
  prefNameOf: (prefCode: string) => string | undefined,
  cityNameOf?: (lgCode: string) => string | undefined,
): string {
  if (scope === undefined || scope === '') return '—'
  if (scope === SCOPE_NATIONWIDE) return '全国'
  if (scope.length === 2) return prefNameOf(scope) ?? scope
  if (scope.length === 3) {
    const sub = subregionById(scope)
    if (!sub) return scope
    const pref = prefNameOf(sub.prefCode)
    return pref === undefined ? sub.name : `${pref}・${sub.name}`
  }
  return cityNameOf?.(scope) ?? scope
}

/**
 * 問題セットの範囲の表示名（出題・挑戦状・答案で同じものを出す）。
 * 都道府県名は出題そのもの（questions[0].pref）から引くので meta を読まなくてよい。
 *  - 広げたとき（widened）は広げた先の都道府県
 *  - 2 桁・3 文字は scopeLabel（地域は「北海道・道央」）
 *  - 6 桁は所属市区町村名（difficult の city）
 */
export function rangeLabelOf(set: QuestionSet): string {
  if (set.scope === SCOPE_NATIONWIDE) return '全国'
  const first = set.questions[0]
  if (!first) return set.scope
  if (set.widened) return first.pref
  if (set.scope.length <= 3) return scopeLabel(set.scope, () => first.pref)
  return first.city ?? first.pref
}
