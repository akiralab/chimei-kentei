// @vitest-environment jsdom
/**
 * 画面フローの統合テスト（jsdom）。表紙 → 範囲・科目 → 出題 → 結果 を通す。
 * 実ブラウザが無いので、これがデモの「動く」証明になる。
 *
 * - 問題バンクは fetch をモックしてフィクスチャ（src/engine/__fixtures__）を返す
 * - localStorage / sessionStorage は jsdom のものを使い、テストごとに clear()
 * - タイマーは vi.useFakeTimers() ＋ act() で進める
 */
import '@testing-library/jest-dom/vitest'
import { StrictMode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BankMeta, Question, QuestionSet } from './engine/types.ts'
import { QUESTIONS_PER_SET, TIME_LIMIT_MS } from './engine/types.ts'
import type { BankSource } from './engine/bank.ts'
import { DATA_VERSION, buildQuestionSet } from './engine/bank.ts'
import { cityRow, cityRowOf, makeDifficult, makeEasy, starsTriple, withStars } from './engine/__fixtures__/questions.ts'
import { answerSheetKey } from './hooks/answerSheet.ts'
import { NICKNAME_KEY } from './hooks/useNickname.ts'
import { NO_TIME_LIMIT, TIME_LIMIT_KEY } from './hooks/useTimeLimit.ts'
import { readWrongList } from './engine/wrongList.ts'
import { quizPath, resetNavigated, resultPath } from './router.ts'
import App from './App.tsx'

/** Quiz.tsx の ○× を見せる時間。同値を保つ */
const FEEDBACK_MS = 1000

// ---------------------------------------------------------------- フィクスチャ

/**
 * フィクスチャの読みは連番入りなので `し1` のように算用数字を含む（makeEasy / makeDifficult）。
 * 解答欄（HiraganaInput）には仕様どおり「ひらがな＋ー」しか入らないため、数字のままでは
 * どう打っても一致しない。実データ（ABR の読み）は必ずひらがななので、
 * フィクスチャ側を実データに寄せて数字をかな読みへ置き換える（`し1` → `しいち`）。
 * 桁ごとの置換なので連番の一意性は保たれる。
 */
const KANA_DIGITS = ['ぜろ', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう']

function kanaizeAnswers(questions: Question[]): Question[] {
  return questions.map((q) => ({ ...q, answer: q.answer.replace(/\d/g, (d) => KANA_DIGITS[Number(d)]) }))
}

/**
 * 地域（北海道 4・東京都 3）の判定は団体コードの先頭 5 桁で行う（src/geo/subregions.ts）ので、
 * 北海道・東京都のフィクスチャは makeEasy の連番コードではなく **実在コード**に差し替える。
 * 千葉県は地域を持たないので連番のままでよい
 */
function withLgCodes(questions: Question[], lgCodes: string[]): Question[] {
  if (questions.length !== lgCodes.length) throw new Error('lgCode の数が合いません')
  return questions.map((q, i) => ({ ...q, lgCode: lgCodes[i], id: `c:${lgCodes[i]}:${q.display}` }))
}

/**
 * 千葉県は easy 15 件・大字 30 件、東京都・北海道は easy 14 件。どれも 10 問に足りる。
 *
 * 千葉県の難易度は ★3 を 11・★2 を 3・★1 を 1 に振る（makeEasy の既定は 1→2→3 の循環）。
 * ★3 だけ 10 問を組めるので「★3 は 10 問・★2 と ★1 は全市区町村名に固定」の両方を 1 県で通せる
 */
const EASY_12 = withStars(kanaizeAnswers(makeEasy('12', '千葉県', 15)), [
  3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 1,
])
// 道央 12（札幌・小樽・室蘭…）＋ 道南 2（函館・北斗）。道央だけで 10 問に足りる
const EASY_01 = withLgCodes(kanaizeAnswers(makeEasy('01', '北海道', 14)), [
  '011002', '012033', '012050', '012092', '012106', '012131',
  '012157', '012165', '012173', '012181', '012220', '012246',
  '012025', '012360',
])
// 島しょ 9（大島〜小笠原の全 9 町村）＋ 23区 3 ＋ 多摩 2。島しょは 9 件なので 10 問を組めない
const EASY_13 = withLgCodes(kanaizeAnswers(makeEasy('13', '東京都', 14)), [
  '133612', '133621', '133639', '133647', '133817', '133825', '134015', '134023', '134210',
  '131016', '131024', '131032',
  '132012', '132021',
])
const EASY_ALL: Question[] = [...EASY_12, ...EASY_13, ...EASY_01]
const DIFFICULT_12 = kanaizeAnswers(makeDifficult('12', '千葉県', 1, 30))
const DIFFICULT_13 = kanaizeAnswers(makeDifficult('13', '東京都', 1, 30))
const DIFFICULT_ALL: Question[] = [...DIFFICULT_12, ...DIFFICULT_13]

const META: BankMeta = {
  dataVersion: DATA_VERSION,
  generatedAt: '2026-09-25T00:00:00.000Z',
  source: 'テスト用フィクスチャ',
  prefectures: [
    { code: '01', name: '北海道', easyCount: EASY_01.length, difficultCount: 0, difficultStars: [0, 0, 0] },
    {
      code: '12',
      name: '千葉県',
      easyCount: EASY_12.length,
      difficultCount: DIFFICULT_12.length,
      difficultStars: starsTriple(DIFFICULT_12),
    },
    {
      code: '13',
      name: '東京都',
      easyCount: EASY_13.length,
      difficultCount: DIFFICULT_13.length,
      difficultStars: starsTriple(DIFFICULT_13),
    },
  ],
  cities: [
    ...EASY_ALL.map((q) => cityRowOf(q, DIFFICULT_ALL)),
    // 問題バンクが除いた市区町村（実データの さいたま・ニセコ・むかわ の代わり）。
    // 市区町村の数には入るが、問題にはならない ＝ 全市区町村名でも出題されない
    cityRow({ lgCode: '129901', prefCode: '12', name: 'さいたま市', kana: 'さいたまし' }),
  ],
}

/** 画面側は fetch 経由で読むので、同じ中身を直接返す BankSource も用意して期待値を組み立てる */
const FIXTURE_SOURCE: BankSource = {
  async meta() {
    return META
  },
  async easy() {
    return EASY_ALL
  },
  async difficult(prefCode: string) {
    if (prefCode === '12') return DIFFICULT_12
    if (prefCode === '13') return DIFFICULT_13
    return []
  },
}

function bankBody(url: string): unknown | undefined {
  if (url.endsWith('/meta.json')) return META
  if (url.endsWith('/easy.json')) return EASY_ALL
  const m = /\/difficult\/(\d{2})\.json$/.exec(url)
  // 12・13 以外の都道府県は用意していない → 404 として扱う（読み込み失敗の経路を通すため）
  if (m) return m[1] === '12' ? DIFFICULT_12 : m[1] === '13' ? DIFFICULT_13 : undefined
  return undefined
}

function installFetchMock(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input)
      const body = bankBody(url)
      if (body === undefined) {
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('not found')) })
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
    }),
  )
}

// ------------------------------------------------------------------ ヘルパー

/** fake timers のまま、保留中の Promise と React の更新を流す */
async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function goto(hash: string): void {
  window.location.hash = hash
}

function hash(): string {
  return window.location.hash
}

function el(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector)
  if (!found) throw new Error(`見つかりません: ${selector}`)
  return found
}

function all(selector: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(selector)]
}

function answerInput(): HTMLInputElement {
  return screen.getByLabelText('読みをひらがなで入力') as HTMLInputElement
}

/** 間違えたあとに出る「次へ」（最後の問なら「結果を見る」）。正解のあとは出ない */
function nextButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: /^(次へ|結果を見る)$/ })
}

/**
 * 1 問解答する。value が null なら 20 秒放置して自動パスさせる。
 * ○ は 1 秒で自動的に次へ進むが、× とパスは「次へ」を押すまで止まるので、出ていれば押す
 */
async function answerOne(value: string | null): Promise<void> {
  if (value === null) {
    await settle(TIME_LIMIT_MS)
  } else {
    const input = answerInput()
    fireEvent.change(input, { target: { value } })
    fireEvent.keyDown(input, { key: 'Enter' })
  }
  await settle(FEEDBACK_MS)
  const next = nextButton()
  if (next) {
    fireEvent.click(next)
    await settle()
  }
}

/** main.tsx と同じ条件（StrictMode）で描画する */
function renderApp(): void {
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

/** 出題画面を開いて問題セットが載るまで待つ */
async function openQuiz(setId: string): Promise<void> {
  goto(quizPath(setId))
  renderApp()
  await settle()
}

const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())

const SET_ID = `${DATA_VERSION}-e-12-1234`
/** 全市区町村名（千葉県）。フィクスチャの千葉県は meta.cities が 15 件なので 15 問 */
const SET_ALL = `${DATA_VERSION}-e-12-0417-all`
let EXPECTED: QuestionSet
let EXPECTED_ALL: QuestionSet

beforeAll(async () => {
  EXPECTED = await buildQuestionSet('e', '12', '1234', FIXTURE_SOURCE)
  EXPECTED_ALL = await buildQuestionSet('e', '12', '0417', FIXTURE_SOURCE, true)
})

beforeEach(() => {
  vi.useFakeTimers()
  installFetchMock()
  // userEvent.setup() が navigator.clipboard を差し替えるので、毎回こちらで上書きし直す
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  writeText.mockClear()
  localStorage.clear()
  sessionStorage.clear()
  // 既定は「制限なし」だが、この通しテストの多くは 20 秒制限の挙動を見ている。
  // 制限なしの経路は「時間制限」describe で個別に確かめる
  localStorage.setItem(TIME_LIMIT_KEY, String(TIME_LIMIT_MS))
  goto('#/')
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// -------------------------------------------------------------------- 1. 表紙

describe('表紙', () => {
  // 実キー入力を通したいので、この 1 本だけ本物のタイマーで動かす（user-event は fake timers と相性が悪い）
  it('氏名を入れて「はじめる」で #/select へ進み、氏名が localStorage に残る', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    renderApp()

    await user.type(screen.getByRole('textbox'), 'たろう')
    await user.click(screen.getByRole('button', { name: 'はじめる' }))
    await waitFor(() => {
      expect(hash()).toBe('#/select')
    })

    expect(localStorage.getItem(NICKNAME_KEY)).toBe('たろう')
  })

  it('maxLength により 13 文字目は打ち込めない', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    renderApp()

    const input = screen.getByRole('textbox') as HTMLInputElement
    await user.type(input, 'あいうえおかきくけこさしす')

    expect(input.value).toBe('あいうえおかきくけこさし')
    expect(screen.getByRole('button', { name: 'はじめる' })).toBeEnabled()
  })

  it('空欄では進めない', async () => {
    renderApp()
    const start = screen.getByRole('button', { name: 'はじめる' })
    expect(start).toBeDisabled()

    fireEvent.click(start)
    await settle()
    expect(hash()).toBe('#/')
  })

  it('13 文字では進めない', async () => {
    renderApp()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'あいうえおかきくけこさしす' } })
    await settle()

    expect(screen.getByRole('button', { name: 'はじめる' })).toBeDisabled()
  })
})

// ------------------------------------------------------------- 2. 範囲・科目

describe('範囲・科目', () => {
  async function openSelect(): Promise<void> {
    localStorage.setItem(NICKNAME_KEY, 'たろう')
    goto('#/select')
    renderApp()
    await settle()
  }

  it('都道府県を選んで「始める」で #/q/{dataVersion}-e-{prefCode}-{4桁} へ', async () => {
    await openSelect()

    fireEvent.click(screen.getByRole('button', { name: '千葉県' }))
    fireEvent.click(screen.getByRole('button', { name: '始める' }))
    await settle()

    expect(hash()).toMatch(new RegExp(`^#/q/${DATA_VERSION}-e-12-\\d{4}$`))
  })

  // 範囲・科目ごとの日替わりは全員が同じ問題にならないので廃止。日替わりは表紙の「今日の10問（全国）」だけ
  it('「今日の10問」のボタンは置かない', async () => {
    await openSelect()

    expect(screen.queryByRole('button', { name: /^今日の10問/ })).toBeNull()
  })

  it('全国のままでも difficult を押せるが、都道府県を選ぶまで「始める」は無効で案内文が出る', async () => {
    await openSelect()

    // 科目の切替は最初から押せる（押せないと操作が詰まる）。
    // 全国のままでは「始める」が無効になり、ボタンのラベルが案内に変わる（行は増やさない）
    const difficult = screen.getByRole('button', { name: '市区町村名＋町名' })
    expect(difficult).toBeEnabled()
    expect(screen.getByRole('button', { name: '始める' })).toBeEnabled()

    fireEvent.click(difficult)
    expect(screen.queryByRole('button', { name: '始める' })).toBeNull()
    expect(screen.getByRole('button', { name: '都道府県を選ぶと始められます' })).toBeDisabled()
    expect(hash()).toBe('#/select')

    // 都道府県を選べば「始める」に戻って始められる（科目の選択は保たれる）
    fireEvent.click(screen.getByRole('button', { name: '千葉県' }))
    expect(screen.queryByRole('button', { name: '都道府県を選ぶと始められます' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '始める' }))
    await settle()
    expect(hash()).toMatch(new RegExp(`^#/q/${DATA_VERSION}-d-12-\\d{4}$`))
  })

  it('時間制限の既定は「なし」で、出題画面にタイマーが出ない', async () => {
    // beforeEach はタイマー系テストのために 20 秒を入れているので、
    // 「未設定のときの既定」を見るためにここで消してから開く
    localStorage.removeItem(TIME_LIMIT_KEY)
    await openSelect()

    expect(screen.getByRole('button', { name: '時間制限: なし' })).toHaveClass('is-selected')
    // 「時間制限: なし」ボタンとも当たるので、見出し行を名指しで見る
    expect(el('.paper__subtitle').textContent).toContain('制限: なし')

    fireEvent.click(screen.getByRole('button', { name: '千葉県' }))
    fireEvent.click(screen.getByRole('button', { name: '始める' }))
    await settle()

    expect(document.querySelector('.timer')).toBeNull()
    expect(document.querySelector('.timer__label')).toBeNull()
  })

  it('時間制限に「20秒」を選ぶと出題画面にタイマーが出る', async () => {
    await openSelect()

    fireEvent.click(screen.getByRole('button', { name: '時間制限: 20秒' }))
    await settle()
    expect(screen.getByRole('button', { name: '時間制限: 20秒' })).toHaveClass('is-selected')

    fireEvent.click(screen.getByRole('button', { name: '千葉県' }))
    fireEvent.click(screen.getByRole('button', { name: '始める' }))
    await settle()

    expect(document.querySelector('.timer')).not.toBeNull()
    expect(el('.timer__label').textContent).toContain('のこり 20 秒')
  })

  it('都道府県を選べば difficult で始められる', async () => {
    await openSelect()

    fireEvent.click(screen.getByRole('button', { name: '千葉県' }))
    fireEvent.click(screen.getByRole('button', { name: '市区町村名＋町名' }))
    fireEvent.click(screen.getByRole('button', { name: '始める' }))
    await settle()

    expect(hash()).toMatch(new RegExp(`^#/q/${DATA_VERSION}-d-12-\\d{4}$`))
  })

  it('都道府県を選ぶと出題数が出て、全市区町村名（問題バンクの件数）で -all のセットになる', async () => {
    await openSelect()

    // 全国のあいだは「全市区町村名」を選べない（都道府県ごとの出題なので）
    expect(screen.getByRole('button', { name: '問題数: 全市区町村名' })).toBeDisabled()
    expect(document.querySelector('.jp-map__note')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '千葉県' }))
    // 見出し行の余白には **問題数**（easy の 15 件）が出る。市区町村の数（meta.cities の 16 件）
    // ではない — 除外した「さいたま市」は出題しないので、数えても出題数と合わない
    expect(el('.jp-map__note').textContent).toBe('千葉県 15問')
    expect(el('.jp-map__note')).toHaveAttribute('title', '問題数 15 問')
    const allButton = screen.getByRole('button', { name: '問題数: 全市区町村名（15 問）' })
    expect(allButton).toBeEnabled()
    fireEvent.click(allButton)
    expect(allButton).toHaveAttribute('aria-pressed', 'true')
    expect(el('.paper__subtitle').textContent).toContain('問題数: 全 15 問')

    // 町名を含める科目に切り替えると 10 問に戻る（全市区町村名は市区町村名だけの機能）
    fireEvent.click(screen.getByRole('button', { name: '市区町村名＋町名' }))
    expect(screen.getByRole('button', { name: '問題数: 10 問' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '問題数: 全市区町村名（15 問）' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '市区町村名' }))
    fireEvent.click(screen.getByRole('button', { name: '問題数: 全市区町村名（15 問）' }))
    fireEvent.click(screen.getByRole('button', { name: '始める' }))
    await settle()

    expect(hash()).toMatch(new RegExp(`^#/q/${DATA_VERSION}-e-12-\\d{4}-all$`))
    // 10 問を超えるので問番号は算用数字（fake timers なので waitFor ではなく settle で流す）
    await settle()
    expect(el('.q-number__text').textContent).toBe('問1 / 15')
    expect(all('.q-kanji').every((e) => !e.textContent?.includes('さいたま'))).toBe(true)
  })

  // ---- 難易度（★1〜3。Issue #33 / PR #38 の build_stars.py） ----

  it('市区町村名のときだけ難易度の行が出て、町名も に切り替えると消える', async () => {
    await openSelect()

    // 全国のままでも難易度は選べる（★ は市区町村名の問に付いているので範囲に依らない）
    expect(screen.getByRole('group', { name: '難易度' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '難易度: 全部' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '市区町村名＋町名' }))
    expect(screen.queryByRole('group', { name: '難易度' })).toBeNull()
    expect(screen.queryByRole('button', { name: '難易度: ★3' })).toBeNull()

    // 市区町村名に戻すと行も戻り、「全部」に戻っている（町名のあいだの選択を引きずらない）
    fireEvent.click(screen.getByRole('button', { name: '市区町村名' }))
    expect(screen.getByRole('group', { name: '難易度' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '難易度: 全部' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('★★★ を選んで始めると setId に -s3 が付き、出題画面に ★★★ が出る', async () => {
    await openSelect()

    fireEvent.click(screen.getByRole('button', { name: '千葉県' }))
    const three = screen.getByRole('button', { name: '難易度: ★3' })
    expect(three).toBeEnabled()
    fireEvent.click(three)
    expect(three).toHaveAttribute('aria-pressed', 'true')
    // 帯に難易度が出て、問題数は ★3 の件数（11 件）で数える
    expect(el('.paper__subtitle').textContent).toContain('難易度: ★★★')
    expect(screen.getByRole('button', { name: '問題数: 全市区町村名（11 問）' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '始める' }))
    await settle()

    expect(hash()).toMatch(new RegExp(`^#/q/${DATA_VERSION}-e-12-\\d{4}-s3$`))
    await settle()
    expect(el('.q-number__text').textContent).toBe('問一 / 十')
    // 10 問すべて ★3（出題画面にも答案にも ★ が出る）
    expect(el('.q-number .stars').textContent).toBe('★★★')
    expect(screen.getByLabelText('難易度 3')).toBeInTheDocument()
  })

  it('難易度を切り替えると問題数の表示もその ★ の件数になる', async () => {
    await openSelect()
    fireEvent.click(screen.getByRole('button', { name: '千葉県' }))

    // 全部 15 件 → ★3 は 11 件 → ★2 は 3 件
    expect(screen.getByRole('button', { name: '問題数: 全市区町村名（15 問）' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '難易度: ★3' }))
    expect(screen.getByRole('button', { name: '問題数: 全市区町村名（11 問）' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '難易度: ★2' }))
    expect(screen.getByRole('button', { name: '問題数: 全市区町村名（3 問）' })).toBeInTheDocument()
  })

  it('地図の見出しの数は難易度に連れて動き、町名のときは出さない', async () => {
    await openSelect()
    fireEvent.click(screen.getByRole('button', { name: '千葉県' }))
    expect(el('.jp-map__note').textContent).toBe('千葉県 15問')

    // ★ で絞ると「★★★ 11問」。記号だけでは何の数か分からないので読み上げ名で言い換える
    fireEvent.click(screen.getByRole('button', { name: '難易度: ★3' }))
    expect(el('.jp-map__note').textContent).toBe('千葉県 ★★★ 11問')
    expect(screen.getByRole('note', { name: '★★★ の問題数 11 問' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '難易度: ★2' }))
    expect(el('.jp-map__note').textContent).toBe('千葉県 ★★ 3問')

    // 町名は easy の件数ではないので数を出さない（科目を戻せばまた出る）
    fireEvent.click(screen.getByRole('button', { name: '市区町村名＋町名' }))
    expect(document.querySelector('.jp-map__note')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '市区町村名' }))
    expect(el('.jp-map__note').textContent).toBe('千葉県 15問')
  })

  it('10 問に足りない難易度は島しょと同じく全市区町村名に固定し、理由を読み上げる', async () => {
    await openSelect()
    fireEvent.click(screen.getByRole('button', { name: '千葉県' }))
    // ★2 は 3 件しかない
    fireEvent.click(screen.getByRole('button', { name: '難易度: ★2' }))

    expect(screen.getByRole('button', { name: `問題数: ${QUESTIONS_PER_SET} 問` })).toBeDisabled()
    expect(screen.getByRole('button', { name: '問題数: 全市区町村名（3 問）' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(el('.sr-only').textContent).toBe('千葉県の★★は 3 問なので、10 問ではなく全市区町村名で解きます')

    fireEvent.click(screen.getByRole('button', { name: '始める' }))
    await settle()
    expect(hash()).toMatch(new RegExp(`^#/q/${DATA_VERSION}-e-12-\\d{4}-all-s2$`))
    await settle()
    // 10 問以下なので番号は漢数字のまま（算用数字になるのは 10 問を超えたとき）
    expect(el('.q-number__text').textContent).toBe('問一 / 三')
    expect(el('.q-number .stars').textContent).toBe('★★')
  })

  // ---- 地域（北海道 4・東京都 3。Issue #34） ----

  it('地域の切替は北海道・東京都のときだけ出る', async () => {
    await openSelect()

    expect(screen.queryByRole('button', { name: '地域: 道央' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '千葉県' }))
    expect(screen.queryByRole('button', { name: '地域: 道央' })).toBeNull()
    expect(screen.queryByRole('group', { name: '地域' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '北海道' }))
    expect(screen.getByRole('group', { name: '地域' })).toBeInTheDocument()
    // 既定は「全道」（scope は 2 桁のまま）
    expect(screen.getByRole('button', { name: '地域: 全道' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('button', { name: /^地域: / }).map((b) => b.textContent)).toEqual([
      '全道',
      '道央',
      '道南',
      '道北',
      '道東',
    ])

    // 都道府県を選び直すと地域は外れる（全国に戻せば切替そのものが消える）
    fireEvent.click(screen.getByRole('button', { name: '地域: 道東' }))
    expect(el('.paper__subtitle').textContent).toContain('いまの範囲: 北海道・道東')
    fireEvent.click(screen.getByRole('button', { name: '東京都' }))
    expect(screen.getByRole('button', { name: '地域: 全域' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '全国' }))
    expect(screen.queryByRole('group', { name: '地域' })).toBeNull()
  })

  it('北海道→道央で始めると scope が 01c になり、出題の範囲に「北海道・道央」が出る', async () => {
    await openSelect()

    fireEvent.click(screen.getByRole('button', { name: '北海道' }))
    fireEvent.click(screen.getByRole('button', { name: '地域: 道央' }))
    // 地図の見出しの件数は地域の出題数（フィクスチャの道央は 12 問）
    expect(el('.jp-map__note').textContent).toBe('北海道 12問')
    expect(el('.paper__subtitle').textContent).toContain('いまの範囲: 北海道・道央')

    fireEvent.click(screen.getByRole('button', { name: '始める' }))
    await settle()

    expect(hash()).toMatch(new RegExp(`^#/q/${DATA_VERSION}-e-01c-\\d{4}$`))
    expect(el('.paper__header').textContent).toContain('範囲: 北海道・道央')
    expect(el('.q-number__text').textContent).toBe('問一 / 十')
  })

  it('東京都→島しょ × 市区町村名は 10 問が押せず、全市区町村名（9 問）になる', async () => {
    await openSelect()

    fireEvent.click(screen.getByRole('button', { name: '東京都' }))
    fireEvent.click(screen.getByRole('button', { name: '地域: 島しょ' }))

    // 母集団 9 件なので 10 問は組めない。全市区町村名に固定され、理由が 1 行で出る
    expect(screen.getByRole('button', { name: '問題数: 10 問' })).toBeDisabled()
    const allButton = screen.getByRole('button', { name: '問題数: 全市区町村名（9 問）' })
    expect(allButton).toHaveAttribute('aria-pressed', 'true')
    // 理由は行を足さずに伝える（読み上げ専用テキスト ＋ 押せない 10 問ボタンの title）
    expect(el('.sr-only').textContent).toBe('東京都・島しょは 9 市町村なので、10 問ではなく全市区町村名で解きます')
    expect(screen.getByRole('button', { name: '問題数: 10 問' })).toHaveAttribute(
      'title',
      '東京都・島しょは 9 市町村なので全市区町村名で解きます',
    )
    expect(el('.paper__subtitle').textContent).toContain('問題数: 全 9 問')

    // 市区町村名＋町名なら 40 件あるので 10 問に戻れる（制限は科目側の事情ではない）
    fireEvent.click(screen.getByRole('button', { name: '市区町村名＋町名' }))
    expect(screen.getByRole('button', { name: '問題数: 10 問' })).toBeEnabled()
    expect(document.querySelector('.sr-only')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '市区町村名' }))

    fireEvent.click(screen.getByRole('button', { name: '始める' }))
    await settle()

    expect(hash()).toMatch(new RegExp(`^#/q/${DATA_VERSION}-e-13i-\\d{4}-all$`))
    expect(el('.paper__header').textContent).toContain('範囲: 東京都・島しょ')
    expect(el('.q-number__text').textContent).toBe('問一 / 九')
  })
})

// -------------------------------------------------------------------- 3. 出題

describe('出題', () => {
  it('setId を直接開くと 問一 / 十 と漢字が出る', async () => {
    await openQuiz(SET_ID)

    expect(el('.q-number__text').textContent).toBe('問一 / 十')
    expect(el('.q-kanji').textContent).toContain(EXPECTED.questions[0].display)
  })

  it('正解を入れて Enter で ○ が出て、約 1 秒後に問二へ進む', async () => {
    await openQuiz(SET_ID)

    const input = answerInput()
    fireEvent.change(input, { target: { value: EXPECTED.questions[0].answer } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(all('.mark--correct')).toHaveLength(1)
    expect(el('.q-number__text').textContent).toBe('問一 / 十')

    // 1 秒経つまでは次へ進まない
    await settle(FEEDBACK_MS - 1)
    expect(el('.q-number__text').textContent).toBe('問一 / 十')

    await settle(1)
    expect(el('.q-number__text').textContent).toBe('問二 / 十')
    expect(el('.q-kanji').textContent).toContain(EXPECTED.questions[1].display)
    expect(answerInput()).toHaveValue('')
  })

  it('解答欄は最初から、次の問に進んだ後も入力できる状態（フォーカス）になっている', async () => {
    await openQuiz(SET_ID)

    expect(answerInput()).toHaveFocus()

    const input = answerInput()
    fireEvent.change(input, { target: { value: EXPECTED.questions[0].answer } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await settle(FEEDBACK_MS)

    expect(el('.q-number__text').textContent).toBe('問二 / 十')
    expect(answerInput()).toHaveFocus()
  })

  it('カタカナや前後の空白でも正解として採点される（engine の正規化が効いている）', async () => {
    await openQuiz(SET_ID)

    const katakana = EXPECTED.questions[0].answer.replace(/[\u3041-\u3096]/g, (c) =>
      String.fromCodePoint((c.codePointAt(0) as number) + 0x60),
    )
    expect(katakana).not.toBe(EXPECTED.questions[0].answer)

    const input = answerInput()
    fireEvent.change(input, { target: { value: `  ${katakana}  ` } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(all('.mark--correct')).toHaveLength(1)
  })

  it('ローマ字で打てる。打ちかけの n は画面に残り、Enter で「ん」に確定して解答される', async () => {
    await openQuiz(SET_ID)

    const input = answerInput()
    // 'san' の末尾 n はまだ「ん」か「な行」か決まらないので、値は「さ」／表示は「さn」
    fireEvent.change(input, { target: { value: 'san' } })
    expect(input).toHaveValue('さn')

    // Enter で確定（onChange → 再描画 → onSubmit）まで一息で進む。IME の変換は要らない
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(all('.mark')).toHaveLength(1)

    // 「さん」は不正解なので「次へ」を押して進む
    await settle(FEEDBACK_MS)
    fireEvent.click(nextButton()!)
    await settle()
    expect(el('.q-number__text').textContent).toBe('問二 / 十')

    // 残り 9 問を埋めて、1 問目に「さん」が記録されていることを確かめる
    for (let i = 1; i < EXPECTED.questions.length; i++) await answerOne(EXPECTED.questions[i].answer)
    const records = JSON.parse(sessionStorage.getItem(answerSheetKey(SET_ID)) ?? '[]')
    expect(records[0]).toMatchObject({ input: 'さん', passed: false })
  })

  it('誤答では × と正解が出て、「次へ」を押すまで次の問へ進まない', async () => {
    await openQuiz(SET_ID)

    const input = answerInput()
    fireEvent.change(input, { target: { value: 'でたらめ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(all('.mark--wrong')).toHaveLength(1)
    expect(el('.marker--yellow').textContent).toBe(EXPECTED.questions[0].answer)
    // 「解答」の場所に「次へ」が出る（正しい読みを確かめてから自分のペースで進む）。
    // フォーカスも移るので Enter / Space でそのまま進める
    expect(screen.queryByRole('button', { name: '解答' })).toBeNull()
    expect(nextButton()).toHaveTextContent('次へ')
    expect(document.activeElement).toBe(nextButton())
    // 間違えている間は「空欄のまま解答すると…」の注意書きを出さない（用紙の高さを抑える）
    expect(screen.queryByText(/空欄のまま解答すると/)).toBeNull()

    // 正解のときの 1 秒どころか、ずっと待っても進まない
    await settle(FEEDBACK_MS * 10)
    expect(el('.q-number__text').textContent).toBe('問一 / 十')
    expect(all('.mark--wrong')).toHaveLength(1)

    fireEvent.click(nextButton()!)
    await settle()
    expect(el('.q-number__text').textContent).toBe('問二 / 十')
    expect(all('.mark')).toHaveLength(0)
    expect(screen.getByRole('button', { name: '解答' })).toBeInTheDocument()
    // 次の問の計測は「次へ」を押してから。正解を眺めていた時間は答案の ms に入らない
    await answerOne(EXPECTED.questions[1].answer)
    for (let i = 2; i < EXPECTED.questions.length; i++) await answerOne(EXPECTED.questions[i].answer)
    const records = JSON.parse(sessionStorage.getItem(answerSheetKey(SET_ID)) ?? '[]')
    expect(records[1].ms).toBeLessThan(FEEDBACK_MS)
  })

  it('最後の問を間違えると「結果を見る」になり、押すと結果へ進む', async () => {
    await openQuiz(SET_ID)
    for (let i = 0; i < EXPECTED.questions.length - 1; i++) await answerOne(EXPECTED.questions[i].answer)
    expect(el('.q-number__text').textContent).toBe('問十 / 十')

    fireEvent.click(screen.getByRole('button', { name: '解答' }))
    await settle(FEEDBACK_MS * 3)
    expect(hash()).toBe(quizPath(SET_ID))
    expect(nextButton()).toHaveTextContent('結果を見る')

    fireEvent.click(nextButton()!)
    await settle()
    expect(hash()).toBe(resultPath(SET_ID))
  })

  it('空欄で「解答」はパス扱い', async () => {
    await openQuiz(SET_ID)

    fireEvent.click(screen.getByRole('button', { name: '解答' }))
    expect(all('.mark--wrong')).toHaveLength(1)

    // パスも間違いと同じく「次へ」を押すまで止まる
    await settle(FEEDBACK_MS)
    expect(el('.q-number__text').textContent).toBe('問一 / 十')
    fireEvent.click(nextButton()!)
    await settle()
    expect(el('.q-number__text').textContent).toBe('問二 / 十')

    // 残り 9 問は適当に埋めて、1 問目がパスとして記録されていることを確認する
    for (let i = 1; i < EXPECTED.questions.length; i++) await answerOne(EXPECTED.questions[i].answer)
    const records = JSON.parse(sessionStorage.getItem(answerSheetKey(SET_ID)) ?? '[]')
    expect(records[0]).toMatchObject({ input: '', passed: true, correct: false, ms: TIME_LIMIT_MS })
  })

  it('20 秒放置すると自動でパスし、「次へ」で次の問へ進む', async () => {
    await openQuiz(SET_ID)
    expect(el('.timer__label').textContent).toContain('のこり 20 秒')

    // 制限時間ぎりぎりまでは自動パスしない
    await settle(TIME_LIMIT_MS - 100)
    expect(all('.mark--wrong')).toHaveLength(0)
    expect(el('.timer__label')).toHaveClass('is-urgent')

    await settle(100)
    expect(all('.mark--wrong')).toHaveLength(1)

    // 時間切れのあとは砂時計が止まり、「次へ」を押すまで次の問に進まない
    await settle(FEEDBACK_MS * 5)
    expect(el('.q-number__text').textContent).toBe('問一 / 十')
    fireEvent.click(nextButton()!)
    await settle()
    expect(el('.q-number__text').textContent).toBe('問二 / 十')
    expect(el('.timer__label').textContent).toContain('のこり 20 秒')
    expect(el('.timer__label')).not.toHaveClass('is-urgent')
  })

  it('10 問終わると #/result へ進み、答案が sessionStorage に 10 件残る', async () => {
    await openQuiz(SET_ID)

    for (let i = 0; i < EXPECTED.questions.length; i++) {
      // 偶数問は正解、奇数問は誤答にして得点を 50 点にそろえる
      await answerOne(i % 2 === 0 ? EXPECTED.questions[i].answer : 'ちがう')
    }

    expect(hash()).toBe(resultPath(SET_ID))
    const records = JSON.parse(sessionStorage.getItem(answerSheetKey(SET_ID)) ?? 'null')
    expect(records).toHaveLength(10)
    expect(records.filter((r: { correct: boolean }) => r.correct)).toHaveLength(5)
    expect(records.map((r: { questionId: string }) => r.questionId)).toEqual(EXPECTED.questions.map((q) => q.id))
  })

  it('同じ setId なら 1 問目は毎回同じ', async () => {
    await openQuiz(SET_ID)
    const first = el('.q-kanji').textContent
    cleanup()

    await openQuiz(SET_ID)
    expect(el('.q-kanji').textContent).toBe(first)
  })
})

// -------------------------------------------------------------------- 4. 結果

describe('結果', () => {
  /** 7 問正解の答案を sessionStorage に置いてから結果画面を開く */
  async function openResult(correctCount = 7): Promise<void> {
    localStorage.setItem(NICKNAME_KEY, 'たろう')
    const records = EXPECTED.questions.map((q, i) => ({
      questionId: q.id,
      input: i < correctCount ? q.answer : 'ちがう',
      correct: i < correctCount,
      ms: 3000,
      passed: false,
    }))
    sessionStorage.setItem(answerSheetKey(SET_ID), JSON.stringify(records))
    goto(resultPath(SET_ID))
    renderApp()
    await settle()
  }

  it('得点スタンプと 10 行の見直しが出る', async () => {
    await openResult()

    expect(el('.stamp').textContent).toBe('70点')
    expect(all('.review__row')).toHaveLength(10)
    expect(all('.review__row')[0].textContent).toContain(EXPECTED.questions[0].answer)
  })

  it('ランキングに登録すると自分の行が順位付きで出る', async () => {
    await openResult()

    fireEvent.click(screen.getByRole('button', { name: 'ランキングに登録' }))
    await settle()

    const rows = all('.ranking__row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveClass('is-me')
    expect(rows[0].textContent).toContain('たろう')
    expect(screen.getByText(/あなたは 1 位/)).toBeInTheDocument()
    expect(screen.getByText('1 位で登録しました。')).toBeInTheDocument()
  })

  it('同じ setId へ二重登録は弾かれる', async () => {
    await openResult()

    fireEvent.click(screen.getByRole('button', { name: 'ランキングに登録' }))
    await settle()

    // 登録後はボタンを無効にするので 2 度目は押せない（サーバー側でも 409 で弾く）
    expect(screen.getByRole('button', { name: 'ランキングに登録' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'ランキングに登録' }))
    await settle()

    expect(all('.ranking__row')).toHaveLength(1)
  })

  it('「この問題で挑ませる」で出題 URL をクリップボードへ入れる', async () => {
    await openResult()

    fireEvent.click(screen.getByRole('button', { name: 'この問題で挑ませる' }))
    await settle()

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0][0]).toContain(`#/q/${SET_ID}`)
  })

  it('答案が無ければ範囲選択へ戻る', async () => {
    goto(resultPath(SET_ID))
    renderApp()
    await settle()

    expect(hash()).toBe('#/select')
  })

  it('登録済みの結果を開き直すと最初から順位表が出る', async () => {
    await openResult()
    fireEvent.click(screen.getByRole('button', { name: 'ランキングに登録' }))
    await settle()
    cleanup()

    await openResult()
    expect(all('.ranking__row')).toHaveLength(1)
    expect(all('.ranking__row')[0]).toHaveClass('is-me')
    expect(screen.getByText('この問題にはすでに登録済みです。')).toBeInTheDocument()
  })

  it('氏名が未記入なら登録できない', async () => {
    await openResult()
    localStorage.removeItem(NICKNAME_KEY)
    cleanup()
    goto(resultPath(SET_ID))
    renderApp()
    await settle()

    fireEvent.click(screen.getByRole('button', { name: 'ランキングに登録' }))
    await settle()

    expect(screen.getByText(/氏名（ニックネーム）が未記入です/)).toBeInTheDocument()
    expect(all('.ranking__row')).toHaveLength(0)
  })
})

// --------------------------------------------------- 5. 通し（表紙→結果）

describe('通しフロー', () => {
  it('表紙から 10 問解いて結果・順位表まで一息で通る', async () => {
    renderApp()

    // 表紙
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'たろう' } })
    fireEvent.click(screen.getByRole('button', { name: 'はじめる' }))
    await settle()
    expect(hash()).toBe('#/select')

    // 範囲・科目
    fireEvent.click(screen.getByRole('button', { name: '千葉県' }))
    fireEvent.click(screen.getByRole('button', { name: '始める' }))
    await settle()

    const setId = hash().replace('#/q/', '')
    const set = await buildQuestionSet('e', '12', setId.split('-')[3], FIXTURE_SOURCE)
    expect(el('.q-number__text').textContent).toBe('問一 / 十')
    expect(el('.answer-input')).toBeInTheDocument()

    // 出題（全問正解）
    for (const q of set.questions) {
      expect(el('.q-kanji').textContent).toContain(q.display)
      await answerOne(q.answer)
    }

    // 結果
    // 出題 → 結果 の遷移は hashchange 経由なので、もう一度流してから見る
    await settle()
    expect(hash()).toBe(resultPath(setId))
    expect(el('.stamp').textContent).toBe('100点')
    expect(all('.review__row')).toHaveLength(10)
    expect(all('.mark--correct')).toHaveLength(10)

    fireEvent.click(screen.getByRole('button', { name: 'ランキングに登録' }))
    await settle()
    expect(all('.ranking__row')[0]).toHaveClass('is-me')
  })

  it('全問 20 秒放置でも結果まで進み、10 件すべてパスになる', async () => {
    await openQuiz(SET_ID)

    for (let i = 0; i < EXPECTED.questions.length; i++) await answerOne(null)

    expect(hash()).toBe(resultPath(SET_ID))
    const records = JSON.parse(sessionStorage.getItem(answerSheetKey(SET_ID)) ?? 'null')
    expect(records).toHaveLength(10)
    expect(records.every((r: { passed: boolean }) => r.passed)).toBe(true)

    await settle()
    expect(el('.stamp').textContent).toBe('0点')
  })
})

// ------------------------------------------------ 6. 範囲の広げ方・difficult

describe('出題の表示', () => {
  it('母集団が足りない 6 桁 scope は都道府県へ広げたことを明示する', async () => {
    await openQuiz(`${DATA_VERSION}-e-120007-1234`)

    expect(el('.pen-comment').textContent).toContain('都道府県に広げました')
    expect(el('.paper__header').textContent).toContain('範囲: 千葉県')
  })

  it('difficult は所属自治体を添え書きし、接尾辞［市］を出さない', async () => {
    await openQuiz(`${DATA_VERSION}-d-120001-1234`)

    expect(el('.paper__header').textContent).toContain('科目: 市区町村名＋町名')
    expect(el('.q-pref').textContent).toBe('千市1')
    expect(document.querySelector('.q-suffix')).toBeNull()
  })

  it('全国 easy は都道府県を添え書きする', async () => {
    await openQuiz(`${DATA_VERSION}-e-00-20261002`)

    expect(el('.paper__header').textContent).toContain('範囲: 全国')
    expect(['千葉県', '東京都', '北海道']).toContain(el('.q-pref').textContent)
    expect(el('.q-suffix').textContent).toBe('［市］')
  })

  it('表紙の「今日の10問」の形（全国 × ★★★ × 8 桁シード）は 10 問組めて帯に ★★★ が出る', async () => {
    await openQuiz(`${DATA_VERSION}-e-00-20261002-s3`)

    expect(el('.paper__header').textContent).toContain('範囲: 全国')
    expect(el('.q-number__text').textContent).toBe('問一 / 十')
    expect(el('.q-number .stars').textContent).toBe('★★★')
  })

  it('壊れた setId は出題エラーになり、範囲選択へ戻れる', async () => {
    goto('#/q/こわれた')
    renderApp()
    await settle()

    expect(screen.getByText(/セットIDが読めません/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '範囲をえらび直す' }))
    await settle()
    expect(hash()).toBe('#/select')
  })

  it('共有された 全国 × difficult の URL はエラー表示になる（落ちない）', async () => {
    await openQuiz(`${DATA_VERSION}-d-00-1234`)

    expect(screen.getByText(/全国 × difficult はこのデモでは対応していません/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '範囲をえらび直す' }))
    await settle()
    expect(hash()).toBe('#/select')
  })

  it('問題バンクの読み込みに失敗したらエラー表示になる', async () => {
    await openQuiz(`${DATA_VERSION}-d-14-1234`)

    expect(screen.getByText(/問題バンクを読み込めませんでした（404）/)).toBeInTheDocument()
  })

  it('出題できる地名が無い scope はエラー表示になる', async () => {
    await openQuiz(`${DATA_VERSION}-e-990001-1234`)

    expect(screen.getByText(/この範囲には出題できる地名がありませんでした/)).toBeInTheDocument()
  })
})

// ------------------------------------------------- 7. 表紙 → ランキングの導線

describe('ランキングへの導線', () => {
  it('表紙の「ランキングを見る」のリンク先が #/ranking で、開くと都道府県の一覧が出る', async () => {
    renderApp()

    const link = screen.getByRole('link', { name: 'ランキングを見る' })
    expect(link).toHaveAttribute('href', '#/ranking')

    // jsdom は <a href="#..."> のクリックでハッシュを動かさないので、同じ遷移をルータ経由で起こす
    goto(link.getAttribute('href') as string)
    await settle()

    expect(screen.getByRole('heading', { name: 'これまでのランキング' })).toBeInTheDocument()
    // 地図データ（public/geo/）が無くても一覧だけで成立する
    expect(screen.getByRole('button', { name: /千葉県/ })).toBeInTheDocument()
  })

  it('#/ranking/{prefCode} は都道府県の詳細を出す', async () => {
    goto('#/ranking/12')
    renderApp()
    await settle()

    expect(screen.getByRole('heading', { name: '千葉県のランキング' })).toBeInTheDocument()
    expect(screen.getByText('まだ登録がありません。')).toBeInTheDocument()
  })
})

// ------------------------------------------------------- 8. 2 回目のプレイ

describe('もう一度', () => {
  it('結果から範囲選択へ戻って別の問題を始め直せる', async () => {
    localStorage.setItem(NICKNAME_KEY, 'たろう')
    await openQuiz(SET_ID)
    for (const q of EXPECTED.questions) await answerOne(q.answer)
    await settle()
    expect(el('.stamp').textContent).toBe('100点')

    fireEvent.click(screen.getByRole('button', { name: 'もう一度（別の問題）' }))
    await settle()
    expect(hash()).toBe('#/select')

    fireEvent.click(screen.getByRole('button', { name: '東京都' }))
    fireEvent.click(screen.getByRole('button', { name: '始める' }))
    await settle()

    expect(hash()).toMatch(new RegExp(`^#/q/${DATA_VERSION}-e-13-\\d{4}$`))
    expect(el('.q-number__text').textContent).toBe('問一 / 十')
    expect(el('.answer-input')).toHaveValue('')
  })
})

// --------------------------------------------- 9. 時間制限なし（アプリの既定）

describe('時間制限なし', () => {
  beforeEach(() => {
    localStorage.setItem(TIME_LIMIT_KEY, String(NO_TIME_LIMIT))
  })

  it('砂時計・残り秒・タイマーバーを出さず「時間制限なし」と出る', async () => {
    await openQuiz(SET_ID)

    expect(document.querySelector('.timer')).toBeNull()
    expect(document.querySelector('.timer__label')).toBeNull()
    expect(screen.getByText('時間制限なし')).toBeInTheDocument()
    expect(el('.paper__header').textContent).toContain('制限: なし')
  })

  it('放置しても自動パスしない', async () => {
    await openQuiz(SET_ID)

    await settle(TIME_LIMIT_MS * 2)
    expect(all('.mark')).toHaveLength(0)
    expect(el('.q-number__text').textContent).toBe('問一 / 十')
  })

  it('パスは 20000 ではなく実測の経過時間で記録される', async () => {
    await openQuiz(SET_ID)

    await settle(3000)
    fireEvent.click(screen.getByRole('button', { name: '解答' }))
    await settle(FEEDBACK_MS)
    fireEvent.click(nextButton()!)
    await settle()
    for (let i = 1; i < EXPECTED.questions.length; i++) await answerOne(EXPECTED.questions[i].answer)

    const records = JSON.parse(sessionStorage.getItem(answerSheetKey(SET_ID)) ?? '[]')
    expect(records[0]).toMatchObject({ input: '', passed: true, correct: false })
    expect(records[0].ms).toBeGreaterThanOrEqual(3000)
    expect(records[0].ms).toBeLessThan(TIME_LIMIT_MS)
  })

  it('結果の帯に「制限 なし」が出る', async () => {
    localStorage.setItem(NICKNAME_KEY, 'たろう')
    await openQuiz(SET_ID)
    for (const q of EXPECTED.questions) await answerOne(q.answer)
    await settle()

    expect(el('.paper__header').textContent).toContain('制限 なし')
  })
})

// ------------------------------------------- 10. 間違えた問題（#/review）

describe('間違えた問題', () => {
  /** 1 問目だけ誤答して結果画面まで進む */
  async function playWithOneWrong(): Promise<void> {
    localStorage.setItem(NICKNAME_KEY, 'たろう')
    await openQuiz(SET_ID)
    await answerOne('でたらめ')
    for (let i = 1; i < EXPECTED.questions.length; i++) await answerOne(EXPECTED.questions[i].answer)
    await settle()
  }

  it('ランキングに登録すると誤答が記録され、#/review に出る', async () => {
    await playWithOneWrong()
    expect(hash()).toBe(resultPath(SET_ID))
    // 登録するまでは記録しない
    expect(readWrongList()).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'ランキングに登録' }))
    await settle()

    const list = readWrongList()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      questionId: EXPECTED.questions[0].id,
      input: 'でたらめ',
      answer: EXPECTED.questions[0].answer,
      prefCode: '12',
      mode: 'e',
    })

    fireEvent.click(screen.getByRole('button', { name: '間違えた問題を見る' }))
    await settle()

    expect(hash()).toBe('#/review')
    expect(all('.review__row')).toHaveLength(1)
    expect(el('.review__row').textContent).toContain(EXPECTED.questions[0].display)
    expect(el('.review__row').textContent).toContain('でたらめ')
  })

  it('登録しなければ記録しない', async () => {
    await playWithOneWrong()

    fireEvent.click(screen.getByRole('button', { name: 'タイトルへ戻る' }))
    await settle()

    expect(hash()).toBe('#/')
    expect(readWrongList()).toHaveLength(0)
  })

  it('表紙から「間違えた問題」へ行ける', async () => {
    localStorage.setItem(NICKNAME_KEY, 'たろう')
    renderApp()
    await settle()

    const link = screen.getByRole('link', { name: '間違えた問題' })
    expect(link).toHaveAttribute('href', '#/review')

    // jsdom は <a href="#..."> のクリックでハッシュを動かさないので、同じ遷移をルータ経由で起こす
    goto(link.getAttribute('href') as string)
    await settle()

    expect(screen.getByRole('heading', { name: '間違えた問題' })).toBeInTheDocument()
    expect(screen.getByText(/まだ記録がありません/)).toBeInTheDocument()
  })
})

// ----------------------------------------- 11. 共有リンクの着地（挑戦状）

describe('共有リンクの着地', () => {
  /**
   * ページ読み込み直後と同じ状態を作る。ハッシュ遷移を 1 度も起こさずに出題 URL のまま
   * App を載せるので、Quiz は「直接開かれた」と見て挑戦状を描く。
   * （jsdom では location.hash への代入が hashchange を飛ばすので、history.replaceState を使う）
   */
  async function landOnQuiz(setId: string): Promise<void> {
    // beforeEach の goto('#/') が積んだ hashchange を先に流し切ってから読み込み直後へ戻す
    await settle()
    resetNavigated()
    history.replaceState(null, '', quizPath(setId))
    renderApp()
    await settle()
  }

  function startButton(): HTMLElement {
    return screen.getByRole('button', { name: 'はじめる' })
  }

  function nameInput(): HTMLElement {
    return screen.getByLabelText('氏名')
  }

  it('出題の前に挑戦状が出る。砂時計も問一も出ていない', async () => {
    await landOnQuiz(SET_ID)

    expect(screen.getByRole('heading', { name: '挑戦状' })).toBeInTheDocument()
    expect(document.querySelector('.q-number')).toBeNull()
    expect(document.querySelector('.timer')).toBeNull()
    expect(document.querySelector('.answer-input')).toBeNull()
  })

  it('範囲・科目・問題数・制限時間が書かれている', async () => {
    await landOnQuiz(SET_ID)

    const text = el('.paper').textContent ?? ''
    expect(text).toContain('範囲: 千葉県')
    expect(text).toContain('科目: 市区町村名')
    expect(text).toContain('問題数: 10 問')
    expect(text).toContain('制限: 20秒')
  })

  it('氏名が未記入では始められず、放置しても砂時計は進まない', async () => {
    await landOnQuiz(SET_ID)
    expect(startButton()).toBeDisabled()

    fireEvent.click(startButton())
    await settle(TIME_LIMIT_MS * 2)

    // 計測が始まっていないので自動パスも起きない
    expect(screen.getByRole('heading', { name: '挑戦状' })).toBeInTheDocument()
    expect(all('.mark')).toHaveLength(0)
    expect(document.querySelector('.q-number')).toBeNull()
  })

  it('前回の名前があれば氏名欄に復元される', async () => {
    localStorage.setItem(NICKNAME_KEY, 'はなこ')
    await landOnQuiz(SET_ID)

    expect(nameInput()).toHaveValue('はなこ')
    expect(startButton()).toBeEnabled()
  })

  it('氏名を入れて「はじめる」で問一が出て、そこから計測が始まる', async () => {
    await landOnQuiz(SET_ID)

    fireEvent.change(nameInput(), { target: { value: 'たろう' } })
    fireEvent.click(startButton())
    await settle()

    expect(el('.q-number__text').textContent).toBe('問一 / 十')
    expect(el('.q-kanji').textContent).toContain(EXPECTED.questions[0].display)
    expect(el('.timer__label').textContent).toContain('のこり 20 秒')
    expect(el('.paper__header').textContent).toContain('たろう')
    expect(localStorage.getItem(NICKNAME_KEY)).toBe('たろう')

    // 自動パスは「はじめる」から 20 秒後。着地していた時間は数えない
    await settle(TIME_LIMIT_MS - 100)
    expect(all('.mark--wrong')).toHaveLength(0)
    await settle(100)
    expect(all('.mark--wrong')).toHaveLength(1)
  })

  it('挑戦状で制限を「なし」に変えて始めると砂時計が出ない', async () => {
    await landOnQuiz(SET_ID)

    fireEvent.change(nameInput(), { target: { value: 'たろう' } })
    fireEvent.click(screen.getByRole('button', { name: '時間制限: なし' }))
    fireEvent.click(startButton())
    await settle()

    expect(document.querySelector('.timer')).toBeNull()
    expect(el('.paper__header').textContent).toContain('制限: なし')
  })

  it('着地から 10 問解くと結果へ進み、入力した氏名で登録できる', async () => {
    await landOnQuiz(SET_ID)

    fireEvent.change(nameInput(), { target: { value: 'はなこ' } })
    fireEvent.click(startButton())
    await settle()

    for (const q of EXPECTED.questions) await answerOne(q.answer)
    await settle()

    expect(hash()).toBe(resultPath(SET_ID))
    fireEvent.click(screen.getByRole('button', { name: 'ランキングに登録' }))
    await settle()

    expect(all('.ranking__row')[0].textContent).toContain('はなこ')
  })

  it('壊れた setId を直接開いたときは挑戦状ではなく出題エラー', async () => {
    await landOnQuiz('こわれた')

    expect(screen.getByText(/セットIDが読めません/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '挑戦状' })).toBeNull()
  })

  it('アプリ内の「始める」から来たときは挑戦状を挟まない', async () => {
    renderApp()
    await settle()

    // 表紙 → 範囲・科目 → 出題
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'たろう' } })
    fireEvent.click(screen.getByRole('button', { name: 'はじめる' }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: '千葉県' }))
    fireEvent.click(screen.getByRole('button', { name: '始める' }))
    await settle()

    expect(screen.queryByRole('heading', { name: '挑戦状' })).toBeNull()
    expect(el('.q-number__text').textContent).toBe('問一 / 十')
  })
})

// ------------------------------------------- 全市区町村名（順位表に登録できる）

describe('全市区町村名の結果', () => {
  /** 15 問のうち correctCount 問だけ正解した答案を置いてから結果画面を開く */
  async function openAllResult(correctCount: number): Promise<void> {
    localStorage.setItem(NICKNAME_KEY, 'たろう')
    const records = EXPECTED_ALL.questions.map((q, i) => ({
      questionId: q.id,
      input: i < correctCount ? q.answer : 'ちがう',
      correct: i < correctCount,
      ms: 3000,
      passed: false,
    }))
    sessionStorage.setItem(answerSheetKey(SET_ALL), JSON.stringify(records))
    goto(resultPath(SET_ALL))
    renderApp()
    await settle()
  }

  it('得点は正答率で、10 問と同じように登録できる', async () => {
    expect(EXPECTED_ALL.questions).toHaveLength(15)
    await openAllResult(11)

    // 11 / 15 = 73.3… → 73 点
    expect(el('.stamp').textContent).toBe('73点')
    expect(all('.review__row')).toHaveLength(15)
    expect(el('.paper__subtitle').textContent).toContain('正解 11 / 15 問')
    expect(screen.queryByText(/順位表には載りません/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'ランキングに登録' }))
    await settle()

    expect(screen.getByText('1 位で登録しました。')).toBeInTheDocument()
    const row = all('.ranking__row')[0]
    expect(row.textContent).toContain('たろう')
    expect(row.querySelector('.ranking__score')?.textContent).toBe('73点［全市区町村名（15 問）］')
    // 間違えた問題も 10 問のときと同じように残る
    expect(readWrongList()).toHaveLength(4)
  })
})
