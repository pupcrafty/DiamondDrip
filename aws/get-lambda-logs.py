#!/usr/bin/env python3
"""
Get Lambda function logs from CloudWatch Logs
Supports tailing, filtering, and time-based queries
"""
import boto3
import argparse
import sys
from datetime import datetime, timedelta
from pathlib import Path
import os

def get_lambda_function_name(stack_name, region='us-east-1'):
    """Get Lambda function name from CloudFormation stack outputs"""
    cf = boto3.client('cloudformation', region_name=region)
    try:
        response = cf.describe_stacks(StackName=stack_name)
        outputs = {o['OutputKey']: o['OutputValue'] 
                  for o in response['Stacks'][0].get('Outputs', [])}
        function_name = outputs.get('LambdaFunctionName')
        if not function_name:
            # Try to get it from the stack resources
            resources = cf.describe_stack_resources(StackName=stack_name)
            for resource in resources.get('StackResources', []):
                if resource['ResourceType'] == 'AWS::Lambda::Function':
                    return resource['PhysicalResourceId']
        return function_name
    except Exception as e:
        print(f"[ERROR] Could not get Lambda function name from stack: {e}")
        return None

def get_log_group_name(function_name):
    """Get CloudWatch Log Group name for Lambda function"""
    return f"/aws/lambda/{function_name}"

def get_logs(log_group_name, region='us-east-1', start_time=None, end_time=None, 
             filter_pattern=None, limit=100, follow=False):
    """Get logs from CloudWatch Logs"""
    logs = boto3.client('logs', region_name=region)
    
    # Check if log group exists
    try:
        logs.describe_log_groups(logGroupNamePrefix=log_group_name)
    except Exception as e:
        print(f"[ERROR] Could not access log group {log_group_name}: {e}")
        return False
    
    # Set default time range (last hour if not specified)
    if start_time is None:
        start_time = datetime.utcnow() - timedelta(hours=1)
    if end_time is None:
        end_time = datetime.utcnow()
    
    start_timestamp = int(start_time.timestamp() * 1000)
    end_timestamp = int(end_time.timestamp() * 1000)
    
    print(f"[INFO] Fetching logs from {log_group_name}")
    print(f"[INFO] Time range: {start_time.strftime('%Y-%m-%d %H:%M:%S')} to {end_time.strftime('%Y-%m-%d %H:%M:%S')} UTC")
    if filter_pattern:
        print(f"[INFO] Filter pattern: {filter_pattern}")
    print("-" * 80)
    
    try:
        kwargs = {
            'logGroupName': log_group_name,
            'startTime': start_timestamp,
            'endTime': end_timestamp,
            'limit': limit
        }
        
        if filter_pattern:
            kwargs['filterPattern'] = filter_pattern
        
        last_seen_timestamp = start_timestamp
        printed_count = 0
        
        while True:
            kwargs['startTime'] = last_seen_timestamp + 1
            
            response = logs.filter_log_events(**kwargs)
            
            events = response.get('events', [])
            
            for event in events:
                timestamp = datetime.fromtimestamp(event['timestamp'] / 1000)
                message = event['message'].rstrip()
                print(f"[{timestamp.strftime('%Y-%m-%d %H:%M:%S')}] {message}")
                printed_count += 1
                last_seen_timestamp = max(last_seen_timestamp, event['timestamp'])
            
            # If no more events and not following, break
            if not events or not follow:
                if not follow:
                    break
                # In follow mode, wait a bit before checking again
                import time
                time.sleep(2)
            else:
                # Check for more events
                if 'nextToken' not in response:
                    if follow:
                        import time
                        time.sleep(2)
                    else:
                        break
                else:
                    kwargs['nextToken'] = response['nextToken']
        
        if printed_count == 0:
            print("[INFO] No log events found in the specified time range")
        else:
            print("-" * 80)
            print(f"[INFO] Retrieved {printed_count} log event(s)")
        
        return True
        
    except logs.exceptions.ResourceNotFoundException:
        print(f"[ERROR] Log group not found: {log_group_name}")
        print(f"[INFO] The Lambda function may not have been invoked yet, or logs may not exist")
        return False
    except Exception as e:
        print(f"[ERROR] Failed to get logs: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(
        description='Get Lambda function logs from CloudWatch Logs',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Get recent logs (last hour)
  python get-lambda-logs.py

  # Get logs from last 30 minutes
  python get-lambda-logs.py --minutes 30

  # Get logs from last 24 hours
  python get-lambda-logs.py --hours 24

  # Get logs with custom time range
  python get-lambda-logs.py --start "2024-01-01 10:00:00" --end "2024-01-01 11:00:00"

  # Follow logs (tail -f style)
  python get-lambda-logs.py --follow

  # Filter logs by pattern
  python get-lambda-logs.py --filter "ERROR"

  # Use specific function name
  python get-lambda-logs.py --function-name diamonddrip-production-prediction-server
        """
    )
    
    parser.add_argument('--stack-name', '-s',
                       default=os.environ.get('STACK_NAME', 'diamonddrip-production-application'),
                       help='CloudFormation stack name (default: diamonddrip-production-application)')
    parser.add_argument('--function-name', '-f',
                       help='Lambda function name (overrides stack-name lookup)')
    parser.add_argument('--region', '-r',
                       default=os.environ.get('AWS_REGION', 'us-east-1'),
                       help='AWS region (default: us-east-1)')
    parser.add_argument('--minutes', '-m', type=int,
                       help='Get logs from last N minutes')
    parser.add_argument('--hours', type=int,
                       help='Get logs from last N hours')
    parser.add_argument('--days', type=int,
                       help='Get logs from last N days')
    parser.add_argument('--start',
                       help='Start time (format: YYYY-MM-DD HH:MM:SS, UTC)')
    parser.add_argument('--end',
                       help='End time (format: YYYY-MM-DD HH:MM:SS, UTC)')
    parser.add_argument('--filter', '--filter-pattern',
                       help='Filter pattern (CloudWatch Logs filter syntax)')
    parser.add_argument('--limit', type=int, default=100,
                       help='Maximum number of log events to retrieve (default: 100)')
    parser.add_argument('--follow', '-F', action='store_true',
                       help='Follow logs (like tail -f)')
    parser.add_argument('--project', '-p',
                       default=os.environ.get('PROJECT_NAME', 'diamonddrip'),
                       help='Project name (default: diamonddrip)')
    parser.add_argument('--env', '-e',
                       default=os.environ.get('ENVIRONMENT', 'production'),
                       help='Environment (default: production)')
    
    args = parser.parse_args()
    
    # Get Lambda function name
    if args.function_name:
        function_name = args.function_name
    else:
        # Try to construct from project/env
        if not args.stack_name or args.stack_name == 'diamonddrip-production-application':
            args.stack_name = f'{args.project}-{args.env}-application'
        
        print(f"[INFO] Looking up Lambda function from stack: {args.stack_name}")
        function_name = get_lambda_function_name(args.stack_name, args.region)
        
        if not function_name:
            print(f"[ERROR] Could not determine Lambda function name")
            print(f"[INFO] Try specifying --function-name directly")
            sys.exit(1)
    
    print(f"[INFO] Lambda function: {function_name}")
    
    # Calculate time range
    end_time = datetime.utcnow()
    start_time = None
    
    if args.start:
        try:
            start_time = datetime.strptime(args.start, '%Y-%m-%d %H:%M:%S')
        except ValueError:
            print(f"[ERROR] Invalid start time format. Use: YYYY-MM-DD HH:MM:SS")
            sys.exit(1)
    elif args.minutes:
        start_time = end_time - timedelta(minutes=args.minutes)
    elif args.hours:
        start_time = end_time - timedelta(hours=args.hours)
    elif args.days:
        start_time = end_time - timedelta(days=args.days)
    else:
        # Default: last hour
        start_time = end_time - timedelta(hours=1)
    
    if args.end:
        try:
            end_time = datetime.strptime(args.end, '%Y-%m-%d %H:%M:%S')
        except ValueError:
            print(f"[ERROR] Invalid end time format. Use: YYYY-MM-DD HH:MM:SS")
            sys.exit(1)
    
    # Get log group name
    log_group_name = get_log_group_name(function_name)
    
    # Get logs
    success = get_logs(
        log_group_name,
        region=args.region,
        start_time=start_time,
        end_time=end_time,
        filter_pattern=args.filter,
        limit=args.limit,
        follow=args.follow
    )
    
    if not success:
        sys.exit(1)

if __name__ == '__main__':
    # Change to aws directory
    script_dir = Path(__file__).parent
    os.chdir(script_dir)
    
    main()





