/**
 * プライバシーと利用条件（#/privacy。App Store Guideline 5.1.1(i)・Issue #57）。
 *
 * 正本は public/privacy.html。App Store Connect にはそのページの URL を書くので、
 * 本文を 2 か所に持たないように、ここでは同梱の同じファイルを読んで main の中身だけを出す。
 * 同梱なので通信が無くても開ける。自前のファイルなので innerHTML に入れてよい。
 */
import { useEffect, useState } from 'react'
import { CONTACT_EMAIL } from '../contact.ts'
import PaperSkeleton from '../components/PaperSkeleton.tsx'
import { BOARD_SCROLL, useBoardModifier } from '../hooks/useBoardModifier.ts'

export default function Privacy() {
  useBoardModifier(BOARD_SCROLL)
  const [body, setBody] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`${import.meta.env.BASE_URL}privacy.html`)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status))
        return res.text()
      })
      .then((html) => {
        const main = new DOMParser().parseFromString(html, 'text/html').querySelector('main')
        if (!main) throw new Error('main がありません')
        if (alive) setBody(main.innerHTML)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [])

  if (failed) {
    return (
      <div className="paper howto">
        <h1 className="paper__title">プライバシーと利用条件</h1>
        <p>読み込めませんでした。問い合わせ先: {CONTACT_EMAIL}</p>
      </div>
    )
  }
  if (body === null) {
    return (
      <div className="paper howto">
        <PaperSkeleton lines={5} />
      </div>
    )
  }
  return <div className="paper howto legal" dangerouslySetInnerHTML={{ __html: body }} />
}
