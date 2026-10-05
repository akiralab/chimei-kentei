/**
 * あそびかた（#/howto）。初めて開いた人が画面だけでは分からないこと（市・区・町・村を書かない、
 * ローマ字で打ってもひらがなになる、★ の意味、得点の付け方の違い…）を 7 節で説明する。
 *
 * **遊ぶ人向けの原稿の正本はこのページ**（README は開発者向けのまま）。
 * 読み込みは無し（静的な本文だけ）なので、通信が無くても開ける。
 *
 * 1 画面契約の例外として **用紙ごと縦スクロール**する（結果・間違えた問題と同じ
 * useBoardModifier(BOARD_SCROLL)。src/styles/CONTRACT.md「1 画面運用」）。
 * 戻る導線は持たない（下タブバーの「検定」が表紙へ戻す。第 3 波 D1）。
 *
 * **出典の正本はこのページの節 7**（第 3 波 D3・決定 ②）。各画面に常駐していた
 * .footer-credit を外した代わりに、CC BY 4.0 のライセンス URL を節 7 に置く。
 * アプリ内で外部リンクを開くのはこの 1 か所だけ。
 */
import type { Stars as StarsLevel } from '../engine/types.ts'
import { starsAria, starsMark } from '../engine/stars.ts'
import { BOARD_SCROLL, useBoardModifier } from '../hooks/useBoardModifier.ts'

/** 本文に混ぜる ★。記号は読み上げから外し、言い換えを添える（engine/stars.ts・CONTRACT.md） */
function Stars({ level }: { level: StarsLevel }) {
  return (
    <>
      <span className="stars" aria-hidden="true">
        {starsMark(level)}
      </span>
      <span className="sr-only">{starsAria(level)}</span>
    </>
  )
}

/**
 * 数を伴わない ★（「★ を 1 つ選ぶ」「★ と検索で絞れる」の、絞り込みそのものを指す ★）。
 * 記号は読み上げさせず「難易度」と読ませる。見出しのように前後の文が既に「難易度」と
 * 言っている場所では label を省く
 */
function StarMark({ label = '難易度' }: { label?: string }) {
  return (
    <>
      <span className="stars" aria-hidden="true">
        ★
      </span>
      {label !== '' && <span className="sr-only">{label}</span>}
    </>
  )
}

export default function HowTo() {
  // 7 節は 375px で 3〜4 画面ぶんになる。内側スクロールに押し込むと底が切れるので用紙ごと伸ばす
  useBoardModifier(BOARD_SCROLL)

  return (
    <div className="paper howto">
      <div className="paper__header">
        <h1 className="paper__title">あそびかた</h1>
        <p className="paper__subtitle">どうやって遊ぶの？</p>
      </div>

      <section className="howto__section">
        <h2 className="paper__section">1. 氏名を書いて、はじめる</h2>
        <ul>
          <li>氏名は 1〜12 文字。順位表にこの名前で載ります</li>
          <li>
            「はじめる」で範囲と科目を選びます。「今日の10問（全国）」は全国の
            <Stars level={3} />
            から日替わりの 10 問で、だれが押しても同じ問題です
          </li>
        </ul>
      </section>

      <section className="howto__section">
        <h2 className="paper__section">2. 範囲と科目</h2>
        <ul>
          <li>範囲は全国か都道府県。北海道と東京都は地域（道央・23区 など）でも選べます</li>
          <li>
            科目は 2 つ。「市区町村名」（例: 匝瑳市 → そうさ）と「市区町村名＋町名」（例: 放出東 →
            はなてんひがし。丁目は出ません）
          </li>
        </ul>
      </section>

      <section className="howto__section">
        <h2 className="paper__section">
          3. 難易度 <StarMark label="" />
        </h2>
        <ul>
          <li>
            市区町村名も町名も、1 問ごとに
            <Stars level={1} />〜<Stars level={3} />
            が付いています。
            <Stars level={1} />
            は読みが素直で人口も多い（横浜）、
            <Stars level={2} />
            は読みに変化があるか字が少し難しい（我孫子）、
            <Stars level={3} />
            は読めない字や無名の組み合わせ（匝瑳）
          </li>
          <li>
            町名は人口を見ず、読みの素直さ・字の難しさ・同じ字で別の読みがあるか（本町 ＝ ほんちょう／ほんまち）で決めます
          </li>
          <li>
            「全部」か
            <StarMark />
            を 1 つ選ぶと、その難易度だけから出ます。足りないときは、市区町村名なら全市区町村名に切り替わり、町名ならその
            <StarMark />
            は選べません
          </li>
        </ul>
      </section>

      <section className="howto__section">
        <h2 className="paper__section">4. 問題数と時間</h2>
        <ul>
          <li>10 問は 1 問 10 点の 100 点満点。「全部」は市区町村名ならその範囲の全市区町村名、町名なら選んだ市区町村の全町名（町名が 10〜500 の市区町村だけ）を出し、得点は正答率です。順位表では「全問」の区分に載ります</li>
          <li>時間制限は「なし」が標準。「20 秒」にすると 0 で自動パスになり、順位表に ⏳ が付きます</li>
        </ul>
      </section>

      <section className="howto__section">
        <h2 className="paper__section">5. 答え方</h2>
        <ul>
          <li>
            <strong>
              読みをひらがなで書きます。<span className="marker marker--yellow">市・区・町・村は書きません</span>
            </strong>
            （匝瑳市 → そうさ）
          </li>
          <li>ローマ字で打ってもひらがなになります。カタカナや漢字で確定しても自動でひらがなに直します</li>
          <li>
            「ゃ・ゅ・ょ・っ」は大きく書いても正解。「ぢ／じ」「づ／ず」はどちらでも正解。「ー」は区別します（そうさ
            と そーさ は別）
          </li>
          <li>空欄のまま「解答」を押すとパス。○ は 1 秒で次へ進み、× とパスは正解を確かめてから「次へ」</li>
        </ul>
      </section>

      <section className="howto__section">
        <h2 className="paper__section">6. 結果のあと</h2>
        <ul>
          <li>
            得点のスタンプと答案が出ます。「ランキングに登録」で同じ問題を解いた人と並びます（1
            つの問題セットに 1 回）
          </li>
          <li>見出しの右の「共有」で同じ 10 問のリンクを送れます</li>
          <li>
            間違えた問題は、<strong>登録した答案のぶんだけ</strong>この端末に残ります（下の「見直し」）
          </li>
        </ul>
      </section>

      <section className="howto__section">
        <h2 className="paper__section">7. 地名帳と出典</h2>
        <ul>
          <li>
            下の「地名帳」で市区町村名の読みと場所を一覧できます。
            <StarMark />
            と検索で絞れます
          </li>
          <li>
            出題はデジタル庁「アドレス・ベース・レジストリ」（
            <a
              className="howto__link"
              href="https://creativecommons.org/licenses/by/4.0/deed.ja"
              target="_blank"
              rel="noreferrer"
            >
              CC BY 4.0
            </a>
            ）を<strong>加工して利用</strong>しています（読みの正規化・難易度の判定・出題の抽出）。
            人口・地図は総務省統計局 e-Stat（2020 年国勢調査）、難易度の判定に KANJIDIC2（EDRDG, CC BY-SA
            4.0）、書体は SIL Open Font License の 5 書体を同梱
          </li>
        </ul>
      </section>
    </div>
  )
}
