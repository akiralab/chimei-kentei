/**
 * 地名帳（`#/atlas`）。クイズとは別の「正解の一覧と位置がわかる資料集」（Issue #35・段階 1）。
 *
 * 3 つの状態を 1 つの画面で出し分ける（設計 §12.4）:
 *   入口   `#/atlas`                … 地方 → 都道府県（範囲選択と同じ RegionPicker）
 *   一覧   `#/atlas/13k`            … 「市区町村 ｜ よみ」の表（団体コード順）
 *   行     `#/atlas/13k/131199`     … その市区町村を地図で塗り、人口・面積のカードを出す
 *
 * 幅 900px を境に、同じ 2 つのブロック（一覧・詳細）を「並べる」か「切り替える」かだけが変わる:
 *   900px 以上 … 出題画面と同じ `.layout`（左に地図＋カード、右の用紙に一覧）
 *   899px 以下 … 行が URL にあれば詳細だけ、無ければ一覧だけ
 *
 * 段階 1 は市区町村名だけ。`meta.cities`（1,741 件）を全部載せるので、
 * 出題から外した市区町村（ひらがなの さいたま など）もここには出る（資料集は欠けがない方が価値がある）。
 */
import { useEffect, useMemo, useState } from 'react'
import type { BankMeta } from '../engine/types.ts'
import { loadMeta } from '../engine/bank.ts'
import { scopeLabel } from '../engine/scope.ts'
import type { PrefectureCollection } from '../geo/load.ts'
import { defaultGeoSource } from '../geo/load.ts'
import { isSubregionScope, subregionById, subregionOf, subregionsOf, wholePrefLabel } from '../geo/subregions.ts'
import { useMediaQuery, WIDE_QUERY } from '../hooks/useMediaQuery.ts'
import { ATLAS_PATH, COVER_PATH, SELECT_PATH, atlasPath, navigate } from '../router.ts'
import type { AtlasRow } from '../components/AtlasList.tsx'
import AtlasList from '../components/AtlasList.tsx'
import AtlasNav from '../components/AtlasNav.tsx'
import MunicipalityInfo from '../components/MunicipalityInfo.tsx'
import MunicipalityMap from '../components/MunicipalityMap.tsx'
import RegionPicker from '../components/RegionPicker.tsx'

/** meta.cities の 1 件（段階 2 で町名を混ぜても壊れないよう、必要な 2 列だけを見る） */
interface City {
  lgCode: string
  name: string
  kana: string
}

/** 行の単位。特別区が混じる東京都だけ「市区町村」になる（範囲選択と同じ数え方） */
function unitOf(cities: City[]): string {
  return cities.some((c) => c.name.endsWith('区')) ? '市区町村' : '市町村'
}

/** 漢字でもかなでも部分一致。空の検索語は全件（設計 §12.5。前方一致より「橋」で探せる方が役に立つ） */
function matches(city: City, query: string): boolean {
  return query === '' || city.name.includes(query) || city.kana.includes(query)
}

interface Props {
  /** 2 桁の都道府県か 3 文字の地域。入口では undefined */
  scope?: string
  /** 選択中の行（6 桁）。一覧では undefined */
  lgCode?: string
}

export default function Atlas({ scope, lgCode }: Props) {
  const [meta, setMeta] = useState<BankMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 入口の地図。読めなくても RegionPicker がボタングリッドで成立させる */
  const [japan, setJapan] = useState<PrefectureCollection | null>(null)
  const [mapLoading, setMapLoading] = useState(true)
  /** 検索語。画面（親）が持つので、詳細へ行って戻っても消えない（設計 §12.3） */
  const [query, setQuery] = useState('')
  /**
   * 最後に開いた行。375 で詳細から一覧へ戻ったとき（URL から lgCode が消える）でも
   * 「どの行を見ていたか」を蛍光黄と `aria-current` で残すために持つ。範囲を替えたら忘れる。
   *
   * 更新は「props が変わったら描画中に state を直す」型（effect を挟まない）。
   * 条件付きなので余分な再描画は URL が変わった回だけで、ループにはならない
   */
  const [mark, setMark] = useState<{ scope: string; lgCode: string } | null>(null)
  if (scope !== undefined && lgCode !== undefined && (mark?.scope !== scope || mark.lgCode !== lgCode)) {
    setMark({ scope, lgCode })
  }

  const wide = useMediaQuery(WIDE_QUERY)

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

  // 入口の日本地図（public/geo/japan.json）
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

  // 統計（municipalities.json 328KB）は一覧を開いた時点で先読みする。
  // 最初の行を選んだ瞬間にカードが出るように（読めなければカードがプレースホルダーになるだけ）
  useEffect(() => {
    if (scope === undefined) return
    void defaultGeoSource().stats()
  }, [scope])

  const prefCode = scope?.slice(0, 2)
  const prefName = useMemo(
    () => (prefCode === undefined ? undefined : meta?.prefectures.find((p) => p.code === prefCode)?.name),
    [meta, prefCode],
  )
  const subregions = useMemo(() => (prefCode === undefined ? [] : subregionsOf(prefCode)), [prefCode])

  /** その範囲の市区町村（団体コード昇順 ＝ 県内で 市 → 郡ごとの町村 の順になる） */
  const cities = useMemo<City[]>(() => {
    if (!meta || scope === undefined) return []
    const sub = scope.length === 3 ? subregionById(scope) : undefined
    return meta.cities
      .filter((c) => c.prefCode === prefCode && (!sub || subregionOf(c.lgCode)?.id === sub.id))
      .map((c) => ({ lgCode: c.lgCode, name: c.name, kana: c.kana }))
      .sort((a, b) => (a.lgCode < b.lgCode ? -1 : 1))
  }, [meta, scope, prefCode])

  const shown = useMemo(() => cities.filter((c) => matches(c, query.trim())), [cities, query])

  // 不正な URL は素直に落とす（設計 §12.4。網羅的な検証はしない）
  useEffect(() => {
    if (!meta || scope === undefined) return
    const known = scope.length === 2 ? meta.prefectures.some((p) => p.code === scope) : isSubregionScope(scope)
    if (!known) {
      navigate(ATLAS_PATH)
      return
    }
    if (lgCode !== undefined && !cities.some((c) => c.lgCode === lgCode)) navigate(atlasPath(scope))
  }, [meta, scope, lgCode, cities])

  /** 一覧で目印を付ける行。URL の行、無ければ最後に開いた行 */
  const markedLgCode = lgCode ?? (mark !== null && mark.scope === scope ? mark.lgCode : undefined)

  // 詳細から一覧へ戻ったとき、見ていた行を画面の中に入れる
  useEffect(() => {
    if (markedLgCode === undefined) return
    const el = document.querySelector<HTMLElement>('.atlas [aria-current="true"]')
    // jsdom には scrollIntoView が無い
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [markedLgCode, shown, wide])

  /**
   * 「前／次」がたどる並び。原則は **表示中の並び**（検索で絞っていればその順）だが、
   * 検索語を変えて選択中の行が消えた場合だけ、範囲の全件に戻す（めくれなくなるのを避ける）
   */
  const navRows = lgCode !== undefined && !shown.some((c) => c.lgCode === lgCode) ? cities : shown
  const navIndex = lgCode === undefined ? -1 : navRows.findIndex((c) => c.lgCode === lgCode)
  const selected = navIndex < 0 ? undefined : navRows[navIndex]

  const rangeName = scopeLabel(scope, () => prefName)
  const headerNote =
    query.trim() !== '' ? `${shown.length} 件` : `${rangeName} ／ ${cities.length} ${unitOf(cities)}`

  const changePref = (code: string) => {
    // 都道府県を替えたら地域は「全域」に戻り、検索も空にする（設計 §12.4）
    setQuery('')
    navigate(atlasPath(code))
  }

  if (error) {
    return (
      <div className="paper">
        <h1 className="paper__title">地名帳</h1>
        <p>市区町村の一覧を読み込めませんでした。</p>
        <p>{error}</p>
        <p>
          <a className="btn btn--ghost" href={COVER_PATH}>
            タイトルへ戻る
          </a>
        </p>
      </div>
    )
  }

  if (!meta) {
    return (
      <div className="paper">
        <h1 className="paper__title">地名帳</h1>
        <p>読み込み中…</p>
      </div>
    )
  }

  // ---------------------------------------------------------------- 入口
  if (scope === undefined) {
    return (
      <div className="paper">
        <div className="paper__header">
          <h1 className="paper__title">地名帳</h1>
          <p className="paper__subtitle">都道府県を選ぶと市区町村の一覧が出ます</p>
        </div>

        {/* 範囲選択と同じ 2 段階。全国は出さない（1,741 行を 1 枚に並べる画面ではない） */}
        <RegionPicker
          collection={japan}
          prefectures={meta.prefectures.map((p) => ({ code: p.code, name: p.name }))}
          loading={mapLoading}
          onSelect={(code) => navigate(atlasPath(code))}
        />

        <p>
          <a className="btn btn--ghost" href={SELECT_PATH}>
            範囲・科目へ
          </a>
          <a className="btn btn--ghost" href={COVER_PATH}>
            タイトルへ戻る
          </a>
        </p>
      </div>
    )
  }

  const rows: AtlasRow[] = shown.map((c) => ({
    key: c.lgCode,
    name: c.name,
    kana: c.kana,
    href: atlasPath(scope, c.lgCode),
    selected: c.lgCode === markedLgCode,
  }))

  const nav = (
    <AtlasNav
      // 900px 以上は一覧が隣にあるので「← 一覧へ」は出さない（設計 §12.2 の線画）
      listHref={wide ? undefined : atlasPath(scope)}
      prev={
        navIndex > 0 ?
          { href: atlasPath(scope, navRows[navIndex - 1].lgCode), name: navRows[navIndex - 1].name }
        : undefined
      }
      next={
        navIndex >= 0 && navIndex < navRows.length - 1 ?
          { href: atlasPath(scope, navRows[navIndex + 1].lgCode), name: navRows[navIndex + 1].name }
        : undefined
      }
      index={navIndex < 0 ? undefined : navIndex + 1}
      total={navRows.length}
    />
  )

  // 地図とカード。行を選ぶ前は塗りなしの県の形＋プレースホルダーのカード
  const detail = (
    <>
      <MunicipalityMap prefCode={prefCode ?? ''} lgCode={lgCode} prefName={prefName} />
      {/* lgCode が無いときは引ける統計も無い（空文字でカードがプレースホルダーになる） */}
      <MunicipalityInfo
        lgCode={lgCode ?? ''}
        revealed
        reading={selected?.kana}
        placeholder="行を選ぶと出ます"
      />
      {nav}
    </>
  )

  const list = (
    <div className="paper">
      <div className="paper__header">
        <h1 className="paper__title">地名帳</h1>
        {/* 検索で絞ると件数が変わるので読み上げに知らせる */}
        <p className="paper__subtitle" aria-live="polite">
          {headerNote}
        </p>
      </div>

      <label className="field">
        <span className="field__label">都道府県</span>
        <select
          className="field__input"
          value={prefCode ?? ''}
          onChange={(e) => changePref(e.target.value)}
          aria-label="都道府県をえらぶ"
        >
          {meta.prefectures.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      {/* 地域（北海道 4・東京都 3）。1 つ目は都道府県まるごと（「全道」「全域」） */}
      {subregions.length > 0 && prefCode !== undefined && (
        <div className="mode-switch mode-switch--compact" role="group" aria-label="地域">
          <button
            type="button"
            className={scope.length === 2 ? 'mode-switch__item is-selected' : 'mode-switch__item'}
            aria-pressed={scope.length === 2}
            aria-label={`地域: ${wholePrefLabel(prefCode) ?? '全域'}`}
            onClick={() => navigate(atlasPath(prefCode))}
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
              onClick={() => navigate(atlasPath(sub.id))}
            >
              {sub.name}
            </button>
          ))}
        </div>
      )}

      <label className="field">
        <span className="field__label">検索</span>
        <input
          className="field__input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="漢字でもかなでも"
          aria-label="市区町村名・よみで絞り込む"
        />
      </label>

      {rows.length === 0 ?
        <p>
          見つかりません。
          <button type="button" className="btn btn--ghost" onClick={() => setQuery('')}>
            検索を消す
          </button>
        </p>
      : <AtlasList rows={rows} label={`${rangeName}の市区町村`} />}

      <p>
        <a className="btn btn--ghost" href={SELECT_PATH}>
          範囲・科目へ
        </a>
        <a className="btn btn--ghost" href={COVER_PATH}>
          タイトルへ戻る
        </a>
      </p>
    </div>
  )

  // ------------------------------------------------- 900px 以上: 一覧と詳細を並べる
  if (wide) {
    return (
      <div className="layout">
        <aside className="layout__map">{detail}</aside>
        <div className="layout__quiz">{list}</div>
      </div>
    )
  }

  // ------------------------------------------------- 899px 以下: どちらか 1 つ
  if (lgCode === undefined) return list

  return (
    <div className="paper">
      <div className="paper__header">
        <h1 className="paper__title">{selected?.name ?? '地名帳'}</h1>
        <p className="paper__subtitle">{selected?.kana ?? ''}</p>
      </div>
      {/* 出題画面と違い、用紙 1 枚をこの 2 つに使えるのでカードは通常フロー（map.css の .atlas-detail） */}
      <div className="atlas-detail">{detail}</div>
    </div>
  )
}
