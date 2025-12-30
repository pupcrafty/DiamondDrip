#!/usr/bin/env python3
"""
Fix ROLLBACK_FAILED CloudFormation stack
Handles stuck rollback operations by continuing rollback or skipping resources
"""
import boto3
import sys
import time
import argparse
from botocore.exceptions import ClientError

def get_stack_status(cf_client, stack_name):
    """Get current stack status"""
    try:
        response = cf_client.describe_stacks(StackName=stack_name)
        return response['Stacks'][0]['StackStatus']
    except ClientError as e:
        print(f"Error getting stack status: {e}")
        return None

def get_stack_events(cf_client, stack_name, limit=10):
    """Get recent stack events to see what failed"""
    try:
        response = cf_client.describe_stack_events(
            StackName=stack_name,
            MaxResults=limit
        )
        return response['StackEvents']
    except ClientError as e:
        print(f"Error getting stack events: {e}")
        return []

def continue_rollback(cf_client, stack_name, resources_to_skip=None):
    """Continue rollback operation"""
    try:
        params = {
            'StackName': stack_name
        }
        if resources_to_skip:
            params['ResourcesToSkip'] = resources_to_skip
        
        cf_client.continue_update_rollback(**params)
        print(f"✓ Rollback continuation initiated")
        return True
    except ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == 'TokenAlreadyExistsException':
            print("⚠ Rollback already in progress. Waiting...")
            return True
        else:
            print(f"✗ Error continuing rollback: {e}")
            return False

def delete_stack_force(cf_client, stack_name):
    """Force delete stack by skipping resources"""
    print(f"\n⚠ WARNING: This will force delete the stack!")
    print(f"   Resources that can't be deleted will be skipped.")
    
    try:
        # First try to continue rollback
        print("\n1. Attempting to continue rollback...")
        continue_rollback(cf_client, stack_name)
        
        # Wait a bit
        time.sleep(10)
        
        # Check status
        status = get_stack_status(cf_client, stack_name)
        print(f"   Current status: {status}")
        
        if status == 'DELETE_IN_PROGRESS':
            print("   Rollback continuing, waiting for completion...")
            return wait_for_stack_deletion(cf_client, stack_name)
        elif status == 'ROLLBACK_FAILED':
            print("\n2. Rollback still failed. Attempting to skip Database resource...")
            # Skip the Database resource that's blocking
            continue_rollback(cf_client, stack_name, resources_to_skip=['Database'])
            return wait_for_stack_deletion(cf_client, stack_name)
        else:
            print(f"   Unexpected status: {status}")
            return False
            
    except ClientError as e:
        print(f"✗ Error: {e}")
        return False

def wait_for_stack_deletion(cf_client, stack_name, timeout=1800):
    """Wait for stack deletion to complete"""
    print(f"\n⏳ Waiting for stack deletion (timeout: {timeout}s)...")
    start_time = time.time()
    
    while True:
        try:
            status = get_stack_status(cf_client, stack_name)
            
            if status is None:
                print("✓ Stack deleted successfully")
                return True
            
            elapsed = int(time.time() - start_time)
            print(f"   [{elapsed}s] Status: {status}")
            
            if status in ['DELETE_COMPLETE']:
                print("✓ Stack deleted successfully")
                return True
            elif status in ['DELETE_FAILED', 'ROLLBACK_FAILED']:
                print(f"✗ Stack deletion failed with status: {status}")
                return False
            
            if elapsed >= timeout:
                print(f"✗ Timeout waiting for deletion")
                return False
            
            time.sleep(30)
            
        except KeyboardInterrupt:
            print("\n⚠ Interrupted by user")
            return False
        except Exception as e:
            print(f"✗ Error: {e}")
            return False

def main():
    """Main function"""
    parser = argparse.ArgumentParser(
        description='Fix ROLLBACK_FAILED CloudFormation stack',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Continue rollback (recommended)
  python fix-rollback-failed.py diamonddrip-production --action continue

  # Force delete stack (skip blocking resources)
  python fix-rollback-failed.py diamonddrip-production --action force-delete

  # Show detailed events and exit
  python fix-rollback-failed.py diamonddrip-production --action show-events

  # Use specific region
  python fix-rollback-failed.py diamonddrip-production --action continue --region us-west-2
        """
    )
    
    parser.add_argument('stack_name', help='CloudFormation stack name')
    parser.add_argument('--action', '-a', 
                       choices=['continue', 'force-delete', 'show-events'],
                       default='continue',
                       help='Action to take (default: continue)')
    parser.add_argument('--region',
                       default='us-east-1',
                       help='AWS region (default: us-east-1)')
    parser.add_argument('--skip-resources', nargs='+',
                       help='Resource logical IDs to skip during rollback')
    
    args = parser.parse_args()
    
    stack_name = args.stack_name
    region = args.region
    
    print("=" * 60)
    print("CloudFormation Rollback Fixer")
    print("=" * 60)
    print(f"\nStack: {stack_name}")
    print(f"Region: {region}")
    print(f"Action: {args.action}\n")
    
    cf_client = boto3.client('cloudformation', region_name=region)
    
    # Check current status
    status = get_stack_status(cf_client, stack_name)
    print(f"Current status: {status}\n")
    
    if status != 'ROLLBACK_FAILED':
        print("⚠ Stack is not in ROLLBACK_FAILED state.")
        print(f"   Current status: {status}")
        print("\nThis script is designed for ROLLBACK_FAILED stacks.")
        sys.exit(1)
    
    # Show recent events
    print("Recent stack events:")
    print("-" * 60)
    events = get_stack_events(cf_client, stack_name, limit=5)
    for event in events[:5]:
        print(f"  [{event['Timestamp']}] {event['ResourceStatus']}: {event['LogicalResourceId']}")
        if event.get('ResourceStatusReason'):
            print(f"    Reason: {event['ResourceStatusReason']}")
    print()
    
    # Execute action
    if args.action == 'continue':
        print("Continuing rollback...")
        resources_to_skip = args.skip_resources if args.skip_resources else None
        if continue_rollback(cf_client, stack_name, resources_to_skip=resources_to_skip):
            print("\n⏳ Waiting for rollback to complete...")
            time.sleep(5)
            status = get_stack_status(cf_client, stack_name)
            print(f"Current status: {status}")
            
            if status == 'ROLLBACK_COMPLETE':
                print("\n✓ Rollback completed successfully")
                print("  You can now delete the stack or update it.")
            elif status == 'ROLLBACK_FAILED':
                print("\n⚠ Rollback still failed. Try --action force-delete to force delete.")
            else:
                print(f"\nStatus changed to: {status}")
    
    elif args.action == 'force-delete':
        delete_stack_force(cf_client, stack_name)
    
    elif args.action == 'show-events':
        print("Detailed stack events:")
        print("-" * 60)
        events = get_stack_events(cf_client, stack_name, limit=20)
        for event in events:
            print(f"\n[{event['Timestamp']}] {event['ResourceStatus']}: {event['LogicalResourceId']}")
            if event.get('ResourceStatusReason'):
                print(f"  Reason: {event['ResourceStatusReason']}")

if __name__ == '__main__':
    main()


