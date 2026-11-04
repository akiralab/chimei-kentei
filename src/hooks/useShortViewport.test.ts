// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useShortViewport } from './useShortViewport.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useShortViewport', () => {
  it('visualViewport が無ければ innerHeight を見る', () => {
    vi.stubGlobal('innerHeight', 420)
    expect(renderHook(() => useShortViewport()).result.current).toBe(true)

    vi.stubGlobal('innerHeight', 667)
    expect(renderHook(() => useShortViewport()).result.current).toBe(false)
  })

  it('iOS Safari のように innerHeight が変わらなくても visualViewport の縮みを拾う', () => {
    const viewport = Object.assign(new EventTarget(), { height: 844 })
    vi.stubGlobal('visualViewport', viewport)
    vi.stubGlobal('innerHeight', 844)

    const { result } = renderHook(() => useShortViewport())
    expect(result.current).toBe(false)

    act(() => {
      viewport.height = 479
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(result.current).toBe(true)

    act(() => {
      viewport.height = 844
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(result.current).toBe(false)
  })
})
