import { DATA_VERSION } from '../engine/bank.ts'
import { SCOPE_NATIONWIDE, buildSetId, todaySeed } from '../engine/setId.ts'
import { starsAria, starsMark } from '../engine/stars.ts'
import { useNickname } from '../hooks/useNickname.ts'
import { HOWTO_PATH, SELECT_PATH, navigate, quizPath } from '../router.ts'

/**
 * 表紙。「小テストが配られた瞬間」の 1 枚。
 * スクロールさせない前提なので、要素は 5 つ（見出し・吹き出し・なまえ欄・注記・ボタン）に絞る。
 * なまえは任意（App Store Guideline 5.1.1(v)）。順位表に登録するときだけ要るので結果画面でも入れられる。
 * 装飾（赤ペンの丸・鉛筆・ゴム印）は .cover__prop で、画像を持たず CSS と絵文字だけで描く。
 *
 * **主ボタンは「はじめる」1 つ**（第 3 波 D2・決定 ④）。ランキング・間違えた問題・地名帳への
 * 副ボタン行は下タブバーが引き取ったので置かない。「今日の10問」は全員が同じ 10 問
 * （全国・市区町村名・★★★・日付シード）を解く副の遊び方なので、用紙に貼った付箋
 * （.sticky-note）の体で主ボタンの下に落とす。「？」（あそびかた）は見出し行に残す。
 */

/**
 * 「今日の10問」の難易度。★★★（全国で 533 件あるので日替わりの 10 問は毎日組める）に固定する。
 * 全難易度から選ぶと「横浜市」のような読める地名が混ざり、日替わりの検定としての歯応えが出ないため。
 */
const TODAY_STARS = 3

export default function Cover() {
  const [nickname, setNickname] = useNickname()

  const start = () => {
    setNickname(nickname.trim())
    navigate(SELECT_PATH)
  }

  const startToday = () => {
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

      <p className="cover__bubble">読めたら、あなたも地名通！</p>

      <label className="field cover__field">
        <span className="field__label">なまえ</span>
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
      <p className="cover__note">任意。順位表に載る名前です。本名は避けてください。</p>

      <p className="cover__actions">
        <button type="button" className="btn btn--primary cover__start" onClick={start}>
          はじめる
        </button>
      </p>

      {/* 用紙に貼った付箋。主ボタンと同じ格では見せない（副の遊び方なので .btn のまま）。
          見える字は 375px で折り返さない長さに抑え、★★★ は付箋の中の注記と読み上げ名で補う */}
      <div className="sticky-note">
        <button
          type="button"
          className="btn cover__today"
          aria-label={`今日の10問（全国・${starsAria(TODAY_STARS)}）`}
          onClick={startToday}
        >
          今日の10問（全国）
        </button>
        {/* ★ の記号は読み上げに向かないので隠し、読み上げ用の言い方を添える（engine/stars.ts） */}
        <p className="cover__note cover__today-note">
          全国の
          <span className="stars" aria-hidden="true">
            {starsMark(TODAY_STARS)}
          </span>
          <span className="sr-only">{starsAria(TODAY_STARS)}</span>
          から出題。だれが押しても同じ 10 問。
        </p>
      </div>

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
