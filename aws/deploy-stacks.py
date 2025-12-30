#!/usr/bin/env python3
"""
Deploy DiamondDrip infrastructure using smaller, modular stacks
Deploys stacks in order: Network -> Database -> Application -> Frontend

Tracks deployment state in deployment-state.json to allow resuming failed deployments.
"""
import os
import sys
import subprocess
import boto3
import time
import json
import argparse
import secrets
import string
import importlib.util
from pathlib import Path
from datetime import datetime

# Import upload functions from upload-player-client.py
def load_upload_module():
    """Load the upload-player-client module dynamically"""
    upload_script = Path(__file__).parent / 'upload-player-client.py'
    if not upload_script.exists():
        return None, None
    
    spec = importlib.util.spec_from_file_location("upload_player_client", upload_script)
    if spec and spec.loader:
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.upload_player_client, module.invalidate_cloudfront
    return None, None

upload_player_client, invalidate_cloudfront = load_upload_module()

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

def deploy_stack(template_file, stack_name, parameters, region, capabilities=None):
    """Deploy a single CloudFormation stack with detailed progress"""
    print(f"\n🚀 Deploying stack: {stack_name}")
    print(f"   Template: {template_file}")
    
    cf = boto3.client('cloudformation', region_name=region)
    
    # Check if stack exists and its status
    stack_exists = False
    stack_status = None
    try:
        stack_info = cf.describe_stacks(StackName=stack_name)
        stack_exists = True
        stack_status = stack_info['Stacks'][0]['StackStatus']
        
        # Handle stacks in ROLLBACK_COMPLETE state - they cannot be updated
        if stack_status == 'ROLLBACK_COMPLETE':
            print(f"   ⚠️  Stack is in ROLLBACK_COMPLETE state (cannot be updated)")
            print(f"   Deleting stack before redeploying...")
            
            # Delete the stack
            cf.delete_stack(StackName=stack_name)
            
            # Wait for deletion to complete
            print(f"   ⏳ Waiting for deletion to complete...")
            max_attempts = 60
            delay = 10
            
            for attempt in range(max_attempts):
                try:
                    current_info = cf.describe_stacks(StackName=stack_name)
                    current_status = current_info['Stacks'][0]['StackStatus']
                    elapsed = attempt * delay
                    print(f"   [{elapsed // 60}m {elapsed % 60:02d}s] Deletion status: {current_status}")
                    
                    if current_status == 'DELETE_COMPLETE':
                        print(f"   ✓ Stack deleted successfully")
                        stack_exists = False
                        break
                    elif current_status == 'DELETE_FAILED':
                        print(f"   ✗ Stack deletion failed")
                        return False
                    
                    time.sleep(delay)
                except cf.exceptions.ClientError as e:
                    if 'does not exist' in str(e):
                        print(f"   ✓ Stack deleted successfully")
                        stack_exists = False
                        break
                    raise
            
            if stack_exists:
                print(f"   ⚠️  Deletion timeout - stack may still be deleting")
                print(f"   Please wait and try again, or delete manually from AWS Console")
                return False
            
            print(f"   Creating new stack...")
        elif stack_status in ['CREATE_COMPLETE', 'UPDATE_COMPLETE']:
            print(f"   Stack exists, updating...")
        else:
            print(f"   Stack exists with status: {stack_status}, attempting update...")
    except cf.exceptions.ClientError as e:
        if 'does not exist' in str(e):
            print(f"   Creating new stack...")
        else:
            raise
    
    # Build command
    cmd = [
        'aws', 'cloudformation', 'deploy',
        '--template-file', template_file,
        '--stack-name', stack_name,
        '--region', region,
        '--no-fail-on-empty-changeset'
    ]
    
    # Add parameters
    if parameters:
        param_overrides = []
        for key, value in parameters.items():
            param_overrides.append(f'{key}={value}')
        cmd.extend(['--parameter-overrides'] + param_overrides)
    
    # Add capabilities
    if capabilities:
        cmd.extend(['--capabilities'] + capabilities)
    
    # Deploy
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        print(f"   ✓ Deployment command completed")
        
        # Wait for stack to be ready with detailed progress
        print(f"\n   ⏳ Waiting for stack operation to complete...")
        if not stack_exists:
            print(f"   NOTE: First deployment can take 10-15 minutes (especially for Database stack)")
            print(f"   Progress will be shown below:\n")
        
        # Custom wait with progress updates
        max_attempts = 90  # 15 minutes max
        delay = 10
        attempt = 0
        last_seen_resources = set()
        start_time = time.time()
        
        waiter_name = 'stack_update_complete' if stack_exists else 'stack_create_complete'
        
        while attempt < max_attempts:
            try:
                # Check stack status
                stack_info = cf.describe_stacks(StackName=stack_name)
                stack_status = stack_info['Stacks'][0]['StackStatus']
                
                elapsed = int(time.time() - start_time)
                elapsed_min = elapsed // 60
                elapsed_sec = elapsed % 60
                print(f"   [{elapsed_min}m {elapsed_sec:02d}s] Stack status: {stack_status}")
                
                # Check if complete
                if stack_status.endswith('_COMPLETE'):
                    if 'ROLLBACK' in stack_status or 'FAILED' in stack_status:
                        print(f"\n   ✗ Stack operation failed: {stack_status}")
                        # Get failure details
                        try:
                            events = cf.describe_stack_events(StackName=stack_name, MaxResults=10)
                            print(f"   Recent events:")
                            for event in events['StackEvents']:
                                if event['ResourceStatus'].endswith('FAILED'):
                                    print(f"     ✗ {event['LogicalResourceId']}: {event['ResourceStatus']}")
                                    if event.get('ResourceStatusReason'):
                                        reason = event['ResourceStatusReason'][:100]
                                        print(f"        {reason}")
                        except:
                            pass
                        return False
                    print(f"\n   ✓ Stack operation completed successfully!")
                    return True
                
                # Show resources being created/updated
                if stack_status.endswith('_IN_PROGRESS'):
                    try:
                        events = cf.describe_stack_events(StackName=stack_name, MaxResults=20)
                        current_resources = set()
                        
                        for event in events['StackEvents']:
                            resource_id = event['LogicalResourceId']
                            resource_status = event['ResourceStatus']
                            
                            # Show resources that are currently being created/updated
                            if resource_status.endswith('_IN_PROGRESS'):
                                if resource_id not in last_seen_resources:
                                    print(f"     → {resource_id}: {resource_status}")
                                current_resources.add(resource_id)
                            elif resource_status.endswith('_COMPLETE'):
                                if resource_id not in last_seen_resources:
                                    print(f"     ✓ {resource_id}: {resource_status}")
                                current_resources.add(resource_id)
                            elif resource_status.endswith('FAILED'):
                                if resource_id not in last_seen_resources:
                                    reason = event.get('ResourceStatusReason', 'Unknown')
                                    print(f"     ✗ {resource_id}: {resource_status}")
                                    if reason:
                                        reason_short = reason[:80] + "..." if len(reason) > 80 else reason
                                        print(f"        {reason_short}")
                                current_resources.add(resource_id)
                        
                        last_seen_resources = current_resources
                    except Exception as e:
                        pass  # Ignore errors when fetching events
                
                time.sleep(delay)
                attempt += 1
                
            except cf.exceptions.ClientError as e:
                if 'does not exist' in str(e):
                    print(f"\n   ✗ Stack was deleted during operation")
                    return False
                raise
        
        print(f"\n   ⚠️  Timeout waiting for stack operation")
        print(f"   Stack may still be processing. Check AWS Console for status.")
        return False
        
    except subprocess.CalledProcessError as e:
        print(f"   ✗ Deployment command failed: {e.stderr}")
        return False
    except Exception as e:
        print(f"   ✗ Error: {e}")
        return False

def get_stack_outputs(stack_name, region):
    """Get stack outputs"""
    cf = boto3.client('cloudformation', region_name=region)
    try:
        response = cf.describe_stacks(StackName=stack_name)
        outputs = {o['OutputKey']: o['OutputValue'] 
                  for o in response['Stacks'][0].get('Outputs', [])}
        return outputs
    except Exception as e:
        print(f"   ⚠ Could not get outputs: {e}")
        return {}

def get_state_file(project_name, environment):
    """Get path to deployment state file"""
    return Path(f'deployment-state-{project_name}-{environment}.json')

def get_password_file(project_name, environment):
    """Get path to database password file"""
    return Path(f'database-password-{project_name}-{environment}.txt')

def generate_secure_password(length=16):
    """Generate a secure random password meeting RDS requirements"""
    # RDS requirements: min 8 chars, must contain uppercase, lowercase, number
    # We'll ensure at least one of each required character type
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    
    # Ensure password has at least one uppercase, one lowercase, and one digit
    password = [
        secrets.choice(string.ascii_uppercase),  # At least one uppercase
        secrets.choice(string.ascii_lowercase),    # At least one lowercase
        secrets.choice(string.digits),             # At least one digit
    ]
    
    # Fill the rest with random characters
    for _ in range(length - 3):
        password.append(secrets.choice(alphabet))
    
    # Shuffle to avoid predictable pattern
    secrets.SystemRandom().shuffle(password)
    
    return ''.join(password)

def load_database_password(project_name, environment):
    """Load database password from file, or generate and save a new one"""
    password_file = get_password_file(project_name, environment)
    
    if password_file.exists():
        try:
            with open(password_file, 'r') as f:
                password = f.read().strip()
            if password and len(password) >= 8:
                print(f"   ✓ Loaded existing password from {password_file.name}")
                return password
            else:
                print(f"   ⚠️  Existing password file has invalid password, generating new one...")
        except Exception as e:
            print(f"   ⚠️  Could not read password file: {e}, generating new one...")
    
    # Generate new password
    password = generate_secure_password()
    
    # Save to file
    try:
        with open(password_file, 'w') as f:
            f.write(password)
        # Set restrictive permissions (owner read/write only)
        os.chmod(password_file, 0o600)
        print(f"   ✓ Generated new password and saved to {password_file.name}")
        print(f"   ⚠️  IMPORTANT: Keep this file secure! It contains your database password.")
    except Exception as e:
        print(f"   ⚠️  Could not save password file: {e}")
        print(f"   ⚠️  Password will not be persisted. You'll need to enter it manually next time.")
    
    return password

def load_deployment_state(project_name, environment):
    """Load deployment state from JSON file"""
    state_file = get_state_file(project_name, environment)
    if state_file.exists():
        try:
            with open(state_file, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"⚠️  Could not load state file: {e}")
            return {}
    return {}

def save_deployment_state(project_name, environment, state):
    """Save deployment state to JSON file"""
    state_file = get_state_file(project_name, environment)
    try:
        with open(state_file, 'w') as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        print(f"⚠️  Could not save state file: {e}")

def update_stack_state(state, stack_name, status, error=None, last_attempt_timestamp=None):
    """Update state for a specific stack"""
    if 'stacks' not in state:
        state['stacks'] = {}
    
    current_time = datetime.now().isoformat()
    
    # If stack entry exists, preserve last_attempt_timestamp if not provided
    if stack_name in state.get('stacks', {}):
        existing_entry = state['stacks'][stack_name]
        if last_attempt_timestamp is None:
            last_attempt_timestamp = existing_entry.get('last_attempt_timestamp')
    elif last_attempt_timestamp is None:
        # New deployment attempt - record the attempt time
        last_attempt_timestamp = current_time
    
    state['stacks'][stack_name] = {
        'status': status,  # 'success', 'failed', 'skipped'
        'timestamp': current_time,
        'error': error,
        'last_attempt_timestamp': last_attempt_timestamp
    }
    
    # Update last modified
    state['last_modified'] = current_time

def get_stack_status(state, stack_name):
    """Get deployment status for a stack"""
    if 'stacks' not in state:
        return None
    return state['stacks'].get(stack_name, {}).get('status')

def verify_stack_exists(stack_name, region):
    """Verify if stack exists and is in a good state"""
    cf = boto3.client('cloudformation', region_name=region)
    try:
        response = cf.describe_stacks(StackName=stack_name)
        status = response['Stacks'][0]['StackStatus']
        
        # Consider stacks in good states as successfully deployed
        good_statuses = [
            'CREATE_COMPLETE',
            'UPDATE_COMPLETE'
        ]
        
        # Stacks in ROLLBACK_COMPLETE cannot be updated - need to be deleted first
        if status == 'ROLLBACK_COMPLETE':
            return False, status
        
        if status in good_statuses:
            return True, status
        # Stack exists but not in good state - should redeploy
        return False, status
    except cf.exceptions.ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', '')
        if error_code == 'ValidationError' and 'does not exist' in str(e):
            return False, 'DOES_NOT_EXIST'
        raise

def main():
    """Main deployment function"""
    parser = argparse.ArgumentParser(
        description='Deploy DiamondDrip infrastructure using modular stacks',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Deploy all stacks (respects state file)
  python deploy-stacks.py

  # Deploy all stacks (ignore state file)
  python deploy-stacks.py --all

  # Deploy specific stack
  python deploy-stacks.py --stack network

  # Deploy multiple specific stacks
  python deploy-stacks.py --stack network --stack database

  # Reset state and deploy all
  python deploy-stacks.py --reset --all
        """
    )
    
    parser.add_argument('--stack', '-s', action='append', 
                       choices=['network', 'database', 'application', 'frontend'],
                       help='Deploy specific stack(s) (can be used multiple times)')
    parser.add_argument('--all', '-a', action='store_true',
                       help='Deploy all stacks, ignoring state file')
    parser.add_argument('--reset', '-r', action='store_true',
                       help='Reset deployment state file before deploying')
    parser.add_argument('--project', '-p', 
                       default=os.environ.get('PROJECT_NAME', 'diamonddrip'),
                       help='Project name (default: diamonddrip)')
    parser.add_argument('--env', '-e',
                       default=os.environ.get('ENVIRONMENT', 'production'),
                       help='Environment (default: production)')
    parser.add_argument('--region', 
                       default=os.environ.get('AWS_REGION', 'us-east-1'),
                       help='AWS region (default: us-east-1)')
    
    args = parser.parse_args()
    
    project_name = args.project
    environment = args.env
    region = args.region
    
    print("=" * 60)
    print("DiamondDrip Multi-Stack Deployment")
    print("=" * 60)
    
    print(f"\nConfiguration:")
    print(f"  Project: {project_name}")
    print(f"  Environment: {environment}")
    print(f"  Region: {region}")
    
    # Load deployment state
    state = load_deployment_state(project_name, environment)
    if args.reset:
        state = {}
        save_deployment_state(project_name, environment, state)
        print(f"\n🔄 Deployment state reset")
    
    # Pre-flight checks
    print("\n[CHECK] Pre-flight checks...")
    if not check_aws_credentials():
        print("\n✗ AWS credentials not configured.")
        print("  Run 'aws configure' to set up credentials")
        sys.exit(1)
    
    # Get database password (generate or load from file)
    print("\n📝 Database Configuration:")
    db_password = load_database_password(project_name, environment)
    
    db_username = os.environ.get('DB_USERNAME', 'diamonddrip_admin')
    db_instance_class = os.environ.get('DB_INSTANCE_CLASS', 'db.t3.micro')
    db_storage = os.environ.get('DB_STORAGE', '20')
    
    # Stack definitions in deployment order
    all_stacks = {
        'network': {
            'name': f'{project_name}-{environment}-network',
            'template': 'stacks/network.yaml',
            'parameters': {
                'ProjectName': project_name,
                'Environment': environment
            },
            'capabilities': None
        },
        'database': {
            'name': f'{project_name}-{environment}-database',
            'template': 'stacks/database.yaml',
            'parameters': {
                'ProjectName': project_name,
                'Environment': environment,
                'DatabaseInstanceClass': db_instance_class,
                'DatabaseAllocatedStorage': db_storage,
                'DatabaseMasterUsername': db_username,
                'DatabaseMasterPassword': db_password
            },
            'capabilities': None
        },
        'application': {
            'name': f'{project_name}-{environment}-application',
            'template': 'stacks/application.yaml',
            'parameters': {
                'ProjectName': project_name,
                'Environment': environment,
                'DatabaseMasterUsername': db_username,
                'DatabaseMasterPassword': db_password
            },
            'capabilities': ['CAPABILITY_NAMED_IAM']
        },
        'frontend': {
            'name': f'{project_name}-{environment}-frontend',
            'template': 'stacks/frontend.yaml',
            'parameters': {
                'ProjectName': project_name,
                'Environment': environment
            },
            'capabilities': None
        }
    }
    
    # Determine which stacks to deploy
    if args.stack:
        # Deploy specific stacks
        stacks_to_deploy = [(key, all_stacks[key]) for key in args.stack if key in all_stacks]
        ignore_state = True  # When specifying stacks, always deploy them
    elif args.all:
        # Deploy all stacks, ignoring state
        stacks_to_deploy = list(all_stacks.items())
        ignore_state = True
    else:
        # Deploy all stacks, but skip ones marked as successful in state
        stacks_to_deploy = []
        for key, stack_def in all_stacks.items():
            stack_status = get_stack_status(state, stack_def['name'])
            if stack_status == 'success':
                # Verify stack actually exists
                exists, actual_status = verify_stack_exists(stack_def['name'], region)
                if exists:
                    print(f"\n⏭️  Skipping {stack_def['name']} (already deployed successfully)")
                    continue
                else:
                    print(f"\n⚠️  State says {stack_def['name']} is deployed, but stack doesn't exist. Will redeploy.")
            stacks_to_deploy.append((key, stack_def))
        ignore_state = False
    
    if not stacks_to_deploy:
        print("\n✓ All stacks are already deployed successfully!")
        print("  Use --all to redeploy all stacks, or --stack to deploy specific ones")
        return
    
    # Deploy stacks in order
    print("\n" + "=" * 60)
    print(f"Deploying Stacks ({len(stacks_to_deploy)} stack(s))")
    print("=" * 60)
    
    deployed_stacks = []
    failed_stacks = []
    
    for i, (stack_key, stack) in enumerate(stacks_to_deploy, 1):
        print(f"\n[{i}/{len(stacks_to_deploy)}] {stack['name']}")
        print("-" * 60)
        
        # Record deployment attempt timestamp before starting
        attempt_timestamp = datetime.now().isoformat()
        update_stack_state(state, stack['name'], 'in_progress', last_attempt_timestamp=attempt_timestamp)
        save_deployment_state(project_name, environment, state)
        
        success = deploy_stack(
            stack['template'],
            stack['name'],
            stack['parameters'],
            region,
            stack['capabilities']
        )
        
        if success:
            # If this is the frontend stack, upload files to S3
            if stack_key == 'frontend':
                print(f"\n[UPLOAD] Uploading frontend files to S3...")
                try:
                    # Get bucket name from stack outputs
                    frontend_outputs = get_stack_outputs(stack['name'], region)
                    bucket_name = frontend_outputs.get('PlayerClientBucketName')
                    distribution_id = frontend_outputs.get('PlayerClientDistributionId')
                    
                    if bucket_name:
                        # Get API endpoint for config update
                        app_outputs = get_stack_outputs(f'{project_name}-{environment}-application', region)
                        api_endpoint = app_outputs.get('ApiEndpoint') if app_outputs else None
                        
                        # Upload files
                        if upload_player_client:
                            upload_success = upload_player_client(bucket_name, region, api_endpoint)
                            if upload_success:
                                print(f"   ✓ Files uploaded successfully to S3 bucket: {bucket_name}")
                                
                                # Verify files are actually in the bucket
                                print(f"   [VERIFY] Verifying files in S3 bucket...")
                                try:
                                    s3 = boto3.client('s3', region_name=region)
                                    response = s3.list_objects_v2(Bucket=bucket_name, MaxKeys=20)
                                    if 'Contents' in response:
                                        file_count = len(response['Contents'])
                                        print(f"   ✓ Verified: {file_count} file(s) found in bucket")
                                        # List key files
                                        key_files = [obj['Key'] for obj in response['Contents']]
                                        if 'index.html' in key_files:
                                            print(f"   ✓ Verified: index.html is present")
                                        else:
                                            print(f"   ⚠️  Warning: index.html not found in bucket")
                                    else:
                                        print(f"   ⚠️  Warning: No files found in bucket (may be empty)")
                                except Exception as e:
                                    print(f"   ⚠️  Warning: Could not verify files in bucket: {e}")
                                
                                # Invalidate CloudFront cache
                                if distribution_id and invalidate_cloudfront:
                                    invalidate_cloudfront(distribution_id, region)
                                    print(f"   ✓ CloudFront cache invalidation initiated")
                            else:
                                print(f"   ⚠️  Warning: Some files failed to upload. Check errors above.")
                        else:
                            print(f"   ⚠️  Warning: Upload module not available. Run manually:")
                            print(f"      python upload-player-client.py --stack-name {stack['name']} --invalidate")
                    else:
                        print(f"   ⚠️  Warning: Could not get bucket name from stack outputs.")
                        print(f"      Run manually: python upload-player-client.py --stack-name {stack['name']} --invalidate")
                except Exception as e:
                    print(f"   ⚠️  Warning: Failed to upload files automatically: {e}")
                    print(f"      Run manually: python upload-player-client.py --stack-name {stack['name']} --invalidate")
            
            update_stack_state(state, stack['name'], 'success', last_attempt_timestamp=attempt_timestamp)
            deployed_stacks.append(stack['name'])
        else:
            error_msg = f"Deployment failed for {stack['name']}"
            update_stack_state(state, stack['name'], 'failed', error_msg, last_attempt_timestamp=attempt_timestamp)
            failed_stacks.append(stack['name'])
            print(f"\n✗ Deployment failed at stack: {stack['name']}")
            
            # Don't exit - continue to save state, but show what happened
            if i < len(stacks_to_deploy):
                print(f"  Previous stacks are still deployed:")
                for deployed in deployed_stacks:
                    print(f"    - {deployed}")
                print(f"\n  You can:")
                print(f"    - Fix the issue and run: python deploy-stacks.py --stack {stack_key}")
                print(f"    - Or clean up: python cleanup-stacks.py")
    
    # Save state
    save_deployment_state(project_name, environment, state)
    
    # Summary
    print("\n" + "=" * 60)
    if failed_stacks:
        print("Deployment Summary (Some Failed)")
        print("=" * 60)
        print(f"\n✓ Successfully deployed: {len(deployed_stacks)}")
        print(f"✗ Failed: {len(failed_stacks)}")
        for failed in failed_stacks:
            print(f"    - {failed}")
        print(f"\n💡 To retry failed stacks:")
        for failed in failed_stacks:
            stack_key = failed.split('-')[-1]  # Extract stack type from name
            print(f"    python deploy-stacks.py --stack {stack_key}")
    else:
        print("Deployment Complete!")
        print("=" * 60)
        
        # Get final outputs
        app_outputs = get_stack_outputs(f'{project_name}-{environment}-application', region)
        frontend_outputs = get_stack_outputs(f'{project_name}-{environment}-frontend', region)
        
        if app_outputs:
            print(f"\n📡 API Endpoint:")
            print(f"   {app_outputs.get('ApiEndpoint', 'N/A')}")
        
        if frontend_outputs:
            print(f"\n🌐 Frontend URL:")
            print(f"   https://{frontend_outputs.get('PlayerClientURL', 'N/A')}")
        
        print(f"\n📝 Update your client code:")
        if app_outputs.get('ApiEndpoint'):
            print(f"   PREDICTION_SERVER_URL = '{app_outputs['ApiEndpoint']}/prediction'")
    
    print("\n" + "=" * 60)

if __name__ == '__main__':
    # Change to aws directory
    script_dir = Path(__file__).parent
    os.chdir(script_dir)
    
    main()

