// @vitest-environment jsdom
/**
 * 2 段階ピッカー（地方 → 都道府県）の単体テスト。
 *
 * jsdom には ResizeObserver もレイアウトも無いので、チップは既定サイズ（345x240）を
 * 前提に配置される。位置そのものは見ず、「押せる操作子が正しく出るか」を見る。
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PrefectureCollection } from '../geo/load.ts'
import { REGIONS, regionOfPref } from '../geo/regions.ts'
import RegionPicker from './RegionPicker.tsx'

afterEach(cleanup)

/** 1 県 = 1 つの矩形。経度緯度は地方ごとにだいたいの位置へ置く */
function square(lon: number, lat: number): PrefectureCollection['features'][number]['geometry'] {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lon, lat],
        [lon + 0.8, lat],
        [lon + 0.8, lat + 0.8],
        [lon, lat + 0.8],
        [lon, lat],
      ],
    ],
  }
}

const PREFS: { code: string; name: string; lon: number; lat: number }[] = [
  { code: '01', name: '北海道', lon: 142.5, lat: 43.0 },
  { code: '02', name: '青森県', lon: 140.6, lat: 40.6 },
  { code: '04', name: '宮城県', lon: 140.7, lat: 38.3 },
  { code: '12', name: '千葉県', lon: 140.1, lat: 35.5 },
  { code: '13', name: '東京都', lon: 139.4, lat: 35.6 },
  { code: '14', name: '神奈川県', lon: 139.3, lat: 35.3 },
  { code: '27', name: '大阪府', lon: 135.4, lat: 34.6 },
  { code: '40', name: '福岡県', lon: 130.5, lat: 33.5 },
  { code: '47', name: '沖縄県', lon: 127.8, lat: 26.3 },
]

const COLLECTION: PrefectureCollection = {
  type: 'FeatureCollection',
  features: PREFS.map((p) => ({
    type: 'Feature',
    properties: { prefCode: p.code, name: p.name },
    geometry: square(p.lon, p.lat),
  })),
}

const OPTIONS = PREFS.map((p) => ({ code: p.code, name: p.name }))

function renderPicker(props: Partial<React.ComponentProps<typeof RegionPicker>> = {}) {
  const onSelect = vi.fn()
  render(<RegionPicker collection={COLLECTION} prefectures={OPTIONS} onSelect={onSelect} {...props} />)
  return onSelect
}

describe('地方の定義', () => {
  it('47 都道府県がちょうど 1 つの地方に属する', () => {
    const codes = REGIONS.flatMap((r) => r.prefCodes)
    expect(codes).toHaveLength(47)
    expect(new Set(codes).size).toBe(47)
    expect(regionOfPref('13')?.id).toBe('kanto')
    expect(regionOfPref('15')?.id).toBe('hokuriku')
    expect(regionOfPref('19')?.id).toBe('chubu')
    expect(regionOfPref('31')?.id).toBe('chugoku-shikoku')
    expect(regionOfPref('47')?.id).toBe('okinawa')
  })
})

describe('RegionPicker', () => {
  it('段階 1 では地方チップが出て、都道府県は出ない', () => {
    renderPicker()

    expect(screen.getByText('地方をえらぶ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '関東地方' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '東北地方' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '千葉県' })).toBeNull()
    expect(document.querySelector('.jp-map__grid')).toBeNull()
  })

  it('地方を押すと段階 2（その地方の都道府県）になる', () => {
    renderPicker()

    fireEvent.click(screen.getByRole('button', { name: '関東地方' }))

    expect(screen.getByText('関東の都道府県をえらぶ')).toBeInTheDocument()
    // 地図のチップとボタングリッドの両方から選べる
    expect(screen.getAllByRole('button', { name: '千葉県' }).length).toBeGreaterThanOrEqual(2)
    expect(document.querySelectorAll('.jp-map__cell')).toHaveLength(3) // 12・13・14
    // 他の地方の県は出ない
    expect(screen.queryByRole('button', { name: '大阪府' })).toBeNull()
  })

  it('段階 2 で都道府県を押すと onSelect が呼ばれる（チップ・グリッドのどちらでも）', () => {
    const onSelect = renderPicker()
    fireEvent.click(screen.getByRole('button', { name: '関東地方' }))

    fireEvent.click(document.querySelector('.jp-map__chip[aria-label="東京都"]')!)
    expect(onSelect).toHaveBeenLastCalledWith('13', '東京都')

    fireEvent.click([...document.querySelectorAll('.jp-map__cell')].find((b) => b.textContent === '神奈川県')!)
    expect(onSelect).toHaveBeenLastCalledWith('14', '神奈川県')
  })

  it('「地方を選び直す」で段階 1 へ戻る', () => {
    renderPicker()
    fireEvent.click(screen.getByRole('button', { name: '関東地方' }))
    expect(screen.getByRole('button', { name: '地方を選び直す' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '地方を選び直す' }))

    expect(screen.getByText('地方をえらぶ')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '千葉県' })).toBeNull()
  })

  it('1 県しかない地方（北海道・沖縄）は段階 2 を挟まず直接選べる', () => {
    const onSelect = renderPicker()

    fireEvent.click(screen.getByRole('button', { name: '北海道地方' }))
    expect(onSelect).toHaveBeenLastCalledWith('01', '北海道')
    expect(screen.getByText('地方をえらぶ')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '沖縄地方' }))
    expect(onSelect).toHaveBeenLastCalledWith('47', '沖縄県')
  })

  it('選択中の都道府県はチップと塗りに印が付く', () => {
    renderPicker({ selected: '13' })

    // 段階 1 では所属する地方（関東）が選択中
    expect(screen.getByRole('button', { name: '関東地方' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '東北地方' })).toHaveAttribute('aria-pressed', 'false')
    expect(document.querySelector('.jp-map__path--selected[data-pref-code="13"]')).not.toBeNull()
  })

  it('地図が読めないときはボタングリッドだけで全県えらべる', () => {
    const onSelect = renderPicker({ collection: null })

    expect(screen.getByText(/地図を読み込めませんでした/)).toBeInTheDocument()
    expect(document.querySelectorAll('.jp-map__cell')).toHaveLength(PREFS.length)

    fireEvent.click(screen.getByRole('button', { name: '大阪府' }))
    expect(onSelect).toHaveBeenCalledWith('27', '大阪府')
  })

  it('チップは最小タップ領域と読み上げ名を持つ（キーボードでも押せる）', () => {
    renderPicker()
    const chip = screen.getByRole('button', { name: '関東地方' })

    expect(chip.tagName).toBe('BUTTON')
    expect(chip).toHaveClass('jp-map__chip')
    // <button> なので Tab で到達でき、Enter / Space はブラウザ既定で click になる
    expect(chip).not.toHaveAttribute('tabindex')
    fireEvent.click(chip)
    expect(screen.getByText('関東の都道府県をえらぶ')).toBeInTheDocument()
  })
})
