#!/bin/bash
# Deployment script for DiamondDrip AWS infrastructure

set -e

PROJECT_NAME="${PROJECT_NAME:-diamonddrip}"
ENVIRONMENT="${ENVIRONMENT:-production}"
STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}"
REGION="${AWS_REGION:-us-east-1}"

echo "=========================================="
echo "DiamondDrip AWS Deployment"
echo "=========================================="
echo "Project: $PROJECT_NAME"
echo "Environment: $ENVIRONMENT"
echo "Stack: $STACK_NAME"
echo "Region: $REGION"
echo "=========================================="
echo ""

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI not found. Please install it first."
    exit 1
fi

# Check if logged in
if ! aws sts get-caller-identity &> /dev/null; then
    echo "Error: Not logged into AWS. Run 'aws configure' first."
    exit 1
fi

# Build Lambda package
echo "Building Lambda package..."
./build-lambda.sh

if [ ! -f "lambda-package.zip" ]; then
    echo "Error: Lambda package not found. Build failed."
    exit 1
fi

# Deploy CloudFormation stack
echo ""
echo "Deploying CloudFormation stack..."
aws cloudformation deploy \
    --template-file infrastructure.yaml \
    --stack-name "$STACK_NAME" \
    --parameter-overrides \
        ProjectName="$PROJECT_NAME" \
        Environment="$ENVIRONMENT" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region "$REGION"

# Get stack outputs
echo ""
echo "Retrieving stack outputs..."
API_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
    --output text \
    --region "$REGION")

DB_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='DatabaseEndpoint'].OutputValue" \
    --output text \
    --region "$REGION")

echo ""
echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo "API Endpoint: $API_ENDPOINT"
echo "Database Endpoint: $DB_ENDPOINT"
echo ""
echo "Update your client code to use:"
echo "  PREDICTION_SERVER_URL = '$API_ENDPOINT/prediction'"
echo "=========================================="


