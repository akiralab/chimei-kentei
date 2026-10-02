/**
 * 今まで間違えた問題（#/review）。
 *
 * 記録されるのは **ランキングに登録した答案だけ**（engine/wrongList.ts）。
 * 端末内の localStorage だけを見るので、読み込み待ちも通信失敗も無い。
 */
import { useMemo, useState } from 'react'
import type { WrongItem } from '../engine/wrongList.ts'
import { clearWrongList, newestFirst, readWrongList } from '../engine/wrongList.ts'
import { COVER_PATH, SELECT_PATH, navigate } from '../router.ts'

/** 都道府県の絞り込みで「すべて」を表す値 */
const ALL = ''

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, '0')}`
}

/** 都道府県／市区町村の添え書き。difficult は所属自治体まで出す */
function placeLabel(item: WrongItem): string {
  return item.city === undefined || item.city === '' ? item.pref : `${item.pref}・${item.city}`
}

export default function Review() {
  const [items, setItems] = useState<WrongItem[]>(() => newestFirst(readWrongList()))
  const [pref, setPref] = useState<string>(ALL)
  /** 「一覧を消す」は 2 回押しで確定する（確認ダイアログは出さない） */
  const [armed, setArmed] = useState(false)

  // 絞り込みのセレクトは、実際に記録がある都道府県だけ出す
  const prefOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const i of items) if (!seen.has(i.prefCode)) seen.set(i.prefCode, i.pref)
    return [...seen].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  }, [items])

  const shown = useMemo(() => (pref === ALL ? items : items.filter((i) => i.prefCode === pref)), [items, pref])

  const clearAll = () => {
    if (!armed) {
      setArmed(true)
      return
    }
    clearWrongList()
    setItems([])
    setPref(ALL)
    setArmed(false)
  }

  return (
    <div className="paper">
      <div className="paper__header">
        <h1 className="paper__title">間違えた問題</h1>
        <p className="paper__subtitle">
          ランキングに登録した答案から記録しています ／ {items.length} 問（新しい順）
        </p>
      </div>

      {items.length === 0 ? (
        <p>
          まだ記録がありません。答案を「ランキングに登録」すると、間違えた問題がここに残ります。
        </p>
      ) : (
        <>
          <label className="field">
            <span className="field__label">都道府県</span>
            <select
              className="field__input"
              value={pref}
              onChange={(e) => setPref(e.target.value)}
              aria-label="都道府県で絞り込む"
            >
              <option value={ALL}>すべて（{items.length}問）</option>
              {prefOptions.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          {shown.length === 0 ? (
            <p>この都道府県の記録はありません。</p>
          ) : (
            /* .review__row は ○× | 出題 | 自分の解答 | 正解 の 4 列グリッド */
            <ol className="review">
              {shown.map((item) => (
                <li className="review__row" key={`${item.questionId}-${item.at}`}>
                  <span className="mark mark--wrong" aria-hidden="true">
                    ×
                  </span>
                  <span className="review__q">
                    <span className="sr-only">出題 </span>
                    {item.display}
                  </span>
                  <span className="review__mine">{item.input === '' ? '（無記入）' : item.input}</span>
                  <span className="review__answer">
                    <span className="sr-only">正解 </span>
                    <span className="marker marker--yellow">{item.answer}</span>
                  </span>
                  {/* 4 列グリッドの 2 行目として全幅に置く（場所と日付） */}
                  <span className="q-pref" style={{ gridColumn: '1 / -1', margin: 0 }}>
                    {placeLabel(item)} ／ {item.mode === 'e' ? 'easy' : 'difficult'} ／ {formatDate(item.at)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      <p>
        <button type="button" className="btn btn--primary" onClick={() => navigate(SELECT_PATH)}>
          この県でもう一度
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => navigate(COVER_PATH)}>
          タイトルへ戻る
        </button>
        {items.length > 0 && (
          <button type="button" className="btn btn--ghost" onClick={clearAll}>
            {armed ? 'もう一度押すと消えます' : '一覧を消す'}
          </button>
        )}
      </p>
    </div>
  )
}
