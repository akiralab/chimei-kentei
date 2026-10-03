# 答案用紙テーマ 部品クラスの契約

`src/styles/tokens.css`（CSS 変数）と `src/styles/theme.css`（部品）を画面側が使う。クラス名は固定。

| クラス | 役割 |
|---|---|
| `.board` | 画面全体の背景（黒板色）。`body` 直下のラッパー |
| `.paper` | 答案用紙（クリーム地・罫線・影・角丸）。1 画面 1 枚 |
| `.paper__header` | 用紙上部の帯（科目名・氏名欄・得点欄を横並び） |
| `.paper__title` | 用紙の見出し（`--font-display`） |
| `.field` / `.field__label` / `.field__input` | 氏名欄などの記入欄（下線スタイル） |
| `.q-number` | 「問三 / 十」の番号 |
| `.q-prompt` | 「次の地名の読みを書け。」 |
| `.q-kanji` | 出題の漢字（大きく・明朝） |
| `.q-suffix` | 接尾辞 ［市］（薄い・小さい） |
| `.q-pref` | 都道府県名の添え書き |
| `.answer-input` | ひらがな入力欄（`--font-hand`・下線・大きめ） |
| `.timer` / `.timer__bar` | 20 秒の残り（砂時計は絵文字可） |
| `.mark` / `.mark--correct` / `.mark--wrong` | 赤ペンの ○ / ×（`--font-pen`） |
| `.pen-comment` | 赤ペンの一言（「おしい！」） |
| `.stamp` | 斜めの得点スタンプ（朱・二重枠・`rotate(-12deg)`） |
| `.marker` / `.marker--yellow` / `.marker--pink` / `.marker--blue` | 蛍光マーカーの塗り |
| `.btn` / `.btn--primary` / `.btn--ghost` | ボタン |
| `.pref-grid` / `.pref-grid__item` / `.is-selected` | 都道府県の選択グリッド |
| `.mode-switch` / `.mode-switch__item` / `.is-selected` | 科目（市区町村名 / 町名も）・問題数・時間制限の切替。`.switch-row` で 2 つを 1 行に並べられる |
| `.mode-switch--compact` | `.mode-switch` の修飾子。選択肢が 4〜5 個ある切替（地域: 全道｜道央｜道南｜道北｜道東）用に、狭い画面で左右余白と文字（`--fs-sm`）を 1 段落とす |
| `.mode-switch--fit` | `.mode-switch` の修飾子。選択肢ごとに幅が違う切替（難易度: 全部｜★｜★★｜★★★）用に、項目を等分せず中身の幅で置く。`.switch-row` の中では相手に残りの幅を譲る |
| `.review` / `.review__row` | 答案の見直し（1 行 1 問） |
| `.ranking` / `.ranking__row` / `.is-me` | 順位表 |
| `.footer-credit` | 出典表記 |

## 追加した補助クラス（2026-10-02 / design 側）

上の表の部品を組むのに必要だったものだけ足した。名前はこのまま使ってよい。

| クラス | 役割 |
|---|---|
| `.sr-only` | 読み上げ専用テキスト。○ × の隣に「正解 / 誤り」を併記するために使う |
| `.paper__subtitle` | `.paper__header` 内の小さな注記（データ版・所要時間など）。1 行まるごと使う |
| `.timer__label` | 時計絵文字＋残り秒数。`.timer` の**兄弟**として直前に置く |
| `.is-urgent` | `.timer` / `.timer__bar` / `.timer__label` に付けると赤ペン色になる |
| `.stamp__num` / `.stamp__label` | `.stamp` の中の得点数字と「テン」などの小さな添え字 |
| `.review__q` / `.review__mine` / `.review__answer` | `.review__row` の中の 出題 / 自分の解答 / 正解（赤ペン） |
| `.ranking__rank` / `.ranking__name` / `.ranking__score` / `.ranking__time` | `.ranking__row` の 4 列 |

実装上の約束:

- **`.mark` の ○ × の文字は markup 側が入れる。** CSS は `content` を生成しない（記号を DOM に持たせるため）。`aria-hidden="true"` を付け、隣に `.sr-only` で「正解 / 誤り」を書く
- `.mark` の大きさは `--mark-size`（既定 `--fs-mark`）で決まる。`.mark--correct` ×1.1 / `.mark--wrong` ×1.45 の補正がその上に乗る（× は字面が小さく出るため）。別の場所で小さくしたいときは `font-size` ではなく **`--mark-size` を上書き**する（`.review__row .mark` がその例）
- `.q-suffix` は `.q-kanji` の**内側**に置く（サイズが `em` 基準）
- `.timer__bar` の幅は画面側が inline style（`style="width: 65%"`）で与える
- `.ranking__row.is-me` は蛍光黄だが、色だけに頼らないよう `.ranking__rank` に「★」等の記号を markup 側で添える
- 部品の見本は `public/theme-preview.html`（`/chimei-kentei/theme-preview.html`）。CSS は `public/theme-preview.css` に結合コピーしてあるので、**正本を直したらそちらも再生成する**

- フォントは `index.html` の `<link>` で Google Fonts から読み込む（design 側が追加）
- `src/main.tsx` が `./styles/tokens.css` と `./styles/theme.css` を import する（ui 側が追加）
- ダークモード対応は不要。正誤は色と記号（○×）の両方で示す

## v1 追加（担当分け）

- `src/styles/map.css`（地図・2 カラム。クラス接頭辞 `.layout*` `.map*` `.jp-map*` `.info-card*`）は **地図 UI 担当**が所有し、`theme.css` には書かない。
- `src/styles/tokens.css` / `theme.css` / `index.html` のフォント指定は **タイポグラフィ担当**が所有する。
- `src/components/HiraganaInput.tsx` は **入力担当**が所有し、クラスは既存の `.answer-input` を使う（必要な修飾子は `.answer-input--ime` のように接尾）。

## v1 追加（2026-10-02 / タイポグラフィ・入力担当）

### 書体

| 変数 | 書体 | 役割 |
|---|---|---|
| `--font-display` | **Mochiy Pop One** | 見出し・ボタン・問番号・順位。**Dela Gothic One から変更** |
| `--font-stamp` | Dela Gothic One | 得点スタンプの数字（`.stamp__num`）だけに残した |

Dela Gothic One は字幅を詰めた極太デザインで、1.4rem 前後の漢字（範囲・結果・匝瑳）が墨だまりになって読めなかった。Mochiy Pop One は同程度にポップで、画線が均一・フトコロが開いているため小さくしても潰れない。`index.html` と `public/theme-preview.html` の Google Fonts `<link>` は 5 書体（Dela Gothic One / Klee One / Mochiy Pop One / Shippori Mincho B1 / Yusei Magic）。

### 文字サイズの約束

- `.paper__title` … 375px で約 1.83rem、1024px 以上で 2.4rem（`--fs-title`）
- `.q-number` / `.paper__section` … 375px で約 1.41rem、1024px 以上で 1.75rem（`--fs-xl`）
- 本文（明朝・`--fs-md`）は据え置き。`.field__label` は `--fs-xs` → `--fs-sm`、`.field__input` は `--fs-lg`（1.0625rem → 1.1875rem）に 1 段上げた
- `@media (max-height: 740px)`（iPhone SE 等）では **余白トークンと見出し以外の文字**だけを縮める。上の下限は割らない

### 追加クラス

| クラス | 役割 |
|---|---|
| `.paper__section` | 用紙の中の節見出し（「答案の見直し」「順位表」）。`<h3>` に付ける。`.paper__title` の 1 段下 |
| `.answer-hint` | 解答欄の下の案内文。`HiraganaInput` が必ず出す（`aria-describedby` で入力欄と結ぶ） |
| `.cover` | 表紙の `.paper` に併記する修飾子 |
| `.cover__title` / `.cover__subtitle` | 表紙の大見出し（`--fs-cover`）と副題。`.paper__title` / `.paper__subtitle` に足す |
| `.cover__bubble` | 赤ペンの吹き出し（「目指せ！…」）。尻尾は `::before` / `::after` |
| `.cover__field` | 表紙のニックネーム欄。`.field` に足して中央寄せ・拡大 |
| `.cover__note` | 氏名欄の下の注記 |
| `.cover__actions` / `.cover__sub-actions` | 「はじめる」と「ランキングを見る」の置き場 |
| `.cover__start` | `.btn.btn--primary` に足して拡大＋浮きアニメ（`prefers-reduced-motion` で停止） |
| `.cover__ranking` | `.btn.btn--ghost` に足して控えめに縮める |
| `.cover__prop` / `--pencil` / `--circle` / `--stamp` | 用紙の余白の小物（鉛筆・赤ペンの花丸・「満点」のゴム印）。画像を使わず絵文字と CSS だけ。`aria-hidden="true"` を付ける |

### 1 画面運用（ページをスクロールさせない）

- `body` は `height: 100%` + `overflow: hidden`。`.board` は `height: 100dvh` + `overflow: hidden` で上下中央寄せ
- `.paper` は `display: flex; flex-direction: column; max-height: 100%; min-height: 0; overflow-y: auto`
- **`.paper` の直下の子は既定で縮まない**（`.paper > * { flex: 0 0 auto }`）。
  長くなりうる `.review` / `.ranking` / `.pref-grid` だけが `flex: 1 1 auto` + `overflow-y: auto` で**用紙の内側だけ**スクロールする（下限 `.review`/`.ranking` 5.5rem、`.pref-grid` 7rem）
- `.paper__header` は `position: sticky; top: 0`、**`.btn` を直接含む `<p>` / `<div>` は `position: sticky; bottom: 0`**。
  つまり画面側は**ボタンを `<p>` か `<div>` で包む**こと（現行の 4 画面はすべてそうなっている）。包まないと底に貼り付かない
- 確認したビューポート: 375×667 と 1280×800。表紙・範囲選択・出題は用紙の内側スクロールも不要、結果だけ `.review` / `.ranking` が内側で動く。どの画面も `body` はスクロールしない

### 入力

- `src/components/HiraganaInput.tsx` が `.answer-input` ＋ `.answer-hint` を出す。値は常にひらがな＋「ー」
- 変換規則は `src/components/hiragana.ts`（`splitHiragana` / `toHiraganaStrict`）。`wanakana` の `toKana({ IMEMode: 'toHiragana' })` を使う

## v1 追加（2026-10-03 / 難易度 ★）

| クラス | 役割 |
|---|---|
| `.stars` | 難易度の ★（★ / ★★ / ★★★）。蛍光黄を鉛筆色で細く縁取ってクリーム地でも沈まないようにしたもの |
| `.q-number__text` | `.q-number` の中の問番号そのもの（「問三 / 十」）。★ と同じ行に並べるための入れ物で、装飾は `.q-number` 側 |
| `.q-number__stars` | 問番号の横に添える `.stars`（小さく・下寄せ） |
| `.review__stars` | 答案の見直しの行で出題の後ろに添える `.stars` |

実装上の約束:

- **難易度は ★ の「数」で示す。** 色（蛍光黄）は補助で、色が見えなくても ★ の数で区別できる（○× と同じ考え）。
- **記号そのものは読み上げさせない。** `.stars` を単独で置くときは `role="img"` ＋ `aria-label="難易度 3"` にし、
  ボタンの中に置くときは `aria-hidden="true"` にしてボタン側の `aria-label` に任せる。
- ★ を持つのは**市区町村名の問だけ**。町名（`d`）の問には `.stars` を出さない。
