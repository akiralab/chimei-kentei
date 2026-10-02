# infra — 共有ランキング API

GitHub Pages は静的配信なので、ランキングだけ AWS 側に置く。契約の正本は [API.md](API.md)。

## 構成

```
ブラウザ（https://akiralab.github.io/chimei-kentei/）
   │  POST /results  … setId ＋ 各問の入力だけ（得点は送らない）
   │  GET  /results?setId=…&limit=20
   ▼
API Gateway HTTP API（$default ステージ・CORS）
   ▼
Lambda  ResultsFunction（nodejs22.x / arm64 / 256MB / 10s）
   │   └ handler.mjs ＝ src/engine をそのままバンドルしたもの
   │      ① parseSetId → buildQuestionSet() で 10 問を再導出
   │      ② answers の questionId 集合を照合
   │      ③ grade() で再採点 → score・timeMs を算出
   ├──► GitHub Pages（BANK_BASE_URL）… 問題バンク JSON を読む（Lambda 内でキャッシュ）
   ▼
DynamoDB  RankingTable（PAY_PER_REQUEST・PITR 有効）
     pk = set#{setId}
     sk = token#{clientToken}            … 予約。attribute_not_exists(pk) で 1 セット 1 登録
     sk = entry#{createdAt}#{entryId}    … 本体。GET は begins_with(sk,'entry#') で引く
     pk = pref#{prefCode}
     sk = entry#{createdAt}#{entryId}    … 都道府県インデックス（本体の写し）
     sk = player#{clientToken}           … 人数の印。attribute_not_exists(pk) で distinct を数える
     sk = player#{mode}#{clientToken}    … 科目別の人数の印
     pk = stats#pref, sk = {prefCode}    … 合計カウンタ。entries は常に +1、players は印が新規のときだけ +1
     pk = stats#pref, sk = {prefCode}#{mode} … 科目別カウンタ（合計行と両立する）
```

エンドポイントは 4 つ: `POST /results`（登録。任意の `timeLimitMs` つき）、`GET /results?setId=…`（そのセットの順位表）、`GET /results?prefCode=…&mode=e`（都道府県を横断した上位 30 件・科目はサーバー側で絞る）、`GET /stats/prefectures`（都道府県ごとの件数・人数を合計と科目別 `byMode` で返す）。
登録時に `pref#{prefCode}` の索引と `stats#pref` のカウンタも更新する（本体の TransactWrite とは別リクエスト。失敗しても登録は 201 のまま）。

採点をサーバーに寄せているので、クライアントは得点を申告できない（改ざんしても順位は変わらない）。
`clientToken` と `answers` は一覧に出さない（返すのは `RankingRow` だけ）。

## 環境変数（Lambda）

| 変数 | 既定値 | 用途 |
|---|---|---|
| `TABLE_NAME` | （スタックが決める） | DynamoDB テーブル名 |
| `BANK_BASE_URL` | `https://akiralab.github.io/chimei-kentei/questions/` | 問題バンクの置き場。**版ディレクトリの 1 つ上**。Lambda が末尾に `abr20260925/` を足す |
| `ALLOWED_ORIGINS` | `https://akiralab.github.io,http://localhost:5173,http://localhost:4173` | CORS 許可 Origin（カンマ区切り） |

## デプロイ

```bash
npm ci
AWS_PROFILE=<あなたのプロファイル> npm run deploy:api
```

`infra/deploy.sh` が順にやること（何度流しても同じ結果になる）:

1. アーティファクト用 S3 バケット `chimei-kentei-artifacts-{アカウントID}` を無ければ作る（公開ブロック・暗号化・30日で失効）
2. `npm run build:api`（esbuild で `infra/api/src/handler.ts` → `infra/api/dist/handler.mjs`）
3. `aws cloudformation package` → `aws cloudformation deploy --stack-name chimei-kentei --capabilities CAPABILITY_IAM`
4. Outputs の `ApiUrl` を表示

リージョンは既定 `ap-northeast-1`（`AWS_REGION` で変更可）。スタック名は `STACK_NAME` で変更可。

### クライアントへ API URL を渡す

ビルド時の環境変数 `VITE_RANKING_API` が共有ランキングの有無を決める（無ければ localStorage にフォールバック）。
GitHub Actions には repository variable で渡す:

```bash
gh variable set VITE_RANKING_API --body "https://xxxx.execute-api.ap-northeast-1.amazonaws.com"
# 確認
gh variable list
```

手元で共有ランキングをつないで試すとき:

```bash
VITE_RANKING_API=https://xxxx.execute-api.ap-northeast-1.amazonaws.com npm run dev
```

変数を消せば（`gh variable delete VITE_RANKING_API`）次のビルドからローカルランキングに戻る。

## 料金の目安

個人利用の規模（1 日数百リクエスト）では **ほぼ無料枠内**に収まる見込み。

| サービス | 無料枠 | 想定 |
|---|---|---|
| Lambda | 月 100 万リクエスト・40 万 GB 秒（無期限） | 1 回 ≒ 256MB × 0.3 秒 → 月 1 万回でも 0.8 GB 秒/日 程度 |
| API Gateway HTTP API | 最初の 12 か月のみ月 100 万リクエスト | 以降は 100 万件あたり $1.00 |
| DynamoDB（オンデマンド） | 25GB ストレージ（無期限） | 1 件 ≒ 200 バイト。書き込み 100 万件で $1.25 程度 |
| CloudWatch Logs | 月 5GB 取り込み | 保持 14 日に設定済み |

課金が怖いのは「意図しない大量アクセス」だけなので、気になるなら AWS Budgets でアラートを張る。

## 削除

```bash
aws cloudformation delete-stack --stack-name chimei-kentei --region ap-northeast-1
aws cloudformation wait stack-delete-complete --stack-name chimei-kentei --region ap-northeast-1
```

`RankingTable` は `DeletionPolicy: Retain` にしてあるので**テーブルは残る**（登録データを事故で消さないため）。
本当に消すなら:

```bash
aws dynamodb delete-table --table-name <残ったテーブル名> --region ap-northeast-1
aws s3 rb s3://chimei-kentei-artifacts-<アカウントID> --force
```

## 開発

```bash
npx vitest --run infra          # ハンドラの単体テスト（DynamoDB はメモリ上の偽物）
npx tsc -p infra/tsconfig.json  # 型チェック（root の `tsc -b` は infra/ を見ない）
npm run build:api               # バンドルを作る
```

`@aws-sdk/*` は Lambda の nodejs22.x ランタイム同梱なのでバンドルから外している（`--external:@aws-sdk/*`）。
手元のテスト・型チェックのために devDependencies にも入れてある。
