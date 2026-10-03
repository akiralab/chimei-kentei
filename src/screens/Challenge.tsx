import type { Mode, Stars } from '../engine/types.ts'
import { modeName } from '../engine/modes.ts'
import { starsHeaderNote } from '../engine/stars.ts'
import { isValidNickname } from '../engine/ranking.ts'
import { TIME_LIMIT_CHOICES, useTimeLimit } from '../hooks/useTimeLimit.ts'

/**
 * 挑戦状。共有リンク（`#/q/{setId}`）を直接開いた人に、出題の前に 1 枚だけ挟む着地画面。
 *
 * 砂時計は「はじめる」を押してから動かす（Quiz 側が started を立てる）。
 * ここで氏名を必須にしておくので、名無しのまま結果画面に着いて登録できない経路は生まれない。
 * スクロールさせない前提なので、要素は 4 つ（帯＝見出しと条件・制限の切替・氏名欄・ボタン）に絞る。
 */
export default function Challenge({
  rangeLabel,
  mode,
  total,
  all,
  stars,
  widened,
  nickname,
  onNicknameChange,
  onStart,
}: {
  rangeLabel: string
  mode: Mode
  total: number
  /** 全市区町村名（その都道府県の市区町村を全部） */
  all: boolean
  /** 難易度の絞り込み。null ＝ 絞っていない（そのときは帯に出さない） */
  stars: Stars | null
  widened: boolean
  nickname: string
  onNicknameChange: (value: string) => void
  onStart: () => void
}) {
  const [timeLimitMs, setTimeLimitMs] = useTimeLimit()
  const ready = isValidNickname(nickname)

  /** 「制限なし」→「なし」。Select と同じく「制限: 制限なし」と重ならないように頭を落とす */
  const shortLimit = (label: string) => label.replace(/^制限/, '')
  const timeLimitLabel = shortLimit(
    TIME_LIMIT_CHOICES.find((c) => c.value === timeLimitMs)?.label ?? TIME_LIMIT_CHOICES[0].label,
  )

  const start = () => {
    if (!ready) return
    onNicknameChange(nickname.trim())
    onStart()
  }

  return (
    <div className="paper cover">
      {/* 条件は帯（.paper__header）の中に置く。.paper__subtitle は flex-basis: 100% なので、
          用紙（縦の flex）に直接ぶら下げると高さ 100% の 1 行になって用紙からはみ出す */}
      <div className="paper__header">
        <h1 className="paper__title cover__title">挑戦状</h1>
        <p className="paper__subtitle cover__subtitle">地名読み検定 ― この地名、読めますか</p>
        <p className="paper__subtitle">
          範囲: {rangeLabel} ／ 科目: {modeName(mode)}
          {stars !== null && ` ／ ${starsHeaderNote(stars)}`} ／ 問題数:{' '}
          {all ? `全市区町村名（${total} 問）` : `${total} 問`} ／ 制限: {timeLimitLabel}
        </p>
      </div>

      {widened && <p className="pen-comment">範囲が狭いため都道府県に広げました</p>}

      {/* 制限時間はここでも変えられる。Quiz は「はじめる」を押した時点の設定を読む */}
      <div className="mode-switch">
        {TIME_LIMIT_CHOICES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            className={timeLimitMs === choice.value ? 'mode-switch__item is-selected' : 'mode-switch__item'}
            aria-pressed={timeLimitMs === choice.value}
            aria-label={`時間制限: ${shortLimit(choice.label)}`}
            onClick={() => setTimeLimitMs(choice.value)}
          >
            <span className="mode-switch__full" aria-hidden="true">
              時間制限: {shortLimit(choice.label)}
            </span>
            <span className="mode-switch__abbr" aria-hidden="true">
              {choice.label}
            </span>
          </button>
        ))}
      </div>

      <label className="field cover__field">
        <span className="field__label">氏名</span>
        <input
          className="field__input"
          type="text"
          value={nickname}
          maxLength={12}
          placeholder="ニックネーム"
          onChange={(e) => onNicknameChange(e.target.value)}
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
      </p>
    </div>
  )
}
