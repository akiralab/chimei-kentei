import { describe, expect, it } from 'vitest'
import { CONTACT_EMAIL, reportMailto } from './contact.ts'

// node:fs は tsconfig.app の types に無いので import.meta.glob で読む（bank.realdata.test.ts と同じ）
const pages = import.meta.glob<string>('../public/{privacy,support}.html', {
  query: '?raw',
  import: 'default',
  eager: true,
})

describe('問い合わせ先', () => {
  it.each(['privacy.html', 'support.html'])('public/%s に同じアドレスが載っている', (file) => {
    const html = pages[`../public/${file}`]
    expect(html).toContain(`mailto:${CONTACT_EMAIL}`)
    expect(html.split(CONTACT_EMAIL).length).toBeGreaterThan(2)
  })
})

describe('reportMailto', () => {
  it('行を特定できる情報を本文に入れ、件名と本文を符号化する', () => {
    const url = reportMailto({ nickname: 'た ろ&う', setId: 'abr-e-12-1', entryId: 'id-1' })
    expect(url.startsWith(`mailto:${CONTACT_EMAIL}?subject=`)).toBe(true)
    const body = decodeURIComponent(url.split('&body=')[1])
    expect(body).toContain('名前: た ろ&う')
    expect(body).toContain('問題: abr-e-12-1')
    expect(body).toContain('登録番号: id-1')
  })
})
