// @vitest-environment jsdom
/**
 * 出題中の市区町村が県内のどこかを示す地図。強調クラスの付き方と、読めないときの退避。
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { emptyGeoSource, fixtureGeoSource } from '../geo/__fixtures__/geo.ts'
import MunicipalityMap from './MunicipalityMap.tsx'

afterEach(cleanup)

function path(lgCode: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.map-muni__path[data-lg-code="${lgCode}"]`)
}

describe('MunicipalityMap', () => {
  it('県内の市区町村を描き、対象の lgCode だけ強調クラスが付く', async () => {
    render(<MunicipalityMap prefCode="12" lgCode="120002" prefName="千葉県" source={fixtureGeoSource()} />)

    await waitFor(() => {
      expect(document.querySelectorAll('.map-muni__path')).toHaveLength(3)
    })
    expect(path('120002')).toHaveClass('map-muni__path--target')
    expect(path('120001')).not.toHaveClass('map-muni__path--target')
    expect(path('120003')).not.toHaveClass('map-muni__path--target')
  })

  it('difficult の大字でも所属市区町村（lgCode）が光る', async () => {
    // 大字の Question でも lgCode は所属自治体なので、easy と同じ呼び方になる
    render(<MunicipalityMap prefCode="13" lgCode="130003" source={fixtureGeoSource()} />)

    await waitFor(() => {
      expect(path('130003')).toHaveClass('map-muni__path--target')
    })
  })

  it('lgCode を省くと県の形だけを描く（塗り・縁取り・照準リングを出さない）', async () => {
    // 地名帳（#/atlas/12）で行を選ぶ前の状態
    render(<MunicipalityMap prefCode="12" prefName="千葉県" source={fixtureGeoSource()} />)

    await waitFor(() => {
      expect(document.querySelectorAll('.map-muni__path')).toHaveLength(3)
    })
    expect(document.querySelector('.map-muni__path--target')).toBeNull()
    expect(document.querySelector('.map-muni__halo')).toBeNull()
    expect(document.querySelector('.map-muni__pin')).toBeNull()
  })

  it('caption を渡すと見出しと読み上げ名が差し替わる（既定は出題画面の「{県名}のどこ？」）', async () => {
    // 既定（出題画面）。問いの言い方のまま
    render(<MunicipalityMap prefCode="13" lgCode="130003" prefName="東京都" source={fixtureGeoSource()} />)
    await waitFor(() => {
      expect(document.querySelector('.map-muni__caption')?.textContent).toBe('東京都のどこ？')
    })
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '東京都の中の出題地点')

    // 地名帳はクイズではないので範囲の名前をそのまま出す
    cleanup()
    render(
      <MunicipalityMap
        prefCode="13"
        lgCode="130003"
        prefName="東京都"
        caption="東京都・23区"
        source={fixtureGeoSource()}
      />,
    )
    await waitFor(() => {
      expect(document.querySelector('.map-muni__caption')?.textContent).toBe('東京都・23区')
    })
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '東京都・23区の地図')
  })

  it('地図が読めなければ 1 行の注記にとどめ、パネルは残す', async () => {
    render(<MunicipalityMap prefCode="12" lgCode="120001" source={emptyGeoSource()} />)

    await waitFor(() => {
      expect(screen.getByText('地図を読み込めませんでした')).toBeInTheDocument()
    })
    expect(document.querySelector('.map-muni')).not.toBeNull()
  })
})
