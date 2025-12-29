# DiamondDrip AWS Deployment

Complete AWS deployment setup for the DiamondDrip Prediction Server with RDS PostgreSQL, Lambda, and API Gateway.

## Architecture

- **API Gateway**: HTTP API with automatic SSL/TLS
- **Lambda**: Serverless function handling prediction requests
- **RDS PostgreSQL**: Managed database for prediction data
- **VPC**: Isolated network for database security
- **Secrets Manager**: Secure credential storage

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **AWS CLI** installed and configured
   ```bash
   aws configure
   ```
3. **Python 3.11+** for Lambda
4. **pip** for installing dependencies

## Quick Start

### 1. Install Dependencies

```bash
cd aws
pip install -r requirements.txt
pip install boto3  # For deployment script
```

### 2. Configure Deployment

Set environment variables (optional, defaults shown):

```bash
export PROJECT_NAME=diamonddrip
export ENVIRONMENT=production
export AWS_REGION=us-east-1
```

### 3. Deploy Infrastructure

**Option A: Using Python script (Recommended)**
```bash
python deploy.py
```

**Option B: Using shell script**
```bash
chmod +x deploy.sh build-lambda.sh
./deploy.sh
```

**Option C: Manual CloudFormation**
```bash
# Build Lambda package
./build-lambda.sh

# Deploy stack
aws cloudformation deploy \
    --template-file infrastructure.yaml \
    --stack-name diamonddrip-production \
    --capabilities CAPABILITY_NAMED_IAM \
    --region us-east-1

# Update Lambda code
aws lambda update-function-code \
    --function-name diamonddrip-production-prediction-server \
    --zip-file fileb://lambda-package.zip \
    --region us-east-1
```

## Configuration

### CloudFormation Parameters

Edit `infrastructure.yaml` or pass parameters:

- `ProjectName`: Project name (default: `diamonddrip`)
- `Environment`: Environment name (default: `production`)
- `DatabaseInstanceClass`: RDS instance size (default: `db.t3.micro`)
- `DatabaseAllocatedStorage`: Storage in GB (default: `20`)
- `DatabaseMasterUsername`: Database admin username
- `DatabaseMasterPassword`: Database admin password (min 8 chars)

### Environment Variables

Lambda function uses these environment variables (set automatically):

- `DB_HOST`: RDS endpoint
- `DB_PORT`: RDS port (5432)
- `DB_NAME`: Database name (diamonddrip)
- `DB_USER`: Database username
- `DB_PASSWORD`: Database password

## Database Setup

The database schema is automatically created on first Lambda invocation. The `PredictionDatabase` class handles:

- Table creation
- Index creation
- JSONB support for complex data

### Manual Database Access

To connect to the database manually:

```bash
# Get database endpoint
DB_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name diamonddrip-production \
    --query "Stacks[0].Outputs[?OutputKey=='DatabaseEndpoint'].OutputValue" \
    --output text)

# Connect (requires VPN or bastion host)
psql -h $DB_ENDPOINT -U diamonddrip_admin -d diamonddrip
```

## API Endpoints

After deployment, your API will be available at:

```
https://<api-id>.execute-api.<region>.amazonaws.com/production
```

Endpoints:
- `POST /prediction` - Submit prediction data
- `GET /stats` - Get statistics
- `GET /recent?limit=100` - Get recent predictions
- `GET /health` - Health check
- `GET /` - Health check (alias)

## Updating the Deployment

### Update Lambda Code Only

```bash
./build-lambda.sh
aws lambda update-function-code \
    --function-name diamonddrip-production-prediction-server \
    --zip-file fileb://lambda-package.zip
```

### Update Infrastructure

```bash
aws cloudformation update-stack \
    --stack-name diamonddrip-production \
    --template-body file://infrastructure.yaml \
    --capabilities CAPABILITY_NAMED_IAM
```

## Cost Estimation

**Free Tier Eligible:**
- Lambda: 1M requests/month free
- API Gateway: 1M requests/month free
- RDS: db.t3.micro free for 12 months (750 hours/month)

**Estimated Monthly Cost (after free tier):**
- Lambda: ~$0.20 per 1M requests
- API Gateway: ~$1.00 per 1M requests
- RDS db.t3.micro: ~$15/month
- Data transfer: ~$0.09/GB

**Total: ~$16-20/month** for low to moderate traffic

## Monitoring

### CloudWatch Logs

Lambda logs are automatically sent to CloudWatch:

```bash
aws logs tail /aws/lambda/diamonddrip-production-prediction-server --follow
```

### CloudWatch Metrics

Monitor:
- Lambda invocations
- Lambda errors
- API Gateway requests
- RDS connections
- Database CPU/Memory

## Security

- **VPC**: Database in private subnets
- **Security Groups**: Restrictive access rules
- **Secrets Manager**: Encrypted credential storage
- **SSL/TLS**: Automatic via API Gateway
- **IAM Roles**: Least privilege access

## Troubleshooting

### Lambda Timeout

If Lambda times out, increase timeout in `infrastructure.yaml`:

```yaml
Timeout: 60  # Increase from 30
```

### Database Connection Issues

1. Check security groups allow Lambda → RDS
2. Verify Lambda is in VPC
3. Check RDS endpoint is correct

### API Gateway CORS

CORS is configured in the CloudFormation template. If issues persist, check:
- API Gateway CORS settings
- Lambda response headers

## Cleanup

To delete all resources:

```bash
aws cloudformation delete-stack \
    --stack-name diamonddrip-production
```

**Note**: RDS has `DeletionPolicy: Snapshot`, so a snapshot will be created before deletion.

## Custom Domain

To use a custom domain:

1. Request certificate in ACM (same region as API Gateway)
2. Update `infrastructure.yaml` with `CertificateArn` parameter
3. Create custom domain mapping in API Gateway console

## Support

For issues or questions:
1. Check CloudWatch Logs
2. Review CloudFormation stack events
3. Verify IAM permissions
4. Check security group rules

## Next Steps

1. Update client code to use new API endpoint
2. Set up CloudWatch alarms
3. Configure auto-scaling if needed
4. Set up CI/CD pipeline
5. Add custom domain


