# 地名読み検定「この地名、読めますか」

難読地名を**ひらがなで書いて答える、答案用紙風の10問テスト**。都道府県を選んで始め、同じ問題セット（セットID）で他の人と点を競う。

- 公開先: https://akiralab.github.io/chimei-kentei/
- モード: **easy** ＝ 市区町村名（「匝瑳市」は幹の「匝瑳」だけを読む）／ **difficult** ＝ 市区町村名 ＋ 大字・町名（丁目は出さない）
- 1セット10問固定・100点満点。セットID ＝ `{データ版}-{モード}-{範囲}-{シード}` から決定論的に同じ問題が再現される

## 出典

出題データは デジタル庁「アドレス・ベース・レジストリ 全国 町字マスター」（2026-09-25 版）を加工したもの。
ライセンスは [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)。
元データの前処理（読みの正規化・対応表化）は別リポジトリ `abr-data` で行い、本リポジトリの `data/build_questions.py` が問題バンク（`public/questions/`）を生成する。

## 開発

```bash
npm install
npm run dev        # http://localhost:5173/chimei-kentei/
npm test           # vitest（エンジンの単体テスト）
npm run build      # dist/ を生成
```

`main` への push で GitHub Actions が `dist/` を GitHub Pages に配信する。

## 構成

```
data/build_questions.py      対応表 → 問題バンク JSON（前処理ルール a〜f）
public/questions/{版}/       easy.json / difficult/{都道府県コード}.json / meta.json
src/engine/                  セットID・決定論的抽出・採点の正規化・ランキング保存（UI 非依存）
src/screens/                 表紙・範囲選択・出題・結果
src/styles/                  答案用紙テーマ（デザイントークン・部品）
```

設計の正本（画面・前処理ルール・セットIDの仕様・未決論点）は作者の個人ノートにあり、要点は Issues に分割して管理する。
