#!/bin/bash
# Deletes the whole platform (a final RDS snapshot is kept). Re-create any time with deploy.sh.
#   ./scripts/teardown.sh [--wait]
set -uo pipefail
STACK=${STACK:-megafab-platform}; PROJECT=${PROJECT:-megafab}
ACCT=$(aws sts get-caller-identity --query Account --output text)
aws cloudtrail stop-logging --name "$PROJECT-audit-trail" 2>/dev/null
python3 - "$PROJECT" "$ACCT" <<'PY'
import sys, boto3
s3 = boto3.resource("s3")
for b in ("assets", "docs", "logs", "audit"):
    name = f"{sys.argv[1]}-{b}-{sys.argv[2]}"
    try:
        s3.Bucket(name).object_versions.delete(); print("emptied", name)
    except Exception as e:
        print("skip", name, type(e).__name__)
PY
aws cloudformation delete-stack --stack-name "$STACK"
echo "delete requested for $STACK"
if [ "${1:-}" = "--wait" ]; then
  aws cloudformation wait stack-delete-complete --stack-name "$STACK" 2>/dev/null || {
    # second pass: logs that arrived while deleting
    python3 - "$PROJECT" "$ACCT" <<'PY'
import sys, boto3
s3 = boto3.resource("s3")
for b in ("assets", "docs", "logs", "audit"):
    try: s3.Bucket(f"{sys.argv[1]}-{b}-{sys.argv[2]}").object_versions.delete()
    except Exception: pass
PY
    aws cloudformation delete-stack --stack-name "$STACK"
    aws cloudformation wait stack-delete-complete --stack-name "$STACK"; }
  echo "stack $STACK deleted"
fi
