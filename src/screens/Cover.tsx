import { DATA_VERSION } from '../engine/bank.ts'
import { isValidNickname } from '../engine/ranking.ts'
import { SCOPE_NATIONWIDE, buildSetId, todaySeed } from '../engine/setId.ts'
import { starsAria, starsMark } from '../engine/stars.ts'
import { useNickname } from '../hooks/useNickname.ts'
import { ATLAS_PATH, HOWTO_PATH, RANKING_PATH, REVIEW_PATH, SELECT_PATH, navigate, quizPath } from '../router.ts'

/**
 * 表紙。「小テストが配られた瞬間」の 1 枚。
 * スクロールさせない前提なので、要素は 5 つ（見出し・吹き出し・氏名欄・注記・ボタン）に絞る。
 * 装飾（赤ペンの丸・鉛筆・ゴム印）は .cover__prop で、画像を持たず CSS と絵文字だけで描く。
 *
 * ボタンは 2 つとも主ボタン。「今日の10問」は全員が同じ 10 問（全国・市区町村名・★★★・日付シード）を
 * 解くので、範囲選択を経由せず表紙から 1 タップで始められるようにする。
 */

/**
 * 「今日の10問」の難易度。★★★（全国で 533 件あるので日替わりの 10 問は毎日組める）に固定する。
 * 全難易度から選ぶと「横浜市」のような読める地名が混ざり、日替わりの検定としての歯応えが出ないため。
 */
const TODAY_STARS = 3

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
    navigate(quizPath(buildSetId(DATA_VERSION, 'e', SCOPE_NATIONWIDE, todaySeed(), false, TODAY_STARS)))
  }

  return (
    <div className="paper cover">
      <div className="paper__header">
        <h1 className="paper__title cover__title">地名読み検定</h1>
        <p className="paper__subtitle cover__subtitle">この地名、読めますか</p>
        {/* 行は足さない（帯の右下に重ねる）。見える字は「？」だけで、名前は aria-label に持たせる */}
        <a className="btn btn--ghost paper__help" href={HOWTO_PATH} aria-label="どうやって遊ぶの？">
          ？
        </a>
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
        {/* 見える字は 375px で折り返さない長さに抑える（「今日の10問（全国・市区町村名）」は折り返した）。
            ★★★ であることは下の注記と読み上げ名で補う */}
        <button
          type="button"
          className="btn btn--primary cover__today"
          aria-label={`今日の10問（全国・${starsAria(TODAY_STARS)}）`}
          onClick={startToday}
          disabled={!ready}
        >
          今日の10問（全国）
        </button>
      </p>

      {/* ボタンのラベルに入れると折り返すので、難易度は 1 行の注記に出す。
          ★ の記号は読み上げに向かないので隠し、読み上げ用の言い方を添える（engine/stars.ts） */}
      <p className="cover__note cover__today-note">
        今日の10問は全国の
        <span className="stars" aria-hidden="true">
          {starsMark(TODAY_STARS)}
        </span>
        <span className="sr-only">{starsAria(TODAY_STARS)}</span>
        から出題。
      </p>

      {/* 副ボタンは 3 つ。「ランキングを見る」のままだと 375px で「地名帳」が 2 行目に落ち、
          表紙が 12px スクロールしたので見える字を「ランキング」に縮めた（読み上げ名は元のまま）*/}
      <p className="cover__sub-actions">
        <a className="btn btn--ghost cover__ranking" href={RANKING_PATH} aria-label="ランキングを見る">
          ランキング
        </a>
        <a className="btn btn--ghost" href={REVIEW_PATH}>
          間違えた問題
        </a>
        <a className="btn btn--ghost" href={ATLAS_PATH}>
          地名帳
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
