# Updating the running Elastic Beanstalk environment

Bundle: `syed-forge-app.zip` (Flask app only; same Procfile and requirements as before; no new Python packages).
Target: application `megafab-portal`, environment `megafab-prod`, region `us-east-1`.
Nothing in CloudFormation, RDS, SQS, SWF, SNS, IAM or the worker fleet changes. The database schema is unchanged.

## 0. Start the lab and check the current state (read-only)
Open AWS Academy → Start Lab → AWS console → CloudShell, then run:

```bash
aws cloudformation describe-stacks --stack-name megafab-platform --query 'Stacks[0].StackStatus' --output text
aws elasticbeanstalk describe-environments --environment-names megafab-prod \
  --query 'Environments[0].[Status,Health,VersionLabel]' --output text
curl -s -o /dev/null -w "%{http_code}\n" http://<your-eb-cname>.us-east-1.elasticbeanstalk.com/health
```

Continue only if the stack shows `*_COMPLETE`, the environment shows `Ready`, and /health returns `200`.
**Write down the VersionLabel** — it is your rollback point.

## 1. Upload the bundle
CloudShell → Actions → Upload file → `syed-forge-app.zip`.

## 2. Register and deploy the new version
```bash
ART=megafab-artifacts-<account-id>
VER=forge-$(date +%Y%m%d-%H%M)
aws s3 cp syed-forge-app.zip "s3://$ART/bundles/app-$VER.zip"
aws elasticbeanstalk create-application-version --application-name megafab-portal --version-label "$VER" \
  --source-bundle S3Bucket=$ART,S3Key=bundles/app-$VER.zip
aws elasticbeanstalk update-environment --environment-name megafab-prod --version-label "$VER"
aws elasticbeanstalk wait environment-updated --environment-names megafab-prod
```
Elastic Beanstalk performs its normal rolling deployment; the load balancer keeps serving during the update.

## 3. Verify
```bash
U=http://<your-eb-cname>.us-east-1.elasticbeanstalk.com
for p in /health / /track /ops /ops/architecture /api/ops/summary; do echo "$p $(curl -s -o /dev/null -w '%{http_code}' $U$p)"; done
```
Then in a browser: intro plays once → place a small test order → watch it reach COMPLETED on its tracking page and in the Command Center → check Security & Audit shows **verified** controls.

## Rollback (if anything looks wrong)
```bash
aws elasticbeanstalk update-environment --environment-name megafab-prod --version-label <VersionLabel from step 0>
```

## Notes
- The CloudFormation parameter `AppBundleKey` still names the earlier bundle. `scripts/deploy.sh` always rebuilds from the `app/` folder, which now contains SYED FORGE, so a future stack update will not undo this release.
- The original SYED logo is served byte-for-byte as uploaded (`static/brand/syed-logo.webp`, 1.2 MB). Edges are softened only with a CSS mask.
