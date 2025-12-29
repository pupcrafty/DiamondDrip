#!/usr/bin/env python3
"""
Clean up failed stack and prepare for redeployment
"""
import boto3
import sys
import time

def delete_stack(stack_name, region='us-east-1'):
    """Delete a CloudFormation stack"""
    cf = boto3.client('cloudformation', region_name=region)
    
    print(f"Deleting stack: {stack_name}")
    print("This will clean up all resources created by the failed deployment")
    
    try:
        cf.delete_stack(StackName=stack_name)
        print(f"[OK] Stack deletion initiated")
        
        # Wait for deletion
        print("Waiting for stack deletion to complete...")
        waiter = cf.get_waiter('stack_delete_complete')
        
        max_wait = 30  # 5 minutes
        for i in range(max_wait):
            try:
                status = cf.describe_stacks(StackName=stack_name)['Stacks'][0]['StackStatus']
                print(f"  [{i * 10}s] Status: {status}")
                if status == 'DELETE_COMPLETE':
                    print(f"\n[OK] Stack deleted successfully")
                    return True
                time.sleep(10)
            except cf.exceptions.ClientError as e:
                if 'does not exist' in str(e):
                    print(f"\n[OK] Stack deleted successfully")
                    return True
                raise
        
        print(f"\n[WARNING] Deletion may still be in progress")
        return True
        
    except Exception as e:
        print(f"[ERROR] Failed to delete stack: {e}")
        return False

if __name__ == '__main__':
    stack_name = sys.argv[1] if len(sys.argv) > 1 else 'diamonddrip-production'
    region = sys.argv[2] if len(sys.argv) > 2 else 'us-east-1'
    
    print("=" * 60)
    print("CloudFormation Stack Cleanup")
    print("=" * 60)
    
    if delete_stack(stack_name, region):
        print("\n" + "=" * 60)
        print("Stack cleanup complete!")
        print("=" * 60)
        print("\nYou can now redeploy with:")
        print("  python deploy-windows.py")
    else:
        print("\nCleanup failed. Check AWS Console for details.")
        sys.exit(1)

