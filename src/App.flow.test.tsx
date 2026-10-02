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
import { TIME_LIMIT_MS } from './engine/types.ts'
import type { BankSource } from './engine/bank.ts'
import { DATA_VERSION, buildQuestionSet } from './engine/bank.ts'
import { todaySeed } from './engine/setId.ts'
import { makeDifficult, makeEasy } from './engine/__fixtures__/questions.ts'
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

// 千葉県は easy 15 件・大字 30 件、東京都は easy 14 件。どちらも「今日の10問」に足りる
const EASY_12 = kanaizeAnswers(makeEasy('12', '千葉県', 15))
const EASY_13 = kanaizeAnswers(makeEasy('13', '東京都', 14))
const EASY_ALL: Question[] = [...EASY_12, ...EASY_13]
const DIFFICULT_12 = kanaizeAnswers(makeDifficult('12', '千葉県', 1, 30))
const DIFFICULT_13 = kanaizeAnswers(makeDifficult('13', '東京都', 1, 30))

const META: BankMeta = {
  dataVersion: DATA_VERSION,
  generatedAt: '2026-09-25T00:00:00.000Z',
  source: 'テスト用フィクスチャ',
  prefectures: [
    { code: '12', name: '千葉県', easyCount: EASY_12.length, difficultCount: DIFFICULT_12.length },
    { code: '13', name: '東京都', easyCount: EASY_13.length, difficultCount: DIFFICULT_13.length },
  ],
  cities: EASY_ALL.map((q) => ({ lgCode: q.lgCode, prefCode: q.prefCode, name: q.display, kana: q.answer })),
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

/** 1 問解答する。value が null なら 20 秒放置して自動パスさせる */
async function answerOne(value: string | null): Promise<void> {
  if (value === null) {
    await settle(TIME_LIMIT_MS)
  } else {
    const input = answerInput()
    fireEvent.change(input, { target: { value } })
    fireEvent.keyDown(input, { key: 'Enter' })
  }
  await settle(FEEDBACK_MS)
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
let EXPECTED: QuestionSet

beforeAll(async () => {
  EXPECTED = await buildQuestionSet('e', '12', '1234', FIXTURE_SOURCE)
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

  it('「今日の10問」は（範囲未選択なら）全国 × easy × 日付シード', async () => {
    await openSelect()

    // ボタン名に範囲と科目が入るので前方一致で拾う（例「今日の10問（全国・easy）」）
    fireEvent.click(screen.getByRole('button', { name: /^今日の10問/ }))
    await settle()

    expect(hash()).toBe(`#/q/${DATA_VERSION}-e-00-${todaySeed()}`)
  })

  it('全国のままでも difficult を押せるが、都道府県を選ぶまで「始める」は無効で案内文が出る', async () => {
    await openSelect()

    // 科目の切替は最初から押せる（押せないと操作が詰まる）。
    // 全国のままでは「始める」が無効になり、ボタンのラベルが案内に変わる（行は増やさない）
    const difficult = screen.getByRole('button', { name: /^difficult/ })
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
    fireEvent.click(screen.getByRole('button', { name: /^difficult/ }))
    fireEvent.click(screen.getByRole('button', { name: '始める' }))
    await settle()

    expect(hash()).toMatch(new RegExp(`^#/q/${DATA_VERSION}-d-12-\\d{4}$`))
  })

})

// -------------------------------------------------------------------- 3. 出題

describe('出題', () => {
  it('setId を直接開くと 問一 / 十 と漢字が出る', async () => {
    await openQuiz(SET_ID)

    expect(el('.q-number').textContent).toBe('問一 / 十')
    expect(el('.q-kanji').textContent).toContain(EXPECTED.questions[0].display)
  })

  it('正解を入れて Enter で ○ が出て、約 1 秒後に問二へ進む', async () => {
    await openQuiz(SET_ID)

    const input = answerInput()
    fireEvent.change(input, { target: { value: EXPECTED.questions[0].answer } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(all('.mark--correct')).toHaveLength(1)
    expect(el('.q-number').textContent).toBe('問一 / 十')

    // 1 秒経つまでは次へ進まない
    await settle(FEEDBACK_MS - 1)
    expect(el('.q-number').textContent).toBe('問一 / 十')

    await settle(1)
    expect(el('.q-number').textContent).toBe('問二 / 十')
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

    expect(el('.q-number').textContent).toBe('問二 / 十')
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

    await settle(FEEDBACK_MS)
    expect(el('.q-number').textContent).toBe('問二 / 十')

    // 残り 9 問を埋めて、1 問目に「さん」が記録されていることを確かめる
    for (let i = 1; i < EXPECTED.questions.length; i++) await answerOne(EXPECTED.questions[i].answer)
    const records = JSON.parse(sessionStorage.getItem(answerSheetKey(SET_ID)) ?? '[]')
    expect(records[0]).toMatchObject({ input: 'さん', passed: false })
  })

  it('誤答では × と正解が出る', async () => {
    await openQuiz(SET_ID)

    const input = answerInput()
    fireEvent.change(input, { target: { value: 'でたらめ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(all('.mark--wrong')).toHaveLength(1)
    expect(el('.marker--yellow').textContent).toBe(EXPECTED.questions[0].answer)
  })

  it('空欄で「解答」はパス扱い', async () => {
    await openQuiz(SET_ID)

    fireEvent.click(screen.getByRole('button', { name: '解答' }))
    expect(all('.mark--wrong')).toHaveLength(1)

    await settle(FEEDBACK_MS)
    expect(el('.q-number').textContent).toBe('問二 / 十')

    // 残り 9 問は適当に埋めて、1 問目がパスとして記録されていることを確認する
    for (let i = 1; i < EXPECTED.questions.length; i++) await answerOne(EXPECTED.questions[i].answer)
    const records = JSON.parse(sessionStorage.getItem(answerSheetKey(SET_ID)) ?? '[]')
    expect(records[0]).toMatchObject({ input: '', passed: true, correct: false, ms: TIME_LIMIT_MS })
  })

  it('20 秒放置すると自動でパスして次の問へ進む', async () => {
    await openQuiz(SET_ID)
    expect(el('.timer__label').textContent).toContain('のこり 20 秒')

    // 制限時間ぎりぎりまでは自動パスしない
    await settle(TIME_LIMIT_MS - 100)
    expect(all('.mark--wrong')).toHaveLength(0)
    expect(el('.timer__label')).toHaveClass('is-urgent')

    await settle(100)
    expect(all('.mark--wrong')).toHaveLength(1)

    await settle(FEEDBACK_MS)
    expect(el('.q-number').textContent).toBe('問二 / 十')
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
    expect(el('.q-number').textContent).toBe('問一 / 十')
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

    expect(el('.paper__header').textContent).toContain('科目: difficult')
    expect(el('.q-pref').textContent).toBe('千市1')
    expect(document.querySelector('.q-suffix')).toBeNull()
  })

  it('全国 easy は都道府県を添え書きする', async () => {
    await openQuiz(`${DATA_VERSION}-e-00-20261002`)

    expect(el('.paper__header').textContent).toContain('範囲: 全国')
    expect(['千葉県', '東京都']).toContain(el('.q-pref').textContent)
    expect(el('.q-suffix').textContent).toBe('［市］')
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
    expect(el('.q-number').textContent).toBe('問一 / 十')
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
    expect(el('.q-number').textContent).toBe('問一 / 十')
  })

  it('パスは 20000 ではなく実測の経過時間で記録される', async () => {
    await openQuiz(SET_ID)

    await settle(3000)
    fireEvent.click(screen.getByRole('button', { name: '解答' }))
    await settle(FEEDBACK_MS)
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
    expect(text).toContain('科目: easy（市区町村名）')
    expect(text).toContain('全 10 問')
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

    expect(el('.q-number').textContent).toBe('問一 / 十')
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
    expect(el('.q-number').textContent).toBe('問一 / 十')
  })
})
