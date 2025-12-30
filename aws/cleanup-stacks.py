#!/usr/bin/env python3
"""
Clean up DiamondDrip stacks
By default, only cleans up failed deployments (from state file)
Use --all to clean up all stacks
"""
import os
import sys
import boto3
import time
import json
import argparse
from pathlib import Path
from datetime import datetime
from botocore.exceptions import ClientError

def delete_stack(stack_name, region):
    """Delete a CloudFormation stack"""
    cf = boto3.client('cloudformation', region_name=region)
    
    print(f"\n🗑️  Deleting stack: {stack_name}")
    
    try:
        # Check if stack exists
        try:
            stack_info = cf.describe_stacks(StackName=stack_name)
            status = stack_info['Stacks'][0]['StackStatus']
            print(f"   Current status: {status}")
        except cf.exceptions.ClientError as e:
            if 'does not exist' in str(e):
                print(f"   ✓ Stack does not exist (already deleted)")
                return True
            raise
        
        # Initiate deletion
        cf.delete_stack(StackName=stack_name)
        print(f"   ✓ Deletion initiated")
        
        # Wait for deletion
        print(f"   Waiting for deletion to complete...")
        max_attempts = 60
        delay = 10
        
        for attempt in range(max_attempts):
            try:
                status = cf.describe_stacks(StackName=stack_name)['Stacks'][0]['StackStatus']
                elapsed = attempt * delay
                print(f"   [{elapsed // 60}m {elapsed % 60:02d}s] Status: {status}")
                
                if status == 'DELETE_COMPLETE':
                    print(f"   ✓ Stack deleted successfully")
                    return True
                elif status == 'DELETE_FAILED':
                    print(f"   ✗ Stack deletion failed")
                    return False
                
                time.sleep(delay)
            except cf.exceptions.ClientError as e:
                if 'does not exist' in str(e):
                    print(f"   ✓ Stack deleted successfully")
                    return True
                raise
        
        print(f"   ⚠️  Deletion timeout - stack may still be deleting")
        return True
        
    except Exception as e:
        print(f"   ✗ Error: {e}")
        return False

def get_state_file(project_name, environment):
    """Get path to deployment state file"""
    return Path(f'deployment-state-{project_name}-{environment}.json')

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

def get_failed_stacks(state):
    """Get list of failed stack names from state"""
    failed_stacks = []
    if 'stacks' in state:
        for stack_name, stack_info in state['stacks'].items():
            if stack_info.get('status') == 'failed':
                failed_stacks.append(stack_name)
    return failed_stacks

def verify_stack_exists(stack_name, region):
    """Check if stack exists in AWS"""
    cf = boto3.client('cloudformation', region_name=region)
    try:
        cf.describe_stacks(StackName=stack_name)
        return True
    except ClientError as e:
        if 'does not exist' in str(e):
            return False
        raise

def main():
    """Main cleanup function"""
    parser = argparse.ArgumentParser(
        description='Clean up DiamondDrip CloudFormation stacks',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Clean up only failed stacks (from state file)
  python cleanup-stacks.py

  # Clean up all stacks
  python cleanup-stacks.py --all

  # Clean up a single specific stack
  python cleanup-stacks.py --stack diamonddrip-production-frontend

  # Clean up with specific project/environment
  python cleanup-stacks.py --project myapp --env staging
        """
    )
    
    parser.add_argument('--all', '-a', action='store_true',
                       help='Delete all stacks (ignores state file)')
    parser.add_argument('--stack', '-s',
                       help='Delete a single specific stack by name')
    parser.add_argument('--project', '-p',
                       default=os.environ.get('PROJECT_NAME', 'diamonddrip'),
                       help='Project name (default: diamonddrip)')
    parser.add_argument('--env', '-e',
                       default=os.environ.get('ENVIRONMENT', 'production'),
                       help='Environment (default: production)')
    parser.add_argument('--region', '-r',
                       default=os.environ.get('AWS_REGION', 'us-east-1'),
                       help='AWS region (default: us-east-1)')
    
    args = parser.parse_args()
    
    project_name = args.project
    environment = args.env
    region = args.region
    
    print("=" * 60)
    print("DiamondDrip Multi-Stack Cleanup")
    print("=" * 60)
    
    print(f"\nConfiguration:")
    print(f"  Project: {project_name}")
    print(f"  Environment: {environment}")
    print(f"  Region: {region}")
    
    # All possible stacks in reverse deployment order
    all_stacks = [
        f'{project_name}-{environment}-frontend',
        f'{project_name}-{environment}-application',
        f'{project_name}-{environment}-database',
        f'{project_name}-{environment}-network'
    ]
    
    # Determine which stacks to delete
    if args.stack:
        # Single stack mode
        stacks_to_delete = [args.stack]
        print(f"\n🗑️  Mode: Delete SINGLE stack (--stack specified)")
        print(f"  Target stack: {args.stack}")
    elif args.all:
        stacks_to_delete = all_stacks
        print(f"\n🗑️  Mode: Delete ALL stacks (--all flag specified)")
    else:
        # Load state and get failed stacks
        state = load_deployment_state(project_name, environment)
        failed_stacks = get_failed_stacks(state)
        
        if not failed_stacks:
            print(f"\n✓ No failed stacks found in deployment state")
            print(f"  State file: {get_state_file(project_name, environment)}")
            print(f"\n  To delete all stacks, use:")
            print(f"    python cleanup-stacks.py --all")
            return
        
        # Verify failed stacks actually exist
        stacks_to_delete = []
        for stack_name in failed_stacks:
            if verify_stack_exists(stack_name, region):
                stacks_to_delete.append(stack_name)
            else:
                print(f"\n⚠️  Stack {stack_name} marked as failed but doesn't exist (already deleted?)")
        
        if not stacks_to_delete:
            print(f"\n✓ No failed stacks exist in AWS")
            print(f"  All failed stacks from state file have already been deleted")
            return
        
        print(f"\n🗑️  Mode: Delete only FAILED stacks (from state file)")
        print(f"  Found {len(stacks_to_delete)} failed stack(s) to delete:")
        for stack_name in stacks_to_delete:
            print(f"    - {stack_name}")
    
    # Sort stacks in reverse deployment order for deletion (unless single stack mode)
    if not args.stack:
        stack_order = {
            'frontend': 0,
            'application': 1,
            'database': 2,
            'network': 3
        }
        stacks_to_delete.sort(key=lambda x: stack_order.get(x.split('-')[-1], 99))
    
    # Show what will be deleted (no confirmation needed - non-interactive)
    print(f"\n⚠️  WARNING: This will delete {len(stacks_to_delete)} stack(s)")
    if args.stack:
        print(f"   Single stack: {args.stack}")
    elif not args.all:
        print(f"   Only failed stacks will be deleted")
    else:
        print(f"   ALL stacks will be deleted")
    
    print("\n" + "=" * 60)
    print("Deleting Stacks")
    print("=" * 60)
    
    deleted_stacks = []
    failed_deletions = []
    
    for i, stack_name in enumerate(stacks_to_delete, 1):
        print(f"\n[{i}/{len(stacks_to_delete)}] {stack_name}")
        print("-" * 60)
        
        if delete_stack(stack_name, region):
            deleted_stacks.append(stack_name)
        else:
            failed_deletions.append(stack_name)
            print(f"\n⚠️  Failed to delete: {stack_name}")
            print(f"  You may need to delete it manually or fix issues")
            print(f"  Continuing with other stacks...")
    
    # Update state file to remove deleted stacks
    if not args.all:
        state = load_deployment_state(project_name, environment)
        if 'stacks' in state:
            for stack_name in deleted_stacks:
                if stack_name in state['stacks']:
                    del state['stacks'][stack_name]
            state['last_modified'] = datetime.now().isoformat()
            state_file = get_state_file(project_name, environment)
            try:
                with open(state_file, 'w') as f:
                    json.dump(state, f, indent=2)
                print(f"\n📝 Updated state file: {state_file}")
            except Exception as e:
                print(f"\n⚠️  Could not update state file: {e}")
    
    print("\n" + "=" * 60)
    print("Cleanup Complete!")
    print("=" * 60)
    
    if len(deleted_stacks) == len(stacks_to_delete):
        print(f"\n✓ All target stacks deleted successfully")
    else:
        print(f"\n⚠️  Deletion Summary:")
        print(f"   ✓ Successfully deleted: {len(deleted_stacks)}")
        print(f"   ✗ Failed to delete: {len(failed_deletions)}")
        for stack in failed_deletions:
            print(f"      - {stack}")
        print(f"\n   Check AWS Console or run this script again")
    
    print("\n" + "=" * 60)

if __name__ == '__main__':
    # Change to aws directory
    script_dir = Path(__file__).parent
    os.chdir(script_dir)
    
    main()

