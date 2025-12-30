#!/usr/bin/env python3
"""
Check status of all DiamondDrip CloudFormation stacks
Shows which stacks are still in progress and what operations are pending
"""
import boto3
import sys
import time
from datetime import datetime
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
                    # Get full stack details
                    try:
                        stack_info = cf.describe_stacks(StackName=stack_name)['Stacks'][0]
                        stacks.append(stack_info)
                    except ClientError:
                        # Stack might be deleted, use summary
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

def get_stack_events(stack_name, region, limit=5):
    """Get recent stack events"""
    cf = boto3.client('cloudformation', region_name=region)
    
    try:
        response = cf.describe_stack_events(
            StackName=stack_name,
            MaxResults=limit
        )
        return response['StackEvents']
    except Exception as e:
        return []

def format_duration(start_time):
    """Format time duration"""
    if not start_time:
        return "N/A"
    
    if isinstance(start_time, str):
        start_time = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
    
    now = datetime.now(start_time.tzinfo) if start_time.tzinfo else datetime.now()
    delta = now - start_time
    
    total_seconds = int(delta.total_seconds())
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    
    if hours > 0:
        return f"{hours}h {minutes}m {seconds}s"
    elif minutes > 0:
        return f"{minutes}m {seconds}s"
    else:
        return f"{seconds}s"

def is_in_progress(status):
    """Check if stack status indicates an operation in progress"""
    in_progress_statuses = [
        'CREATE_IN_PROGRESS',
        'UPDATE_IN_PROGRESS',
        'DELETE_IN_PROGRESS',
        'ROLLBACK_IN_PROGRESS',
        'UPDATE_ROLLBACK_IN_PROGRESS',
        'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS',
        'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS'
    ]
    return status in in_progress_statuses

def get_status_emoji(status):
    """Get emoji for stack status"""
    if is_in_progress(status):
        return "⏳"
    elif status.endswith('_COMPLETE'):
        if 'ROLLBACK' in status or 'FAILED' in status:
            return "⚠️"
        return "✓"
    elif status.endswith('_FAILED'):
        return "✗"
    else:
        return "ℹ️"

def print_stack_status(stack, region, show_events=True):
    """Print detailed stack status"""
    stack_name = stack['StackName']
    status = stack['StackStatus']
    emoji = get_status_emoji(status)
    
    print(f"\n{emoji} {stack_name}")
    print(f"   Status: {status}")
    
    # Show timing
    creation_time = stack.get('CreationTime')
    last_updated = stack.get('LastUpdatedTime', creation_time)
    
    if last_updated:
        duration = format_duration(last_updated)
        print(f"   Duration: {duration}")
    
    # Show status reason if available
    if 'StackStatusReason' in stack:
        print(f"   Reason: {stack['StackStatusReason']}")
    
    # Show recent events for in-progress stacks
    if is_in_progress(status) and show_events:
        events = get_stack_events(stack_name, region, limit=3)
        if events:
            print(f"   Recent activity:")
            for event in events[:3]:
                resource_status = event['ResourceStatus']
                resource_id = event['LogicalResourceId']
                timestamp = event.get('Timestamp', '')
                
                # Only show in-progress or recent completed resources
                if resource_status.endswith('_IN_PROGRESS') or resource_status.endswith('_COMPLETE'):
                    status_emoji = "→" if "_IN_PROGRESS" in resource_status else "✓"
                    print(f"     {status_emoji} {resource_id}: {resource_status}")
                    if event.get('ResourceStatusReason'):
                        reason = event['ResourceStatusReason'][:80]
                        if len(event['ResourceStatusReason']) > 80:
                            reason += "..."
                        print(f"        {reason}")

def watch_mode(project_name, environment, region, interval=30):
    """Watch mode - continuously monitor stacks"""
    print(f"\n👀 Watch mode - checking every {interval} seconds")
    print(f"   Press Ctrl+C to stop\n")
    
    last_statuses = {}
    
    try:
        while True:
            stacks = get_all_stacks(project_name, environment, region)
            in_progress = [s for s in stacks if is_in_progress(s['StackStatus'])]
            
            # Clear screen (optional, can be removed if not desired)
            # print("\033[2J\033[H")  # Uncomment for screen clearing
            
            current_time = datetime.now().strftime("%H:%M:%S")
            print(f"\n[{current_time}] Checking stacks...")
            
            if in_progress:
                print(f"\n⏳ {len(in_progress)} stack(s) in progress:")
                for stack in in_progress:
                    stack_name = stack['StackName']
                    status = stack['StackStatus']
                    
                    # Check if status changed
                    if stack_name in last_statuses and last_statuses[stack_name] != status:
                        print(f"   🔄 {stack_name}: {last_statuses[stack_name]} → {status}")
                    else:
                        print(f"   {stack_name}: {status}")
                    
                    # Show current activity
                    events = get_stack_events(stack_name, region, limit=1)
                    if events:
                        event = events[0]
                        if event['ResourceStatus'].endswith('_IN_PROGRESS'):
                            print(f"      → {event['LogicalResourceId']}: {event['ResourceStatus']}")
                    
                    last_statuses[stack_name] = status
            else:
                print(f"\n✓ No stacks in progress - all operations complete!")
                break
            
            time.sleep(interval)
            
    except KeyboardInterrupt:
        print(f"\n\n⚠️  Watch mode stopped")

def main():
    """Main function"""
    import os
    
    project_name = os.environ.get('PROJECT_NAME', 'diamonddrip')
    environment = os.environ.get('ENVIRONMENT', 'production')
    region = os.environ.get('AWS_REGION', 'us-east-1')
    watch = False
    interval = 30
    
    # Parse command line arguments
    i = 1
    while i < len(sys.argv):
        arg = sys.argv[i]
        if arg == '--watch' or arg == '-w':
            watch = True
            if i + 1 < len(sys.argv) and sys.argv[i + 1].isdigit():
                interval = int(sys.argv[i + 1])
                i += 1
        elif arg == '--project' or arg == '-p':
            project_name = sys.argv[i + 1]
            i += 1
        elif arg == '--env' or arg == '-e':
            environment = sys.argv[i + 1]
            i += 1
        elif arg == '--region' or arg == '-r':
            region = sys.argv[i + 1]
            i += 1
        elif not arg.startswith('-'):
            # Positional arguments for backward compatibility
            if i == 1:
                project_name = arg
            elif i == 2:
                environment = arg
            elif i == 3:
                region = arg
        i += 1
    
    # If watch mode, run continuous monitoring
    if watch:
        watch_mode(project_name, environment, region, interval)
        return
    
    print("=" * 60)
    print("DiamondDrip Stack Status Monitor")
    print("=" * 60)
    print(f"\nProject: {project_name}")
    print(f"Environment: {environment}")
    print(f"Region: {region}")
    
    # Get all stacks
    print(f"\n🔍 Checking stacks...")
    stacks = get_all_stacks(project_name, environment, region)
    
    if not stacks:
        print(f"\n   No stacks found matching: {project_name}-{environment}-*")
        print(f"   Make sure you're in the correct region and have the right project name")
        return
    
    # Separate stacks by status
    in_progress_stacks = [s for s in stacks if is_in_progress(s['StackStatus'])]
    completed_stacks = [s for s in stacks if s['StackStatus'].endswith('_COMPLETE') and not is_in_progress(s['StackStatus'])]
    failed_stacks = [s for s in stacks if s['StackStatus'].endswith('_FAILED')]
    other_stacks = [s for s in stacks if s not in in_progress_stacks + completed_stacks + failed_stacks]
    
    # Print summary
    print(f"\n📊 Summary:")
    print(f"   Total stacks: {len(stacks)}")
    print(f"   ⏳ In progress: {len(in_progress_stacks)}")
    print(f"   ✓ Completed: {len(completed_stacks)}")
    print(f"   ✗ Failed: {len(failed_stacks)}")
    print(f"   ℹ️  Other: {len(other_stacks)}")
    
    # Show in-progress stacks first
    if in_progress_stacks:
        print(f"\n" + "=" * 60)
        print(f"⏳ STACKS IN PROGRESS ({len(in_progress_stacks)})")
        print("=" * 60)
        for stack in in_progress_stacks:
            print_stack_status(stack, region, show_events=True)
    
    # Show failed stacks
    if failed_stacks:
        print(f"\n" + "=" * 60)
        print(f"✗ FAILED STACKS ({len(failed_stacks)})")
        print("=" * 60)
        for stack in failed_stacks:
            print_stack_status(stack, region, show_events=True)
    
    # Show completed stacks
    if completed_stacks:
        print(f"\n" + "=" * 60)
        print(f"✓ COMPLETED STACKS ({len(completed_stacks)})")
        print("=" * 60)
        for stack in completed_stacks:
            print_stack_status(stack, region, show_events=False)
    
    # Show other stacks
    if other_stacks:
        print(f"\n" + "=" * 60)
        print(f"ℹ️  OTHER STACKS ({len(other_stacks)})")
        print("=" * 60)
        for stack in other_stacks:
            print_stack_status(stack, region, show_events=False)
    
    # Recommendations
    if in_progress_stacks:
        print(f"\n" + "=" * 60)
        print("💡 Recommendations")
        print("=" * 60)
        print(f"   • Watch mode - continuously monitor progress:")
        print(f"     python aws/check-stacks-status.py --watch")
        print(f"   • Or run this script again to check status")
        print(f"   • For rollback issues, use:")
        print(f"     python aws/fix-rollback-failed.py <stack-name>")
    else:
        print(f"\n✓ All stacks are in a stable state")
    
    print("\n" + "=" * 60)

if __name__ == '__main__':
    # Show help if requested
    if len(sys.argv) > 1 and sys.argv[1] in ['--help', '-h', 'help']:
        print("=" * 60)
        print("DiamondDrip Stack Status Monitor")
        print("=" * 60)
        print("\nUsage:")
        print("  python check-stacks-status.py [options]")
        print("\nOptions:")
        print("  --watch, -w [interval]    Watch mode - continuously monitor (default: 30s)")
        print("  --project, -p <name>       Project name (default: diamonddrip)")
        print("  --env, -e <env>           Environment (default: production)")
        print("  --region, -r <region>     AWS region (default: us-east-1)")
        print("  --help, -h                Show this help message")
        print("\nExamples:")
        print("  # Check status once")
        print("  python check-stacks-status.py")
        print("\n  # Watch mode (check every 30 seconds)")
        print("  python check-stacks-status.py --watch")
        print("\n  # Watch mode (check every 10 seconds)")
        print("  python check-stacks-status.py --watch 10")
        print("\n  # Check specific project/environment")
        print("  python check-stacks-status.py --project myapp --env staging")
        print("\nEnvironment Variables:")
        print("  PROJECT_NAME              Project name")
        print("  ENVIRONMENT               Environment (development/staging/production)")
        print("  AWS_REGION                AWS region")
        print("=" * 60)
        sys.exit(0)
    
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

