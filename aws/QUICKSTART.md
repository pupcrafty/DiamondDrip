# Quick Start Guide

## 🚀 Deploy to AWS in 5 Minutes

### Step 1: Prerequisites

```bash
# Install AWS CLI
# Windows: Download from https://aws.amazon.com/cli/
# Mac: brew install awscli
# Linux: sudo apt-get install awscli

# Configure AWS credentials
aws configure
# Enter: Access Key ID, Secret Access Key, Region (e.g., us-east-1), Output format (json)
```

### Step 2: Install Python Dependencies

```bash
cd aws
pip install -r requirements.txt boto3
```

### Step 3: Deploy

```bash
# Option 1: Python script (recommended)
python deploy.py

# Option 2: Shell scripts (Linux/Mac)
./deploy.sh

# Option 3: Manual
./build-lambda.sh
aws cloudformation deploy --template-file infrastructure.yaml --stack-name diamonddrip-production --capabilities CAPABILITY_NAMED_IAM
aws lambda update-function-code --function-name diamonddrip-production-prediction-server --zip-file fileb://lambda-package.zip
```

### Step 4: Get Your API Endpoint

After deployment, the script will show your API endpoint. Or get it manually:

```bash
aws cloudformation describe-stacks \
    --stack-name diamonddrip-production \
    --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
    --output text
```

### Step 5: Update Client Code

```bash
# Automatically update client files
python update-client-config.py

# Or manually update:
# In player/playerClient/js/game.js:
#   const PREDICTION_SERVER_URL = 'https://YOUR-API-ID.execute-api.REGION.amazonaws.com/production/prediction';
```

## ✅ That's It!

Your prediction server is now running on AWS with:
- ✅ Automatic SSL/TLS (no certificate issues!)
- ✅ Scalable serverless architecture
- ✅ Managed PostgreSQL database
- ✅ Global CDN-ready

## 💰 Cost

- **Free Tier**: First 12 months free (RDS db.t3.micro)
- **After Free Tier**: ~$16-20/month for low traffic

## 🔧 Troubleshooting

**Deployment fails?**
- Check AWS credentials: `aws sts get-caller-identity`
- Verify region: `aws configure get region`
- Check CloudFormation events in AWS Console

**Lambda timeout?**
- Increase timeout in `infrastructure.yaml` (Timeout: 60)

**Database connection issues?**
- Wait 5-10 minutes after stack creation (RDS takes time to start)
- Check security groups in AWS Console

## 📚 Next Steps

- Set up CloudWatch alarms
- Configure custom domain
- Set up CI/CD pipeline
- Review security settings

See `README.md` for detailed documentation.


