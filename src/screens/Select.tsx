import { useEffect, useMemo, useState } from 'react'
import type { BankMeta, Mode, Stars } from '../engine/types.ts'
import { ALL_TOWNS_MAX, ALL_TOWNS_MIN, QUESTIONS_PER_SET } from '../engine/types.ts'
import { DATA_VERSION, loadEasy, loadMeta } from '../engine/bank.ts'
import { MODES, MODE_LABELS, modeName } from '../engine/modes.ts'
import { allSetLabel, allSetName } from '../engine/score.ts'
import { STARS_ALL, STARS_CHOICES, starsHeaderNote, starsMark, starsSwitchLabel } from '../engine/stars.ts'
import { scopeLabel } from '../engine/scope.ts'
import { SCOPE_NATIONWIDE, buildSetId, canBeAll, canHaveStars, randomSeed } from '../engine/setId.ts'
import { HOWTO_PATH, navigate, quizPath } from '../router.ts'
import { TIME_LIMIT_CHOICES, useTimeLimit } from '../hooks/useTimeLimit.ts'
import type { PrefectureCollection } from '../geo/load.ts'
import { defaultGeoSource } from '../geo/load.ts'
import { subregionById, subregionOf, subregionsOf, wholePrefLabel } from '../geo/subregions.ts'
import RegionPicker from '../components/RegionPicker.tsx'
import PaperSkeleton from '../components/PaperSkeleton.tsx'

/**
 * その範囲の **市区町村の数**（「東京都・島しょは 9 市町村」）。政令市の区は市にまとめてあるので、
 * 区が混じるのは東京都（特別区）だけ。meta.cities で数える。
 * 使い道は「10 問を組めない理由」の一文だけで、**地図の見出しには出さない**
 * （見出しは難易度で変わる出題数を出す。問題バンクにある easy の件数 = easyCount）。
 * scope は 2 桁（都道府県）でも 3 文字（地域。北海道 4・東京都 3）でもよい
 */
function municipalityCount(meta: BankMeta, scope: string): { n: number; unit: string } {
  const prefCode = scope.slice(0, 2)
  const sub = scope.length === 3 ? subregionById(scope) : undefined
  const cities = meta.cities.filter((c) => c.prefCode === prefCode && (!sub || subregionOf(c.lgCode)?.id === sub.id))
  const unit = cities.some((c) => c.name.endsWith('区')) ? '市区町村' : '市町村'
  return { n: cities.length, unit }
}

/** 選んでいる難易度。0 ＝ 絞らない（全部） */
type StarsChoice = Stars | typeof STARS_ALL

/** 件数表のキー。範囲（'00' / 2 桁 / 3 文字 / 6 桁）× 難易度（0 ＝ 全部） */
function countKey(scope: string, stars: StarsChoice): string {
  return `${scope}|${stars}`
}

/**
 * 町名の件数表。`countKey(範囲, 難易度)` → 件数。**meta.json だけで数える**
 * （町名の実体 `difficult/*.json` は 18 MB あるので選択画面では読まない）。
 * 範囲は全国 '00'・都道府県コード・地域 ID・市区町村コード（6 桁）の 4 つを同時に積む
 */
function townCounts(meta: BankMeta): Map<string, number> {
  const counts = new Map<string, number>()
  const bump = (scope: string, stars: StarsChoice, n: number) => {
    const key = countKey(scope, stars)
    counts.set(key, (counts.get(key) ?? 0) + n)
  }
  for (const c of meta.cities) {
    const sub = subregionOf(c.lgCode)
    const scopes = sub ? [SCOPE_NATIONWIDE, c.prefCode, sub.id, c.lgCode] : [SCOPE_NATIONWIDE, c.prefCode, c.lgCode]
    for (const scope of scopes) {
      bump(scope, STARS_ALL, c.towns)
      for (const stars of STARS_CHOICES) bump(scope, stars, c.townStars[stars - 1])
    }
  }
  return counts
}

/** 市区町村の `<select>` の選択肢 1 つ。選べない理由（0 件・少なすぎる・多すぎる）もここで決める */
function cityOptionLabel(city: BankMeta['cities'][number]): string {
  if (city.towns === 0) return `${city.name}（町名なし）`
  const n = city.towns.toLocaleString('ja-JP')
  if (city.towns < ALL_TOWNS_MIN) return `${city.name}（${n}問・少なすぎるため対象外）`
  if (city.towns > ALL_TOWNS_MAX) return `${city.name}（${n}問・多すぎるため対象外）`
  return `${city.name}（${n}問）`
}

/**
 * その市区町村の全町名を 1 回の答案として出せるか。**10〜500 問の 1,405 市区町村だけ**。
 * 0 件（33）と 1〜9 件（286）と 501 問以上（17）は出せない（判定の正本は engine/bank.ts）
 */
function canPlayAllTowns(city: BankMeta['cities'][number]): boolean {
  return city.towns >= ALL_TOWNS_MIN && city.towns <= ALL_TOWNS_MAX
}

export default function Select() {
  const [meta, setMeta] = useState<BankMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * 選んでいる**範囲**。'00' ＝ 全国／2 桁 ＝ 都道府県／3 文字 ＝ 地域。
   * 市区町村（6 桁）はここに入れない — 全町名のときだけ下の `city` で選ぶ（PR #28 で外した
   * 「市区町村で絞る」を戻さないため。6 桁 scope は全町名専用）
   */
  const [scope, setScope] = useState<string>(SCOPE_NATIONWIDE)
  const [mode, setMode] = useState<Mode>('e')
  /**
   * 選んでいる市区町村コード（6 桁）。'' ＝ 未選択。
   * **全町名（町名 × 全部）のときだけ**使う。範囲を変えたら捨てる
   */
  const [city, setCity] = useState('')
  /**
   * 問題数。false ＝ 10 問、true ＝ 母集団を全部
   * （市区町村名ならその範囲の全市区町村名、町名なら選んだ市区町村の全町名）
   */
  const [all, setAll] = useState(false)
  /** 難易度。0 ＝ 全部。両科目で選べる（Issue #46 で町名にも ★ が付いた） */
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
  /**
   * 全町名で選べる市区町村。選んでいる範囲（都道府県か地域）に入る `meta.cities` を団体コード順に。
   * 町名 0 件（33 件）と上限超え（17 件）も **選択肢には出す** — 無いものとして隠すより、
   * 押せないことと理由（「3,741問・多すぎるため対象外」）を見せた方が分かるため
   */
  const cityOptions = useMemo(() => {
    if (!meta || prefCode === undefined) return []
    const sub = scope.length === 3 ? subregionById(scope) : undefined
    return meta.cities.filter((c) => c.prefCode === prefCode && (!sub || subregionOf(c.lgCode)?.id === sub.id))
  }, [meta, prefCode, scope])
  const count = useMemo(
    () => (meta && selectedPref ? municipalityCount(meta, scope) : null),
    [meta, selectedPref, scope],
  )
  /** 町名の件数表（meta だけで数える）。全国・都道府県・地域・市区町村の 4 つの範囲を引ける */
  const townCount = useMemo(() => (meta ? townCounts(meta) : null), [meta])
  /** 難易度を選べる条件。いまは両科目 true（判定は engine/setId.ts に置く） */
  const starsAvailable = canHaveStars(mode)

  /**
   * いまの範囲（またはいまの市区町村）× 難易度の件数。読めていなければ null。
   *  - 市区町村名（'e'）… easy.json を走査した件数
   *  - 町名（'d'）… `meta.cities[].towns` / `townStars` の積み上げ。
   *    **市区町村名そのものは数に入らない**（科目 'd' の 10 問は市区町村名も母集団に含むので、
   *    実際の母集団はこの件数より少し多い。足りないと言い過ぎる側に倒している）
   */
  const countOfRange = (rangeScope: string, choice: StarsChoice): number | null =>
    (mode === 'e' ? easyCount : townCount)?.get(countKey(rangeScope, choice)) ?? null

  /** 選んでいる市区町村（全町名のときだけ）。範囲の外・選べない市区町村なら undefined */
  const selectedCity = useMemo(() => {
    if (mode !== 'd' || city === '') return undefined
    const hit = meta?.cities.find((c) => c.lgCode === city)
    return hit && canPlayAllTowns(hit) ? hit : undefined
  }, [meta, mode, city])
  /** 全町名で出題する市区町村の scope（6 桁）。決まっていなければ undefined */
  const townsScope = all && selectedCity ? selectedCity.lgCode : undefined

  /** 難易度の件数を数える範囲。全町名で市区町村まで決まっていればその市区町村 */
  const starsScope = townsScope ?? scope
  const countAt = (choice: StarsChoice): number | null => countOfRange(starsScope, choice)

  /**
   * その難易度を選べないか。**0 件**は両科目で押せない（既存）。さらに
   * **町名（'d'）は 10 問に足りない ★ も押せなくする** — 10 問のセットは市区町村名のように
   * 「全市区町村名へ固定」で逃がせず（例 東京都・島しょの ★★★ は 4 問）、
   * 全町名も下限 10 問なので（例 匝瑳市の ★★★ が 4 件）どちらも組めないため
   */
  const starsBlocked = (choice: Stars): boolean => {
    const n = countAt(choice)
    if (n === null) return false
    if (n === 0) return true
    return mode === 'd' && n < QUESTIONS_PER_SET
  }
  /**
   * 実際に使う難易度。選んだ ★ が **いまの範囲で選べない**なら「全部」に落とす
   * （範囲を変えた拍子に始められない組み合わせが残らないように）
   */
  const starsSelected: StarsChoice =
    !starsAvailable || (stars !== STARS_ALL && starsBlocked(stars)) ? STARS_ALL : stars
  /** 出題に渡す難易度。0（全部）は渡さない */
  const starsParam = starsSelected === STARS_ALL ? undefined : starsSelected

  /**
   * 「全部」ボタンに添える問題数。読めていなければ null（＝件数を出さない）。
   *  - 市区町村名 … その範囲 × 難易度の easy の件数
   *  - 町名 … **選んだ市区町村** × 難易度の町名の件数（市区町村を選ぶまでは出せない）
   */
  const allCount =
    mode === 'e' ? (nationwide ? null : countAt(starsSelected))
    : townsScope === undefined ? null
    : countOfRange(townsScope, starsSelected)
  /** 全部を選べる条件。市区町村名は都道府県／地域、町名は市区町村（下の `<select>` で選ぶ） */
  const allAvailable = mode === 'e' ? canBeAll(mode, scope) : !nationwide
  /**
   * 10 問を組めない範囲。絞らなければ島しょ（9 件）だけだが、**難易度で絞ると珍しくない**
   * （47 都道府県 × ★3 のうち 71 通りが 10 件未満。例 鳥取県 × ★★★ は 5 件）。
   * 範囲も難易度も広げない仕様（Issue #34 と同じ理屈）なので、ここで全市区町村名に固定する。
   * **町名（'d'）では固定しない** — 逃げ道の全町名は単位（市区町村）が違うので、
   * 代わりに上の starsBlocked でその ★ を押せなくする
   */
  const tooFewForSet = mode === 'e' && allCount !== null && allCount < QUESTIONS_PER_SET
  const allSelected = allAvailable && (all || tooFewForSet)
  /** 全町名を選んだが市区町村がまだ決まっていない。始められないので案内を出す */
  const needCity = mode === 'd' && allSelected && townsScope === undefined
  /**
   * 全国 × 町名は母集団を組めない（町名は都道府県ごとのファイル）。
   * 科目の切替自体は全国のままでも押せるようにし、「始める」だけを止めて案内を出す。
   */
  const blocked = (nationwide && mode === 'd') || needCity
  /** 出題に渡す範囲。全町名なら市区町村（6 桁）、それ以外は選んでいる範囲 */
  const startScope = townsScope ?? scope

  /** 地図で光らせる県。地域・市区町村を選んでいても親の都道府県を光らせる */
  const mapSelected = prefCode

  const prefNameOf = (code: string) => meta?.prefectures.find((p) => p.code === code)?.name
  const cityNameOf = (lgCode: string) => meta?.cities.find((c) => c.lgCode === lgCode)?.name
  /** 見出しに出す範囲名。全町名で市区町村まで決まっていれば「匝瑳市」 */
  const rangeName = scopeLabel(startScope, prefNameOf, cityNameOf)
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

  /**
   * 地図の見出し行に出す添え書き。「いまの範囲 × いまの難易度」の **問題数**（「67問」「★★★ 26問」）。
   * 市区町村の数（meta.cities）ではなく問題バンクの件数なので、難易度の切替と一緒に動く。
   * 町名（'d'）でも出す（地域の件数が meta の townStars で取れるようになったため。Issue #46）。
   * 数えるのは **地図が指している範囲**（都道府県／地域）で、全町名で市区町村を選んでも動かさない
   */
  const noteCount = nationwide ? null : countOfRange(scope, starsSelected)
  const selectedNote =
    noteCount === null ? undefined
    : starsParam === undefined ? `${noteCount}問`
    : `${starsMark(starsParam)} ${noteCount}問`
  /** 上の添え書きの読み上げ・ツールチップ用。記号だけでは何の数か分からないので言い換える */
  const selectedNoteLabel =
    noteCount === null ? undefined
    : starsParam === undefined ? `問題数 ${noteCount} 問`
    : `${starsMark(starsParam)} の問題数 ${noteCount} 問`

  /** 範囲（都道府県・地域）を選び直す。選んでいた市区町村は範囲の外になり得るので捨てる */
  const chooseScope = (next: string) => {
    setScope(next)
    setCity('')
  }
  const choosePref = (prefCode: string) => chooseScope(prefCode)
  const chooseNationwide = () => {
    chooseScope(SCOPE_NATIONWIDE)
    setAll(false)
  }
  const chooseMode = (m: Mode) => {
    setMode(m)
    // 「全部」の単位が科目で違う（全市区町村名 ↔ 全町名）ので、市区町村の選択は引きずらない
    setCity('')
  }
  /** 10 問に戻す。全町名から戻るので市区町村も捨てて都道府県／地域に戻る */
  const chooseTenQuestions = () => {
    setAll(false)
    setCity('')
  }

  const start = () => {
    if (blocked) return
    navigate(quizPath(buildSetId(DATA_VERSION, mode, startScope, randomSeed(), allSelected, starsParam)))
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
        <PaperSkeleton lines={5} />
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
        <a className="btn btn--ghost paper__help" href={HOWTO_PATH} aria-label="どうやって遊ぶの？">
          ？
        </a>
      </div>

      <RegionPicker
        collection={japan}
        prefectures={meta.prefectures.map((p) => ({ code: p.code, name: p.name }))}
        selected={mapSelected}
        selectedNote={selectedNote}
        selectedNoteLabel={selectedNoteLabel}
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
            onClick={() => chooseScope(prefCode)}
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
              onClick={() => chooseScope(sub.id)}
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

        {/* 難易度 ＝ 1 問ごとに付いた ★1〜3（data/build_stars.py）。**両科目に出す**
            （Issue #46 で町名にも ★ が付いた）。
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
                  disabled={starsBlocked(s)}
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
            onClick={chooseTenQuestions}
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
            // 名前は科目で違う（全市区町村名／全町名）。組み立ては engine/score.ts の 1 か所
            aria-label={`問題数: ${allSetLabel(mode, allCount ?? undefined)}`}
            title={
              allAvailable ? undefined
              : mode === 'e' ? '市区町村名で都道府県か地域を選ぶと選べます'
              : '町名で都道府県か地域を選ぶと選べます'
            }
            disabled={!allAvailable}
            onClick={() => setAll(true)}
          >
            <span className="mode-switch__full" aria-hidden="true">
              {allSetName(mode)}
              {allCount !== null && `（${allCount}問）`}
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

      {/* 全町名の単位は市区町村（Issue #46 の決定 1）。**全町名を選んだときだけ** 1 行増やして
          ネイティブの `<select>` で選ばせる（PR #28 で外した「市区町村で絞る」は戻さない）。
          0 件と上限超えは押せない選択肢として並べ、理由をラベルに書く */}
      {mode === 'd' && allSelected && (
        <label className="field">
          <span className="field__label">市区町村</span>
          <select
            className="field__input field__input--wide"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          >
            <option value="">市区町村を選ぶ</option>
            {cityOptions.map((c) => (
              <option key={c.lgCode} value={c.lgCode} disabled={!canPlayAllTowns(c)}>
                {cityOptionLabel(c)}
              </option>
            ))}
          </select>
        </label>
      )}

      <p>
        {/* 全国のまま町名（都道府県ごとの出題）を選んでいる間、全町名で市区町村を選んでいない間は
            始められない。行を足すと 1 画面に収まらなくなるので、案内はボタンのラベルに出す */}
        <button type="button" className="btn btn--primary" onClick={start} disabled={blocked}>
          {!blocked ? '始める'
          : needCity ? '市区町村を選ぶと始められます'
          : '都道府県を選ぶと始められます'}
        </button>
      </p>
    </div>
  )
}
