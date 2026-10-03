# 共有ランキング API 契約

GitHub Pages は静的配信のため、ランキングは別ホストの API に保存する。クライアント（`src/engine/ranking-remote.ts`）とサーバー（`infra/api/`）はこの契約に従う。

## 原則
- **採点はサーバーで行う。** クライアントは setId と各問の入力だけを送る。サーバーは setId から問題セットを**同じエンジンコード**（`src/engine/bank.ts` の `buildQuestionSet`。`-all` 付き setId なら `all = true` で再導出）で採点し、得点・所要時間を計算する。得点の式も**クライアントと同じ関数**（`src/engine/score.ts` の `scoreOf()`）:
  - 10 問のセット … 正答数 × 10
  - それ以外（全市区町村名）… 正答率を 100 点満点に丸めた値（23 問で 20 問正解 → 87 点）
- **順位表の区分（`mode`）は 3 つ。** 科目 2 つ（`e` = 市区町村名 / `d` = 市区町村名＋町名。どちらも 10 問）に、**全市区町村名（`all`）**が並ぶ。全市区町村名は 1 問の重みが違うので 10 問と同じ一覧に混ぜない。
  - setId 単位の順位表（`GET /results?setId=`）は setId が違えば別物なので、区分の考慮は要らない。
  - 都道府県単位（`GET /results?prefCode=`・`GET /stats/prefectures`）は区分ごとに分ける。アイテムの区分は `all` フラグ（無い古いアイテムは 10 問の科目）。
  - 全国（scope `'00'`）に全市区町村名は無い（都道府県ごとの出題なので）。問題バンクは公開サイト `https://akiralab.github.io/chimei-kentei/questions/` から取得する（環境変数 `BANK_BASE_URL` ＋ `DATA_VERSION`）。
- **setId の先頭は問題バンクの版**（`DATA_VERSION`。現行 `abr20260925r2`）。サーバーは自分がバンドルした版で再導出するため、**版が違う setId は 400**（`invalid`）になる。版を上げたときは Pages のデプロイ後に `npm run deploy:api` が必要（→ [data/README.md の「版の扱い」](../data/README.md#版の扱い)）。
- **1 セット 1 登録**（setId × clientToken）。2 回目は 409。
- clientToken と answers は一覧に出さない。

## エンドポイント

### POST /results
```json
{ "setId": "abr20260925r2-e-12-0417", "nickname": "たろう",
  "clientToken": "uuid", "timeLimitMs": 0,
  "answers": [ { "questionId": "c:122351:匝瑳", "input": "そうさ", "ms": 4210, "passed": false } ] }
```
- 検証: setId がパースでき問題セットを再導出できる、**answers の件数が再導出したセットの問題数と一致**（10 問のセットは 10 件、全市区町村名はその都道府県の市区町村の数。防御的な上限 500 件）、questionId の集合が一致、nickname 1〜12 文字。
- `timeLimitMs` は任意。**0（または省略）＝ 時間制限なし**、1000〜60000 ＝ 1 問あたりの制限。それ以外は 400。
- `ms` の許容範囲は `timeLimitMs` で変わる:
  - `timeLimitMs > 0` … `ms` は 0〜`timeLimitMs`。`passed=true` なら `ms === timeLimitMs`（使い切った扱い）
  - `timeLimitMs === 0` … `ms` は 0〜600000。`passed=true` の `ms` は縛らない（実測の経過時間）
- **省略時を「20 秒固定」と読む後方互換は持たない**（省略 ＝ 制限なし）。
- 201: `{ "ok": true, "rank": 3, "entry": RankingRow }`
- 409: `{ "ok": false, "reason": "already_submitted" }`
- 400: `{ "ok": false, "reason": "invalid", "detail": "..." }`

### GET /results?setId=...&limit=20
- 200: `{ "entries": RankingRow[] }`（得点降順 → 所要時間昇順 → 登録順。limit 既定 20・最大 100）
- `RankingRow` には `mode`・`scope`（setId から導ける出題条件）、`timeLimitMs`（0 ＝ 制限なし）、`correct` / `total`（正解数・問題数）も入る。
- `correct` / `total` は後から足した項目。持っていない古いアイテムは**必ず 10 問**（全市区町村名を登録できるようにする前のデータ）なので、サーバーは `total = 10`・`correct = score / 10` を補って返す。クライアントも同じ補完を持つ（`src/engine/score.ts` の `rowCounts()`）。
- 制限なしと 20 秒は**同じ順位表に載る**。並びは得点が主で、時間は同点時のタイブレークにしか効かない。

### GET /results?prefCode=13&limit=30&mode=e
- その都道府県で登録された結果を、セットを横断して返す（「これまでのランキング」の詳細画面）。
- `prefCode` は 2 桁。setId の scope の先頭 2 桁で、**全国（scope '00'）は `'00'`**。
- `mode` は任意（`e` | `d` | `all`）。`all` ＝ 全市区町村名のセットだけ、`e` / `d` ＝ **全市区町村名を除いた**その科目の 10 問だけ。**絞り込みはサーバー側で行う**（クライアントで間引かない）。それ以外の値は 400。
- 200: `{ "entries": RankingRow[] }`（並びは `?setId=` と同じ。**limit 既定 30**・最大 100）
- 400: `prefCode` が 2 桁でない。`setId` と `prefCode` の両方があれば `prefCode` を優先する。

### GET /stats/prefectures
- 200: `{ "prefectures": PrefectureStat[] }`（prefCode 昇順。件数 0 の行は返さない）
- `PrefectureStat = { prefCode, entries, players, byMode }`
  - `entries` / `players` … 3 区分の合計（`{prefCode}` の合計行。全市区町村名もここに足す）
  - `byMode` … `{ e: {…}, d: {…}, all: {…} }`。区分別の内訳。古いデータ（合計行しか無い）では 0 になる
- `entries` は答案の件数、`players` は登録した端末（clientToken）の数。全国は `prefCode: '00'` の 1 行。

## 保存の形（DynamoDB・1 テーブル）

| pk | sk | 役割 |
|---|---|---|
| `set#{setId}` | `token#{clientToken}` | 1 セット 1 登録の予約（`attribute_not_exists(pk)`） |
| `set#{setId}` | `entry#{createdAt}#{entryId}` | 本体。`GET /results?setId=` が引く |
| `pref#{prefCode}` | `entry#{createdAt}#{entryId}` | 都道府県インデックス（本体の写し）。`GET /results?prefCode=` が引く |
| `pref#{prefCode}` | `player#{clientToken}` | 人数（合計）を数える印（`attribute_not_exists(pk)`） |
| `pref#{prefCode}` | `player#{mode}#{clientToken}` | 人数（区分別）を数える印。`mode` は `e` / `d` / `all` |
| `stats#pref` | `{prefCode}` | 合計カウンタ。`entries` は常に +1、`players` は印が新規のときだけ +1（ADD） |
| `stats#pref` | `{prefCode}#{mode}` | 区分別カウンタ（`{prefCode}#e` / `#d` / `#all`）。同じやり方で区分ごとに数える |

- `set#` / `pref#` の `entry#` アイテムは `score` のほかに `correct`・`total`・`all`（全市区町村名か）も持つ。いずれも後から足した項目で、無い古いアイテムは 10 問の科目として扱う。
- 予約と本体は TransactWrite で一括（片方だけ残らない）。
- **都道府県インデックスは本体とは別のリクエストで書く。** player 印の条件失敗（＝同じ端末の 2 セット目）で本体の登録を巻き戻さないため。索引の書き込みが失敗しても POST は 201 のまま返し、ログだけ残す。

## CORS
- 許可 Origin: `https://akiralab.github.io`、`http://localhost:5173`、`http://localhost:4173`

## クライアント側
- `import.meta.env.VITE_RANKING_API`（例 `https://xxxx.execute-api.ap-northeast-1.amazonaws.com`）が設定されていれば `RemoteRankingStore`、無ければ `LocalRankingStore`。GitHub Actions では repository variable `VITE_RANKING_API` を build に渡す。
- 自分の行の判定は POST 応答の `entry.entryId` を localStorage `submitted:{setId}` に保存して行う。
- `RankingStore` は 4 メソッド（`submit` / `list` / `prefectureStats` / `listByPrefecture(prefCode, limit?, mode?)`。`mode` は区分 `e` | `d` | `all`）。Local は localStorage の `ranking:*` を走査して同じ答えを作る（`players` は clientToken の distinct 数、`byMode` も同じ走査で数える）。
- 「これまでのランキング」画面は `#/ranking`（区分を切り替えて都道府県ごとの人数）と `#/ranking/{prefCode}`（上位 30 件）。区分は localStorage `rankingMode`（`e` | `d` | `all`）で引き継ぐ。
- 時間制限は localStorage `timeLimitMs`（0 ＝ 制限なし・既定）。その回に使った値は sessionStorage `timeLimit:{setId}` に控えて POST に載せる。
