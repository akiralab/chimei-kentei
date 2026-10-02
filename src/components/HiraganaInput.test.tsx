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
import { useState } from 'react'
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
    const hint = screen.getByText(/ローマ字でもひらがなでも入力できます/)
    expect(hint).toHaveClass('answer-hint')
    expect(input).toHaveAttribute('aria-describedby', hint.id)
  })

  it('.answer-input と追加クラスを持つ', () => {
    render(
      <HiraganaInput value="" onChange={() => {}} onSubmit={() => {}} className="extra" ariaLabel="よみ" />,
    )
    expect(screen.getByLabelText('よみ')).toHaveClass('answer-input', 'extra')
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
