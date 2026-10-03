// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  ATLAS_PATH,
  COVER_PATH,
  SELECT_PATH,
  atlasPath,
  hasNavigated,
  navigate,
  parseHash,
  quizPath,
  resetNavigated,
  resultPath,
} from './router.ts'

describe('parseHash', () => {
  it('表紙', () => {
    expect(parseHash('')).toEqual({ name: 'cover' })
    expect(parseHash('#')).toEqual({ name: 'cover' })
    expect(parseHash('#/')).toEqual({ name: 'cover' })
  })

  it('範囲・科目', () => {
    expect(parseHash('#/select')).toEqual({ name: 'select' })
  })

  it('出題・結果は setId を取り出す', () => {
    expect(parseHash('#/q/abr20260925-e-12-1234')).toEqual({ name: 'quiz', setId: 'abr20260925-e-12-1234' })
    expect(parseHash('#/result/abr20260925-d-122165-20261002')).toEqual({
      name: 'result',
      setId: 'abr20260925-d-122165-20261002',
    })
  })

  it('不明なハッシュは表紙', () => {
    expect(parseHash('#/nope')).toEqual({ name: 'cover' })
    expect(parseHash('#/q/')).toEqual({ name: 'cover' })
    expect(parseHash('#/q/a/b')).toEqual({ name: 'cover' })
  })

  it('地名帳は 入口 / 一覧 / 行 の 3 段', () => {
    expect(parseHash(ATLAS_PATH)).toEqual({ name: 'atlas' })
    expect(parseHash('#/atlas/13')).toEqual({ name: 'atlasScope', scope: '13' })
    // 地域（3 文字 scope）もそのまま共有できる
    expect(parseHash('#/atlas/13k')).toEqual({ name: 'atlasScope', scope: '13k' })
    expect(parseHash('#/atlas/13k/131199')).toEqual({ name: 'atlasRow', scope: '13k', lgCode: '131199' })
  })

  it('綴りの合わない地名帳の URL は表紙へ落とす', () => {
    // 全国 '00' は使わない（入口で都道府県を選ばせる）
    expect(parseHash('#/atlas/00')).toEqual({ name: 'cover' })
    expect(parseHash('#/atlas/1')).toEqual({ name: 'cover' })
    expect(parseHash('#/atlas/13kk')).toEqual({ name: 'cover' })
    expect(parseHash('#/atlas/13/13119')).toEqual({ name: 'cover' })
    expect(parseHash('#/atlas/13/131199/x')).toEqual({ name: 'cover' })
  })

  it('地名帳のパス生成はルータで往復する', () => {
    expect(atlasPath()).toBe(ATLAS_PATH)
    expect(parseHash(atlasPath('01c'))).toEqual({ name: 'atlasScope', scope: '01c' })
    expect(parseHash(atlasPath('01c', '011002'))).toEqual({ name: 'atlasRow', scope: '01c', lgCode: '011002' })
  })

  it('パス生成はルータで往復する', () => {
    const setId = 'abr20260925-e-00-20261002'
    expect(parseHash(quizPath(setId))).toEqual({ name: 'quiz', setId })
    expect(parseHash(resultPath(setId))).toEqual({ name: 'result', setId })
  })
})

describe('ハッシュ遷移の記録', () => {
  it('読み込み直後は未遷移。navigate() で立ち、resetNavigated() で戻る', () => {
    resetNavigated()
    expect(hasNavigated()).toBe(false)

    navigate(SELECT_PATH)
    expect(hasNavigated()).toBe(true)

    // 同じハッシュへの navigate（hashchange が飛ばない経路）でも遷移として数える
    resetNavigated()
    location.hash = COVER_PATH
    navigate(COVER_PATH)
    expect(hasNavigated()).toBe(true)
  })
})
