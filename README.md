# 地名読み検定「この地名、読めますか」

難読地名を**ひらがなで書いて答える、答案用紙風の10問テスト**。都道府県を選んで始め、同じ問題セット（セットID）で他の人と点を競う。

- 公開先: https://akiralab.github.io/chimei-kentei/
- 科目（出題する地名の種類。難易度ではないので画面では easy / difficult と呼ばない）: **市区町村名**（内部 ID `e`。「匝瑳市」は幹の「匝瑳」だけを読む）／ **市区町村名＋町名**（内部 ID `d`。大字・町名も含む。丁目は出さない）
- 問題数: 10 問（既定）か、市区町村名 × 都道府県のときだけ **全市区町村名**（その都道府県の市区町村を全部。セット ID の末尾に `-all`。練習扱いで順位表には載らない）
- 1セット10問固定・100点満点。セットID ＝ `{データ版}-{モード}-{範囲}-{シード}` から決定論的に同じ問題が再現される

## 出典

出題データは デジタル庁「アドレス・ベース・レジストリ 全国 町字マスター」（2026-09-25 版）を加工したもの。
ライセンスは [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)。
元データの前処理（読みの正規化・対応表化）は別リポジトリ `abr-data` で行い、本リポジトリの `data/build_questions.py` が問題バンク（`public/questions/`）を生成する。

## 時間制限（既定は「なし」）

1 問あたりの制限は端末ごとの設定（localStorage `timeLimitMs`）。**既定は 0 ＝ 制限なし**で、砂時計も残り秒も出さず経過時間だけ測る。20 秒（`20000`）を選ぶと従来どおり 0 で自動パスになる。

- **制限なしと 20 秒は同じ順位表に載る。**並びは得点が主で、所要時間は同点のときのタイブレークにしか効かない。
- 制限ありの行には順位表で「⏳20秒」の印が付く（どちらの条件で解いたかが分かる）。

## 間違えた問題

**ランキングに登録した答案**の誤答（パス・時間切れを含む）だけを端末内（localStorage `wrong:list`・最大 500 件）に残し、`#/review` で新しい順に見られる。練習のつもりで登録しなかった回は記録しない。同じ問題は最後に間違えたときの入力で上書きする。

## 共有ランキング

同じセットIDで解いた人の順位表。**保存先はビルド時の環境変数 `VITE_RANKING_API` で切り替わる。**

| `VITE_RANKING_API` | ランキングの保存先 | 見える範囲 |
|---|---|---|
| 未設定（既定） | `localStorage`（`LocalRankingStore`） | その端末のその人だけ |
| API のベース URL | AWS の共有ランキング API（`RemoteRankingStore`） | 同じセットIDを解いた全員 |

- 得点は**サーバーが再採点する**。クライアントが送るのは セットID と各問の入力（`input` / `ms` / `passed`）と時間制限（`timeLimitMs`）だけで、点数を申告できない。
- 1 セット 1 登録（セットID × 端末トークン）。登録すると自分の `entryId` を `localStorage['submitted:{setId}']` に残し、順位表の自分の行（`.is-me`）をそれで見分ける。
- 「これまでのランキング」は `#/ranking`（科目＝市区町村名 / 市区町村名＋町名 を切り替えて都道府県ごとの回答人数。登録がある県は色が付く）と `#/ranking/{prefCode}`（その科目の上位 30 件）。科目の絞り込みはストア側（Remote なら API の `?mode=`）で行う。
- API の契約は [`infra/API.md`](infra/API.md)、構成とデプロイ手順は [`infra/README.md`](infra/README.md)。
- GitHub Actions では repository variable `VITE_RANKING_API` を build に渡す（未設定なら空文字 → ローカルランキング）。

## 開発

```bash
npm install
npm run dev        # http://localhost:5173/chimei-kentei/
npm test           # vitest（エンジン・画面・API ハンドラの単体テスト）
npm run build      # dist/ を生成
npm run build:api  # Lambda のバンドル（infra/api/dist/handler.mjs）
npm run deploy:api # 共有ランキング API を AWS へデプロイ（infra/README.md）
npm run build:og   # リンクプレビュー用の public/og.png を og/og.html から撮り直す（Google Chrome が要る）
```

共有ランキングをつないで手元で試すとき:

```bash
VITE_RANKING_API=https://xxxx.execute-api.ap-northeast-1.amazonaws.com npm run dev
```

`main` への push で GitHub Actions が `dist/` を GitHub Pages に配信する。

### 解答欄（ひらがな専用入力）

- 解答欄に入るのは**ひらがなと長音記号「ー」だけ**。ローマ字で打つと逐次ひらがなになる（`monzen` → 「もんぜん」。打ちかけの子音は `もんぜn` のように画面にだけ残り、Enter / フォーカス外れで確定する）。
- カタカナ・半角カタカナ・全角英数はひらがなへ畳み、漢字・記号・空白は取り除く（`src/components/hiragana.ts`）。
- **IME で漢字に変換されても読みに戻す。** Web から IME は無効化できないので、macOS のライブ変換などで「匝瑳」と確定されても解答は「そうさ」になる。変換中の `keydown` の `code`（物理キー）から打鍵列 `sousa` を組み直すのが主経路で、貼り付けなど打鍵の痕跡が無い場合は `compositionupdate` が最後に「全部かな」だった文字列を使う。かなのまま確定したとき（フリック入力・かな入力）は確定文字列をそのまま使う。変換中の未確定文字列は書き換えない。

## 構成

```
data/build_questions.py      対応表 → 問題バンク JSON（前処理ルール a〜f）
public/questions/{版}/       easy.json / difficult/{都道府県コード}.json / meta.json
src/engine/                  セットID・決定論的抽出・採点の正規化・ランキング保存（UI 非依存）
infra/                       共有ランキング API（Lambda / HTTP API / DynamoDB・CloudFormation）
src/screens/                 表紙・範囲選択・出題・結果
src/styles/                  答案用紙テーマ（デザイントークン・部品）
og/                          リンクプレビュー画像（OGP）の原稿 og.html と撮影スクリプト render.mjs → public/og.png
```

設計の正本（画面・前処理ルール・セットIDの仕様・未決論点）は作者の個人ノートにあり、要点は Issues に分割して管理する。
