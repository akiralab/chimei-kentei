import { DATA_VERSION } from '../engine/bank.ts'
import { isValidNickname } from '../engine/ranking.ts'
import { SCOPE_NATIONWIDE, buildSetId, todaySeed } from '../engine/setId.ts'
import { useNickname } from '../hooks/useNickname.ts'
import { RANKING_PATH, REVIEW_PATH, SELECT_PATH, navigate, quizPath } from '../router.ts'

/**
 * 表紙。「小テストが配られた瞬間」の 1 枚。
 * スクロールさせない前提なので、要素は 5 つ（見出し・吹き出し・氏名欄・注記・ボタン）に絞る。
 * 装飾（赤ペンの丸・鉛筆・ゴム印）は .cover__prop で、画像を持たず CSS と絵文字だけで描く。
 *
 * ボタンは 2 つとも主ボタン。「今日の10問」は全員が同じ 10 問（全国・市区町村名・日付シード）を解くので、
 * 範囲選択を経由せず表紙から 1 タップで始められるようにする。
 */
export default function Cover() {
  const [nickname, setNickname] = useNickname()
  const ready = isValidNickname(nickname)

  const start = () => {
    if (!ready) return
    setNickname(nickname.trim())
    navigate(SELECT_PATH)
  }

  const startToday = () => {
    if (!ready) return
    setNickname(nickname.trim())
    navigate(quizPath(buildSetId(DATA_VERSION, 'e', SCOPE_NATIONWIDE, todaySeed())))
  }

  return (
    <div className="paper cover">
      <div className="paper__header">
        <h1 className="paper__title cover__title">地名読み検定</h1>
        <p className="paper__subtitle cover__subtitle">この地名、読めますか</p>
      </div>

      <p className="cover__bubble">目指せ！全国の自治体マスター！</p>

      <label className="field cover__field">
        <span className="field__label">氏名</span>
        <input
          className="field__input"
          type="text"
          value={nickname}
          maxLength={12}
          placeholder="ニックネーム"
          onChange={(e) => setNickname(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) start()
          }}
        />
      </label>
      <p className="cover__note">氏名は 1〜12 文字。順位表にこの名前で載ります。</p>

      <p className="cover__actions">
        <button type="button" className="btn btn--primary cover__start" onClick={start} disabled={!ready}>
          はじめる
        </button>
        <button type="button" className="btn btn--primary cover__today" onClick={startToday} disabled={!ready}>
          今日の10問（全国）
        </button>
      </p>

      <p className="cover__sub-actions">
        <a className="btn btn--ghost cover__ranking" href={RANKING_PATH}>
          ランキングを見る
        </a>
        <a className="btn btn--ghost" href={REVIEW_PATH}>
          間違えた問題
        </a>
      </p>

      {/* 用紙の余白の小物。読み上げ不要 */}
      <span className="cover__prop cover__prop--circle" aria-hidden="true" />
      <span className="cover__prop cover__prop--pencil" aria-hidden="true">
        ✏️
      </span>
      <span className="cover__prop cover__prop--stamp" aria-hidden="true">
        満点
      </span>
    </div>
  )
}
