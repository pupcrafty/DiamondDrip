#!/usr/bin/env python3
"""
Diagnostic script for CloudFormation stacks
Analyzes stack events to identify failures and provide troubleshooting guidance
"""
import boto3
import sys
import json
import os
import argparse
from datetime import datetime
from collections import defaultdict
from pathlib import Path
from botocore.exceptions import ClientError

def get_all_stacks(project_name, environment, region):
    """Get all stacks for the project"""
    cf = boto3.client('cloudformation', region_name=region)
    
    stack_prefix = f"{project_name}-{environment}-"
    stacks = []
    
    try:
        paginator = cf.get_paginator('list_stacks')
        for page in paginator.paginate():
            for stack_summary in page['StackSummaries']:
                stack_name = stack_summary['StackName']
                if stack_name.startswith(stack_prefix):
                    try:
                        stack_info = cf.describe_stacks(StackName=stack_name)['Stacks'][0]
                        stacks.append(stack_info)
                    except ClientError:
                        stacks.append({
                            'StackName': stack_name,
                            'StackStatus': stack_summary['StackStatus'],
                            'CreationTime': stack_summary.get('CreationTime'),
                            'LastUpdatedTime': stack_summary.get('LastUpdatedTime')
                        })
    except Exception as e:
        print(f"Error listing stacks: {e}")
        return []
    
    return stacks

def get_stack_events(stack_name, region, max_events=100, since_timestamp=None):
    """Get stack events, optionally filtered by timestamp"""
    cf = boto3.client('cloudformation', region_name=region)
    
    events = []
    try:
        paginator = cf.get_paginator('describe_stack_events')
        for page in paginator.paginate(StackName=stack_name):
            events.extend(page['StackEvents'])
            if len(events) >= max_events * 2:  # Get more to filter
                break
    except ClientError as e:
        if 'does not exist' in str(e):
            return []
        raise
    
    # Filter by timestamp if provided
    if since_timestamp:
        try:
            if isinstance(since_timestamp, str):
                since_dt = datetime.fromisoformat(since_timestamp.replace('Z', '+00:00'))
            else:
                since_dt = since_timestamp
            
            filtered_events = []
            for event in events:
                event_time = event.get('Timestamp')
                if event_time:
                    # Handle timezone-aware and naive datetimes
                    if isinstance(event_time, str):
                        event_dt = datetime.fromisoformat(event_time.replace('Z', '+00:00'))
                    else:
                        event_dt = event_time
                    
                    # Compare timestamps (handle timezone differences)
                    if isinstance(since_dt, datetime) and isinstance(event_dt, datetime):
                        # Make both timezone-aware or both naive for comparison
                        if since_dt.tzinfo is None and event_dt.tzinfo is not None:
                            event_dt = event_dt.replace(tzinfo=None)
                        elif since_dt.tzinfo is not None and event_dt.tzinfo is None:
                            event_dt = event_dt.replace(tzinfo=since_dt.tzinfo)
                        
                        if event_dt >= since_dt:
                            filtered_events.append(event)
            events = filtered_events
        except Exception as e:
            # If timestamp parsing fails, use all events
            print(f"   ⚠️  Could not filter by timestamp: {e}, showing all events")
    
    # Sort by timestamp (most recent first)
    events.sort(key=lambda x: x.get('Timestamp', datetime.min), reverse=True)
    return events[:max_events]

def analyze_events(events):
    """Analyze stack events to identify issues"""
    analysis = {
        'failed_resources': [],
        'in_progress_resources': [],
        'completed_resources': [],
        'warnings': [],
        'errors_by_type': defaultdict(list),
        'timeline': []
    }
    
    seen_resources = set()
    
    for event in events:
        resource_id = event['LogicalResourceId']
        resource_status = event['ResourceStatus']
        resource_type = event.get('ResourceType', 'Unknown')
        timestamp = event.get('Timestamp', '')
        reason = event.get('ResourceStatusReason', '')
        
        # Build timeline
        analysis['timeline'].append({
            'timestamp': timestamp,
            'resource': resource_id,
            'status': resource_status,
            'type': resource_type,
            'reason': reason
        })
        
        # Track failed resources
        if resource_status.endswith('FAILED'):
            if resource_id not in seen_resources:
                analysis['failed_resources'].append({
                    'resource_id': resource_id,
                    'resource_type': resource_type,
                    'status': resource_status,
                    'reason': reason,
                    'timestamp': timestamp
                })
                seen_resources.add(resource_id)
                
                # Categorize errors
                if 'not authorized' in reason.lower() or 'access denied' in reason.lower():
                    analysis['errors_by_type']['permissions'].append({
                        'resource': resource_id,
                        'reason': reason
                    })
                elif 'limit' in reason.lower() or 'quota' in reason.lower():
                    analysis['errors_by_type']['limits'].append({
                        'resource': resource_id,
                        'reason': reason
                    })
                elif 'already exists' in reason.lower():
                    analysis['errors_by_type']['conflicts'].append({
                        'resource': resource_id,
                        'reason': reason
                    })
                elif 'timeout' in reason.lower():
                    analysis['errors_by_type']['timeouts'].append({
                        'resource': resource_id,
                        'reason': reason
                    })
                else:
                    analysis['errors_by_type']['other'].append({
                        'resource': resource_id,
                        'reason': reason
                    })
        
        # Track in-progress resources
        elif resource_status.endswith('_IN_PROGRESS'):
            if resource_id not in seen_resources:
                analysis['in_progress_resources'].append({
                    'resource_id': resource_id,
                    'resource_type': resource_type,
                    'status': resource_status
                })
        
        # Track completed resources
        elif resource_status.endswith('_COMPLETE'):
            if resource_id not in seen_resources and not resource_status.startswith('DELETE'):
                analysis['completed_resources'].append({
                    'resource_id': resource_id,
                    'resource_type': resource_type
                })
        
        # Track warnings
        if 'ROLLBACK' in resource_status and resource_id != event.get('StackName', ''):
            analysis['warnings'].append({
                'resource': resource_id,
                'status': resource_status,
                'reason': reason
            })
    
    return analysis

def get_troubleshooting_tips(error_type, errors):
    """Get troubleshooting tips based on error type"""
    tips = []
    
    if error_type == 'permissions':
        tips.append("🔐 Permission Issues Detected:")
        tips.append("   1. Check IAM permissions for the deployment user/role")
        tips.append("   2. Verify the deployment permissions policy includes:")
        for error in errors[:3]:  # Show first 3 examples
            if 'rds:' in error['reason']:
                tips.append("      - RDS permissions (CreateDBSnapshot, DeleteDBInstance, etc.)")
            elif 'iam:' in error['reason']:
                tips.append("      - IAM permissions (PassRole, CreateRole, etc.)")
            elif 'ec2:' in error['reason']:
                tips.append("      - EC2 permissions (CreateVpc, CreateSubnet, etc.)")
        tips.append("   3. Run: python deploy-stacks.py --help to see required permissions")
        tips.append("   4. Check if service-linked roles need to be created")
    
    elif error_type == 'limits':
        tips.append("📊 Service Limits Exceeded:")
        tips.append("   1. Check AWS Service Quotas console")
        tips.append("   2. Common limits:")
        tips.append("      - VPCs per region (default: 5)")
        tips.append("      - NAT Gateways per AZ (default: 5)")
        tips.append("      - RDS instances per region")
        tips.append("   3. Request limit increases if needed")
        tips.append("   4. Delete unused resources to free up quota")
    
    elif error_type == 'conflicts':
        tips.append("⚠️  Resource Conflicts:")
        tips.append("   1. Resource name may already exist")
        tips.append("   2. Check if resource exists in another stack")
        tips.append("   3. Use different naming or delete conflicting resource")
        tips.append("   4. Check for duplicate stack deployments")
    
    elif error_type == 'timeouts':
        tips.append("⏱️  Timeout Issues:")
        tips.append("   1. Some resources take longer to create (RDS, NAT Gateway)")
        tips.append("   2. Check if operation is still in progress")
        tips.append("   3. Increase CloudFormation timeout if needed")
        tips.append("   4. Check AWS service health dashboard")
    
    return tips

def load_deployment_state(project_name, environment):
    """Load deployment state from JSON file"""
    state_file = Path(f'deployment-state-{project_name}-{environment}.json')
    if state_file.exists():
        try:
            with open(state_file, 'r') as f:
                return json.load(f)
        except Exception as e:
            return {}
    return {}

def diagnose_stack(stack_name, region, verbose=False, since_timestamp=None):
    """Diagnose a single stack"""
    cf = boto3.client('cloudformation', region_name=region)
    
    print(f"\n{'=' * 70}")
    print(f"Diagnosing Stack: {stack_name}")
    print(f"{'=' * 70}")
    
    # Get stack info
    try:
        stack_info = cf.describe_stacks(StackName=stack_name)['Stacks'][0]
        status = stack_info['StackStatus']
        print(f"\n📊 Stack Status: {status}")
        
        if 'StackStatusReason' in stack_info:
            print(f"   Reason: {stack_info['StackStatusReason']}")
        
        creation_time = stack_info.get('CreationTime')
        last_updated = stack_info.get('LastUpdatedTime', creation_time)
        if last_updated:
            print(f"   Last Updated: {last_updated}")
    except ClientError as e:
        if 'does not exist' in str(e):
            print(f"\n⚠️  Stack does not exist")
            return
        raise
    
    # Get events
    print(f"\n🔍 Analyzing stack events...")
    if since_timestamp:
        print(f"   Filtering events since last deployment attempt: {since_timestamp}")
    events = get_stack_events(stack_name, region, max_events=200, since_timestamp=since_timestamp)
    
    if not events:
        if since_timestamp:
            print(f"   No events found since last deployment attempt")
            print(f"   Try running without timestamp filtering or check deployment state")
        else:
            print(f"   No events found")
        return
    
    print(f"   Found {len(events)} events" + (" (filtered)" if since_timestamp else ""))
    
    # Analyze events
    analysis = analyze_events(events)
    
    # Print summary
    print(f"\n📈 Summary:")
    print(f"   ✓ Completed resources: {len(analysis['completed_resources'])}")
    print(f"   ⏳ In progress: {len(analysis['in_progress_resources'])}")
    print(f"   ✗ Failed resources: {len(analysis['failed_resources'])}")
    print(f"   ⚠️  Warnings: {len(analysis['warnings'])}")
    
    # Show failed resources
    if analysis['failed_resources']:
        print(f"\n{'=' * 70}")
        print(f"❌ FAILED RESOURCES ({len(analysis['failed_resources'])})")
        print(f"{'=' * 70}")
        
        for i, failed in enumerate(analysis['failed_resources'], 1):
            print(f"\n[{i}] {failed['resource_id']}")
            print(f"    Type: {failed['resource_type']}")
            print(f"    Status: {failed['status']}")
            print(f"    Time: {failed['timestamp']}")
            if failed['reason']:
                print(f"    Error: {failed['reason']}")
    
    # Show error categorization
    if analysis['errors_by_type']:
        print(f"\n{'=' * 70}")
        print(f"🔎 ERROR ANALYSIS")
        print(f"{'=' * 70}")
        
        for error_type, errors in analysis['errors_by_type'].items():
            if errors:
                print(f"\n{error_type.upper()} Errors ({len(errors)}):")
                for error in errors[:5]:  # Show first 5
                    print(f"   • {error['resource']}")
                    if verbose:
                        print(f"     {error['reason'][:100]}")
                
                # Show troubleshooting tips
                tips = get_troubleshooting_tips(error_type, errors)
                for tip in tips:
                    print(f"   {tip}")
    
    # Show warnings
    if analysis['warnings']:
        print(f"\n{'=' * 70}")
        print(f"⚠️  WARNINGS ({len(analysis['warnings'])})")
        print(f"{'=' * 70}")
        
        for warning in analysis['warnings'][:10]:  # Show first 10
            print(f"   • {warning['resource']}: {warning['status']}")
            if warning['reason']:
                print(f"     {warning['reason'][:80]}")
    
    # Show recent timeline
    if verbose and analysis['timeline']:
        print(f"\n{'=' * 70}")
        print(f"📅 RECENT TIMELINE (Last 20 events)")
        print(f"{'=' * 70}")
        
        for event in analysis['timeline'][:20]:
            timestamp = event['timestamp'].strftime("%H:%M:%S") if isinstance(event['timestamp'], datetime) else str(event['timestamp'])
            status_emoji = "✗" if "FAILED" in event['status'] else "✓" if "COMPLETE" in event['status'] else "→"
            print(f"   {status_emoji} [{timestamp}] {event['resource']}: {event['status']}")
            if event['reason'] and ("FAILED" in event['status'] or verbose):
                reason_short = event['reason'][:70] + "..." if len(event['reason']) > 70 else event['reason']
                print(f"      {reason_short}")
    
    # Recommendations
    print(f"\n{'=' * 70}")
    print(f"💡 RECOMMENDATIONS")
    print(f"{'=' * 70}")
    
    if analysis['failed_resources']:
        print(f"\n1. Fix the issues identified above")
        print(f"2. Retry deployment:")
        print(f"   python deploy-stacks.py --stack <stack-name>")
        print(f"3. For rollback issues:")
        print(f"   python fix-rollback-failed.py {stack_name}")
    elif status.endswith('_IN_PROGRESS'):
        print(f"\n1. Stack is still in progress")
        print(f"2. Monitor with:")
        print(f"   python check-stacks-status.py --watch")
    elif status.endswith('_COMPLETE'):
        print(f"\n✓ Stack is in a completed state")
        if 'ROLLBACK' in status:
            print(f"   Note: Stack rolled back but is stable")
    else:
        print(f"\n1. Check AWS Console for detailed error messages")
        print(f"2. Review CloudWatch Logs if applicable")
        print(f"3. Verify all prerequisites are met")
    
    print(f"\n{'=' * 70}")

def main():
    """Main function"""
    parser = argparse.ArgumentParser(
        description='Diagnose CloudFormation stack failures',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Diagnose all stacks
  python diagnose-stacks.py

  # Diagnose specific stack
  python diagnose-stacks.py --stack network

  # Verbose output with timeline
  python diagnose-stacks.py --stack database --verbose

  # Diagnose all failed stacks
  python diagnose-stacks.py --failed-only
        """
    )
    
    parser.add_argument('--stack', '-s', 
                       choices=['network', 'database', 'application', 'frontend', 'diagnostics-frontend'],
                       help='Diagnose specific stack')
    parser.add_argument('--stack-name', 
                       help='Diagnose stack by exact name')
    parser.add_argument('--failed-only', '-f', action='store_true',
                       help='Only diagnose failed stacks')
    parser.add_argument('--verbose', '-v', action='store_true',
                       help='Show detailed timeline and all events')
    parser.add_argument('--project', '-p',
                       default=os.environ.get('PROJECT_NAME', 'diamonddrip'),
                       help='Project name')
    parser.add_argument('--env', '-e',
                       default=os.environ.get('ENVIRONMENT', 'production'),
                       help='Environment')
    parser.add_argument('--region', '-r',
                       default=os.environ.get('AWS_REGION', 'us-east-1'),
                       help='AWS region')
    parser.add_argument('--export', action='store_true',
                       help='Export events to JSON file')
    
    args = parser.parse_args()
    
    project_name = args.project
    environment = args.env
    region = args.region
    
    print("=" * 70)
    print("CloudFormation Stack Diagnostics")
    print("=" * 70)
    print(f"\nProject: {project_name}")
    print(f"Environment: {environment}")
    print(f"Region: {region}")
    
    # Load deployment state to get last attempt timestamps
    deployment_state = load_deployment_state(project_name, environment)
    
    # Helper function to check if a stack is failed
    def is_failed_stack(stack_name, stack_status=None):
        """Check if a stack should be considered failed"""
        # Check deployment state
        if 'stacks' in deployment_state and stack_name in deployment_state['stacks']:
            stack_state = deployment_state['stacks'][stack_name]
            if stack_state.get('status') == 'failed':
                return True
        
        # Check AWS stack status if provided
        if stack_status:
            if (stack_status.endswith('FAILED') or 
                'ROLLBACK' in stack_status or
                stack_status == 'ROLLBACK_COMPLETE'):
                return True
        
        return False
    
    # Get stacks to diagnose
    if args.stack_name:
        # Diagnose specific stack by name
        # Check if it's failed if --failed-only is set
        if args.failed_only:
            try:
                cf = boto3.client('cloudformation', region_name=region)
                stack_info = cf.describe_stacks(StackName=args.stack_name)['Stacks'][0]
                if not is_failed_stack(args.stack_name, stack_info['StackStatus']):
                    print(f"\n⚠️  Stack {args.stack_name} is not in a failed state")
                    print(f"   Use without --failed-only to diagnose anyway")
                    return
                stacks_to_diagnose = [stack_info]
            except ClientError as e:
                if 'does not exist' in str(e):
                    print(f"\n⚠️  Stack {args.stack_name} does not exist")
                    return
                raise
        else:
            stacks_to_diagnose = [{'StackName': args.stack_name}]
    elif args.stack:
        # Diagnose specific stack type
        stack_name = f"{project_name}-{environment}-{args.stack}"
        # Check if it's failed if --failed-only is set
        if args.failed_only:
            try:
                cf = boto3.client('cloudformation', region_name=region)
                stack_info = cf.describe_stacks(StackName=stack_name)['Stacks'][0]
                if not is_failed_stack(stack_name, stack_info['StackStatus']):
                    print(f"\n⚠️  Stack {stack_name} is not in a failed state")
                    print(f"   Use without --failed-only to diagnose anyway")
                    return
                stacks_to_diagnose = [stack_info]
            except ClientError as e:
                if 'does not exist' in str(e):
                    print(f"\n⚠️  Stack {stack_name} does not exist")
                    return
                raise
        else:
            stacks_to_diagnose = [{'StackName': stack_name}]
    else:
        # Get all stacks
        all_stacks = get_all_stacks(project_name, environment, region)
        
        if args.failed_only:
            # Only diagnose stacks that are marked as failed
            stacks_to_diagnose = []
            for s in all_stacks:
                stack_name = s['StackName']
                if is_failed_stack(stack_name, s.get('StackStatus')):
                    stacks_to_diagnose.append(s)
            
            if not stacks_to_diagnose:
                print(f"\n✓ No failed stacks found")
                return
        else:
            stacks_to_diagnose = all_stacks
    
    if not stacks_to_diagnose:
        print(f"\n⚠️  No stacks found")
        return
    
    # Diagnose each stack
    for stack in stacks_to_diagnose:
        # Extract stack name (handles both dict formats)
        stack_name = stack.get('StackName') if isinstance(stack, dict) else str(stack)
        
        if not stack_name:
            continue
        
        # Get last attempt timestamp from deployment state
        since_timestamp = None
        if 'stacks' in deployment_state and stack_name in deployment_state['stacks']:
            stack_state = deployment_state['stacks'][stack_name]
            since_timestamp = stack_state.get('last_attempt_timestamp')
        
        diagnose_stack(stack_name, region, verbose=args.verbose, since_timestamp=since_timestamp)
        
        # Export if requested
        if args.export:
            events = get_stack_events(stack_name, region)
            export_file = f"diagnostics-{stack_name}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
            with open(export_file, 'w') as f:
                json.dump({
                    'stack_name': stack_name,
                    'timestamp': datetime.now().isoformat(),
                    'events': events
                }, f, indent=2, default=str)
            print(f"\n📄 Events exported to: {export_file}")

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted by user")
        sys.exit(0)
    except Exception as e:
        print(f"\n✗ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

