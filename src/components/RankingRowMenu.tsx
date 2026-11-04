/**
 * 順位表の行の「…」。他の人の名前を報告する・この端末で非表示にする
 * （App Store Guideline 1.2。設計ノート §18）。
 *
 * 報告はメールで受ける（本文に行を特定する情報が入る）。メールを送らなくても
 * 報告を押した時点で行は隠すので、見たくないものが残らない。
 * 全画面の用紙から外れた重なりなので body に portal する（MunicipalitySheet と同じ理由）。
 */
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { CONTACT_EMAIL, reportMailto } from '../contact.ts'

interface Props {
  row: { nickname: string; setId: string; entryId: string }
  onHide: (name: string) => void
}

/** 非表示にしている行があるときだけ、一覧の下に件数と戻す手段を出す */
export function HiddenNote({ count, onRestore }: { count: number; onRestore: () => void }) {
  if (count === 0) return null
  return (
    <span>
      非表示 {count} 件{' '}
      <button type="button" className="howto__link ranking__restore" onClick={onRestore}>
        元に戻す
      </button>
    </span>
  )
}

export default function RankingRowMenu({ row, onHide }: Props) {
  const [open, setOpen] = useState(false)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const openerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (open) sheetRef.current?.querySelector<HTMLElement>('a, button')?.focus()
  }, [open])

  const close = () => {
    setOpen(false)
    openerRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      close()
      return
    }
    if (event.key !== 'Tab') return
    const items = [...(sheetRef.current?.querySelectorAll<HTMLElement>('a, button') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = (at + (event.shiftKey ? -1 : 1) + items.length) % items.length
    event.preventDefault()
    items[next]?.focus()
  }

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className="ranking__more"
        aria-label={`${row.nickname} を報告・非表示にする`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        …
      </button>
      {open &&
        createPortal(
          <div className="row-menu" role="dialog" aria-modal="true" aria-label={`${row.nickname} について`} onKeyDown={onKeyDown}>
            <div className="row-menu__backdrop" onClick={close} />
            <div className="row-menu__sheet" ref={sheetRef}>
              <p className="row-menu__title">{row.nickname}</p>
              <a className="btn" href={reportMailto(row)} onClick={() => onHide(row.nickname)}>
                この名前を報告する
              </a>
              <button type="button" className="btn" onClick={() => onHide(row.nickname)}>
                この名前を非表示にする
              </button>
              <button type="button" className="btn btn--ghost" onClick={close}>
                やめる
              </button>
              <p className="row-menu__note">
                報告はメールで届き、原則 24 時間以内に確認します。メールが開かないときは {CONTACT_EMAIL} へ。
              </p>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
