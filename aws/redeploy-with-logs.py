#!/usr/bin/env python3
"""
Clean, redeploy, and watch logs for DiamondDrip application
This script orchestrates cleanup, deployment, and log monitoring
"""
import os
import sys
import subprocess
import time
import argparse
from pathlib import Path
import importlib.util

def load_module_function(script_path, function_name):
    """Load a function from a Python script module"""
    if not script_path.exists():
        return None
    
    spec = importlib.util.spec_from_file_location("module", script_path)
    if spec and spec.loader:
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return getattr(module, function_name, None)
    return None

def run_cleanup(project_name, environment, region, all_stacks=False):
    """Run cleanup script"""
    print("=" * 60)
    print("STEP 1: Cleaning up existing stacks")
    print("=" * 60)
    
    cleanup_script = Path(__file__).parent / 'cleanup-stacks.py'
    if not cleanup_script.exists():
        print("✗ cleanup-stacks.py not found")
        return False
    
    cmd = [
        sys.executable, str(cleanup_script),
        '--project', project_name,
        '--env', environment,
        '--region', region
    ]
    
    if all_stacks:
        cmd.append('--all')
    
    print(f"\nRunning: {' '.join(cmd)}\n")
    result = subprocess.run(cmd, cwd=Path(__file__).parent)
    
    if result.returncode != 0:
        print("\n⚠️  Cleanup had issues, but continuing with deployment...")
        return False
    
    print("\n✓ Cleanup completed")
    return True

def run_deployment(project_name, environment, region, stacks=None):
    """Run deployment script"""
    print("\n" + "=" * 60)
    print("STEP 2: Deploying stacks")
    print("=" * 60)
    
    deploy_script = Path(__file__).parent / 'deploy-stacks.py'
    if not deploy_script.exists():
        print("✗ deploy-stacks.py not found")
        return False
    
    cmd = [
        sys.executable, str(deploy_script),
        '--project', project_name,
        '--env', environment,
        '--region', region,
        '--reset',  # Reset state file
        '--all'     # Deploy all stacks
    ]
    
    if stacks:
        cmd = [
            sys.executable, str(deploy_script),
            '--project', project_name,
            '--env', environment,
            '--region', region,
            '--reset'
        ]
        for stack in stacks:
            cmd.extend(['--stack', stack])
    
    print(f"\nRunning: {' '.join(cmd)}\n")
    result = subprocess.run(cmd, cwd=Path(__file__).parent)
    
    if result.returncode != 0:
        print("\n✗ Deployment failed")
        return False
    
    print("\n✓ Deployment completed")
    return True

def watch_logs(project_name, environment, region, follow=True, minutes=5):
    """Watch Lambda function logs"""
    print("\n" + "=" * 60)
    print("STEP 3: Watching Lambda logs")
    print("=" * 60)
    
    logs_script = Path(__file__).parent / 'get-lambda-logs.py'
    if not logs_script.exists():
        print("✗ get-lambda-logs.py not found")
        return False
    
    stack_name = f'{project_name}-{environment}-application'
    
    cmd = [
        sys.executable, str(logs_script),
        '--stack-name', stack_name,
        '--region', region,
        '--minutes', str(minutes)
    ]
    
    if follow:
        cmd.append('--follow')
    
    print(f"\nWatching logs from: {stack_name}")
    print(f"Time range: Last {minutes} minutes")
    if follow:
        print("Mode: Following (will show new logs as they arrive)")
        print("Press Ctrl+C to stop watching logs\n")
    else:
        print("Mode: One-time fetch\n")
    
    print("-" * 60)
    
    try:
        result = subprocess.run(cmd, cwd=Path(__file__).parent)
        return result.returncode == 0
    except KeyboardInterrupt:
        print("\n\n✓ Log watching stopped by user")
        return True

def main():
    parser = argparse.ArgumentParser(
        description='Clean, redeploy, and watch logs for DiamondDrip',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Full clean redeploy with log watching
  python redeploy-with-logs.py

  # Clean redeploy without log watching
  python redeploy-with-logs.py --no-logs

  # Clean redeploy specific stacks only
  python redeploy-with-logs.py --stacks application frontend

  # Skip cleanup (just redeploy)
  python redeploy-with-logs.py --no-cleanup

  # Watch logs for longer period
  python redeploy-with-logs.py --log-minutes 30
        """
    )
    
    parser.add_argument('--project', '-p',
                       default=os.environ.get('PROJECT_NAME', 'diamonddrip'),
                       help='Project name (default: diamonddrip)')
    parser.add_argument('--env', '-e',
                       default=os.environ.get('ENVIRONMENT', 'production'),
                       help='Environment (default: production)')
    parser.add_argument('--region', '-r',
                       default=os.environ.get('AWS_REGION', 'us-east-1'),
                       help='AWS region (default: us-east-1)')
    parser.add_argument('--stacks', '-s', nargs='+',
                       choices=['network', 'database', 'application', 'frontend', 'diagnostics-frontend'],
                       help='Deploy specific stacks only (default: all)')
    parser.add_argument('--no-cleanup', action='store_true',
                       help='Skip cleanup step')
    parser.add_argument('--no-logs', action='store_true',
                       help='Skip log watching step')
    parser.add_argument('--log-minutes', type=int, default=5,
                       help='Minutes of logs to fetch initially (default: 5)')
    parser.add_argument('--no-follow', action='store_true',
                       help='Don\'t follow logs (just fetch once)')
    parser.add_argument('--cleanup-all', action='store_true',
                       help='Clean up all stacks (not just failed ones)')
    
    args = parser.parse_args()
    
    project_name = args.project
    environment = args.env
    region = args.region
    
    print("=" * 60)
    print("DiamondDrip Clean Redeploy with Log Watching")
    print("=" * 60)
    print(f"\nConfiguration:")
    print(f"  Project: {project_name}")
    print(f"  Environment: {environment}")
    print(f"  Region: {region}")
    if args.stacks:
        print(f"  Stacks: {', '.join(args.stacks)}")
    else:
        print(f"  Stacks: All")
    print(f"  Cleanup: {'Skipped' if args.no_cleanup else ('All stacks' if args.cleanup_all else 'Failed stacks only')}")
    print(f"  Log Watching: {'Disabled' if args.no_logs else ('Following' if not args.no_follow else 'One-time')}")
    
    # Step 1: Cleanup
    if not args.no_cleanup:
        success = run_cleanup(project_name, environment, region, args.cleanup_all)
        if not success:
            print("\n⚠️  Cleanup had issues. Continue anyway? (This is normal if no stacks exist)")
            time.sleep(2)
    else:
        print("\n⏭️  Skipping cleanup (--no-cleanup specified)")
    
    # Wait a bit for cleanup to fully complete
    if not args.no_cleanup:
        print("\n⏳ Waiting 5 seconds for cleanup to settle...")
        time.sleep(5)
    
    # Step 2: Deploy
    success = run_deployment(project_name, environment, region, args.stacks)
    if not success:
        print("\n✗ Deployment failed. Check errors above.")
        sys.exit(1)
    
    # Step 3: Watch logs
    if not args.no_logs:
        # Wait a bit for Lambda to be ready
        print("\n⏳ Waiting 10 seconds for Lambda to be ready...")
        time.sleep(10)
        
        watch_logs(
            project_name,
            environment,
            region,
            follow=not args.no_follow,
            minutes=args.log_minutes
        )
    else:
        print("\n⏭️  Skipping log watching (--no-logs specified)")
    
    print("\n" + "=" * 60)
    print("✓ Redeploy process completed!")
    print("=" * 60)
    print("\nTo watch logs manually, run:")
    print(f"  python get-lambda-logs.py --stack-name {project_name}-{environment}-application --follow")

if __name__ == '__main__':
    # Change to script directory
    script_dir = Path(__file__).parent
    os.chdir(script_dir)
    
    main()


