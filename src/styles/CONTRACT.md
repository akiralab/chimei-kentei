# 答案用紙テーマ 部品クラスの契約

`src/styles/tokens.css`（CSS 変数）と `src/styles/theme.css`（部品）を画面側が使う。クラス名は固定。

| クラス | 役割 |
|---|---|
| `.board` | 画面全体の背景（黒板色）。`body` 直下のラッパー |
| `.paper` | 答案用紙（クリーム地・罫線・影・角丸）。1 画面 1 枚 |
| `.paper__header` | 用紙上部の帯（科目名・氏名欄・得点欄を横並び） |
| `.paper__title` | 用紙の見出し（`--font-display`） |
| `.field` / `.field__label` / `.field__input` | 氏名欄などの記入欄（下線スタイル）。**`<select>` もこのクラスで作る**（`select.field__input` に `min-height: var(--tap-min)` が当たる） |
| `.field__input--wide` | `.field__input` に足して 12rem の上限を外し、行幅まで伸ばす（長い選択肢を切らないため） |
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
| `.atlas` / `.atlas__row` / `.atlas__name` / `.atlas__kana` / `.is-selected` | 地名帳の一覧（地名 ｜ よみ）。`.ranking` と同じく `.paper` の内側だけがスクロールする |
| `.atlas-nav` | 地名帳の移動（「← 一覧へ」「前／次」「3 / 23」） |
| `.footer-credit` | 出典表記 |
| `.board--scroll` | `.board` の修飾子。結果・間違えた問題の 2 画面だけ、用紙ごと縦スクロールする（下の「1 画面運用」の例外） |
| `.skeleton` / `.skeleton__line` | 読み込み中の答案（`PaperSkeleton`）。罫線の上に薄い長方形を数行 |
| `.layout__map--folded` / `.layout__map-label`（**map.css**） | 出題画面の地図を解答前に 1 行へ畳む修飾子と、その中の範囲名 |

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
- 部品の見本は `public/theme-preview.html`（`/chimei-kentei/theme-preview.html`）。CSS は `public/theme-preview.css` に結合コピー（`fonts.css` + `tokens.css` + `theme.css`）してあるので、**正本を直したらそちらも再生成する**（手順はそのファイルの先頭コメント）

- フォントは **同梱**（`public/fonts/*.woff2`）。`@font-face` は `src/styles/fonts.css` で、これは `npm run build:fonts` が生成するので**手で編集しない**。外部ホスト（Google Fonts）からは読まない
- `src/main.tsx` が `./styles/fonts.css` → `./styles/tokens.css` → `./styles/theme.css` の順に import する（ui 側が追加）
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

Dela Gothic One は字幅を詰めた極太デザインで、1.4rem 前後の漢字（範囲・結果・匝瑳）が墨だまりになって読めなかった。Mochiy Pop One は同程度にポップで、画線が均一・フトコロが開いているため小さくしても潰れない。同梱しているのは 5 書体 7 ウェイト（Dela Gothic One / Klee One 400・600 / Mochiy Pop One / Shippori Mincho B1 400・700 / Yusei Magic）。

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

#### 例外: 結果・間違えた問題の 2 画面（2026-10-05 / 第 2 波）

**`.board--scroll` を付けた画面だけは、用紙ごと縦にスクロールしてよい。他の画面は従来どおり 1 画面に収める。**

- 対象は **結果（`#/result/...`）と間違えた問題（`#/review`）の 2 画面だけ**。内容が本質的に「10 行＋操作（＋順位表）」で、どう詰めても 1 画面に入らない。内側スクロールに押し込むと底のボタンが切れる（設計ノート §13.6 決定 2）
- 画面側は `useBoardModifier(BOARD_SCROLL)`（`src/hooks/useBoardModifier.ts`）を呼ぶ。`.board` を描くのは `App.tsx` なので、**画面が自分で宣言して App には分岐表を置かない**
- CSS は `.board--scroll` が `height: auto` / `min-height: 100dvh` / `justify-content: flex-start`、その中の `.paper` が `flex: none` / `max-height: none` / `overflow: visible`、`.review` と `.ranking` も内側スクロールをやめる。`html` / `body` の `overflow: hidden` は `:has(.board--scroll)` で解く
- 用紙の `padding-bottom` に `env(safe-area-inset-bottom)` を足してある（ホームインジケータの上に最後のボタンが来ないように）
- 底のボタン群は sticky にしない（用紙の末尾に自然に置く）。`.footer-credit` はスクロールの末尾に来る
- 計測は `paper.overY` ではなく `docOverY` / `lastButtonCut` / `reviewVisibleFirstView` で見る（`scripts/measure-expr.js`）

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

## v1 追加（2026-10-03 / 地名帳 段階 1）

| クラス | 役割 |
|---|---|
| `.atlas` | 地名帳の一覧（`<ol>`）。`.paper` の直下に置くと **用紙の内側だけ**スクロールする（`.ranking` と同じ `flex: 1 1 auto` ／ 下限 5.5rem） |
| `.atlas__row` | 1 行（`<li>`）。中身は `<a>`（選べる行）か `.atlas__cells`（選べない行。段階 2 の町名用） |
| `.atlas__mark` | 選択中の目印「▶」（赤ペン色）。列幅は常に取るので、選んでも地名の位置がずれない |
| `.atlas__name` | 地名（明朝・`--font-body`） |
| `.atlas__kana` | よみ（手書き風・`--font-hand`） |
| `.atlas__stars` | 行の難易度 ★（`.stars` の入れ物）。★ を持たない行でも**列だけ残す**ので、よみの右端が行ごとにずれない |
| `.atlas-nav` / `.atlas-nav__back` / `.atlas-nav__step` / `.atlas-nav__name` / `.atlas-nav__count` | 「← 一覧へ」「◀ 前 {名前}」「次 {名前} ▶」「3 / 23」。端の行では `.atlas-nav__step--end` で押せない見た目にする |
| `.atlas-detail`（**map.css**） | 899px 以下の詳細（地図＋カード）。`.info-card` を地図に重ねるのをやめて通常フローに戻す上書きなので、`.map-*` / `.info-card*` の所有者である `map.css` に置く |

実装上の約束:

- **選択中の行は色だけに頼らない。** `.atlas__row.is-selected`（蛍光黄）と同時に、markup 側が `<a aria-current="true">` と `.atlas__mark` の「▶」を出す（`.ranking__row.is-me` と同じ考え）。
- `.atlas__row` の中の行の高さは **44px 以上**（指で押せる最小）。
- `.atlas` は `AtlasList`（`src/components/AtlasList.tsx`）が描く。行は `{key, name, kana, href?, selected?}` の配列で受け取る **meta 非依存の表示部品**なので、段階 2 の町名もそのまま並べられる。
- 900px 以上の地名帳は出題画面と同じ `.layout` / `.layout__map` / `.layout__quiz` をそのまま使う（CSS の追加なし）。
- **`.atlas__row` は `position: relative`。** 行の `.sr-only`（`position: absolute`）を行の中で止めるため。 ここで止めないと `.paper`（`position: relative`）を基準に置かれ、一覧の内側スクロールに切り取られずに用紙の高さを押し広げる。
- 地名帳の難易度の切替は範囲選択と同じ `.mode-switch.mode-switch--compact.mode-switch--fit` だが、**`.switch-row` に入れず 1 行に単独で置く**。そのため `.paper > .mode-switch--fit` だけ `width: auto`（枠を中身に合わせる）にしてある。

## v1 追加（2026-10-04 / スマホアプリ化 第 1 波）

### タップ領域 `--tap-min`（44px）

指で押せる最小の寸法。Apple HIG の 44pt に合わせた `tokens.css` のトークンで、
**操作できる部品（`a` / `button` / `input` / `select`）はこれを下回らせない**。
高さは `min-height: var(--tap-min)`、中身が痩せる切替（難易度の ★）は `min-width` も引く。

| 守っている部品 | 置き場所 |
|---|---|
| `.btn`（`.btn--ghost` 含む） | `theme.css` |
| `.cover__ranking` / `.atlas-nav .btn` / `.layout__exit .btn` | `theme.css` / `map.css`（小さく詰める修飾が当たる場所） |
| `.mode-switch__item`（`min-width` も） / `.pref-grid__item` / `input.field__input` ・ `select.field__input` | `theme.css` |
| `.jp-map__all` | `map.css` |

**`--tap-min` を下回ってよいのは `@media (min-width: 720px)` の中だけ**（`.mode-switch--compact .mode-switch__item`）。
マウス操作の幅なので、用紙 1 枚に収める方を取る。狭い画面に同じ縮小を持ち込まない。

> 既知の例外（未解決）: 地図の段階 2（地方を開いた状態）の `.jp-map__chip` は `min-height: 36px`、
> `.jp-map__back`（「地方を選び直す」）は 34px で、**720px 未満でも 44px を割っている**（`map.css`）。
> `npm run measure` の `select-d-all` がこの画面を初めて測ったことで表に出た。地図の寸法は別の変更で直す。

### 文字の下限

表示中のテキストに **13px 未満を作らない**。`em` 指定は親が小さい場所で掛け算になって潰れるので、
小さくなり得る入れ子では絶対値（`--fs-sm` など）に切り替えるか、`max(0.7em, 0.8125rem)` のように下限を書く
（例: `.review__q .q-suffix` は `.q-kanji` 基準の `0.42em` では 8px になるため上書きしている）。

2026-10-05（第 2 波）の確定値:

| トークン / クラス | 値 | 備考 |
|---|---|---|
| `--fs-md`（本文） | **16px**（`1rem`） | 15px から引き上げ（設計ノート §13.6 決定 3）。iOS の本文に寄せる |
| `--fs-xs` | **13px**（`0.8125rem`） | 12px から引き上げ。出典クレジット・情報カードのラベル・注記がここに乗る |
| `.stars` / `.q-number__stars` / `.review__stars` | `max(<em 指定>, 0.8125rem)` | `--fs-sm` の帯の中で 11.7px まで潰れていた |

**`--fs-xs` より小さいトークンを足さない。** 計測（`npm run measure` の `fontUnder16`）に除外は作らず、
`.footer-credit a` も含めて 13px 未満が 0 件であることを見る。

### 出題画面の地図は解答前に畳む（899px 以下）

`.layout__map` は `899px` 以下で、**解答前だけ** `.layout__map--folded` が付いて高さ `--tap-min`（44px）の
1 行になる。中身は範囲名（`.layout__map-label`。「東京都」だけ。「どこ？」のヒントは出さない）で、
`MunicipalityMap` と `MunicipalityInfo` は**描かない**。解答すると 24dvh（狭い画面は 20dvh）で開く。

- 判定は `useMediaQuery(WIDE_QUERY)`（`900px` 以上なら従来どおり常時表示）＋ `feedback === null`
- 開くときの高さは 150ms で伸ばす。`prefers-reduced-motion` では `theme.css` §18 の一括指定で止まる
- キーボード近似の高さ（`max-height: 560px`）では畳んだ 1 行も消す。同じ内容が用紙の帯の「範囲: 東京都」に出ているため
- `MunicipalityInfo` の「カードは常に置く」約束は、**畳んでいない間だけ**の約束に読み替える（出題画面のスマホ幅は畳んだ 1 行 → 地図＋カード で高さが動く。これは「答え合わせで開く」演出として意図したもの）

### 読み込み中と失敗（`.skeleton` / 再試行）

- 読み込み中は「読み込み中…」の 1 行をやめ、`PaperSkeleton`（`.skeleton` / `.skeleton__line`）で
  罫線に乗る薄い長方形を 3〜5 行置く。`role="status"` ＋ `aria-busy="true"` ＋ `.sr-only` の「読み込み中」
- 色は `--color-paper-line` を薄めた 1 色だけ。明滅は `prefers-reduced-motion: no-preference` のときだけ 1.2s
- 順位表に届かなかったときは原因を言い分け（`src/hooks/connection.ts`）、**どちらでも「もう一度ためす」を出す**

### safe-area

`.board` の padding に `env(safe-area-inset-*)` を足してある。ウェブでは 0 なので見た目は変わらない。
用紙の外に部品を置く変更（第 3 波の下タブバー）では、その部品側でも
`padding-bottom: env(safe-area-inset-bottom)` を見ること。
