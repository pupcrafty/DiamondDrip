#!/usr/bin/env python3
"""
Wait for CloudFormation stack deletion to complete
"""
import sys
import boto3
import time

def wait_for_deletion(stack_name, region='us-east-1', max_wait_minutes=10):
    """Wait for stack deletion to complete"""
    cf = boto3.client('cloudformation', region_name=region)
    
    print(f"Waiting for stack deletion: {stack_name}")
    print(f"Max wait time: {max_wait_minutes} minutes")
    print("")
    
    max_attempts = max_wait_minutes * 6  # Check every 10 seconds
    attempt = 0
    
    while attempt < max_attempts:
        try:
            stack_info = cf.describe_stacks(StackName=stack_name)
            status = stack_info['Stacks'][0]['StackStatus']
            
            elapsed = attempt * 10
            print(f"[{elapsed // 60}m {elapsed % 60}s] Status: {status}")
            
            if status == 'DELETE_COMPLETE':
                print(f"\n[OK] Stack deletion completed!")
                return True
            elif 'DELETE' not in status:
                print(f"\n[INFO] Stack status changed to: {status}")
                print("Deletion may have completed or stack was recreated")
                return True
            
            time.sleep(10)
            attempt += 1
            
        except cf.exceptions.ClientError as e:
            if 'does not exist' in str(e):
                print(f"\n[OK] Stack deleted successfully!")
                return True
            else:
                print(f"[ERROR] {e}")
                return False
    
    print(f"\n[WARNING] Deletion is taking longer than {max_wait_minutes} minutes")
    print("Stack may still be deleting. Check AWS Console for status.")
    return False

if __name__ == '__main__':
    stack_name = sys.argv[1] if len(sys.argv) > 1 else 'diamonddrip-production'
    region = sys.argv[2] if len(sys.argv) > 2 else 'us-east-1'
    
    if wait_for_deletion(stack_name, region):
        print("\nYou can now run: python deploy-windows.py")
    else:
        sys.exit(1)

