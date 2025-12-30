# DiamondDrip AWS Deployment

Complete AWS deployment setup for the DiamondDrip Prediction Server using a modular multi-stack architecture.

## Architecture

The infrastructure is split into 4 independent stacks:

- **Network Stack**: VPC, subnets, NAT gateway, route tables, security groups
- **Database Stack**: RDS PostgreSQL, DB subnet group, Secrets Manager
- **Application Stack**: Lambda function, API Gateway, IAM roles
- **Frontend Stack**: S3 bucket, CloudFront distribution

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **AWS CLI** installed and configured
   ```bash
   aws configure
   ```
3. **Python 3.11+** for deployment scripts
4. **boto3** Python library
   ```bash
   pip install boto3
   ```

## Quick Start

### 1. Install Dependencies

```bash
cd aws
pip install -r requirements.txt
```

### 2. Deploy All Stacks

```bash
python deploy-stacks.py
```

This will:
- Deploy stacks in order: Network → Database → Application → Frontend
- Save deployment state to `deployment-state-{project}-{env}.json`
- Skip stacks that are already successfully deployed

## Scripts Reference

### Deployment Scripts

#### `deploy-stacks.py` - Deploy Infrastructure Stacks

Deploys all or specific CloudFormation stacks with state tracking.

**Basic Usage:**
```bash
# Deploy all stacks (respects state file - skips already deployed)
python deploy-stacks.py

# Deploy all stacks (ignore state file)
python deploy-stacks.py --all

# Deploy specific stack(s)
python deploy-stacks.py --stack network
python deploy-stacks.py --stack network --stack database

# Reset state and deploy all
python deploy-stacks.py --reset --all
```

**Options:**
- `--stack, -s <name>` - Deploy specific stack (network, database, application, frontend). Can be used multiple times.
- `--all, -a` - Deploy all stacks, ignoring state file
- `--reset, -r` - Reset deployment state file before deploying
- `--project, -p <name>` - Project name (default: diamonddrip)
- `--env, -e <env>` - Environment: development, staging, production (default: production)
- `--region <region>` - AWS region (default: us-east-1)

**Environment Variables:**
- `PROJECT_NAME` - Project name
- `ENVIRONMENT` - Environment name
- `AWS_REGION` - AWS region
- `DB_USERNAME` - Database username (default: diamonddrip_admin)
- `DB_INSTANCE_CLASS` - RDS instance class (default: db.t3.micro)
- `DB_STORAGE` - RDS storage in GB (default: 20)

**State File:**
The script creates `deployment-state-{project}-{env}.json` to track which stacks deployed successfully. This allows:
- Resuming failed deployments (only failed stacks are redeployed)
- Skipping already-deployed stacks on subsequent runs
- Tracking deployment history

**Examples:**
```bash
# First deployment - deploys all stacks
python deploy-stacks.py

# If database stack failed, retry just that one
python deploy-stacks.py --stack database

# Force redeploy all stacks
python deploy-stacks.py --all

# Deploy to staging environment
python deploy-stacks.py --env staging
```

#### `cleanup-stacks.py` - Clean Up Stacks

Cleans up DiamondDrip stacks. By default, only deletes failed stacks (from deployment state file).

**Basic Usage:**
```bash
# Delete only failed stacks (from state file)
python cleanup-stacks.py

# Delete all stacks (ignores state file)
python cleanup-stacks.py --all
```

**Options:**
- `--all, -a` - Delete all stacks, ignoring state file
- `--project, -p <name>` - Project name (default: diamonddrip)
- `--env, -e <env>` - Environment (default: production)
- `--region, -r <region>` - AWS region (default: us-east-1)

**Environment Variables:**
- `PROJECT_NAME` - Project name
- `ENVIRONMENT` - Environment
- `AWS_REGION` - AWS region

**Behavior:**
- **Default**: Only deletes stacks marked as "failed" in `deployment-state-{project}-{env}.json`
- **With --all**: Deletes all stacks regardless of state
- Updates state file after deletion (removes deleted stacks from state)
- Deletes in reverse deployment order: Frontend → Application → Database → Network

**Examples:**
```bash
# Clean up only failed deployments
python cleanup-stacks.py

# Clean up everything
python cleanup-stacks.py --all

# Clean up specific project/environment
python cleanup-stacks.py --project myapp --env staging
```

### Monitoring Scripts

#### `check-stacks-status.py` - Monitor Stack Status

Check status of all stacks and see which operations are in progress.

**Basic Usage:**
```bash
# Check status once
python check-stacks-status.py

# Watch mode - continuously monitor (every 30 seconds)
python check-stacks-status.py --watch

# Watch mode with custom interval (every 10 seconds)
python check-stacks-status.py --watch 10
```

**Options:**
- `--watch, -w [interval]` - Watch mode, continuously monitor (default: 30s)
- `--project, -p <name>` - Project name
- `--env, -e <env>` - Environment
- `--region, -r <region>` - AWS region
- `--help, -h` - Show help message

**Environment Variables:**
- `PROJECT_NAME` - Project name
- `ENVIRONMENT` - Environment
- `AWS_REGION` - AWS region

**Output:**
- Summary of all stacks (In Progress, Completed, Failed)
- Detailed status for in-progress stacks
- Recent activity (which resources are being created/updated/deleted)
- Duration of operations

**Examples:**
```bash
# Quick status check
python check-stacks-status.py

# Continuous monitoring during deployment
python check-stacks-status.py --watch

# Check specific project
python check-stacks-status.py --project myapp --env staging
```

#### `check-stack-status.py` - Check Single Stack Status

Check detailed status of a single CloudFormation stack.

**Usage:**
```bash
python check-stack-status.py <stack-name> [region]
```

**Example:**
```bash
python check-stack-status.py diamonddrip-production-network us-east-1
```

#### `get-endpoints.py` - Get Stack Endpoints

Get endpoints and URLs for all deployed stacks. Displays API endpoints, frontend URLs, database endpoints, and other useful information.

**Basic Usage:**
```bash
# Get all endpoints
python get-endpoints.py

# Get endpoints for specific project/environment
python get-endpoints.py --project myapp --env staging

# Get endpoints in JSON format
python get-endpoints.py --json
```

**Options:**
- `--project, -p <name>` - Project name (default: diamonddrip)
- `--env, -e <env>` - Environment (default: production)
- `--region, -r <region>` - AWS region (default: us-east-1)
- `--json, -j` - Output in JSON format

**Output:**
- **Application Stack**: API endpoint URL with all available routes (POST /prediction, GET /stats, etc.), Lambda function name
- **Frontend Stack**: CloudFront URL, S3 bucket name, CloudFront distribution ID
- **Database Stack**: Database endpoint, port, connection information
- **Network Stack**: VPC ID and other network resources

**Examples:**
```bash
# Quick endpoint lookup
python get-endpoints.py

# JSON output for scripting
python get-endpoints.py --json

# Check staging environment endpoints
python get-endpoints.py --env staging
```

#### `diagnose-stacks.py` - Diagnose Stack Failures

Analyze stack events to identify why stacks failed and provide troubleshooting guidance.

**Basic Usage:**
```bash
# Diagnose all stacks
python diagnose-stacks.py

# Diagnose specific stack
python diagnose-stacks.py --stack network

# Diagnose by exact stack name
python diagnose-stacks.py --stack-name diamonddrip-production-database

# Only diagnose failed stacks
python diagnose-stacks.py --failed-only

# Verbose output with detailed timeline
python diagnose-stacks.py --stack database --verbose

# Export events to JSON file
python diagnose-stacks.py --stack database --export
```

**Options:**
- `--stack, -s <name>` - Diagnose specific stack (network, database, application, frontend)
- `--stack-name <name>` - Diagnose stack by exact name
- `--failed-only, -f` - Only diagnose failed stacks
- `--verbose, -v` - Show detailed timeline and all events
- `--export` - Export events to JSON file
- `--project, -p <name>` - Project name
- `--env, -e <env>` - Environment
- `--region, -r <region>` - AWS region

**Features:**
- Identifies failed resources with error messages
- Categorizes errors (permissions, limits, conflicts, timeouts)
- Provides troubleshooting tips based on error type
- Shows resource creation timeline
- Exports events to JSON for further analysis

**Example Output:**
```
❌ FAILED RESOURCES (1)
[1] Database
    Type: AWS::RDS::DBInstance
    Status: CREATE_FAILED
    Error: User is not authorized to perform: rds:CreateDBSnapshot

🔎 ERROR ANALYSIS
PERMISSIONS Errors (1):
   • Database
   🔐 Permission Issues Detected:
      1. Check IAM permissions for the deployment user/role
      2. Verify the deployment permissions policy includes:
         - RDS permissions (CreateDBSnapshot, DeleteDBInstance, etc.)
```

**Environment Variables:**
- `PROJECT_NAME` - Project name
- `ENVIRONMENT` - Environment
- `AWS_REGION` - AWS region

### Utility Scripts

#### `fix-rollback-failed.py` - Fix ROLLBACK_FAILED Stacks

Fix stacks stuck in ROLLBACK_FAILED state.

**Usage:**
```bash
python fix-rollback-failed.py <stack-name> [region]
```

**Example:**
```bash
python fix-rollback-failed.py diamonddrip-production-database us-east-1
```

**Features:**
- Shows recent stack events
- Continues rollback operation
- Can skip blocking resources
- Interactive menu for options

#### `build-lambda.sh` - Build Lambda Package

Build the Lambda deployment package.

**Usage:**
```bash
bash build-lambda.sh
```

Creates `lambda-package.zip` with Lambda function and dependencies.

#### `upload-player-client.py` - Upload Frontend to S3

Upload player client files to S3 bucket.

**Usage:**
```bash
python upload-player-client.py [options]
```

**Options:**
- `--stack-name` - CloudFormation stack name (default: diamonddrip-production)
- `--bucket` - S3 bucket name (overrides stack lookup)
- `--source-dir` - Source directory (default: ../player)
- `--region` - AWS region

**Example:**
```bash
python upload-player-client.py --stack-name diamonddrip-production-frontend
```

#### `update-client-config.py` - Update Client Configuration

Update client configuration files with API endpoint.

**Usage:**
```bash
python update-client-config.py [options]
```

**Options:**
- `--stack-name` - CloudFormation stack name
- `--config-file` - Config file to update
- `--region` - AWS region

#### `database.py` - Database Utilities

Database helper functions and utilities.

**Usage:**
```bash
python database.py
```

Contains database connection and schema management code.

## Stack Templates

All stack templates are in the `stacks/` directory:

- **`stacks/network.yaml`** - Network infrastructure
- **`stacks/database.yaml`** - Database infrastructure
- **`stacks/application.yaml`** - Application infrastructure
- **`stacks/frontend.yaml`** - Frontend infrastructure

See `stacks/README.md` for detailed stack documentation.

## Deployment State File

The deployment script creates a JSON file (`deployment-state-{project}-{env}.json`) that tracks:

```json
{
  "stacks": {
    "diamonddrip-production-network": {
      "status": "success",
      "timestamp": "2025-12-29T10:30:00",
      "error": null
    },
    "diamonddrip-production-database": {
      "status": "failed",
      "timestamp": "2025-12-29T10:35:00",
      "error": "Deployment failed for diamonddrip-production-database"
    }
  },
  "last_modified": "2025-12-29T10:35:00"
}
```

**Benefits:**
- Resume failed deployments
- Skip already-deployed stacks
- Track deployment history
- Know which stacks need attention

## Configuration

### Environment Variables

Set these before running scripts:

```bash
export PROJECT_NAME=diamonddrip
export ENVIRONMENT=production
export AWS_REGION=us-east-1
export DB_USERNAME=diamonddrip_admin
export DB_INSTANCE_CLASS=db.t3.micro
export DB_STORAGE=20
```

### Stack Parameters

Each stack has its own parameters. See individual stack templates for details.

## Deployment Workflow

### First Deployment

```bash
# 1. Deploy all stacks
python deploy-stacks.py

# 2. Monitor progress
python check-stacks-status.py --watch

# 3. Upload Lambda code (if needed)
bash build-lambda.sh
aws lambda update-function-code \
    --function-name diamonddrip-production-prediction-server \
    --zip-file fileb://lambda-package.zip

# 4. Upload frontend
python upload-player-client.py
```

### Updating Specific Stack

```bash
# Update only the application stack
python deploy-stacks.py --stack application

# Or update multiple stacks
python deploy-stacks.py --stack network --stack application
```

### Resuming Failed Deployment

```bash
# Check what failed
python check-stacks-status.py

# Retry failed stack
python deploy-stacks.py --stack database
```

### Complete Redeployment

```bash
# Reset state and redeploy all
python deploy-stacks.py --reset --all
```

## API Endpoints

After deployment, get endpoints using the helper script:

```bash
# Get all endpoints (recommended)
python get-endpoints.py

# Get endpoints in JSON format
python get-endpoints.py --json
```

Or manually query stack outputs:

```bash
# Get API endpoint
aws cloudformation describe-stacks \
    --stack-name diamonddrip-production-application \
    --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
    --output text

# Get Frontend URL
aws cloudformation describe-stacks \
    --stack-name diamonddrip-production-frontend \
    --query "Stacks[0].Outputs[?OutputKey=='PlayerClientURL'].OutputValue" \
    --output text
```

**Endpoints:**
- `POST /prediction` - Submit prediction data
- `GET /stats` - Get statistics
- `GET /recent?limit=100` - Get recent predictions
- `GET /health` - Health check
- `GET /` - Health check (alias)

## Cleanup

### Delete All Stacks

```bash
python cleanup-stacks.py
```

### Delete Specific Stack

```bash
aws cloudformation delete-stack --stack-name diamonddrip-production-frontend
```

**Note:** Delete in reverse order (Frontend → Application → Database → Network) to avoid dependency issues.

## Troubleshooting

### Check Stack Status

```bash
# Check all stacks
python check-stacks-status.py

# Check specific stack
python check-stack-status.py diamonddrip-production-database
```

### Fix Rollback Issues

```bash
python fix-rollback-failed.py diamonddrip-production-database
```

### View Stack Events

```bash
aws cloudformation describe-stack-events \
    --stack-name diamonddrip-production-database \
    --max-items 20
```

### Common Issues

1. **Stack in ROLLBACK_FAILED state**
   - Use `fix-rollback-failed.py` to continue rollback
   - Or skip blocking resources

2. **Import/Export errors**
   - Ensure stacks are deployed in correct order
   - Check export names match exactly

3. **Permission errors**
   - Verify IAM permissions (see deployment permissions documentation)
   - Check service-linked role creation permissions

4. **Database deletion issues**
   - Database has `DeletionPolicy: Snapshot`
   - May need `rds:CreateDBSnapshot` permission
   - Can take 10-15 minutes to delete

## Cost Estimation

**Free Tier Eligible:**
- Lambda: 1M requests/month free
- API Gateway: 1M requests/month free
- RDS: db.t3.micro free for 12 months (750 hours/month)
- S3: 5GB storage free
- CloudFront: 50GB data transfer free

**Estimated Monthly Cost (after free tier):**
- Lambda: ~$0.20 per 1M requests
- API Gateway: ~$1.00 per 1M requests
- RDS db.t3.micro: ~$15/month
- S3: ~$0.023/GB storage
- CloudFront: ~$0.085/GB data transfer
- NAT Gateway: ~$32/month + data transfer

**Total: ~$50-60/month** for low to moderate traffic

## Security

- **VPC**: Database in private subnets
- **Security Groups**: Restrictive access rules
- **Secrets Manager**: Encrypted credential storage
- **SSL/TLS**: Automatic via API Gateway and CloudFront
- **IAM Roles**: Least privilege access
- **Network Isolation**: Lambda and Database in private subnets

## Next Steps

1. **Monitor deployments**: Use `check-stacks-status.py --watch` during deployments
2. **Set up CloudWatch alarms**: Monitor stack health
3. **Configure CI/CD**: Automate deployments
4. **Add custom domain**: For API Gateway and CloudFront
5. **Set up backups**: Configure RDS automated backups
6. **Enable logging**: CloudWatch Logs for Lambda and API Gateway

## Support

For issues:
1. Check stack status: `python check-stacks-status.py`
2. Review CloudFormation events in AWS Console
3. Check CloudWatch Logs
4. Verify IAM permissions
5. Review `stacks/README.md` for stack-specific documentation
