// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { CONTACT_EMAIL } from '../contact.ts'
import Privacy from './Privacy.tsx'

const HTML = Object.values(
  import.meta.glob<string>('../../public/privacy.html', { query: '?raw', import: 'default', eager: true }),
)[0]

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('プライバシーと利用条件', () => {
  it('同梱の privacy.html の main を出す', async () => {
    const fetchMock = vi.fn(async () => new Response(HTML, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<Privacy />)
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('プライバシーと利用条件'))
    expect(String(fetchMock.mock.calls[0]?.[0 as never])).toMatch(/privacy\.html$/)
    // 5.1.1(i) が求める 3 点と 1.2 の問い合わせ先
    expect(document.body).toHaveTextContent('集める情報')
    expect(document.body).toHaveTextContent('削除の依頼')
    expect(document.body).toHaveTextContent('一切認めません')
    expect(document.querySelector(`a[href="mailto:${CONTACT_EMAIL}"]`)).not.toBeNull()
    // style も script も持ち込まない
    expect(document.querySelector('.legal style, .legal script')).toBeNull()
  })

  it('読めないときも問い合わせ先は出す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    render(<Privacy />)
    await waitFor(() => expect(document.body).toHaveTextContent(CONTACT_EMAIL))
  })
})
