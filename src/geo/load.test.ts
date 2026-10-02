/**
 * 地図ローダー。出題を止めないため「失敗は例外ではなく null」が契約。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFetchGeoSource } from './load.ts'
import { JAPAN_FIXTURE, PREF_GEO_FIXTURE, STATS_FIXTURE } from './__fixtures__/geo.ts'

const BASE = 'https://example.test/geo/'

function stubFetch(body: (url: string) => unknown | undefined): ReturnType<typeof vi.fn> {
  const spy = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    const found = body(url)
    if (found === undefined) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('not found')) })
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(found) })
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createFetchGeoSource', () => {
  it('japan / pref / stats を読む', async () => {
    stubFetch((url) => {
      if (url.endsWith('/japan.json')) return JAPAN_FIXTURE
      if (url.endsWith('/pref/12.json')) return PREF_GEO_FIXTURE['12']
      if (url.endsWith('/municipalities.json')) return STATS_FIXTURE
      return undefined
    })
    const geo = createFetchGeoSource(BASE)

    expect((await geo.japan())?.features).toHaveLength(2)
    expect((await geo.pref('12'))?.features).toHaveLength(3)
    expect((await geo.stats())?.['120001'].population).toBe(1_234_567)
  })

  it('404 なら null を返す（例外にしない）', async () => {
    stubFetch(() => undefined)
    const geo = createFetchGeoSource(BASE)

    await expect(geo.japan()).resolves.toBeNull()
    await expect(geo.pref('47')).resolves.toBeNull()
    await expect(geo.stats()).resolves.toBeNull()
  })

  it('fetch 自体が落ちても null を返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    )
    const geo = createFetchGeoSource(BASE)

    await expect(geo.japan()).resolves.toBeNull()
  })

  it('FeatureCollection でない JSON は null（壊れたデータを描画に流さない）', async () => {
    stubFetch(() => ({ type: 'Topology' }))
    const geo = createFetchGeoSource(BASE)

    await expect(geo.japan()).resolves.toBeNull()
  })

  it('成功はキャッシュして 1 回しか取りに行かない。失敗は再試行できる', async () => {
    const ok = stubFetch((url) => (url.endsWith('/japan.json') ? JAPAN_FIXTURE : undefined))
    const geo = createFetchGeoSource(BASE)

    await geo.japan()
    await geo.japan()
    expect(ok).toHaveBeenCalledTimes(1)

    // 404 だった pref は毎回取りに行く（データが後から生成される運用なので）
    await geo.pref('12')
    await geo.pref('12')
    expect(ok).toHaveBeenCalledTimes(3)
  })
})
