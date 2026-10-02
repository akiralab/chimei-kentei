# 地名読み検定「この地名、読めますか」

難読地名を**ひらがなで書いて答える、答案用紙風の10問テスト**。都道府県を選んで始め、同じ問題セット（セットID）で他の人と点を競う。

- 公開先: https://akiralab.github.io/chimei-kentei/
- モード: **easy** ＝ 市区町村名（「匝瑳市」は幹の「匝瑳」だけを読む）／ **difficult** ＝ 市区町村名 ＋ 大字・町名（丁目は出さない）
- 1セット10問固定・100点満点。セットID ＝ `{データ版}-{モード}-{範囲}-{シード}` から決定論的に同じ問題が再現される

## 出典

出題データは デジタル庁「アドレス・ベース・レジストリ 全国 町字マスター」（2026-09-25 版）を加工したもの。
ライセンスは [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)。
元データの前処理（読みの正規化・対応表化）は別リポジトリ `abr-data` で行い、本リポジトリの `data/build_questions.py` が問題バンク（`public/questions/`）を生成する。

## 共有ランキング

同じセットIDで解いた人の順位表。**保存先はビルド時の環境変数 `VITE_RANKING_API` で切り替わる。**

| `VITE_RANKING_API` | ランキングの保存先 | 見える範囲 |
|---|---|---|
| 未設定（既定） | `localStorage`（`LocalRankingStore`） | その端末のその人だけ |
| API のベース URL | AWS の共有ランキング API（`RemoteRankingStore`） | 同じセットIDを解いた全員 |

- 得点は**サーバーが再採点する**。クライアントが送るのは セットID と各問の入力（`input` / `ms` / `passed`）だけで、点数を申告できない。
- 1 セット 1 登録（セットID × 端末トークン）。登録すると自分の `entryId` を `localStorage['submitted:{setId}']` に残し、順位表の自分の行（`.is-me`）をそれで見分ける。
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
```

共有ランキングをつないで手元で試すとき:

```bash
VITE_RANKING_API=https://xxxx.execute-api.ap-northeast-1.amazonaws.com npm run dev
```

`main` への push で GitHub Actions が `dist/` を GitHub Pages に配信する。

### 解答欄（ひらがな専用入力）

- 解答欄に入るのは**ひらがなと長音記号「ー」だけ**。ローマ字で打つと逐次ひらがなになる（`monzen` → 「もんぜん」。打ちかけの子音は `もんぜn` のように画面にだけ残り、Enter / フォーカス外れで確定する）。
- カタカナ・半角カタカナ・全角英数はひらがなへ畳み、漢字・記号・空白は取り除く（`src/components/hiragana.ts`）。
- **IME の変換は不要**。日本語 IME が無い端末でもそのまま Enter で解答できる。IME 変換中（未確定文字列）は一切書き換えず、確定した瞬間に正規化する。

## 構成

```
data/build_questions.py      対応表 → 問題バンク JSON（前処理ルール a〜f）
public/questions/{版}/       easy.json / difficult/{都道府県コード}.json / meta.json
src/engine/                  セットID・決定論的抽出・採点の正規化・ランキング保存（UI 非依存）
infra/                       共有ランキング API（Lambda / HTTP API / DynamoDB・CloudFormation）
src/screens/                 表紙・範囲選択・出題・結果
src/styles/                  答案用紙テーマ（デザイントークン・部品）
```

設計の正本（画面・前処理ルール・セットIDの仕様・未決論点）は作者の個人ノートにあり、要点は Issues に分割して管理する。
