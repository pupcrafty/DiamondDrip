#!/usr/bin/env python3
"""
Upload Lambda function code to AWS Lambda
Builds the deployment package and uploads it to the specified Lambda function
"""
import os
import sys
import subprocess
import boto3
import zipfile
import tempfile
import shutil
from pathlib import Path
import argparse

def build_lambda_package(output_zip=None):
    """Build Lambda deployment package
    
    Args:
        output_zip: Path to output zip file (optional)
    """
    if output_zip is None:
        output_zip = Path(__file__).parent / 'lambda-package.zip'
    else:
        output_zip = Path(output_zip)
    
    print(f"Building Lambda deployment package...")
    
    # Create temporary directory
    temp_dir = Path(tempfile.mkdtemp())
    print(f"Using temp directory: {temp_dir}")
    
    try:
        # Get script directory
        script_dir = Path(__file__).parent
        
        # Copy Lambda function files
        lambda_function = script_dir / 'lambda_function.py'
        database = script_dir / 'database.py'
        
        if not lambda_function.exists():
            print(f"ERROR: Error: lambda_function.py not found at {lambda_function}")
            return None
        
        if not database.exists():
            print(f"ERROR: Error: database.py not found at {database}")
            return None
        
        print(f"Copying Lambda function files...")
        shutil.copy2(lambda_function, temp_dir / 'lambda_function.py')
        shutil.copy2(database, temp_dir / 'database.py')
        
        # Copy prediction engine files from synchronizer/
        project_root = script_dir.parent
        synchronizer_dir = project_root / 'synchronizer'
        prediction_files = [
            'prediction_engine.py',
            'prediction_api.py',
            'slot_prior_model.py'
        ]
        
        print(f"Copying prediction engine files...")
        for filename in prediction_files:
            src_file = synchronizer_dir / filename
            if src_file.exists():
                shutil.copy2(src_file, temp_dir / filename)
                print(f"  Copied {filename}")
            else:
                print(f"WARNING:  Warning: {filename} not found at {src_file}")
        
        # Install dependencies
        requirements = script_dir / 'requirements.txt'
        if requirements.exists():
            print(f"Installing dependencies from {requirements}...")
            try:
                # Upgrade pip first to ensure we have the latest wheel support
                subprocess.run(
                    [sys.executable, '-m', 'pip', 'install', '--upgrade', 'pip'],
                    check=True,
                    capture_output=True
                )
                
                # Build pip install command for Lambda (Linux)
                # Use --platform to download Linux wheels even when building on Windows/Mac
                # This ensures psycopg2-binary and other packages are Linux-compatible
                
                # First, try to download Linux wheels to a temp directory
                download_dir = temp_dir / 'wheels'
                download_dir.mkdir(exist_ok=True)
                
                download_cmd = [
                    sys.executable, '-m', 'pip', 'download',
                    '--platform', 'manylinux2014_x86_64',
                    '--only-binary', ':all:',
                    '--python-version', '3.11',
                    '--implementation', 'cp',
                    '--abi', 'cp311',
                    '-r', str(requirements),
                    '-d', str(download_dir),
                    '--quiet'
                ]
                
                print(f"Downloading Linux-compatible wheels...")
                download_result = subprocess.run(
                    download_cmd,
                    check=False,  # Don't fail if download doesn't work
                    capture_output=True,
                    text=True
                )
                
                # Now install - if we downloaded wheels, install from there, otherwise try platform flag
                if download_result.returncode == 0 and list(download_dir.glob('*.whl')):
                    print(f"Installing from downloaded Linux wheels...")
                    pip_cmd = [
                        sys.executable, '-m', 'pip', 'install',
                        '--find-links', str(download_dir),
                        '--no-index',  # Don't look in PyPI, only use downloaded wheels
                        '-r', str(requirements),
                        '-t', str(temp_dir),
                        '--quiet'
                    ]
                else:
                    print(f"Falling back to platform-specific installation...")
                    # Fallback: try with platform flag directly
                    pip_cmd = [
                        sys.executable, '-m', 'pip', 'install',
                        '--platform', 'manylinux2014_x86_64',
                        '--only-binary', ':all:',
                        '--python-version', '3.11',
                        '--implementation', 'cp',
                        '--abi', 'cp311',
                        '-r', str(requirements),
                        '-t', str(temp_dir),
                        '--quiet'
                    ]
                
                # Install dependencies using Linux-compatible wheels
                result = subprocess.run(
                    pip_cmd,
                    check=True,
                    capture_output=True,
                    text=True
                )
            except subprocess.CalledProcessError as e:
                print(f"WARNING:  Warning: Failed to install some dependencies: {e.stderr if e.stderr else str(e)}")
                print(f"   Continuing anyway...")
        else:
            print(f"WARNING:  Warning: requirements.txt not found, skipping dependency installation")
        
        # Create zip file
        print(f"Creating zip package...")
        with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(temp_dir):
                for file in files:
                    file_path = Path(root) / file
                    arcname = file_path.relative_to(temp_dir)
                    zipf.write(file_path, arcname)
        
        # Get file size
        size_mb = output_zip.stat().st_size / (1024 * 1024)
        print(f"SUCCESS: Lambda package created: {output_zip}")
        print(f"  Package size: {size_mb:.2f} MB")
        
        return output_zip
        
    except Exception as e:
        print(f"ERROR: Error building package: {e}")
        return None
    finally:
        # Cleanup
        if temp_dir.exists():
            shutil.rmtree(temp_dir)

def upload_lambda_code(function_name, zip_file, region='us-east-1'):
    """Upload Lambda function code
    
    Args:
        function_name: Name of the Lambda function
        zip_file: Path to the zip file (Path object or string)
        region: AWS region
        
    Returns:
        bool: True if successful, False otherwise
    """
    if isinstance(zip_file, Path):
        zip_file = str(zip_file)
    
    print(f"\nUploading Lambda code to function: {function_name}")
    
    lambda_client = boto3.client('lambda', region_name=region)
    
    try:
        # Check if function exists
        try:
            lambda_client.get_function(FunctionName=function_name)
        except lambda_client.exceptions.ResourceNotFoundException:
            print(f"ERROR: Error: Lambda function '{function_name}' not found")
            print(f"   Make sure the application stack is deployed first")
            return False
        
        # Upload code
        print(f"Uploading {zip_file}...")
        with open(zip_file, 'rb') as f:
            response = lambda_client.update_function_code(
                FunctionName=function_name,
                ZipFile=f.read()
            )
        
        # Wait for update to complete
        print(f"Waiting for code update to complete...")
        waiter = lambda_client.get_waiter('function_updated')
        waiter.wait(FunctionName=function_name)
        
        print(f"SUCCESS: Lambda code uploaded successfully!")
        print(f"  Function: {function_name}")
        print(f"  Runtime: {response.get('Runtime', 'N/A')}")
        print(f"  Handler: {response.get('Handler', 'N/A')}")
        print(f"  Code Size: {response.get('CodeSize', 0) / 1024:.2f} KB")
        
        return True
        
    except Exception as e:
        print(f"ERROR: Error uploading Lambda code: {e}")
        return False

def get_lambda_function_name(stack_name, region='us-east-1'):
    """Get Lambda function name from CloudFormation stack outputs"""
    cf = boto3.client('cloudformation', region_name=region)
    try:
        response = cf.describe_stacks(StackName=stack_name)
        outputs = {o['OutputKey']: o['OutputValue'] 
                  for o in response['Stacks'][0].get('Outputs', [])}
        return outputs.get('LambdaFunctionName')
    except Exception as e:
        print(f"WARNING:  Could not get Lambda function name from stack: {e}")
        return None

def main():
    parser = argparse.ArgumentParser(
        description='Build and upload Lambda function code',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Build and upload using default application stack
  python upload-lambda-code.py

  # Build and upload using specific stack name
  python upload-lambda-code.py --stack-name diamonddrip-production-application

  # Build and upload using function name
  python upload-lambda-code.py --function-name diamonddrip-production-prediction-server

  # Upload existing package
  python upload-lambda-code.py --function-name my-function --zip-file lambda-package.zip
        """
    )
    
    parser.add_argument('--stack-name', '-s',
                       help='CloudFormation stack name (application stack). Defaults to {project}-{env}-application')
    parser.add_argument('--function-name', '-f',
                       help='Lambda function name')
    parser.add_argument('--project', '-p',
                       default=os.environ.get('PROJECT_NAME', 'diamonddrip'),
                       help='Project name (default: diamonddrip)')
    parser.add_argument('--env', '-e',
                       default=os.environ.get('ENVIRONMENT', 'production'),
                       help='Environment (default: production)')
    parser.add_argument('--zip-file', '-z',
                       help='Path to existing zip file (default: checks for lambda-package-docker.zip or lambda-package.zip)')
    parser.add_argument('--region', '-r',
                       default=os.environ.get('AWS_REGION', 'us-east-1'),
                       help='AWS region (default: us-east-1)')
    
    args = parser.parse_args()
    
    # Determine stack name - default to application stack if not provided
    stack_name = args.stack_name
    if not stack_name and not args.function_name:
        # Default to application stack
        stack_name = f'{args.project}-{args.env}-application'
        print(f"Using default application stack: {stack_name}")
    
    # Determine function name
    function_name = args.function_name
    if not function_name and stack_name:
        function_name = get_lambda_function_name(stack_name, args.region)
        if not function_name:
            print(f"ERROR: Could not determine Lambda function name from stack: {stack_name}")
            sys.exit(1)
    
    # Get zip file - prefer docker zip, then specified file, build if neither exists
    zip_file = args.zip_file
    if not zip_file:
        # Check for docker-built package first
        script_dir = Path(__file__).parent
        docker_zip = script_dir / 'lambda-package-docker.zip'
        regular_zip = script_dir / 'lambda-package.zip'
        
        if docker_zip.exists():
            print(f"Using Docker-built package: {docker_zip.name}")
            zip_file = docker_zip
        elif regular_zip.exists():
            print(f"Using existing package: {regular_zip.name}")
            zip_file = regular_zip
        else:
            print(f"No Lambda package found. Building new package...")
            zip_file = build_lambda_package(regular_zip)
            if not zip_file:
                print(f"ERROR: Failed to build Lambda package!")
                sys.exit(1)
    else:
        zip_file = Path(zip_file)
        if not zip_file.exists():
            print(f"ERROR: Zip file not found: {zip_file}")
            sys.exit(1)
    
    # Ensure zip_file is a Path object
    if not isinstance(zip_file, Path):
        zip_file = Path(zip_file)
    
    # Upload if function name is provided
    if not function_name:
        print(f"ERROR: Could not determine Lambda function name.")
        print(f"   Please specify --function-name, --stack-name, or ensure the default application stack exists.")
        sys.exit(1)
    
    success = upload_lambda_code(function_name, zip_file, args.region)
    if not success:
        sys.exit(1)

if __name__ == '__main__':
    # Change to script directory
    script_dir = Path(__file__).parent
    os.chdir(script_dir)
    
    main()

