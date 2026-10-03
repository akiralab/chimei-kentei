import { useEffect, useMemo, useState } from 'react'
import type { BankMeta, Mode, Stars } from '../engine/types.ts'
import { QUESTIONS_PER_SET } from '../engine/types.ts'
import { DATA_VERSION, loadEasy, loadMeta } from '../engine/bank.ts'
import { MODES, MODE_LABELS, modeName } from '../engine/modes.ts'
import { STARS_ALL, STARS_CHOICES, starsHeaderNote, starsMark, starsSwitchLabel } from '../engine/stars.ts'
import { scopeLabel } from '../engine/scope.ts'
import { SCOPE_NATIONWIDE, buildSetId, canBeAll, canHaveStars, randomSeed } from '../engine/setId.ts'
import { navigate, quizPath } from '../router.ts'
import { TIME_LIMIT_CHOICES, useTimeLimit } from '../hooks/useTimeLimit.ts'
import type { PrefectureCollection } from '../geo/load.ts'
import { defaultGeoSource } from '../geo/load.ts'
import { subregionById, subregionOf, subregionsOf, wholePrefLabel } from '../geo/subregions.ts'
import RegionPicker from '../components/RegionPicker.tsx'

/**
 * 地図の見出しに出す「全54市町村」。政令市の区は市にまとめてあるので、区が混じるのは
 * 東京都（特別区）だけ。これは **市区町村の数** なので meta.cities で数える
 * （問題数ではない。全市区町村名が出すのは問題バンクにある easy の件数 = easyCount）。
 * scope は 2 桁（都道府県）でも 3 文字（地域。北海道 4・東京都 3）でもよい
 */
function municipalityCount(meta: BankMeta, scope: string): { n: number; label: string; unit: string } {
  const prefCode = scope.slice(0, 2)
  const sub = scope.length === 3 ? subregionById(scope) : undefined
  const cities = meta.cities.filter((c) => c.prefCode === prefCode && (!sub || subregionOf(c.lgCode)?.id === sub.id))
  const unit = cities.some((c) => c.name.endsWith('区')) ? '市区町村' : '市町村'
  return { n: cities.length, label: `全${cities.length}${unit}`, unit }
}

/** 選んでいる難易度。0 ＝ 絞らない（全部） */
type StarsChoice = Stars | typeof STARS_ALL

/** easy の件数表のキー。範囲（'00' / 2 桁 / 3 文字）× 難易度（0 ＝ 全部） */
function countKey(scope: string, stars: StarsChoice): string {
  return `${scope}|${stars}`
}

export default function Select() {
  const [meta, setMeta] = useState<BankMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<string>(SCOPE_NATIONWIDE)
  const [mode, setMode] = useState<Mode>('e')
  /** 問題数。false ＝ 10 問、true ＝ その都道府県の全市区町村名（市区町村名 × 都道府県のときだけ） */
  const [all, setAll] = useState(false)
  /** 難易度。0 ＝ 全部。市区町村名のときだけ選べる（町名に ★ は無い） */
  const [stars, setStars] = useState<StarsChoice>(STARS_ALL)
  // 時間制限は端末の設定（既定は「制限なし」）。Quiz は出題開始時に readTimeLimit() で読み直す
  const [timeLimitMs, setTimeLimitMs] = useTimeLimit()
  // 地図（地方 → 都道府県の 2 段階）。読めなくても RegionPicker がボタングリッドで成立させる
  const [japan, setJapan] = useState<PrefectureCollection | null>(null)
  const [mapLoading, setMapLoading] = useState(true)
  /**
   * easy.json の件数表。`countKey(範囲, 難易度)` → 件数（難易度 0 ＝ その範囲の全部）。
   * 範囲は全国 '00'・都道府県コード・地域 ID。
   * 市区町村の数ではなく **問題バンクにある件数** を出す（ひらがなの地名などは除かれている）。
   * easy.json は出題でどのみち読むので、ここで先に読んでもキャッシュに乗るだけ
   */
  const [easyCount, setEasyCount] = useState<Map<string, number> | null>(null)

  useEffect(() => {
    let alive = true
    loadMeta()
      .then((m) => {
        if (alive) setMeta(m)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [])

  // 全市区町村名の件数。読めなくても範囲選択は成立する（件数が出ないだけ）
  useEffect(() => {
    let alive = true
    loadEasy()
      .then((easy) => {
        if (!alive) return
        const counts = new Map<string, number>()
        // 範囲 1 つにつき「全部」と「その問の ★」の 2 つを数える。
        // 全国も数えるので、難易度の切替は都道府県を選ぶ前から件数を出せる
        const bump = (scope: string, qStars: Stars | undefined) => {
          for (const key of [countKey(scope, STARS_ALL), ...(qStars ? [countKey(scope, qStars)] : [])]) {
            counts.set(key, (counts.get(key) ?? 0) + 1)
          }
        }
        for (const q of easy) {
          bump(SCOPE_NATIONWIDE, q.stars)
          bump(q.prefCode, q.stars)
          const sub = subregionOf(q.lgCode)
          if (sub) bump(sub.id, q.stars)
        }
        setEasyCount(counts)
      })
      .catch(() => {
        /* 出題時に同じ読み込みで失敗が分かるので、ここでは黙って件数を出さない */
      })
    return () => {
      alive = false
    }
  }, [])

  // 地図データ（public/geo/japan.json）。無くても範囲選択は一覧で成立する
  useEffect(() => {
    let alive = true
    defaultGeoSource()
      .japan()
      .then((fc) => {
        if (!alive) return
        setJapan(fc)
        setMapLoading(false)
      })
      .catch(() => {
        if (alive) setMapLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const nationwide = scope === SCOPE_NATIONWIDE
  /** 選んでいる都道府県コード。地域（3 文字）を選んでいても親の都道府県を指す */
  const prefCode = nationwide ? undefined : scope.slice(0, 2)
  const selectedPref = useMemo(
    () => (prefCode === undefined ? undefined : meta?.prefectures.find((p) => p.code === prefCode)),
    [meta, prefCode],
  )
  /** 地域に分けられる都道府県（北海道・東京都）だけ中身が入る */
  const subregions = useMemo(() => (prefCode === undefined ? [] : subregionsOf(prefCode)), [prefCode])
  const count = useMemo(
    () => (meta && selectedPref ? municipalityCount(meta, scope) : null),
    [meta, selectedPref, scope],
  )
  /** 難易度を選べる条件（市区町村名のときだけ）。町名に切り替えたら「全部」に戻す */
  const starsAvailable = canHaveStars(mode)
  /** いまの範囲 × 難易度の件数。読めていなければ null */
  const countAt = (choice: StarsChoice): number | null => easyCount?.get(countKey(scope, choice)) ?? null
  /**
   * 実際に使う難易度。選んだ ★ が **いまの範囲に 0 件**なら「全部」に落とす
   * （範囲を変えた拍子に始められない組み合わせが残らないように）
   */
  const starsSelected: StarsChoice =
    !starsAvailable || (stars !== STARS_ALL && countAt(stars) === 0) ? STARS_ALL : stars
  /** 出題に渡す難易度。0（全部）は渡さない */
  const starsParam = starsSelected === STARS_ALL ? undefined : starsSelected

  /** 全市区町村名の問題数（＝その範囲 × 難易度の easy の件数）。読めていなければ null */
  const allCount = nationwide ? null : countAt(starsSelected)
  /**
   * 全国 × 町名は母集団を組めない（町名は都道府県ごとのファイル）。
   * 科目の切替自体は全国のままでも押せるようにし、「始める」だけを止めて案内を出す。
   */
  const blocked = nationwide && mode === 'd'
  /** 全市区町村名を選べる条件。外れたら 10 問に戻す（切替は押せないまま残さない） */
  const allAvailable = canBeAll(mode, scope)
  /**
   * 10 問を組めない範囲。絞らなければ島しょ（9 件）だけだが、**難易度で絞ると珍しくない**
   * （47 都道府県 × ★3 のうち 71 通りが 10 件未満。例 鳥取県 × ★★★ は 5 件）。
   * 範囲も難易度も広げない仕様（Issue #34 と同じ理屈）なので、ここで全市区町村名に固定する
   */
  const tooFewForSet = mode === 'e' && allCount !== null && allCount < QUESTIONS_PER_SET
  const allSelected = allAvailable && (all || tooFewForSet)

  /** 地図で光らせる県。地域を選んでいても親の都道府県を光らせる */
  const mapSelected = prefCode

  const rangeName = scopeLabel(scope, (code) => meta?.prefectures.find((p) => p.code === code)?.name)
  /** 「制限なし」→「なし」。見出しや切替で「制限: 制限なし」と重ならないように頭を落とす */
  const shortLimit = (label: string) => label.replace(/^制限/, '')
  const timeLimitLabel = shortLimit(
    TIME_LIMIT_CHOICES.find((c) => c.value === timeLimitMs)?.label ?? TIME_LIMIT_CHOICES[0].label,
  )
  const countLabel = allSelected && allCount !== null ? `全 ${allCount} 問` : `${QUESTIONS_PER_SET} 問`
  /**
   * 10 問が組めない理由の「何が足りないか」の部分。組めるなら null。
   *  - 絞っていない … 「東京都・島しょは 9 市町村」（範囲が狭い）
   *  - 難易度で絞った … 「鳥取県の★★★は 5 問」（★ が少ない）
   */
  const tooFewLack =
    !tooFewForSet ? null
    : starsParam !== undefined ? `${rangeName}の${starsMark(starsParam)}は ${allCount ?? 0} 問`
    : count ? `${rangeName}は ${count.n} ${count.unit}`
    : null

  const choosePref = (prefCode: string) => setScope(prefCode)
  const chooseNationwide = () => {
    setScope(SCOPE_NATIONWIDE)
    setAll(false)
  }
  const chooseMode = (m: Mode) => {
    setMode(m)
    if (m !== 'e') {
      setAll(false)
      // 町名に ★ は無いので、切り替えたら難易度も「全部」に戻す（戻ってきたとき引きずらない）
      setStars(STARS_ALL)
    }
  }

  const start = () => {
    if (blocked) return
    navigate(quizPath(buildSetId(DATA_VERSION, mode, scope, randomSeed(), allSelected, starsParam)))
  }

  if (error) {
    return (
      <div className="paper">
        <h1 className="paper__title">範囲・科目</h1>
        <p>問題バンクを読み込めませんでした。</p>
        <p>{error}</p>
      </div>
    )
  }

  if (!meta) {
    return (
      <div className="paper">
        <h1 className="paper__title">範囲・科目</h1>
        <p>読み込み中…</p>
      </div>
    )
  }

  return (
    <div className="paper">
      <div className="paper__header">
        <h1 className="paper__title">範囲・科目</h1>
        <p className="paper__subtitle">
          いまの範囲: {rangeName} ／ 科目: {modeName(mode)}
          {/* 難易度は絞ったときだけ出す（「全部」は既定なので書かない） */}
          {starsParam !== undefined && ` ／ ${starsHeaderNote(starsParam)}`} ／ 問題数: {countLabel} ／ 制限:{' '}
          {timeLimitLabel}
        </p>
      </div>

      <RegionPicker
        collection={japan}
        prefectures={meta.prefectures.map((p) => ({ code: p.code, name: p.name }))}
        selected={mapSelected}
        selectedNote={count?.label}
        loading={mapLoading}
        nationwide={nationwide}
        onNationwide={chooseNationwide}
        onSelect={choosePref}
      />

      {/* 地域（北海道 4・東京都 3）。該当する都道府県を選んだときだけ出す。
          1 つ目は都道府県まるごと（「全道」「全域」）で、押すと scope が 2 桁に戻る */}
      {subregions.length > 0 && prefCode !== undefined && (
        <div className="mode-switch mode-switch--compact" role="group" aria-label="地域">
          <button
            type="button"
            className={scope.length === 2 ? 'mode-switch__item is-selected' : 'mode-switch__item'}
            aria-pressed={scope.length === 2}
            aria-label={`地域: ${wholePrefLabel(prefCode) ?? '全域'}`}
            onClick={() => setScope(prefCode)}
          >
            {wholePrefLabel(prefCode) ?? '全域'}
          </button>
          {subregions.map((sub) => (
            <button
              key={sub.id}
              type="button"
              className={scope === sub.id ? 'mode-switch__item is-selected' : 'mode-switch__item'}
              aria-pressed={scope === sub.id}
              aria-label={`地域: ${sub.name}`}
              onClick={() => setScope(sub.id)}
            >
              {sub.name}
            </button>
          ))}
        </div>
      )}

      {/* 科目 ＝ 出題する地名の種類。「難易度」とは別の軸なので、同じ行に並べても意味は混ざらない。
          1 行に 2 つ置くのは縦を節約するため（地域の行が出る北海道・東京都でも 1 画面に収める） */}
      <div className="switch-row">
        <div className="mode-switch">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={mode === m ? 'mode-switch__item is-selected' : 'mode-switch__item'}
              aria-pressed={mode === m}
              aria-label={MODE_LABELS[m].name}
              onClick={() => chooseMode(m)}
            >
              <span className="mode-switch__full" aria-hidden="true">
                {MODE_LABELS[m].name}
              </span>
              <span className="mode-switch__abbr" aria-hidden="true">
                {MODE_LABELS[m].short}
              </span>
            </button>
          ))}
        </div>

        {/* 難易度 ＝ 市区町村名 1 問ごとに付いた ★1〜3（data/build_stars.py）。
            町名（'d'）には ★ が無いので、科目が市区町村名のときだけ出す。
            選択肢が 4 つなので地域の行と同じ --compact で 375px に収める */}
        {starsAvailable && (
          <div className="mode-switch mode-switch--compact mode-switch--fit" role="group" aria-label="難易度">
            <button
              type="button"
              className={starsSelected === STARS_ALL ? 'mode-switch__item is-selected' : 'mode-switch__item'}
              aria-pressed={starsSelected === STARS_ALL}
              aria-label={starsSwitchLabel(STARS_ALL)}
              onClick={() => setStars(STARS_ALL)}
            >
              <span className="mode-switch__full" aria-hidden="true">
                全部
              </span>
              {/* 狭い画面では ★ 3 つ分の幅を確保するため 1 文字に落とす */}
              <span className="mode-switch__abbr" aria-hidden="true">
                全
              </span>
            </button>
            {STARS_CHOICES.map((s) => {
              const n = countAt(s)
              return (
                <button
                  key={s}
                  type="button"
                  className={starsSelected === s ? 'mode-switch__item is-selected' : 'mode-switch__item'}
                  aria-pressed={starsSelected === s}
                  aria-label={starsSwitchLabel(s)}
                  // 件数は幅を食うのでラベルには出さず、ツールチップに回す（地域の行と同じ考え）
                  title={n === null ? undefined : `${rangeName}の${starsMark(s)}は ${n} 問`}
                  disabled={n === 0}
                  onClick={() => setStars(s)}
                >
                  <span className="stars" aria-hidden="true">
                    {starsMark(s)}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* 問題数と時間制限。1 行に 2 つ並べて縦を節約する（1 画面に収めるため） */}
      <div className="switch-row">
        <div className="mode-switch">
          {/* 母集団が足りない理由。行を足すと 1 画面に収まらないので読み上げ専用にし、
              見える説明は 10 問ボタンの title（ツールチップ）に出す。
              難易度で絞ったときは市区町村の数ではなく **その ★ の問題数** が理由なのでそちらを言う */}
          {tooFewLack !== null && (
            <span className="sr-only">
              {tooFewLack}なので、{QUESTIONS_PER_SET} 問ではなく全市区町村名で解きます
            </span>
          )}
          <button
            type="button"
            className={allSelected ? 'mode-switch__item' : 'mode-switch__item is-selected'}
            aria-pressed={!allSelected}
            aria-label={`問題数: ${QUESTIONS_PER_SET} 問`}
            title={tooFewLack === null ? undefined : `${tooFewLack}なので全市区町村名で解きます`}
            disabled={tooFewForSet}
            onClick={() => setAll(false)}
          >
            <span className="mode-switch__full" aria-hidden="true">
              {QUESTIONS_PER_SET}問
            </span>
            <span className="mode-switch__abbr" aria-hidden="true">
              {QUESTIONS_PER_SET}問
            </span>
          </button>
          <button
            type="button"
            className={allSelected ? 'mode-switch__item is-selected' : 'mode-switch__item'}
            aria-pressed={allSelected}
            aria-label={allCount === null ? '問題数: 全市区町村名' : `問題数: 全市区町村名（${allCount} 問）`}
            title={allAvailable ? undefined : '市区町村名で都道府県か地域を選ぶと選べます'}
            disabled={!allAvailable}
            onClick={() => setAll(true)}
          >
            <span className="mode-switch__full" aria-hidden="true">
              全市区町村名{allCount !== null && `（${allCount}問）`}
            </span>
            <span className="mode-switch__abbr" aria-hidden="true">
              全部{allCount !== null && `（${allCount}）`}
            </span>
          </button>
        </div>

        <div className="mode-switch">
          {TIME_LIMIT_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              className={timeLimitMs === choice.value ? 'mode-switch__item is-selected' : 'mode-switch__item'}
              aria-pressed={timeLimitMs === choice.value}
              aria-label={`時間制限: ${shortLimit(choice.label)}`}
              onClick={() => setTimeLimitMs(choice.value)}
            >
              <span className="mode-switch__full" aria-hidden="true">
                時間制限: {shortLimit(choice.label)}
              </span>
              {/* 狭い画面でも「なし」単独だと何の設定か分からないので、短縮版は元のラベルを使う */}
              <span className="mode-switch__abbr" aria-hidden="true">
                {choice.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <p>
        {/* 全国のまま町名（都道府県ごとの出題）を選んでいる間は始められない。
            行を足すと 1 画面に収まらなくなるので、案内はボタンのラベルに出す */}
        <button type="button" className="btn btn--primary" onClick={start} disabled={blocked}>
          {blocked ? '都道府県を選ぶと始められます' : '始める'}
        </button>
      </p>
    </div>
  )
}
