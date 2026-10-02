// @vitest-environment jsdom
/**
 * 日本地図からの都道府県選択。クリックとキーボード（Enter / Space）の両方で選べること。
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { JAPAN_FIXTURE } from '../geo/__fixtures__/geo.ts'
import JapanMap from './JapanMap.tsx'

afterEach(cleanup)

function paths(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.jp-map__path')]
}

describe('JapanMap', () => {
  it('県の数だけ path を描き、クリックで onSelect が呼ばれる', () => {
    const onSelect = vi.fn()
    render(<JapanMap collection={JAPAN_FIXTURE} onSelect={onSelect} />)

    expect(paths()).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: '千葉県' }))
    expect(onSelect).toHaveBeenCalledWith('12', '千葉県')
  })

  it('Enter と Space でも選べる（キーボード操作）', () => {
    const onSelect = vi.fn()
    render(<JapanMap collection={JAPAN_FIXTURE} onSelect={onSelect} />)
    const tokyo = screen.getByRole('button', { name: '東京都' })

    expect(tokyo).toHaveAttribute('tabindex', '0')

    fireEvent.keyDown(tokyo, { key: 'Enter' })
    fireEvent.keyDown(tokyo, { key: ' ' })
    fireEvent.keyDown(tokyo, { key: 'a' })

    expect(onSelect).toHaveBeenCalledTimes(2)
    expect(onSelect).toHaveBeenLastCalledWith('13', '東京都')
  })

  it('選択中の県に --selected が付き、aria-pressed が立つ', () => {
    render(<JapanMap collection={JAPAN_FIXTURE} selected="13" onSelect={vi.fn()} />)

    const tokyo = screen.getByRole('button', { name: '東京都' })
    expect(tokyo).toHaveClass('jp-map__path--selected')
    expect(tokyo).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '千葉県' })).not.toHaveClass('jp-map__path--selected')
  })

  it('hover と focus で県名ラベルが出て、離れると消える', () => {
    render(<JapanMap collection={JAPAN_FIXTURE} onSelect={vi.fn()} />)
    expect(document.querySelector('.jp-map__label')).toBeNull()

    const chiba = screen.getByRole('button', { name: '千葉県' })
    fireEvent.mouseEnter(chiba)
    expect(document.querySelector('.jp-map__label')?.textContent).toBe('千葉県')

    fireEvent.mouseLeave(chiba)
    expect(document.querySelector('.jp-map__label')).toBeNull()

    fireEvent.focus(chiba)
    expect(document.querySelector('.jp-map__label')?.textContent).toBe('千葉県')
  })

  it('描けるジオメトリが無ければ注記だけ出す', () => {
    render(<JapanMap collection={{ type: 'FeatureCollection', features: [] }} onSelect={vi.fn()} />)
    expect(screen.getByText('地図を描けませんでした')).toBeInTheDocument()
  })
})
