#!/usr/bin/env python3
"""
Windows-compatible deployment script for DiamondDrip AWS infrastructure
Uses boto3 instead of AWS CLI
"""
import os
import sys
import subprocess
import json
import boto3
import zipfile
import shutil
from pathlib import Path

def check_aws_credentials():
    """Check if AWS credentials are configured"""
    try:
        client = boto3.client('sts')
        identity = client.get_caller_identity()
        print(f"[OK] AWS Account: {identity.get('Account')}")
        print(f"[OK] User/Role: {identity.get('Arn')}")
        print(f"[OK] Region: {boto3.Session().region_name or 'us-east-1'}")
        return True
    except Exception as e:
        print(f"[ERROR] AWS credentials error: {e}")
        print("\nPlease configure AWS credentials:")
        print("  1. Install AWS CLI: https://aws.amazon.com/cli/")
        print("  2. Run: aws configure")
        print("  3. Or set environment variables:")
        print("     AWS_ACCESS_KEY_ID")
        print("     AWS_SECRET_ACCESS_KEY")
        print("     AWS_DEFAULT_REGION")
        return False

def build_lambda_package():
    """Build the Lambda deployment package"""
    print("\n[Building Lambda package...]")
    print("  This packages the Lambda function and dependencies for deployment")
    
    # Create temporary directory
    temp_dir = Path('lambda-build')
    if temp_dir.exists():
        print("  Cleaning up old build directory...")
        shutil.rmtree(temp_dir)
    temp_dir.mkdir()
    print(f"  Created build directory: {temp_dir}")
    
    try:
        # Copy Lambda function files
        print("\n  [Step 1/3] Copying Lambda function files...")
        shutil.copy('lambda_function.py', temp_dir)
        print("    - Copied lambda_function.py")
        shutil.copy('database.py', temp_dir)
        print("    - Copied database.py")
        
        # Install dependencies
        print("  Installing dependencies for Lambda (Linux)...")
        # Download pre-built Linux wheel directly (Lambda runs on Linux)
        import urllib.request
        wheel_url = "https://files.pythonhosted.org/packages/py3/p/psycopg2_binary/psycopg2_binary-2.9.9-cp311-cp311-manylinux_2_17_x86_64.manylinux2014_x86_64.whl"
        wheel_path = temp_dir / "psycopg2_binary.whl"
        
        try:
            print("  Downloading psycopg2-binary wheel for Linux...")
            urllib.request.urlretrieve(wheel_url, wheel_path)
            print("  Extracting wheel...")
            # Extract wheel (wheels are just zip files)
            with zipfile.ZipFile(wheel_path, 'r') as wheel_zip:
                wheel_zip.extractall(temp_dir)
            wheel_path.unlink()
            print("  [OK] psycopg2-binary installed")
        except Exception as e:
            print(f"  [WARNING] Could not download wheel: {e}")
            print("  Trying pip with platform flag...")
            # Fallback: try pip with platform flag
            try:
                subprocess.run([
                    sys.executable, '-m', 'pip', 'install',
                    'psycopg2-binary==2.9.9',
                    '-t', str(temp_dir),
                    '--platform', 'manylinux2014_x86_64',
                    '--only-binary', ':all:',
                    '--python-version', '3.11',
                    '--implementation', 'cp',
                    '--quiet', '--disable-pip-version-check'
                ], check=True, capture_output=True)
                print("  [OK] psycopg2-binary installed via pip")
            except Exception as e2:
                print(f"  [ERROR] Failed to install psycopg2-binary: {e2}")
                print("  You may need to manually add it to the Lambda package")
                raise
        
        # Create zip file
        print("\n  [Step 3/3] Creating zip package...")
        zip_path = Path('lambda-package.zip')
        if zip_path.exists():
            print("    Removing old package...")
            zip_path.unlink()
        
        file_count = 0
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for file_path in temp_dir.rglob('*'):
                if file_path.is_file():
                    arcname = file_path.relative_to(temp_dir)
                    zipf.write(file_path, arcname)
                    file_count += 1
                    if file_count % 100 == 0:
                        print(f"    Packaged {file_count} files...")
        
        print(f"    Total files packaged: {file_count}")
        
        # Cleanup
        print("  Cleaning up build directory...")
        shutil.rmtree(temp_dir)
        
        size = zip_path.stat().st_size / (1024 * 1024)
        print(f"\n[OK] Lambda package created successfully!")
        print(f"  Package: {zip_path}")
        print(f"  Size: {size:.2f} MB")
        print(f"  Files: {file_count}")
        return True
        
    except Exception as e:
        print(f"[ERROR] Build failed: {e}")
        if temp_dir.exists():
            shutil.rmtree(temp_dir)
        return False

def deploy_stack(project_name, environment, region):
    """Deploy CloudFormation stack using boto3"""
    stack_name = f"{project_name}-{environment}"
    
    print(f"\n[Deploying CloudFormation stack: {stack_name}]")
    print(f"  Region: {region}")
    
    cf = boto3.client('cloudformation', region_name=region)
    
    # Read template
    print("  Reading CloudFormation template...")
    with open('infrastructure.yaml', 'r') as f:
        template_body = f.read()
    print(f"  Template size: {len(template_body)} bytes")
    
    # Check if stack exists
    print("  Checking if stack exists...")
    try:
        stack_info = cf.describe_stacks(StackName=stack_name)
        stack_status = stack_info['Stacks'][0]['StackStatus']
        
        # Check if stack is being deleted
        if 'DELETE' in stack_status:
            print(f"  [WARNING] Stack is currently being deleted (status: {stack_status})")
            print(f"  Cannot create/update stack while deletion is in progress")
            print(f"\n  Please wait for deletion to complete, then try again.")
            print(f"  Check status with: python check-stack-status.py {stack_name}")
            print(f"  Or wait and the script will check automatically...")
            
            # Wait for deletion to complete
            print(f"\n  [Waiting for stack deletion to complete...]")
            import time
            max_wait = 30  # 5 minutes
            for i in range(max_wait):
                try:
                    stack_info = cf.describe_stacks(StackName=stack_name)
                    current_status = stack_info['Stacks'][0]['StackStatus']
                    print(f"    [{i * 10}s] Status: {current_status}")
                    
                    if current_status == 'DELETE_COMPLETE':
                        print(f"  [OK] Stack deletion completed")
                        stack_exists = False
                        break
                    elif 'DELETE' not in current_status:
                        # Deletion finished, stack might have been recreated
                        print(f"  [INFO] Stack status changed to: {current_status}")
                        stack_exists = True
                        break
                    
                    time.sleep(10)
                except cf.exceptions.ClientError as e:
                    if 'does not exist' in str(e):
                        print(f"  [OK] Stack deleted successfully")
                        stack_exists = False
                        break
                    raise
            else:
                print(f"\n  [ERROR] Stack deletion is taking too long")
                print(f"  Please wait and check manually, then retry deployment")
                return False
        
        elif stack_status.endswith('_COMPLETE') or stack_status.endswith('_IN_PROGRESS'):
            print(f"  [INFO] Stack exists (status: {stack_status}), will update...")
            stack_exists = True
        else:
            print(f"  [WARNING] Stack exists with status: {stack_status}")
            print(f"  Attempting to update...")
            stack_exists = True
            
    except cf.exceptions.ClientError as e:
        if 'does not exist' in str(e):
            print(f"  [INFO] Stack does not exist, will create new stack...")
            stack_exists = False
        else:
            print(f"  [ERROR] Error checking stack: {e}")
            raise
    
    # Get parameters
    print("\n  [Configuring stack parameters...]")
    import getpass
    print("  Database password is required (min 8 characters)")
    print("  This will be used for the RDS PostgreSQL database")
    db_password = getpass.getpass("  Enter database password: ")
    
    if not db_password or len(db_password) < 8:
        print("[ERROR] Password must be at least 8 characters")
        return False
    
    parameters = [
        {'ParameterKey': 'ProjectName', 'ParameterValue': project_name},
        {'ParameterKey': 'Environment', 'ParameterValue': environment},
        {'ParameterKey': 'DatabaseMasterUsername', 'ParameterValue': 'diamonddrip_admin'},
        {'ParameterKey': 'DatabaseMasterPassword', 'ParameterValue': db_password},
    ]
    
    print("  [OK] Parameters configured:")
    print(f"    ProjectName: {project_name}")
    print(f"    Environment: {environment}")
    print(f"    DatabaseMasterUsername: diamonddrip_admin")
    print(f"    DatabaseMasterPassword: [hidden]")
    
    try:
        if stack_exists:
            print("\n  [Initiating stack update...]")
            response = cf.update_stack(
                StackName=stack_name,
                TemplateBody=template_body,
                Parameters=parameters,
                Capabilities=['CAPABILITY_NAMED_IAM']
            )
            print(f"  [OK] Stack update initiated")
            operation_type = "UPDATE"
        else:
            print("\n  [Initiating stack creation...]")
            print("  This will create:")
            print("    - VPC with public/private subnets")
            print("    - RDS PostgreSQL database (takes ~10 minutes)")
            print("    - Lambda function")
            print("    - API Gateway")
            print("    - Security groups and IAM roles")
            response = cf.create_stack(
                StackName=stack_name,
                TemplateBody=template_body,
                Parameters=parameters,
                Capabilities=['CAPABILITY_NAMED_IAM']
            )
            print(f"  [OK] Stack creation initiated")
            operation_type = "CREATE"
        
        stack_id = response['StackId']
        print(f"\n  Stack ID: {stack_id}")
        print(f"  Operation: {operation_type}")
        print(f"\n  [Waiting for stack operation to complete...]")
        if not stack_exists:
            print(f"  NOTE: First deployment takes 10-15 minutes (RDS database creation)")
            print(f"  Progress will be shown below:\n")
        
        # Wait for stack operation with progress updates
        import time
        if not stack_exists:
            waiter = cf.get_waiter('stack_create_complete')
        else:
            waiter = cf.get_waiter('stack_update_complete')
        
        # Custom wait with progress updates
        max_attempts = 90
        delay = 10
        attempt = 0
        
        while attempt < max_attempts:
            try:
                # Check stack status
                stack_status = cf.describe_stacks(StackName=stack_name)['Stacks'][0]['StackStatus']
                print(f"  [{attempt * delay // 60}m {attempt * delay % 60}s] Stack status: {stack_status}")
                
                # Check if complete
                if stack_status.endswith('_COMPLETE'):
                    if 'FAILED' in stack_status or 'ROLLBACK' in stack_status:
                        print(f"\n  [ERROR] Stack operation failed: {stack_status}")
                        print(f"\n  [Diagnosing failure...]")
                        # Get failure reason
                        try:
                            events = cf.describe_stack_events(StackName=stack_name)
                            print(f"  Recent stack events:")
                            failed_resources = []
                            for event in events['StackEvents']:
                                status = event['ResourceStatus']
                                if status.endswith('FAILED') or status.endswith('ROLLBACK'):
                                    resource = event['LogicalResourceId']
                                    reason = event.get('ResourceStatusReason', 'Unknown')
                                    timestamp = event.get('Timestamp', '')
                                    print(f"\n    [FAILED] {resource}")
                                    print(f"      Status: {status}")
                                    print(f"      Reason: {reason}")
                                    print(f"      Time: {timestamp}")
                                    failed_resources.append((resource, reason))
                            
                            if not failed_resources:
                                # Check stack status reason
                                stack_info = cf.describe_stacks(StackName=stack_name)['Stacks'][0]
                                if 'StackStatusReason' in stack_info:
                                    print(f"\n    Stack Status Reason: {stack_info['StackStatusReason']}")
                        except Exception as e:
                            print(f"    Could not retrieve events: {e}")
                        
                        print(f"\n  [Troubleshooting tips:]")
                        print(f"    1. Check the AWS CloudFormation console for detailed error messages")
                        print(f"    2. Common issues:")
                        print(f"       - IAM permissions insufficient")
                        print(f"       - Resource limits (e.g., VPC limit)")
                        print(f"       - Invalid parameter values")
                        print(f"       - Service quotas exceeded")
                        print(f"    3. To delete the failed stack:")
                        print(f"       aws cloudformation delete-stack --stack-name {stack_name}")
                        return False
                    print(f"\n  [OK] Stack operation completed successfully!")
                    return True
                
                # Check for in-progress status
                if stack_status.endswith('_IN_PROGRESS'):
                    # Show recent events
                    try:
                        events = cf.describe_stack_events(StackName=stack_name)
                        for event in events['StackEvents']:
                            if event['ResourceStatus'].endswith('_IN_PROGRESS'):
                                print(f"    -> {event['LogicalResourceId']}: {event['ResourceStatus']}")
                                break
                    except:
                        pass
                
                time.sleep(delay)
                attempt += 1
            except cf.exceptions.ClientError as e:
                if 'does not exist' in str(e) and stack_exists:
                    # Stack was deleted during update
                    print(f"\n  [ERROR] Stack was deleted during operation")
                    return False
                raise
        
        print(f"\n  [ERROR] Stack operation timed out after {max_attempts * delay // 60} minutes")
        return False
        
    except cf.exceptions.ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == 'ValidationError' and 'No updates' in str(e):
            print("[OK] Stack is already up to date (no changes detected)")
            return True
        else:
            print(f"\n[ERROR] Stack operation failed: {e}")
            error_msg = str(e)
            if 'ValidationError' in error_msg:
                print("  This is usually a template validation error.")
                print("  Check the CloudFormation template for issues.")
            elif 'InsufficientCapabilitiesException' in error_msg:
                print("  Missing required capabilities. Try adding --capabilities CAPABILITY_NAMED_IAM")
            else:
                print(f"  Error details: {error_msg}")
            return False

def update_lambda_code(project_name, environment, region):
    """Update Lambda function code"""
    function_name = f"{project_name}-{environment}-prediction-server"
    
    print(f"\n[Updating Lambda function code: {function_name}]")
    
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
        
        # Wait for update to complete
        waiter = lambda_client.get_waiter('function_updated')
        waiter.wait(FunctionName=function_name)
        
        print(f"✓ Lambda function is ready")
        return True
        
    except Exception as e:
        print(f"[ERROR] Failed to update Lambda: {e}")
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
        print(f"[ERROR] Failed to get stack outputs: {e}")
        return {}

def main():
    """Main deployment function"""
    print("=" * 60)
    print("DiamondDrip AWS Deployment (Windows)")
    print("=" * 60)
    
    # Get configuration
    project_name = os.environ.get('PROJECT_NAME', 'diamonddrip')
    environment = os.environ.get('ENVIRONMENT', 'production')
    region = os.environ.get('AWS_REGION', boto3.Session().region_name or 'us-east-1')
    
    print(f"\nConfiguration:")
    print(f"  Project: {project_name}")
    print(f"  Environment: {environment}")
    print(f"  Region: {region}")
    
    # Pre-flight checks
    print("\n[Pre-flight checks...]")
    
    if not check_aws_credentials():
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
    
    # Upload player client to S3
    print("\n" + "=" * 60)
    print("Uploading Player Client to S3...")
    print("=" * 60)
    
    if outputs and outputs.get('PlayerClientBucketName'):
        import subprocess
        upload_script = Path(__file__).parent / 'upload-player-client.py'
        if upload_script.exists():
            try:
                api_endpoint = outputs.get('ApiEndpoint', '')
                result = subprocess.run([
                    sys.executable, str(upload_script),
                    '--bucket', outputs['PlayerClientBucketName'],
                    '--stack-name', stack_name,
                    '--region', region,
                    '--api-endpoint', api_endpoint,
                    '--invalidate'
                ], capture_output=True, text=True)
                print(result.stdout)
                if result.returncode != 0:
                    print(f"[WARNING] Player client upload had issues: {result.stderr}")
            except Exception as e:
                print(f"[WARNING] Could not upload player client: {e}")
                print("  You can upload manually with:")
                print(f"    python upload-player-client.py --bucket {outputs.get('PlayerClientBucketName', 'BUCKET_NAME')}")
        else:
            print("[WARNING] upload-player-client.py not found")
    else:
        print("[WARNING] Player client bucket not found in stack outputs")
    
    print("\n" + "=" * 60)
    print("DEPLOYMENT COMPLETE!")
    print("=" * 60)
    
    if outputs:
        api_endpoint = outputs.get('ApiEndpoint', 'N/A')
        player_url = outputs.get('PlayerClientURL', 'N/A')
        
        print("\n" + "=" * 60)
        print("ENDPOINTS:")
        print("=" * 60)
        
        print(f"\n[PREDICTION API ENDPOINT]")
        print(f"  URL: {api_endpoint}")
        print(f"  Prediction endpoint: {api_endpoint}/prediction")
        print(f"  Stats endpoint: {api_endpoint}/stats")
        print(f"  Health check: {api_endpoint}/health")
        
        if player_url != 'N/A':
            print(f"\n[PLAYER CLIENT URL]")
            print(f"  Game URL: https://{player_url}")
            print(f"  (CloudFront CDN - global access)")
        else:
            print(f"\n[PLAYER CLIENT URL]")
            print(f"  Not available yet (CloudFront may still be deploying)")
            print(f"  Check stack outputs in AWS Console")
        
        print(f"\n[DATABASE ENDPOINT]")
        print(f"  Host: {outputs.get('DatabaseEndpoint', 'N/A')}")
        print(f"  Port: {outputs.get('DatabasePort', '5432')}")
        print(f"  (Private - only accessible from Lambda)")
        
        print("\n" + "=" * 60)
        print("QUICK START:")
        print("=" * 60)
        print(f"\n1. Play the game:")
        if player_url != 'N/A':
            print(f"   Open: https://{player_url}")
        else:
            print(f"   (Wait for CloudFront deployment, then check stack outputs)")
        
        print(f"\n2. Test the API:")
        print(f"   curl {api_endpoint}/health")
        
        print(f"\n3. Update local code (if needed):")
        print(f"   PREDICTION_SERVER_URL = '{api_endpoint}/prediction'")
        print(f"   Or run: python update-client-config.py")
        
        print("\n" + "=" * 60)
    else:
        print("\n[WARNING] Could not retrieve stack outputs")
        print("  Check AWS Console for endpoint information")
    
    print("\n" + "=" * 60)

if __name__ == '__main__':
    main()

