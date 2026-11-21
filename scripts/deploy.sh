#!/bin/bash
# MegaFab one-command deployment (run from AWS CloudShell, region us-east-1)
#   ./scripts/deploy.sh you@example.com
set -euo pipefail
EMAIL=${1:?usage: deploy.sh notification-email}
PROJECT=${PROJECT:-megafab}
STACK=${STACK:-megafab-platform}
REGION=${AWS_REGION:-us-east-1}
cd "$(dirname "$0")/.."
ACCT=$(aws sts get-caller-identity --query Account --output text)
ART="${PROJECT}-artifacts-${ACCT}"
VER=$(date +%Y%m%d-%H%M%S)

ST=$(aws cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo NONE)
case "$ST" in ROLLBACK_COMPLETE|ROLLBACK_FAILED|DELETE_FAILED|CREATE_FAILED)
  echo "== previous attempt left $STACK in $ST - cleaning up first"; ./scripts/teardown.sh --wait;; esac

echo "== 1/5 artifact bucket s3://$ART"
aws s3api head-bucket --bucket "$ART" 2>/dev/null || {
  aws s3api create-bucket --bucket "$ART" --region "$REGION" >/dev/null
  aws s3api put-public-access-block --bucket "$ART" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-encryption --bucket "$ART" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  aws s3api put-bucket-versioning --bucket "$ART" --versioning-configuration Status=Enabled
}

echo "== 2/5 build + upload application bundles ($VER)"
rm -rf build && mkdir -p build/worker
(cd app && zip -qr "../build/app-$VER.zip" . -x '__pycache__/*')
cp worker/worker.py app/megafab_core.py build/worker/
(cd build/worker && zip -qr "../worker-$VER.zip" .)
aws s3 cp "build/app-$VER.zip" "s3://$ART/bundles/app-$VER.zip" --only-show-errors
aws s3 cp "build/worker-$VER.zip" "s3://$ART/bundles/worker-$VER.zip" --only-show-errors

echo "== 3/5 TLS certificate for the HTTPS listener"
CERT=$(aws acm list-certificates --query "CertificateSummaryList[?DomainName=='portal.megafab-macloud.com'].CertificateArn | [0]" --output text)
if [ "$CERT" = "None" ] || [ -z "$CERT" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout build/tls.key -out build/tls.crt \
    -subj "/C=PK/O=MegaFab Industrial Supply/CN=portal.megafab-macloud.com" \
    -addext "subjectAltName=DNS:portal.megafab-macloud.com,DNS:www.megafab-macloud.com,DNS:*.elasticbeanstalk.com,DNS:app.megafab.internal" 2>/dev/null
  CERT=$(aws acm import-certificate --certificate fileb://build/tls.crt --private-key fileb://build/tls.key \
    --tags Key=Project,Value=$PROJECT --query CertificateArn --output text 2>/dev/null || echo "")
  rm -f build/tls.key
fi
echo "   certificate: ${CERT:-none (HTTP only)}"

echo "== 4/5 package nested templates"
aws cloudformation package --template-file cfn/main.yaml --s3-bucket "$ART" --s3-prefix templates \
  --output-template-file build/packaged.yaml >/dev/null

echo "== 5/5 deploy stack $STACK (RDS Multi-AZ takes ~15-20 min)"
aws cloudformation deploy --stack-name "$STACK" --template-file build/packaged.yaml \
  --capabilities CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
  --tags Project=$PROJECT Owner=SyedMeasumShah \
  --parameter-overrides Project=$PROJECT NotificationEmail="$EMAIL" ArtifactBucket="$ART" \
     AppBundleKey="bundles/app-$VER.zip" WorkerBundleKey="bundles/worker-$VER.zip" CertificateArn="${CERT:-}" \
     ${EXTRA_PARAMS:-}
aws cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output table
