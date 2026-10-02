# 問題バンク生成（data/build_questions.py）

デジタル庁 アドレス・ベース・レジストリ 全国 町字マスター 2026-09-25 版（CC BY 4.0）を加工して
`public/questions/abr20260925/` に問題バンク JSON を書き出す。外部ライブラリ不使用（標準ライブラリのみ）。

```sh
npm run build:questions                      # = python3 data/build_questions.py
python3 data/build_questions.py --abr-dir <dir> --out-dir <dir>   # 入出力を差し替える場合
```

## 入力（`~/workspace/abr-data/processed/`）

- `abr_city_reading.csv`（1,892 行）… 市区町村＋政令市の区。`ward` 非空＝政令市の区
- `abr_name_reading.csv`（441,539 行）… `level` = 市区町村 / 大字・町 / 小字

## 出力（型は `src/engine/types.ts` の `Question` / `BankMeta`。`ensure_ascii=False`・インデントなし・キー順は宣言順）

- `easy.json` … 市区町村 1,741 件（id 昇順）
- `difficult/{prefCode}.json` … 大字・町 107,681 件を 47 都道府県に分割（id 昇順。最小 沖縄県 665／最大 愛知県 6,743）
- `meta.json` … dataVersion / generatedAt / source / prefectures[47] / cities[1,741]

## 前処理ルール（設計 §4）

- **a** `(pref, city)` で一意化。政令市は区の行をまとめて 1 市、郡名は使わない。政令市の `lgCode` は区コードの
  先頭 4 桁＋`'0'`＋全国地方公共団体コードの検査数字（6,5,4,3,2 加重和 → 11−余り、10 以上は 1 の位）。例 札幌 `011002`／川崎 `141305`。
- **b** 末尾 1 文字（市区町村）を `suffix` に分離し、読みからも シ/ク/チョウ|マチ/ソン|ムラ を外す。剥がせなければ例外で停止。
- **c** difficult は `level=='大字・町'` かつ `n_readings=='1'` かつ `kana_small_suspect=='False'` の行のみ。
- **d** 先頭の冠「大字」「字」を外す。読みが オオアザ/アザ のどちらで始まっても外す（どちらでもない 368 件は漢字のみ）。
- **e** 幹が漢字（々・〆 を含む）のみで構成される行だけ残す（数字・カナ・記号を含む 11,987 件を除外）。
  ほか複数読み 596 件・`kana_small_suspect` 5,672 件・空 1 件を除外（`level=='大字・町'` 127,894 → ルール c 通過 121,626）。
- **f** 丁目は対応表で分離済みのため何もしない。**g** `status_flg` は対応表に無いため何もしない。
- 同一 `lgCode`・同一 `display` の重複は、`answer` が一致すれば 1 件に集約（1,715 件を除外）。
  `answer` が割れて正解を一意にできない 115 display（242 行）はキーごと全件落とす。
