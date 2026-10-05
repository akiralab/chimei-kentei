/**
 * 共有の文面（engine/share.ts）。文面はここで固定する ——
 * 変えるときは UI ではなくこのテストから直す。
 */
import { describe, expect, it } from 'vitest'
import { APP_NAME, buildShare } from './share.ts'

const URL = 'https://akiralab.github.io/chimei-kentei/#/q/abr20260925r2-e-12-1234'

describe('buildShare', () => {
  it('範囲・科目・得点を並べ、末尾にリンクを置く', () => {
    const p = buildShare({ range: '千葉県', subject: '市区町村名', score: 80, url: URL })
    expect(p.title).toBe(APP_NAME)
    expect(p.text).toBe(`地名読み検定 千葉県・市区町村名 80 点。この問題で挑戦 → ${URL}`)
    expect(p.url).toBe(URL)
  })

  it('得点が無ければ（結果の前なら）得点を省く', () => {
    const p = buildShare({ range: '千葉県', subject: '市区町村名', score: null, url: URL })
    expect(p.text).toBe(`地名読み検定 千葉県・市区町村名。この問題で挑戦 → ${URL}`)
  })

  it('0 点は省かない（null だけが「得点が無い」）', () => {
    const p = buildShare({ range: '全国', subject: '市区町村名', score: 0, url: URL })
    expect(p.text).toContain('全国・市区町村名 0 点。')
  })

  it('範囲や科目が空なら中黒が余らない', () => {
    expect(buildShare({ range: '東京都・23区', subject: '', score: 50, url: URL }).text).toBe(
      `地名読み検定 東京都・23区 50 点。この問題で挑戦 → ${URL}`,
    )
    expect(buildShare({ url: URL }).text).toBe(`地名読み検定。この問題で挑戦 → ${URL}`)
  })
})
