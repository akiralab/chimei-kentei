#!/usr/bin/env bash
# 共有ランキング API のデプロイ。何度流しても同じ結果になる（冪等）。
#
#   npm run deploy:api                       # 既定（ap-northeast-1）
#   AWS_PROFILE=myprofile npm run deploy:api # プロファイル指定
#   AWS_REGION=us-east-1  npm run deploy:api # リージョン指定
#
# 事前条件: aws CLI v2 がログイン済み。npm ci 済み（esbuild が必要）。
set -euo pipefail

REGION="${AWS_REGION:-ap-northeast-1}"
STACK_NAME="${STACK_NAME:-chimei-kentei}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

echo "==> リージョン $REGION / スタック $STACK_NAME${AWS_PROFILE:+ / プロファイル $AWS_PROFILE}"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text --region "$REGION")"
BUCKET="chimei-kentei-artifacts-${ACCOUNT_ID}"

# 1. アーティファクト用 S3 バケット（無ければ作る）
if aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null; then
  echo "==> バケットあり: s3://$BUCKET"
else
  echo "==> バケットを作る: s3://$BUCKET"
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION"
  fi
  aws s3api put-public-access-block --bucket "$BUCKET" --region "$REGION" \
    --public-access-block-configuration \
    'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'
  aws s3api put-bucket-encryption --bucket "$BUCKET" --region "$REGION" \
    --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  # 古いアーティファクトは 30 日で消す
  aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --region "$REGION" \
    --lifecycle-configuration \
    '{"Rules":[{"ID":"expire-artifacts","Status":"Enabled","Filter":{"Prefix":""},"Expiration":{"Days":30}}]}'
fi

# 2. Lambda のバンドルを作る（infra/api/dist/handler.mjs）
echo "==> npm run build:api"
( cd "$ROOT" && npm run build:api )

# 3. テンプレートに同梱物を載せる
PACKAGED="$HERE/.packaged.yaml"
echo "==> cloudformation package"
aws cloudformation package \
  --template-file "$HERE/template.yaml" \
  --s3-bucket "$BUCKET" \
  --s3-prefix "$STACK_NAME" \
  --output-template-file "$PACKAGED" \
  --region "$REGION" >/dev/null

# 4. デプロイ（差分が無ければ何もしない）
echo "==> cloudformation deploy"
set +e
aws cloudformation deploy \
  --template-file "$PACKAGED" \
  --stack-name "$STACK_NAME" \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --region "$REGION"
STATUS=$?
set -e
if [ "$STATUS" -ne 0 ]; then
  echo "!! デプロイに失敗した。直近のイベントを見る:" >&2
  aws cloudformation describe-stack-events --stack-name "$STACK_NAME" --region "$REGION" \
    --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`||ResourceStatus==`UPDATE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
    --output table >&2 || true
  exit "$STATUS"
fi

# 5. ApiUrl を表示
API_URL="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)"
echo
echo "==> ApiUrl: $API_URL"
echo "    GitHub の repository variable VITE_RANKING_API にこの URL を入れる:"
echo "      gh variable set VITE_RANKING_API --body \"$API_URL\""
