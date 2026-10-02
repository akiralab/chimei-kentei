import { isValidNickname } from '../engine/ranking.ts'
import { useNickname } from '../hooks/useNickname.ts'
import { SELECT_PATH, navigate } from '../router.ts'

export default function Cover() {
  const [nickname, setNickname] = useNickname()
  const ready = isValidNickname(nickname)

  const start = () => {
    if (!ready) return
    setNickname(nickname.trim())
    navigate(SELECT_PATH)
  }

  return (
    <div className="paper">
      <div className="paper__header">
        <h1 className="paper__title">地名読み検定</h1>
        <p className="paper__subtitle">この地名、読めますか</p>
      </div>

      <label className="field">
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
      <p>氏名は 1〜12 文字。順位表にこの名前で載ります。</p>

      <p>
        <button type="button" className="btn btn--primary" onClick={start} disabled={!ready}>
          はじめる
        </button>
      </p>
    </div>
  )
}
