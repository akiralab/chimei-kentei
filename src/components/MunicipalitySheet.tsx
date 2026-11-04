/**
 * 解答後に開く、地図と情報カードの全画面シート（899px 以下。Quiz.tsx の「地図と情報」）。
 *
 * 用紙の上に地図を開くと高さが足りず、カードが地図に重なり「次へ」もタブバーの下に隠れた（Issue #68）。
 * そこで画面の高さを全部使い、地図とカードを重ねずに縦に積む。右から滑り込み、タブバーも問題も覆う。
 * 祖先の overflow や重なり順に左右されないよう body の直下に描く。
 *
 * URL は変えない（ハッシュを動かすと出題画面が作り直される恐れがある）。
 * onBack は「問題へ」を押した処理の中で呼ぶ。iOS はユーザー操作の中でないとキーボードを出さない。
 * 閉じる動きのあいだは描いたままにするので、閉じ終わりを onClosed で知らせる。
 */
import type { KeyboardEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMediaQuery } from '../hooks/useMediaQuery.ts'
import MunicipalityInfo from './MunicipalityInfo.tsx'
import MunicipalityMap from './MunicipalityMap.tsx'

/** map.css の .map-sheet の動きと同じ長さ */
const SLIDE_MS = 200
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

interface Props {
  /** 上端に出す問題の地名 */
  title: string
  prefCode: string
  lgCode: string
  prefName: string
  /** 市区町村名の読み。町名の問では渡さない（MunicipalityInfo と同じ） */
  reading?: string
  /** 下端のボタンの文言（「次へ」か「結果を見る」） */
  nextLabel: string
  onBack: () => void
  onClosed: () => void
  onNext: () => void
}

export default function MunicipalitySheet({
  title,
  prefCode,
  lgCode,
  prefName,
  reading,
  nextLabel,
  onBack,
  onClosed,
  onNext,
}: Props) {
  const [closing, setClosing] = useState(false)
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY)
  const backRef = useRef<HTMLButtonElement | null>(null)
  const nextRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    backRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!closing) return
    const t = setTimeout(onClosed, reduced ? 0 : SLIDE_MS)
    return () => clearTimeout(t)
  }, [closing, reduced, onClosed])

  const back = () => {
    onBack()
    setClosing(true)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      back()
      return
    }
    if (event.key !== 'Tab') return
    // 裏の問題へ抜けないよう、2 つのボタンの間で回す
    event.preventDefault()
    const target = document.activeElement === backRef.current ? nextRef : backRef
    target.current?.focus()
  }

  return createPortal(
    <div
      className={closing ? 'map-sheet is-closing' : 'map-sheet'}
      role="dialog"
      aria-modal="true"
      aria-label="地図と情報"
      onKeyDown={handleKeyDown}
    >
      <div className="map-sheet__bar">
        <button ref={backRef} type="button" className="btn map-sheet__back" onClick={back}>
          <span aria-hidden="true">‹</span> 問題へ
        </button>
        <p className="map-sheet__title">{title}</p>
      </div>
      <MunicipalityMap prefCode={prefCode} lgCode={lgCode} prefName={prefName} caption={prefName} />
      <MunicipalityInfo lgCode={lgCode} revealed reading={reading} />
      <button ref={nextRef} type="button" className="btn btn--primary map-sheet__next" onClick={onNext}>
        {nextLabel}
      </button>
    </div>,
    document.body,
  )
}
