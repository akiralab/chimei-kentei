// @vitest-environment jsdom
/**
 * HiraganaInput のテスト。
 * 「解答欄にはひらがなしか入らない」「変換操作を要らなくする」が要件なので、
 *   - ローマ字の逐次変換（IME が無い環境の想定）
 *   - カタカナ確定・漢字混じりの貼り付けの正規化
 *   - 日本語 IME の変換中に未確定文字列を壊さないこと
 *   - Enter の送信
 * を見る。実ブラウザの IME は再現できないので composition イベントで代用する。
 */
import '@testing-library/jest-dom/vitest'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HiraganaInput from './HiraganaInput.tsx'

afterEach(cleanup)

/** 親が value を持つ（本番の Quiz と同じ）形で組む */
function Harness({
  onSubmit = () => {},
  onChangeSpy,
  initial = '',
}: {
  onSubmit?: () => void
  onChangeSpy?: (v: string) => void
  initial?: string
}) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <HiraganaInput
        value={value}
        onChange={(next) => {
          onChangeSpy?.(next)
          setValue(next)
        }}
        onSubmit={onSubmit}
        ariaLabel="よみ"
      />
      <output data-testid="value">{value}</output>
    </>
  )
}

function setup(props: Parameters<typeof Harness>[0] = {}) {
  render(<Harness {...props} />)
  return {
    input: screen.getByLabelText('よみ') as HTMLInputElement,
    value: () => screen.getByTestId('value').textContent,
  }
}

describe('ローマ字を逐次ひらがなにする', () => {
  it.each([
    ['sousa', 'そうさ'],
    ['hatsukaichi', 'はつかいち'],
    ['kakamigahara', 'かかみがはら'],
    ['juusou', 'じゅうそう'],
    ['kuma-ta', 'くまーた'],
  ])('%s → %s', async (typed, expected) => {
    const user = userEvent.setup()
    const { input, value } = setup()
    await user.type(input, typed)
    expect(value()).toBe(expected)
    expect(input).toHaveValue(expected)
  })

  it('打ちかけの子音は値に入らないが、画面には残る', async () => {
    const user = userEvent.setup()
    const { input, value } = setup()
    await user.type(input, 'monzen')
    expect(value()).toBe('もんぜ')
    expect(input).toHaveValue('もんぜn')
  })
})

describe('ひらがな以外を受け付けない', () => {
  it.each([
    ['ソウサ', 'そうさ'],
    ['匝瑳そうさ', 'そうさ'],
    ['そう さ', 'そうさ'],
    ['', ''],
  ])('%s → %s', (pasted, expected) => {
    const { input, value } = setup()
    fireEvent.change(input, { target: { value: pasted } })
    expect(value()).toBe(expected)
    expect(input).toHaveValue(expected)
  })
})

describe('日本語 IME の変換中', () => {
  it('未確定文字列を壊さず、確定した時点で変換する', () => {
    const onChangeSpy = vi.fn()
    const { input, value } = setup({ onChangeSpy })

    fireEvent.compositionStart(input)
    // 変換候補を出している最中。ここで書き換えると候補が壊れる
    fireEvent.change(input, { target: { value: 'ソウサ' } })
    expect(input).toHaveValue('ソウサ')
    expect(onChangeSpy).not.toHaveBeenCalled()
    expect(value()).toBe('')

    fireEvent.compositionEnd(input, { data: 'ソウサ' })
    expect(onChangeSpy).toHaveBeenCalledWith('そうさ')
    expect(value()).toBe('そうさ')
    expect(input).toHaveValue('そうさ')
  })

  it('漢字に変換して確定した場合は落とす', () => {
    const { input, value } = setup()
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '匝瑳' } })
    expect(input).toHaveValue('匝瑳')
    fireEvent.compositionEnd(input, { data: '匝瑳' })
    expect(value()).toBe('')
  })

  it('変換確定の Enter では送信しない', () => {
    const onSubmit = vi.fn()
    const { input } = setup({ onSubmit })
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'そうさ' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

/**
 * macOS の日本語 IME（Chrome / Safari）でローマ字を打つと composition が始まり、
 * スペースやライブ変換で漢字になってから Enter で確定する。
 * 実機のイベント順序:
 *   compositionstart
 *   → (keydown → input → compositionupdate) を打鍵ごとに繰り返す
 *   → 変換（Space / ライブ変換）で compositionupdate の data だけが漢字になる
 *   → 確定の Enter で keydown → compositionend(data=確定文字列) → input
 * keydown の key は変換中 'Process' などになるので code（物理キー）で拾う。
 */
describe('IME で漢字に変換されても読みに戻す', () => {
  /**
   * 変換中の 1 打鍵ぶん（keydown → input → compositionupdate）を流す。
   * 2 文字目以降なので isComposing は true。
   */
  function stroke(input: HTMLInputElement, code: string, composed: string) {
    fireEvent.keyDown(input, { key: 'Process', code, keyCode: 229, isComposing: true })
    fireEvent.change(input, { target: { value: composed } })
    fireEvent.compositionUpdate(input, { data: composed })
  }

  /**
   * IME の 1 打鍵目。実機では keydown が compositionstart より**前**に来て、
   * この keydown の isComposing はまだ false（keyCode だけが 229 になる）。
   */
  function firstStroke(input: HTMLInputElement, code: string, composed: string) {
    fireEvent.keyDown(input, { key: 'Process', code, keyCode: 229, isComposing: false })
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: composed } })
    fireEvent.compositionUpdate(input, { data: composed })
  }

  it('(a) スペースで変換して Enter 確定しても、打鍵列から読みに戻る', () => {
    const onSubmit = vi.fn()
    const { input, value } = setup({ onSubmit })

    firstStroke(input, 'KeyS', 's')
    stroke(input, 'KeyO', 'そ')
    stroke(input, 'KeyU', 'そう')
    stroke(input, 'KeyS', 'そうs')
    stroke(input, 'KeyA', 'そうさ')

    // 変換キー（スペース）。打鍵列には入らない
    fireEvent.keyDown(input, { key: 'Process', code: 'Space', isComposing: true })
    fireEvent.change(input, { target: { value: '匝瑳' } })
    fireEvent.compositionUpdate(input, { data: '匝瑳' })

    // 確定の Enter。これは解答の送信ではない
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', isComposing: true })
    fireEvent.compositionEnd(input, { data: '匝瑳' })
    expect(onSubmit).not.toHaveBeenCalled()

    expect(value()).toBe('そうさ')
    expect(input).toHaveValue('そうさ')

    // 続く Enter は解答の送信
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('(a) 確定直後に遅れて届く「変換後の値」の input で上書きされない', () => {
    const { input, value } = setup()
    firstStroke(input, 'KeyS', 's')
    stroke(input, 'KeyO', 'そ')
    stroke(input, 'KeyU', 'そう')
    stroke(input, 'KeyS', 'そうs')
    stroke(input, 'KeyA', 'そうさ')
    fireEvent.change(input, { target: { value: '匝瑳' } })
    fireEvent.compositionUpdate(input, { data: '匝瑳' })
    fireEvent.compositionEnd(input, { data: '匝瑳' })
    // Chrome は compositionend の直後に、まだ変換後の値のまま input を出す
    fireEvent.change(input, { target: { value: '匝瑳' } })

    expect(value()).toBe('そうさ')
    expect(input).toHaveValue('そうさ')
  })

  it('(b) ライブ変換で途中から漢字になっても打鍵列から戻る', () => {
    const { input, value } = setup()
    firstStroke(input, 'KeyS', 's')
    stroke(input, 'KeyO', 'そ')
    stroke(input, 'KeyU', 'そう')
    // ここからライブ変換が走って未確定文字列が漢字になる
    stroke(input, 'KeyS', '総')
    stroke(input, 'KeyA', '総さ')
    fireEvent.compositionUpdate(input, { data: '匝瑳' })
    fireEvent.compositionEnd(input, { data: '匝瑳' })

    expect(value()).toBe('そうさ')
  })

  it('(c) Backspace を含む打鍵列を正しくたどる', () => {
    const { input, value } = setup()
    fireEvent.keyDown(input, { key: 'Process', code: 'KeyS', keyCode: 229, isComposing: false })
    fireEvent.compositionStart(input)
    for (const code of ['KeyO', 'KeyU', 'KeyS', 'KeyA', 'Backspace', 'Backspace', 'KeyK', 'KeyI']) {
      fireEvent.keyDown(input, { key: 'Process', code, keyCode: 229, isComposing: true })
    }
    fireEvent.change(input, { target: { value: '双鬼' } })
    fireEvent.compositionEnd(input, { data: '双鬼' })

    expect(value()).toBe('そうき')
  })

  it('(d) かなのまま確定したら確定文字列を使う（フリック・かな入力）', () => {
    const { input, value } = setup()
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'そうさ' } })
    fireEvent.compositionEnd(input, { data: 'そうさ' })

    expect(value()).toBe('そうさ')
  })

  it('(d) 打鍵列があっても、かなで確定したならそちらを優先する', () => {
    const { input, value } = setup()
    firstStroke(input, 'KeyS', 's')
    stroke(input, 'KeyO', 'そ')
    // 候補から別の読みを選び直してかなで確定した
    fireEvent.compositionEnd(input, { data: 'ソウサ' })

    expect(value()).toBe('そうさ')
  })

  it('(e) 打鍵も未確定履歴も無い漢字（貼り付け）は従来どおり取り除く', () => {
    const { input, value } = setup()
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '匝瑳' } })
    fireEvent.compositionEnd(input, { data: '匝瑳' })

    expect(value()).toBe('')
  })

  it('既に確定している文字の後ろに変換を足しても、前半は壊れない', () => {
    const { input, value } = setup()
    fireEvent.change(input, { target: { value: 'はつ' } })
    expect(value()).toBe('はつ')

    fireEvent.keyDown(input, { key: 'Process', code: 'KeyK', keyCode: 229, isComposing: false })
    fireEvent.compositionStart(input)
    for (const code of ['KeyA', 'KeyI', 'KeyC', 'KeyH', 'KeyI']) {
      fireEvent.keyDown(input, { key: 'Process', code, keyCode: 229, isComposing: true })
    }
    fireEvent.change(input, { target: { value: 'はつ市' } })
    fireEvent.compositionEnd(input, { data: '市' })

    expect(value()).toBe('はつかいち')
  })

  it('先頭の keydown が compositionstart より前でも 1 文字目を落とさない', () => {
    const { input, value } = setup()

    // 実機の順序: keydown(229・isComposing=false) → compositionstart → input → update
    fireEvent.keyDown(input, { key: 'Process', code: 'KeyS', keyCode: 229, isComposing: false })
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 's' } })
    fireEvent.compositionUpdate(input, { data: 's' })

    stroke(input, 'KeyO', 'そ')
    stroke(input, 'KeyU', 'そう')
    stroke(input, 'KeyS', 'そうs')
    stroke(input, 'KeyA', 'そうさ')
    fireEvent.change(input, { target: { value: '匝瑳' } })
    fireEvent.compositionUpdate(input, { data: '匝瑳' })
    fireEvent.compositionEnd(input, { data: '匝瑳' })

    // 先頭を拾い損ねると「おうさ」になる
    expect(value()).toBe('そうさ')
  })

  it('先頭 keydown の key が Process でなく keyCode だけ 229 の場合も拾う', () => {
    const { input, value } = setup()

    fireEvent.keyDown(input, { key: 'Unidentified', code: 'KeyS', keyCode: 229, isComposing: false })
    fireEvent.compositionStart(input)
    stroke(input, 'KeyO', 'そ')
    stroke(input, 'KeyU', 'そう')
    stroke(input, 'KeyS', 'そうs')
    stroke(input, 'KeyA', 'そうさ')
    fireEvent.compositionEnd(input, { data: '匝瑳' })

    expect(value()).toBe('そうさ')
  })

  it('2 問続けて変換しても、前の問題の打鍵列が混ざらない', () => {
    const { input, value } = setup()

    firstStroke(input, 'KeyS', 's')
    stroke(input, 'KeyO', 'そ')
    stroke(input, 'KeyU', 'そう')
    stroke(input, 'KeyS', 'そうs')
    stroke(input, 'KeyA', 'そうさ')
    fireEvent.change(input, { target: { value: '匝瑳' } })
    fireEvent.compositionEnd(input, { data: '匝瑳' })
    expect(value()).toBe('そうさ')

    // 解答欄をクリアして次の変換へ
    fireEvent.change(input, { target: { value: '' } })
    expect(value()).toBe('')

    firstStroke(input, 'KeyK', 'k')
    stroke(input, 'KeyA', 'か')
    fireEvent.change(input, { target: { value: '蚊' } })
    fireEvent.compositionEnd(input, { data: '蚊' })

    expect(value()).toBe('か')
  })

  it('英数モードのローマ字直打ち（229 でない keydown）は従来どおり wanakana で変換する', async () => {
    const user = userEvent.setup()
    const { input, value } = setup()
    await user.type(input, 'sousa')
    expect(value()).toBe('そうさ')
  })

  it('code が取れない環境（古い Android など）では従来動作に落ちる', () => {
    const { input, value } = setup()
    fireEvent.keyDown(input, { key: 'Process', keyCode: 229, isComposing: false })
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '匝瑳' } })
    fireEvent.compositionEnd(input, { data: '匝瑳' })

    expect(value()).toBe('')
  })
})

describe('Enter', () => {
  it('送信する', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const { input, value } = setup({ onSubmit })
    await user.type(input, 'sousa')
    await user.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(value()).toBe('そうさ')
  })

  it('打ちかけの子音を確定させてから送信する', async () => {
    const user = userEvent.setup()
    const seen: string[] = []
    const onSubmit = vi.fn()
    const { input, value } = setup({ onSubmit, onChangeSpy: (v) => seen.push(v) })
    await user.type(input, 'monzen')
    expect(value()).toBe('もんぜ')
    await user.keyboard('{Enter}')
    expect(value()).toBe('もんぜん')
    expect(seen.at(-1)).toBe('もんぜん')
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})

describe('その他', () => {
  it('案内文を添える', () => {
    const { input } = setup()
    const hint = document.querySelector('.answer-hint') as HTMLElement
    expect(hint).toHaveTextContent('ローマ字でもひらがなでも入力できます。漢字に変換されても読みに戻ります')
    expect(hint).toHaveTextContent('IME を英数にすると変換なしで打てます')
    expect(input).toHaveAttribute('aria-describedby', hint.id)
  })

  it('.answer-input と追加クラスを持つ', () => {
    render(
      <HiraganaInput value="" onChange={() => {}} onSubmit={() => {}} className="extra" ariaLabel="よみ" />,
    )
    expect(screen.getByLabelText('よみ')).toHaveClass('answer-input', 'extra')
  })

  it('ref で入力欄そのものを受け取れる（画面側がフォーカスを戻すため）', () => {
    function WithRef() {
      const ref = useRef<HTMLInputElement>(null)
      return (
        <>
          <HiraganaInput value="" onChange={() => {}} onSubmit={() => {}} ariaLabel="よみ" ref={ref} />
          <button type="button" onClick={() => ref.current?.focus()}>
            もどす
          </button>
        </>
      )
    }
    render(<WithRef />)
    fireEvent.click(screen.getByRole('button', { name: 'もどす' }))
    expect(screen.getByLabelText('よみ')).toHaveFocus()
  })

  it('disabled のときは打てない', async () => {
    const user = userEvent.setup()
    const { input, value } = setup()
    input.disabled = true
    await user.type(input, 'sousa')
    expect(value()).toBe('')
  })

  it('親が value を空に戻すと表示も消える', () => {
    function Reset() {
      const [value, setValue] = useState('そうさ')
      return (
        <>
          <HiraganaInput value={value} onChange={setValue} onSubmit={() => {}} ariaLabel="よみ" />
          <button type="button" onClick={() => setValue('')}>
            つぎ
          </button>
        </>
      )
    }
    render(<Reset />)
    const input = screen.getByLabelText('よみ')
    expect(input).toHaveValue('そうさ')
    fireEvent.click(screen.getByRole('button', { name: 'つぎ' }))
    expect(input).toHaveValue('')
  })

  it('フォーカスを外したときも打ちかけを確定させる', async () => {
    const user = userEvent.setup()
    const { input, value } = setup()
    await user.type(input, 'monzen')
    await user.tab()
    expect(value()).toBe('もんぜん')
    expect(input).toHaveValue('もんぜん')
  })
})

/**
 * 漢字を捨てた・読みに戻したことを入力欄の下に一言出す（#20）。
 * 「黙って消える」のが不具合なので、値だけでなく通知の有無を固定する。
 */
describe('捨てた・戻したことを伝える', () => {
  const DROPPED = '漢字や記号は入りません。ひらがなで書いてください'
  const RECOVERED = '漢字を読み（ひらがな）に戻しました'

  /** 入力欄の下の通知。空なら '' */
  function notice() {
    return (document.querySelector('.answer-notice') as HTMLElement).textContent
  }

  it('貼り付けた漢字を捨てたら、その旨を出す', () => {
    const { input, value } = setup()
    fireEvent.change(input, { target: { value: '銚子' } })
    expect(value()).toBe('')
    expect(input).toHaveValue('')
    expect(notice()).toBe(DROPPED)
  })

  it('読み上げ用に aria-live を持ち、案内文の場所を借りる', () => {
    const { input } = setup()
    const region = document.querySelector('.answer-notice') as HTMLElement
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(document.querySelector('.answer-hint')).not.toHaveClass('is-hushed')

    fireEvent.change(input, { target: { value: '銚子' } })
    expect(document.querySelector('.answer-hint')).toHaveClass('is-hushed')
  })

  it.each([
    ['ちょうし'],
    ['チョウシ'],
    ['choushi'],
    ['kuma-ta'],
    [''],
  ])('ひらがな・カタカナ・ローマ字（%s）では出さない', (typed) => {
    const { input } = setup()
    fireEvent.change(input, { target: { value: typed } })
    expect(notice()).toBe('')
  })

  it('打ちかけの子音が残っていても出さない', async () => {
    const user = userEvent.setup()
    const { input } = setup()
    await user.type(input, 'monzen')
    expect(input).toHaveValue('もんぜn')
    expect(notice()).toBe('')
  })

  it('次の入力で消える', () => {
    const { input } = setup()
    fireEvent.change(input, { target: { value: '銚子' } })
    expect(notice()).toBe(DROPPED)
    fireEvent.change(input, { target: { value: 'ちょ' } })
    expect(notice()).toBe('')
  })

  it('IME の確定（compositionend）で捨てたときも出る', () => {
    const { input, value } = setup()
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '銚子' } })
    fireEvent.compositionEnd(input, { data: '銚子' })
    // 打鍵の痕跡が無い（手書き入力・候補の貼り付け）ので漢字は落ちる
    expect(value()).toBe('')
    expect(notice()).toBe(DROPPED)

    // Chrome が後追いで出す「変換後の生の値」の input でも消えない
    fireEvent.change(input, { target: { value: '銚子' } })
    expect(notice()).toBe(DROPPED)
  })

  it('打鍵列から読みに戻せたときは「戻した」と出す', () => {
    const { input, value } = setup()
    fireEvent.keyDown(input, { key: 'Process', code: 'KeyT', keyCode: 229, isComposing: false })
    fireEvent.compositionStart(input)
    for (const code of ['KeyY', 'KeyO', 'KeyU', 'KeyS', 'KeyH', 'KeyI']) {
      fireEvent.keyDown(input, { key: 'Process', code, keyCode: 229, isComposing: true })
    }
    fireEvent.change(input, { target: { value: '銚子' } })
    fireEvent.compositionEnd(input, { data: '銚子' })

    expect(value()).toBe('ちょうし')
    expect(input).toHaveValue('ちょうし')
    expect(notice()).toBe(RECOVERED)
  })

  it('かなのまま確定したときは何も出さない', () => {
    const { input, value } = setup()
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'チョウシ' } })
    fireEvent.compositionEnd(input, { data: 'チョウシ' })
    expect(value()).toBe('ちょうし')
    expect(notice()).toBe('')
  })

  it('変換を始めた時点で前の通知は消える', () => {
    const { input } = setup()
    fireEvent.change(input, { target: { value: '銚子' } })
    expect(notice()).toBe(DROPPED)
    fireEvent.compositionStart(input)
    expect(notice()).toBe('')
  })

  it('Enter で送ると消える', async () => {
    const user = userEvent.setup()
    const { input } = setup()
    await user.click(input)
    fireEvent.change(input, { target: { value: 'ちょうし銚子' } })
    expect(notice()).toBe(DROPPED)
    await user.keyboard('{Enter}')
    expect(notice()).toBe('')
  })

  it('次の問題（親が value を空に戻す）で消える', () => {
    function Reset() {
      const [value, setValue] = useState('')
      return (
        <>
          <HiraganaInput value={value} onChange={setValue} onSubmit={() => {}} ariaLabel="よみ" />
          <button type="button" onClick={() => setValue('')}>
            つぎ
          </button>
        </>
      )
    }
    render(<Reset />)
    const input = screen.getByLabelText('よみ')
    fireEvent.change(input, { target: { value: '銚子' } })
    expect(notice()).toBe(DROPPED)
    fireEvent.change(input, { target: { value: 'ちょうし' } })
    fireEvent.click(screen.getByRole('button', { name: 'つぎ' }))
    expect(input).toHaveValue('')
    expect(notice()).toBe('')
  })
})
