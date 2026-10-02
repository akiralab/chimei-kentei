# 共有ランキング API 契約

GitHub Pages は静的配信のため、ランキングは別ホストの API に保存する。クライアント（`src/engine/ranking-remote.ts`）とサーバー（`infra/api/`）はこの契約に従う。

## 原則
- **採点はサーバーで行う。** クライアントは setId と各問の入力だけを送る。サーバーは setId から問題セットを**同じエンジンコード**（`src/engine/bank.ts` の `buildQuestionSet`）で再導出し、`grade()` で採点して得点・所要時間を計算する。問題バンクは公開サイト `https://akiralab.github.io/chimei-kentei/questions/` から取得する（環境変数 `BANK_BASE_URL`）。
- **1 セット 1 登録**（setId × clientToken）。2 回目は 409。
- clientToken と answers は一覧に出さない。

## エンドポイント

### POST /results
```json
{ "setId": "abr20260925-e-12-0417", "nickname": "たろう",
  "clientToken": "uuid",
  "answers": [ { "questionId": "c:122351:匝瑳", "input": "そうさ", "ms": 4210, "passed": false } ] }
```
- 検証: setId がパースでき 10 問を再導出できる、answers が 10 件で questionId の集合が一致、nickname 1〜12 文字、ms は 0〜20000、passed=true なら ms=20000。
- 201: `{ "ok": true, "rank": 3, "entry": RankingRow }`
- 409: `{ "ok": false, "reason": "already_submitted" }`
- 400: `{ "ok": false, "reason": "invalid", "detail": "..." }`

### GET /results?setId=...&limit=20
- 200: `{ "entries": RankingRow[] }`（得点降順 → 所要時間昇順 → 登録順。limit 既定 20・最大 100）

## CORS
- 許可 Origin: `https://akiralab.github.io`、`http://localhost:5173`、`http://localhost:4173`

## クライアント側
- `import.meta.env.VITE_RANKING_API`（例 `https://xxxx.execute-api.ap-northeast-1.amazonaws.com`）が設定されていれば `RemoteRankingStore`、無ければ `LocalRankingStore`。GitHub Actions では repository variable `VITE_RANKING_API` を build に渡す。
- 自分の行の判定は POST 応答の `entry.entryId` を localStorage `submitted:{setId}` に保存して行う。
