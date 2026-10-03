// @vitest-environment jsdom
/**
 * 自治体情報カード。数値が 3 桁区切りで出ること、
 * そして「常に同じ枠を描く（解答前はプレースホルダー）」ことを押さえる。
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { emptyGeoSource, fixtureGeoSource } from '../geo/__fixtures__/geo.ts'
import MunicipalityInfo from './MunicipalityInfo.tsx'
import { groupDigits } from '../geo/format.ts'

afterEach(cleanup)

describe('groupDigits', () => {
  it('3 桁区切り。小数桁も指定できる', () => {
    expect(groupDigits(0)).toBe('0')
    expect(groupDigits(902)).toBe('902')
    expect(groupDigits(38_601)).toBe('38,601')
    expect(groupDigits(9_733_276)).toBe('9,733,276')
    expect(groupDigits(1234.56, 2)).toBe('1,234.56')
    expect(groupDigits(Number.NaN)).toBe('—')
  })
})

describe('MunicipalityInfo', () => {
  it('解答後は人口・世帯数・面積・人口密度を 3 桁区切りで出し、出典を添える', async () => {
    render(<MunicipalityInfo lgCode="120001" revealed reading="ち1" source={fixtureGeoSource()} />)

    await waitFor(() => {
      expect(screen.getByText('千市1')).toBeInTheDocument()
    })
    expect(screen.getByText('1,234,567')).toBeInTheDocument()
    expect(screen.getByText('567,890')).toBeInTheDocument()
    expect(screen.getByText('1,234.56')).toBeInTheDocument()
    // 密度 = 1,234,567 / 1234.56 ≒ 1,000
    expect(screen.getByText('1,000')).toBeInTheDocument()
    expect(screen.getByText('出典: 2020 年国勢調査（e-Stat 境界データ）')).toBeInTheDocument()

    // easy は読みを添える
    expect(document.querySelector('.info-card__reading')?.textContent).toBe('ち1')
    expect(document.querySelector('.info-card')).not.toHaveClass('info-card--placeholder')
  })

  it('difficult（読みを渡さない）では読みが空。全国モードでは県名を添える', async () => {
    render(<MunicipalityInfo lgCode="130002" revealed prefName="東京都" source={fixtureGeoSource()} />)

    await waitFor(() => {
      expect(screen.getByText('東市2')).toBeInTheDocument()
    })
    expect(document.querySelector('.info-card__reading')?.textContent).toBe('')
    expect(document.querySelector('.info-card__pref')?.textContent).toBe('東京都')
  })

  it('解答前は同じ枠のプレースホルダー（答えになる読みは出さない）', async () => {
    render(<MunicipalityInfo lgCode="120001" revealed={false} reading="ち1" source={fixtureGeoSource()} />)

    // 枠は常にある（解答で高さが動かないように）
    const card = document.querySelector('.info-card')
    expect(card).toHaveClass('info-card--placeholder')
    // 値は伏せたまま。ラベルと出典だけが見える
    expect(screen.getAllByText('—')).toHaveLength(4)
    expect(screen.queryByText('1,234,567')).toBeNull()
    expect(screen.queryByText('ち1')).toBeNull()
    // 自治体名も伏せる（easy では名前そのものが答えに近い）
    expect(screen.queryByText('千市1')).toBeNull()
    expect(screen.getByText('？')).toBeInTheDocument()
  })

  it('プレースホルダーの文言は画面ごとに差し替えられる（地名帳は「行を選ぶと出ます」）', async () => {
    render(
      <MunicipalityInfo lgCode="" revealed placeholder="行を選ぶと出ます" source={fixtureGeoSource()} />,
    )

    await waitFor(() => {
      expect(document.querySelector('.info-card--placeholder')).not.toBeNull()
    })
    expect(document.querySelector('.info-card__reading')?.textContent).toBe('行を選ぶと出ます')
    // 既定は出題画面の文言のまま
    cleanup()
    render(<MunicipalityInfo lgCode="" revealed source={fixtureGeoSource()} />)
    await waitFor(() => {
      expect(document.querySelector('.info-card__reading')?.textContent).toBe('解答すると出ます')
    })
  })

  it('統計が読めない・その自治体の行が無いときもプレースホルダーで高さを保つ', async () => {
    render(<MunicipalityInfo lgCode="120001" revealed source={emptyGeoSource()} />)
    await waitFor(() => {
      expect(document.querySelector('.info-card--placeholder')).not.toBeNull()
    })

    cleanup()
    render(<MunicipalityInfo lgCode="999999" revealed source={fixtureGeoSource()} />)
    await waitFor(() => {
      expect(document.querySelector('.info-card--placeholder')).not.toBeNull()
    })
  })
})
