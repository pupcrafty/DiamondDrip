#!/usr/bin/env python3
"""
Check CloudFormation stack status and show detailed error information
"""
import sys
import boto3
import json
from datetime import datetime

def check_stack_status(stack_name, region='us-east-1'):
    """Check and display detailed stack status"""
    cf = boto3.client('cloudformation', region_name=region)
    
    try:
        # Get stack info
        stacks = cf.describe_stacks(StackName=stack_name)
        stack = stacks['Stacks'][0]
        
        print("=" * 60)
        print(f"Stack: {stack_name}")
        print("=" * 60)
        print(f"Status: {stack['StackStatus']}")
        print(f"Created: {stack.get('CreationTime', 'N/A')}")
        
        if 'StackStatusReason' in stack:
            print(f"\nStatus Reason:")
            print(f"  {stack['StackStatusReason']}")
        
        # Get failed events
        print(f"\n" + "=" * 60)
        print("Failed Resources:")
        print("=" * 60)
        
        # describe_stack_events doesn't have MaxRecords, we need to paginate
        events = cf.describe_stack_events(StackName=stack_name)
        failed = []
        processed = 0
        max_events = 100  # Limit how many we check
        
        for event in events['StackEvents']:
            processed += 1
            if processed > max_events:
                break
            status = event['ResourceStatus']
            if status.endswith('FAILED') or status.endswith('ROLLBACK'):
                failed.append(event)
        
        if failed:
            for event in failed[:10]:  # Show first 10 failures
                print(f"\nResource: {event['LogicalResourceId']}")
                print(f"  Type: {event['ResourceType']}")
                print(f"  Status: {event['ResourceStatus']}")
                print(f"  Reason: {event.get('ResourceStatusReason', 'No reason provided')}")
                print(f"  Time: {event.get('Timestamp', 'N/A')}")
        else:
            print("  No failed resources found in recent events")
        
        # Show outputs if any
        if 'Outputs' in stack and stack['Outputs']:
            print(f"\n" + "=" * 60)
            print("Stack Outputs:")
            print("=" * 60)
            for output in stack['Outputs']:
                print(f"  {output['OutputKey']}: {output['OutputValue']}")
        
        # Show parameters
        if 'Parameters' in stack and stack['Parameters']:
            print(f"\n" + "=" * 60)
            print("Stack Parameters:")
            print("=" * 60)
            for param in stack['Parameters']:
                value = param['ParameterValue']
                if 'password' in param['ParameterKey'].lower():
                    value = '[HIDDEN]'
                print(f"  {param['ParameterKey']}: {value}")
        
    except cf.exceptions.ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == 'ValidationError' and 'does not exist' in str(e):
            print(f"Stack '{stack_name}' does not exist")
        else:
            print(f"Error: {e}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == '__main__':
    stack_name = sys.argv[1] if len(sys.argv) > 1 else 'diamonddrip-production'
    region = sys.argv[2] if len(sys.argv) > 2 else 'us-east-1'
    
    check_stack_status(stack_name, region)

