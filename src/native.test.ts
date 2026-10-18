import { afterEach, describe, expect, it, vi } from 'vitest'
import { haptic, isNative, setupStatusBar, shareNative } from './native.ts'

// Web（殻の外）での振る舞いだけを固定する。殻の中（Capacitor.isNativePlatform() が true）は
// 実機で確かめる（Issue #58 の受け入れ条件 ⑱）。

afterEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error テストで足した navigator.share を片付ける
  delete globalThis.navigator?.share
})

describe('native.ts（Web では殻の機能を呼ばない）', () => {
  it('Web では isNative が false', () => {
    expect(isNative()).toBe(false)
  })

  it('haptic と setupStatusBar は Web では何もせずに解決する', async () => {
    await expect(haptic('success')).resolves.toBeUndefined()
    await expect(haptic('error')).resolves.toBeUndefined()
    await expect(haptic('light')).resolves.toBeUndefined()
    await expect(setupStatusBar()).resolves.toBeUndefined()
  })

  it('navigator.share が無ければ false（呼び手がクリップボードに落とす）', async () => {
    expect(typeof globalThis.navigator?.share).not.toBe('function')
    await expect(shareNative({ url: 'https://example.com/' })).resolves.toBe(false)
  })

  it('navigator.share があればそれを呼んで true', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'share', { value: share, configurable: true, writable: true })
    const payload = { title: '地名読み検定', text: '8 点', url: 'https://example.com/' }
    await expect(shareNative(payload)).resolves.toBe(true)
    expect(share).toHaveBeenCalledWith(payload)
  })

  it('navigator.share を取り消しても（AbortError）true で黙る', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('cancel', 'AbortError'))
    Object.defineProperty(globalThis.navigator, 'share', { value: share, configurable: true, writable: true })
    await expect(shareNative({ url: 'https://example.com/' })).resolves.toBe(true)
  })
})
