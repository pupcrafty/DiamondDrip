#!/usr/bin/env python3
"""
Python deployment script for DiamondDrip AWS infrastructure
Provides interactive deployment with better error handling
"""
import os
import sys
import subprocess
import json
import boto3
from pathlib import Path

def check_aws_cli():
    """Check if AWS CLI is installed"""
    try:
        subprocess.run(['aws', '--version'], capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False

def check_aws_credentials():
    """Check if AWS credentials are configured"""
    try:
        client = boto3.client('sts')
        identity = client.get_caller_identity()
        print(f"✓ AWS Account: {identity.get('Account')}")
        print(f"✓ User/Role: {identity.get('Arn')}")
        return True
    except Exception as e:
        print(f"✗ AWS credentials error: {e}")
        return False

def build_lambda_package():
    """Build the Lambda deployment package"""
    print("\n📦 Building Lambda package...")
    
    if not Path('build-lambda.sh').exists():
        print("✗ build-lambda.sh not found")
        return False
    
    try:
        result = subprocess.run(['bash', 'build-lambda.sh'], 
                              capture_output=True, text=True, check=True)
        print(result.stdout)
        
        if Path('lambda-package.zip').exists():
            size = Path('lambda-package.zip').stat().st_size / (1024 * 1024)
            print(f"✓ Lambda package created ({size:.2f} MB)")
            return True
        else:
            print("✗ Lambda package not found after build")
            return False
    except subprocess.CalledProcessError as e:
        print(f"✗ Build failed: {e.stderr}")
        return False

def deploy_stack(project_name, environment, region):
    """Deploy CloudFormation stack"""
    stack_name = f"{project_name}-{environment}"
    
    print(f"\n🚀 Deploying CloudFormation stack: {stack_name}")
    
    # Check if stack exists
    cf = boto3.client('cloudformation', region_name=region)
    try:
        cf.describe_stacks(StackName=stack_name)
        print(f"  Stack exists, updating...")
    except cf.exceptions.ClientError as e:
        if 'does not exist' in str(e):
            print(f"  Creating new stack...")
        else:
            raise
    
    # Deploy
    cmd = [
        'aws', 'cloudformation', 'deploy',
        '--template-file', 'infrastructure.yaml',
        '--stack-name', stack_name,
        '--parameter-overrides',
        f'ProjectName={project_name}',
        f'Environment={environment}',
        '--capabilities', 'CAPABILITY_NAMED_IAM',
        '--region', region
    ]
    
    try:
        subprocess.run(cmd, check=True)
        print(f"✓ Stack deployed successfully")
        return True
    except subprocess.CalledProcessError as e:
        print(f"✗ Deployment failed")
        return False

def update_lambda_code(project_name, environment, region):
    """Update Lambda function code"""
    function_name = f"{project_name}-{environment}-prediction-server"
    
    print(f"\n📤 Updating Lambda function code: {function_name}")
    
    if not Path('lambda-package.zip').exists():
        print("✗ Lambda package not found")
        return False
    
    lambda_client = boto3.client('lambda', region_name=region)
    
    try:
        with open('lambda-package.zip', 'rb') as f:
            zip_content = f.read()
        
        response = lambda_client.update_function_code(
            FunctionName=function_name,
            ZipFile=zip_content
        )
        
        print(f"✓ Lambda function updated")
        print(f"  Version: {response.get('Version')}")
        return True
    except Exception as e:
        print(f"✗ Failed to update Lambda: {e}")
        return False

def get_stack_outputs(stack_name, region):
    """Get CloudFormation stack outputs"""
    cf = boto3.client('cloudformation', region_name=region)
    
    try:
        response = cf.describe_stacks(StackName=stack_name)
        outputs = {o['OutputKey']: o['OutputValue'] 
                  for o in response['Stacks'][0]['Outputs']}
        return outputs
    except Exception as e:
        print(f"✗ Failed to get stack outputs: {e}")
        return {}

def main():
    """Main deployment function"""
    print("=" * 60)
    print("DiamondDrip AWS Deployment")
    print("=" * 60)
    
    # Get configuration
    project_name = os.environ.get('PROJECT_NAME', 'diamonddrip')
    environment = os.environ.get('ENVIRONMENT', 'production')
    region = os.environ.get('AWS_REGION', 'us-east-1')
    
    print(f"\nConfiguration:")
    print(f"  Project: {project_name}")
    print(f"  Environment: {environment}")
    print(f"  Region: {region}")
    
    # Pre-flight checks
    print("\n🔍 Pre-flight checks...")
    
    if not check_aws_cli():
        print("✗ AWS CLI not found. Please install it first.")
        sys.exit(1)
    print("✓ AWS CLI installed")
    
    if not check_aws_credentials():
        print("\n✗ AWS credentials not configured.")
        print("  Run 'aws configure' to set up credentials")
        sys.exit(1)
    
    # Build Lambda package
    if not build_lambda_package():
        sys.exit(1)
    
    # Deploy infrastructure
    if not deploy_stack(project_name, environment, region):
        sys.exit(1)
    
    # Update Lambda code
    if not update_lambda_code(project_name, environment, region):
        sys.exit(1)
    
    # Get outputs
    stack_name = f"{project_name}-{environment}"
    outputs = get_stack_outputs(stack_name, region)
    
    print("\n" + "=" * 60)
    print("Deployment Complete!")
    print("=" * 60)
    
    if outputs:
        print(f"\n📡 API Endpoint:")
        print(f"   {outputs.get('ApiEndpoint', 'N/A')}")
        print(f"\n💾 Database Endpoint:")
        print(f"   {outputs.get('DatabaseEndpoint', 'N/A')}")
        print(f"\n📝 Update your client code:")
        print(f"   PREDICTION_SERVER_URL = '{outputs.get('ApiEndpoint', '')}/prediction'")
    
    print("\n" + "=" * 60)

if __name__ == '__main__':
    main()


