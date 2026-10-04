// @vitest-environment jsdom
/**
 * 地名帳（#/atlas）の画面フロー。jsdom は `matchMedia` を「どのクエリも不一致」として扱うので、
 * useMediaQuery は常に false ＝ **899px 以下（一覧と詳細の 2 画面）**の経路を通る。
 * 900px 以上の 2 カラムは CDP の実測で確かめる（設計 §12.9）。
 *
 * 地図データ（public/geo/）は用意しないので、地図は 1 行の注記にとどまりカードは
 * プレースホルダーになる。一覧・検索・行の選択・前後の移動はそれでも成立する。
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { BankMeta, Question, Stars } from '../engine/types.ts'
import { DATA_VERSION } from '../engine/bank.ts'
import { resetGeoSource } from '../geo/load.ts'
import { resetNavigated } from '../router.ts'
import App from '../App.tsx'

/**
 * 東京都 23区 3 件 ＋ 多摩 1 件、千葉県 2 件。
 * 23区の 3 件は **団体コード順と五十音順がずれる**ように選んだ（並びが団体コード順であることの確認）。
 * 千葉県の 2 件は、都道府県を替えたときに一覧が入れ替わることの確認用
 */
const CITIES = [
  { lgCode: '131199', prefCode: '13', name: '板橋区', kana: 'いたばしく' },
  { lgCode: '131016', prefCode: '13', name: '千代田区', kana: 'ちよだく' },
  { lgCode: '131202', prefCode: '13', name: '練馬区', kana: 'ねりまく' },
  { lgCode: '132012', prefCode: '13', name: '八王子市', kana: 'はちおうじし' },
  { lgCode: '122041', prefCode: '12', name: '船橋市', kana: 'ふなばしし' },
  { lgCode: '122106', prefCode: '12', name: '匝瑳市', kana: 'そうさし' },
]

/**
 * 難易度 ★（easy.json の stars）。**八王子市（132012）は意図的に入れない**ので、
 * 「問題バンクに無い市区町村（実データの さいたま・ニセコ など 41 件）は ★ を持たず、
 * ★ で絞ると出ない」経路が通る
 */
const STARS: Record<string, Stars> = {
  '131199': 3, // 板橋区
  '131016': 1, // 千代田区
  '131202': 2, // 練馬区
  '122041': 3, // 船橋市
  '122106': 3, // 匝瑳市
}

/** 画面は lgCode と stars しか見ないので、問題バンクの形だけ整えた最小の easy.json */
const EASY: Question[] = Object.entries(STARS).map(([lgCode, stars]) => {
  const city = CITIES.find((c) => c.lgCode === lgCode)
  if (!city) throw new Error(`CITIES に無い lgCode: ${lgCode}`)
  return {
    id: `c:${lgCode}:${city.name}`,
    prefCode: city.prefCode,
    pref: city.prefCode === '13' ? '東京都' : '千葉県',
    lgCode,
    display: city.name.slice(0, -1),
    suffix: city.name.slice(-1),
    answer: city.kana.slice(0, -1),
    stars,
  }
})

const META: BankMeta = {
  dataVersion: DATA_VERSION,
  generatedAt: '2026-09-25T00:00:00.000Z',
  source: 'テスト用フィクスチャ',
  prefectures: [
    { code: '12', name: '千葉県', easyCount: 2, difficultCount: 0 },
    { code: '13', name: '東京都', easyCount: 4, difficultCount: 0 },
  ],
  cities: CITIES,
}

function installFetchMock(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input)
      if (url.endsWith('/meta.json')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(META) })
      }
      if (url.endsWith('/easy.json')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(EASY) })
      }
      // 地図・統計は用意しない（無くても地名帳は成立する）
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('not found')) })
    }),
  )
}

function goto(hash: string): void {
  window.location.hash = hash
}

function hash(): string {
  return window.location.hash
}

/** 保留中の Promise と React の更新を流す */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.atlas__row')]
}

function names(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.atlas__name')].map((el) => el.textContent ?? '')
}

/** 各行の ★（記号のみ。★ を持たない行は空文字） */
function rowStars(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.atlas__stars')].map(
    (el) => el.querySelector('.stars')?.textContent ?? '',
  )
}

function starsButton(label: string): HTMLElement {
  return screen.getByRole('button', { name: label })
}

function subtitle(): string {
  return document.querySelector('.paper__subtitle')?.textContent ?? ''
}

function searchBox(): HTMLInputElement {
  return screen.getByLabelText('市区町村名・よみで絞り込む') as HTMLInputElement
}

/** 一覧が描けるまで待つ */
async function renderAt(path: string): Promise<void> {
  goto(path)
  render(<App />)
  await settle()
}

beforeEach(() => {
  localStorage.clear()
  resetGeoSource()
  resetNavigated()
  installFetchMock()
  goto('#/')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('地名帳の入口', () => {
  it('#/atlas は「地名帳」の見出しと地方 → 都道府県のピッカーを出す（全国は出さない）', async () => {
    await renderAt('#/atlas')

    expect(screen.getByRole('heading', { name: '地名帳' })).toBeInTheDocument()
    expect(subtitle()).toBe('都道府県を選ぶと市区町村の一覧が出ます')
    // RegionPicker は地図（public/geo/japan.json）が読めなければボタングリッドだけで成立する
    expect(screen.getByRole('button', { name: /東京都/ })).toBeInTheDocument()
    // 地名帳に「全国」は無い（入口で都道府県を選ばせる）
    expect(screen.queryByRole('button', { name: '全国' })).toBeNull()
  })

  it('表紙の副ボタンから #/atlas へ行ける', async () => {
    await renderAt('#/')
    const link = screen.getByRole('link', { name: '地名帳' })
    expect(link).toHaveAttribute('href', '#/atlas')

    // jsdom は <a href="#..."> のクリックでハッシュを動かさないので、同じ遷移をルータ経由で起こす
    goto(link.getAttribute('href') as string)
    await settle()
    expect(screen.getByRole('heading', { name: '地名帳' })).toBeInTheDocument()
  })
})

describe('地名帳の一覧', () => {
  it('地域 scope（#/atlas/13k）は 23区だけを団体コード順に並べ、件数を見出しに出す', async () => {
    await renderAt('#/atlas/13k')

    expect(subtitle()).toBe('東京都・23区 ／ 3 市区町村')
    // 五十音順なら 板橋 → 千代田 → 練馬 にならない。団体コード順＝千代田(131016) → 板橋(131199) → 練馬(131202)
    expect(names()).toEqual(['千代田区', '板橋区', '練馬区'])
    expect(document.querySelector('.atlas__kana')?.textContent).toBe('ちよだく')
    // 多摩の八王子市は 23区の一覧に出ない
    expect(screen.queryByText('八王子市')).toBeNull()
  })

  it('都道府県 scope（#/atlas/13）は地域の切替を出し、押すとその地域の URL へ移る', async () => {
    await renderAt('#/atlas/13')

    expect(subtitle()).toBe('東京都 ／ 4 市区町村')
    const whole = screen.getByRole('button', { name: '地域: 全域' })
    expect(whole).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '地域: 多摩' }))
    await settle()
    expect(hash()).toBe('#/atlas/13t')
    expect(names()).toEqual(['八王子市'])
  })

  it('地域を持たない都道府県（千葉県）では地域の切替を出さない', async () => {
    await renderAt('#/atlas/12')

    expect(subtitle()).toBe('千葉県 ／ 2 市町村')
    expect(screen.queryByRole('group', { name: '地域' })).toBeNull()
  })

  it('都道府県の <select> を変えると一覧が入れ替わる', async () => {
    await renderAt('#/atlas/13k')

    fireEvent.change(screen.getByLabelText('都道府県をえらぶ'), { target: { value: '12' } })
    await settle()
    expect(hash()).toBe('#/atlas/12')
    expect(names()).toEqual(['船橋市', '匝瑳市'])
  })

  it('行は #/atlas/{scope}/{lgCode} のリンク', async () => {
    await renderAt('#/atlas/13k')

    expect(screen.getByRole('link', { name: /板橋区/ })).toHaveAttribute('href', '#/atlas/13k/131199')
  })
})

describe('地名帳の検索', () => {
  it('漢字・かなの部分一致で絞れ、見出しの件数が表示中の行数と一致する', async () => {
    await renderAt('#/atlas/13')

    // 漢字の部分一致。前方一致では当たらない「橋」で板橋区が出る（設計 §12.5）
    fireEvent.change(searchBox(), { target: { value: '橋' } })
    await settle()
    expect(names()).toEqual(['板橋区'])
    expect(subtitle()).toBe('1 件')

    // かなの部分一致。読みの途中でも当たる（いた「ばし」く）
    fireEvent.change(searchBox(), { target: { value: 'ばし' } })
    await settle()
    expect(names()).toEqual(['板橋区'])

    fireEvent.change(searchBox(), { target: { value: '区' } })
    await settle()
    expect(names()).toEqual(['千代田区', '板橋区', '練馬区'])
    expect(subtitle()).toBe('3 件')
  })

  it('件数の表示は読み上げに知らせる（aria-live）', async () => {
    await renderAt('#/atlas/13')
    expect(document.querySelector('.paper__subtitle')).toHaveAttribute('aria-live', 'polite')
  })

  it('0 件なら「見つかりません」と消去ボタンを出す', async () => {
    await renderAt('#/atlas/13')

    fireEvent.change(searchBox(), { target: { value: 'ありえない' } })
    await settle()
    expect(screen.getByText(/見つかりません/)).toBeInTheDocument()
    expect(document.querySelector('.atlas')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '絞り込みを消す' }))
    await settle()
    expect(names()).toEqual(['千代田区', '板橋区', '練馬区', '八王子市'])
  })

  it('都道府県を替えると検索は空に戻る', async () => {
    await renderAt('#/atlas/13')

    fireEvent.change(searchBox(), { target: { value: '区' } })
    await settle()
    fireEvent.change(screen.getByLabelText('都道府県をえらぶ'), { target: { value: '12' } })
    await settle()

    expect(searchBox().value).toBe('')
    expect(names()).toEqual(['船橋市', '匝瑳市'])
  })
})

describe('地名帳の難易度 ★', () => {
  it('各行のよみの右に ★ を出す。記号は読み上げから外し、言い換えを添える', async () => {
    await renderAt('#/atlas/13')

    // 千代田区 ★1 / 板橋区 ★3 / 練馬区 ★2 / 八王子市 は easy.json に無いので ★ なし
    expect(rowStars()).toEqual(['★', '★★★', '★★', ''])
    const mark = document.querySelector('.atlas__stars .stars')
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    expect(document.querySelector('.atlas__stars .sr-only')?.textContent).toBe('難易度 1')
  })

  it('★ で絞ると行数が減り、見出しに ★ が添わる', async () => {
    await renderAt('#/atlas/13')
    expect(subtitle()).toBe('東京都 ／ 4 市区町村')

    fireEvent.click(starsButton('難易度: ★3'))
    await settle()
    expect(names()).toEqual(['板橋区'])
    // 単位は範囲の全件から決めるので「市区町村」のまま
    expect(subtitle()).toBe('東京都 ／ ★★★ 1 市区町村')

    fireEvent.click(starsButton('難易度: 全部'))
    await settle()
    expect(names()).toEqual(['千代田区', '板橋区', '練馬区', '八王子市'])
    expect(subtitle()).toBe('東京都 ／ 4 市区町村')
  })

  it('★ を選んでいる間は、問題バンクに無い市区町村（★ なし）が出ない', async () => {
    await renderAt('#/atlas/13')

    for (const label of ['難易度: ★1', '難易度: ★2', '難易度: ★3']) {
      fireEvent.click(starsButton(label))
      await settle()
      expect(names()).not.toContain('八王子市')
    }
    // 「全部」なら出る
    fireEvent.click(starsButton('難易度: 全部'))
    await settle()
    expect(names()).toContain('八王子市')
  })

  it('★ と検索は両方効く', async () => {
    await renderAt('#/atlas/13')

    fireEvent.change(searchBox(), { target: { value: '区' } })
    await settle()
    expect(names()).toEqual(['千代田区', '板橋区', '練馬区'])

    fireEvent.click(starsButton('難易度: ★3'))
    await settle()
    expect(names()).toEqual(['板橋区'])
    // 検索中の見出しは今までどおり件数だけ
    expect(subtitle()).toBe('1 件')
  })

  it('0 件なら検索語と ★ の両方を戻すボタンを出す', async () => {
    await renderAt('#/atlas/13')

    fireEvent.click(starsButton('難易度: ★1'))
    await settle()
    fireEvent.change(searchBox(), { target: { value: '練馬' } })
    await settle()
    // 練馬区は ★2 なので ★1 では当たらない
    expect(screen.getByText(/見つかりません/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '絞り込みを消す' }))
    await settle()
    expect(searchBox().value).toBe('')
    expect(starsButton('難易度: 全部')).toHaveAttribute('aria-pressed', 'true')
    expect(names()).toEqual(['千代田区', '板橋区', '練馬区', '八王子市'])
  })

  it('都道府県を替えても ★ は保つ（検索語は空に戻る）', async () => {
    await renderAt('#/atlas/13')

    fireEvent.click(starsButton('難易度: ★3'))
    await settle()
    fireEvent.change(searchBox(), { target: { value: '橋' } })
    await settle()

    fireEvent.change(screen.getByLabelText('都道府県をえらぶ'), { target: { value: '12' } })
    await settle()
    expect(searchBox().value).toBe('')
    expect(starsButton('難易度: ★3')).toHaveAttribute('aria-pressed', 'true')
    expect(names()).toEqual(['船橋市', '匝瑳市'])
  })

  it('★ は詳細へ行って戻っても消えない。前／次は絞った並びをたどる', async () => {
    await renderAt('#/atlas/12')

    fireEvent.click(starsButton('難易度: ★3'))
    await settle()
    expect(names()).toEqual(['船橋市', '匝瑳市'])

    goto('#/atlas/12/122106')
    await settle()
    // 絞った 2 件のうち 2 件目。次は無く、前は船橋市
    expect(document.querySelector('.atlas-nav__count')?.textContent).toBe('2 / 2')
    expect(screen.getByRole('link', { name: '前: 船橋市' })).toHaveAttribute('href', '#/atlas/12/122041')
    expect(screen.queryByRole('link', { name: /^次: / })).toBeNull()

    goto('#/atlas/12')
    await settle()
    expect(starsButton('難易度: ★3')).toHaveAttribute('aria-pressed', 'true')
    expect(names()).toEqual(['船橋市', '匝瑳市'])
  })

  it('375 の詳細では副題のよみの右に ★ を出す（記号は読ませない）', async () => {
    await renderAt('#/atlas/13k/131199')

    const mark = document.querySelector('.paper__subtitle .stars')
    expect(mark?.textContent).toBe('★★★')
    expect(mark).toHaveAttribute('role', 'img')
    expect(mark).toHaveAttribute('aria-label', '難易度 3')
  })
})

describe('地名帳の詳細（899px 以下）', () => {
  it('#/atlas/13k/131199 を直接開くと名前・よみ・地図・カードと前後の移動が出る', async () => {
    await renderAt('#/atlas/13k/131199')

    expect(screen.getByRole('heading', { name: '板橋区' })).toBeInTheDocument()
    // 副題はよみ ＋ 難易度（板橋区は ★3）
    expect(subtitle()).toBe('いたばしく★★★')
    // 一覧は出さない（375 は一覧か詳細のどちらか）
    expect(document.querySelector('.atlas')).toBeNull()
    expect(document.querySelector('.atlas-detail')).not.toBeNull()
    // 地図とカードの枠は（データが読めなくても）置かれる
    expect(document.querySelector('.map-muni')).not.toBeNull()
    await waitFor(() => {
      expect(document.querySelector('.info-card')).not.toBeNull()
    })

    // 23区の 2 件目なので 2 / 3。前は千代田区、次は練馬区
    expect(document.querySelector('.atlas-nav__count')?.textContent).toBe('2 / 3')
    expect(screen.getByRole('link', { name: '前: 千代田区' })).toHaveAttribute('href', '#/atlas/13k/131016')
    expect(screen.getByRole('link', { name: '次: 練馬区' })).toHaveAttribute('href', '#/atlas/13k/131202')
    expect(screen.getByRole('link', { name: '一覧へ' })).toHaveAttribute('href', '#/atlas/13k')
  })

  it('最初の行では「前」、最後の行では「次」が押せない', async () => {
    await renderAt('#/atlas/13k/131016')
    expect(screen.queryByRole('link', { name: /^前: / })).toBeNull()
    expect(document.querySelectorAll('.atlas-nav__step--end')).toHaveLength(1)

    cleanup()
    await renderAt('#/atlas/13k/131202')
    expect(screen.queryByRole('link', { name: /^次: / })).toBeNull()
  })

  it('「← 一覧へ」で戻ると、見ていた行に aria-current が付いて選択中だと分かる', async () => {
    await renderAt('#/atlas/13k/131199')

    const back = screen.getByRole('link', { name: '一覧へ' })
    goto(back.getAttribute('href') as string)
    await settle()

    expect(hash()).toBe('#/atlas/13k')
    const selected = rows().filter((r) => r.className.includes('is-selected'))
    expect(selected).toHaveLength(1)
    expect(selected[0].textContent).toContain('板橋区')
    expect(selected[0].querySelector('a')).toHaveAttribute('aria-current', 'true')
    // 色だけに頼らない目印
    expect(selected[0].querySelector('.atlas__mark')?.textContent).toBe('▶')
    expect(screen.getByRole('link', { name: /板橋区/ })).toHaveAttribute('aria-current', 'true')
  })

  it('検索した文字列は詳細へ行って戻っても消えない', async () => {
    await renderAt('#/atlas/13')

    fireEvent.change(searchBox(), { target: { value: '区' } })
    await settle()

    goto('#/atlas/13/131199')
    await settle()
    expect(screen.getByRole('heading', { name: '板橋区' })).toBeInTheDocument()

    goto('#/atlas/13')
    await settle()
    expect(searchBox().value).toBe('区')
    expect(names()).toEqual(['千代田区', '板橋区', '練馬区'])
  })

  it('前後の移動は表示中の並びをたどる（検索で絞ればその中だけ）', async () => {
    await renderAt('#/atlas/13')

    fireEvent.change(searchBox(), { target: { value: 'く' } })
    await settle()
    // よみが「…く」の 3 区だけ。八王子市（はちおうじし）は外れる
    expect(names()).toEqual(['千代田区', '板橋区', '練馬区'])

    goto('#/atlas/13/131202')
    await settle()
    expect(document.querySelector('.atlas-nav__count')?.textContent).toBe('3 / 3')
    expect(screen.queryByRole('link', { name: /^次: / })).toBeNull()
  })
})

describe('地名帳の不正な URL', () => {
  it('存在しない都道府県・地域は #/atlas へ落とす', async () => {
    await renderAt('#/atlas/99')
    await waitFor(() => {
      expect(hash()).toBe('#/atlas')
    })

    cleanup()
    await renderAt('#/atlas/13z')
    await waitFor(() => {
      expect(hash()).toBe('#/atlas')
    })
  })

  it('その範囲に無い lgCode は一覧へ落とす', async () => {
    await renderAt('#/atlas/13k/999999')
    await waitFor(() => {
      expect(hash()).toBe('#/atlas/13k')
    })

    cleanup()
    // 多摩の八王子市は 23区の範囲外
    await renderAt('#/atlas/13k/132012')
    await waitFor(() => {
      expect(hash()).toBe('#/atlas/13k')
    })
  })
})
