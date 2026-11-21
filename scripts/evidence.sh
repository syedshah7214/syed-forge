#!/bin/bash
# Prints compact evidence for the report:  ./scripts/evidence.sh <name>
STACK=${STACK:-megafab-platform}; R=us-east-1
out(){ aws cloudformation describe-stacks --stack-name $STACK --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
case "$1" in
 outputs) aws cloudformation describe-stacks --stack-name $STACK --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output table ;;
 stacks) aws cloudformation describe-stacks --query "Stacks[?starts_with(StackName,'megafab')].[StackName,StackStatus,CreationTime]" --output table ;;
 network)
  aws ec2 describe-vpcs --filters Name=tag:Project,Values=megafab --query 'Vpcs[].[Tags[?Key==`Name`]|[0].Value,CidrBlock,VpcId]' --output table
  aws ec2 describe-subnets --filters Name=tag:Name,Values='megafab-*' --query 'sort_by(Subnets,&CidrBlock)[].[Tags[?Key==`Name`]|[0].Value,CidrBlock,AvailabilityZone,MapPublicIpOnLaunch]' --output table
  aws ec2 describe-vpc-peering-connections --filters Name=tag:Name,Values=megafab-mgmt-to-app --query 'VpcPeeringConnections[].[VpcPeeringConnectionId,Status.Code,RequesterVpcInfo.CidrBlock,AccepterVpcInfo.CidrBlock]' --output table ;;
 security)
  aws ec2 describe-security-groups --filters Name=group-name,Values='*megafab*' --query 'SecurityGroups[].{SG:GroupName,In:IpPermissions[].[FromPort,join(`,`,IpRanges[].CidrIp),join(`,`,UserIdGroupPairs[].GroupId)][]}' --output json | python3 -c "import json,sys;[print(f\"{g['SG'][:40]:40} {g['In']}\") for g in json.load(sys.stdin)]"
  aws ec2 describe-network-acls --filters Name=tag:Name,Values='megafab-*' --query 'NetworkAcls[].[Tags[?Key==`Name`]|[0].Value,length(Entries)]' --output text ;;
 encryption)
  K=$(out KmsKey); aws kms describe-key --key-id $K --query 'KeyMetadata.[KeyId,KeyManager,KeyState]' --output text; aws kms get-key-rotation-status --key-id $K --output text
  for b in assets docs logs audit; do printf "%-32s " megafab-$b; aws s3api get-bucket-encryption --bucket megafab-$b-$(aws sts get-caller-identity --query Account --output text) --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' --output text; done
  aws rds describe-db-instances --db-instance-identifier megafab-orders-db --query 'DBInstances[0].[DBInstanceIdentifier,StorageEncrypted,MultiAZ,BackupRetentionPeriod,AvailabilityZone,SecondaryAvailabilityZone]' --output table
  aws ec2 get-ebs-encryption-by-default --output text; aws ec2 describe-volumes --filters Name=tag:Project,Values=megafab --query 'Volumes[].[VolumeId,Size,Encrypted]' --output text
  aws sqs get-queue-attributes --queue-url $(aws sqs get-queue-url --queue-name megafab-orders --query QueueUrl --output text) --attribute-names KmsMasterKeyId --output text ;;
 iam) aws iam list-policies --scope Local --query 'Policies[?starts_with(PolicyName,`megafab`)].[PolicyName,AttachmentCount,CreateDate]' --output table ;;
 workers)
  aws autoscaling describe-auto-scaling-groups --query "AutoScalingGroups[?contains(AutoScalingGroupName,'megafab') || contains(AutoScalingGroupName,'awseb')].[AutoScalingGroupName,MinSize,DesiredCapacity,MaxSize,length(Instances)]" --output table ;;
 scaling)
  for g in $(aws autoscaling describe-auto-scaling-groups --query "AutoScalingGroups[?contains(AutoScalingGroupName,'awseb') || contains(AutoScalingGroupName,'megafab')].AutoScalingGroupName" --output text); do
   echo "## $g"; aws autoscaling describe-scaling-activities --auto-scaling-group-name $g --max-items 8 --query 'Activities[].[StartTime,StatusCode,Description]' --output text | cut -c1-150; done ;;
 swf) aws swf list-closed-workflow-executions --domain MegaFab-Fulfilment --start-time-filter oldestDate=$(date -d '-1 day' +%s) --max-items 8 --query 'executionInfos[].[execution.workflowId,closeStatus,startTimestamp,closeTimestamp]' --output table
  aws swf count-open-workflow-executions --domain MegaFab-Fulfilment --start-time-filter oldestDate=$(date -d '-1 day' +%s) --output text ;;
 trail) aws cloudtrail get-trail-status --name megafab-audit-trail --query '[IsLogging,LatestDeliveryTime]' --output text
  aws cloudtrail describe-trails --trail-name-list megafab-audit-trail --query 'trailList[0].[IsMultiRegionTrail,LogFileValidationEnabled,KmsKeyId!=null,S3BucketName]' --output text
  aws cloudtrail lookup-events --max-results 12 --lookup-attributes AttributeKey=Username,AttributeValue=$(aws sts get-caller-identity --query Arn --output text | cut -d/ -f3) --query 'Events[].[EventTime,EventName,EventSource]' --output table ;;
 dns) Z=$(aws route53 list-hosted-zones-by-name --dns-name megafab-macloud.com --query 'HostedZones[0].Id' --output text)
  NS=$(aws route53 get-hosted-zone --id $Z --query 'DelegationSet.NameServers[0]' --output text)
  aws route53 list-hosted-zones --query 'HostedZones[].[Name,Config.PrivateZone,ResourceRecordSetCount]' --output table
  echo "\$ dig +short www.megafab-macloud.com @$NS"; dig +short www.megafab-macloud.com @$NS 2>/dev/null || nslookup www.megafab-macloud.com $NS | tail -4 ;;
 bastion) B=$(out BastionId); C=$(aws ssm send-command --instance-ids $B --document-name AWS-RunShellScript --parameters 'commands=["echo HOST: $(hostname) in mgmt VPC","getent hosts db.megafab.internal","/usr/local/bin/megafab-db -t -e \"SELECT status, COUNT(*) orders FROM orders GROUP BY status; SELECT @@require_secure_transport AS tls_required;\"","/usr/local/bin/megafab-backup"]' --query Command.CommandId --output text)
  sleep 12; aws ssm get-command-invocation --command-id $C --instance-id $B --query '[Status,StandardOutputContent,StandardErrorContent]' --output text ;;
 iamdeny) echo "== Learner Lab IAM restrictions (caller: $(aws sts get-caller-identity --query Arn --output text | cut -d/ -f1-2))"
  T='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
  for c in "create-user --user-name measum.shah" "create-group --group-name megafab-admins"; do echo "\$ aws iam $c"; aws iam $c 2>&1 | grep -o 'AccessDenied.*operation'; done
  echo "\$ aws iam create-role --role-name megafab-app-instance-role ..."; aws iam create-role --role-name megafab-app-instance-role --assume-role-policy-document "$T" 2>&1 | grep -o 'AccessDenied.*operation'
  echo; echo "\$ aws iam list-policies --scope Local   # customer-managed policies ARE allowed and were created by CloudFormation"
  aws iam list-policies --scope Local --query 'Policies[?starts_with(PolicyName,`megafab`)].PolicyName' --output table ;;
 ta) echo "== Trusted-Advisor-equivalent review (TA console/API blocked in Learner Lab) =="
  printf "TA API: "; aws support describe-trusted-advisor-checks --language en >/dev/null 2>&1 && echo available || echo "AccessDenied (lab)"
  echo "-- Security: SG rules open to 0.0.0.0/0"; aws ec2 describe-security-groups --filters Name=ip-permission.cidr,Values=0.0.0.0/0 Name=tag:aws:cloudformation:stack-name,Values='megafab*' --query 'SecurityGroups[].[GroupName,join(`,`,IpPermissions[?IpRanges[?CidrIp==`0.0.0.0/0`]].to_string(ToPort))]' --output text
  echo "-- Security: S3 public access block (4 flags) per bucket"; for b in $(aws s3api list-buckets --query "Buckets[?starts_with(Name,'megafab')].Name" --output text); do printf "%-36s " $b; aws s3api get-public-access-block --bucket $b --query 'PublicAccessBlockConfiguration.[BlockPublicAcls,IgnorePublicAcls,BlockPublicPolicy,RestrictPublicBuckets]' --output text; done
  echo "-- Fault tolerance: RDS Multi-AZ / backup retention"; aws rds describe-db-instances --query 'DBInstances[].[DBInstanceIdentifier,MultiAZ,BackupRetentionPeriod]' --output text
  echo "-- Fault tolerance: ASG AZ spread"; aws autoscaling describe-auto-scaling-groups --query "AutoScalingGroups[].[AutoScalingGroupName,join(',',AvailabilityZones)]" --output text | cut -c1-90
  echo "-- Cost: unattached EBS volumes"; aws ec2 describe-volumes --filters Name=status,Values=available --query 'length(Volumes)' --output text
  echo "-- Cost: avg CPU last 1h per running instance"; for i in $(aws ec2 describe-instances --filters Name=instance-state-name,Values=running Name=tag:Project,Values=megafab --query 'Reservations[].Instances[].InstanceId' --output text) $(aws ec2 describe-instances --filters Name=instance-state-name,Values=running Name=tag:elasticbeanstalk:environment-name,Values=megafab-prod --query 'Reservations[].Instances[].InstanceId' --output text); do printf "%s %s " $i "$(aws ec2 describe-instances --instance-ids $i --query 'Reservations[0].Instances[0].Tags[?Key==`Name`].Value|[0]' --output text)"; aws cloudwatch get-metric-statistics --namespace AWS/EC2 --metric-name CPUUtilization --dimensions Name=InstanceId,Value=$i --start-time $(date -u -d '-1 hour' +%FT%TZ) --end-time $(date -u +%FT%TZ) --period 3600 --statistics Average --query 'Datapoints[0].Average' --output text; done
  echo "-- IAM: root MFA (AccountMFAEnabled)"; aws iam get-account-summary --query 'SummaryMap.AccountMFAEnabled' --output text ;;
 *) echo "usage: evidence.sh outputs|stacks|network|security|encryption|iam|workers|scaling|swf|trail|dns|bastion";;
esac
