#!/usr/bin/env python3
"""
Get endpoints and URLs for all DiamondDrip CloudFormation stacks
Displays API endpoints, frontend URLs, database endpoints, and other useful information
"""
import os
import sys
import boto3
import argparse
from pathlib import Path
from botocore.exceptions import ClientError

def get_stack_outputs(stack_name, region):
    """Get outputs from a CloudFormation stack"""
    cf = boto3.client('cloudformation', region_name=region)
    try:
        response = cf.describe_stacks(StackName=stack_name)
        outputs = {}
        for output in response['Stacks'][0].get('Outputs', []):
            outputs[output['OutputKey']] = output['OutputValue']
        return outputs
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', '')
        if error_code == 'ValidationError' and 'does not exist' in str(e):
            return None
        raise

def get_stack_status(stack_name, region):
    """Get status of a CloudFormation stack"""
    cf = boto3.client('cloudformation', region_name=region)
    try:
        response = cf.describe_stacks(StackName=stack_name)
        return response['Stacks'][0]['StackStatus']
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', '')
        if error_code == 'ValidationError' and 'does not exist' in str(e):
            return None
        raise

def format_url(url):
    """Format URL for display"""
    if url and not url.startswith('http'):
        return f"https://{url}"
    return url

def main():
    """Main function"""
    parser = argparse.ArgumentParser(
        description='Get endpoints and URLs for DiamondDrip CloudFormation stacks',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Get all endpoints
  python get-endpoints.py

  # Get endpoints for specific project/environment
  python get-endpoints.py --project myapp --env staging

  # Get endpoints in JSON format
  python get-endpoints.py --json
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
    parser.add_argument('--json', '-j', action='store_true',
                       help='Output in JSON format')
    
    args = parser.parse_args()
    
    project_name = args.project
    environment = args.env
    region = args.region
    
    # Stack definitions
    stacks = {
        'network': {
            'name': f'{project_name}-{environment}-network',
            'display': 'Network Stack',
            'outputs': ['VPCId']
        },
        'database': {
            'name': f'{project_name}-{environment}-database',
            'display': 'Database Stack',
            'outputs': ['DatabaseEndpoint', 'DatabasePort']
        },
        'application': {
            'name': f'{project_name}-{environment}-application',
            'display': 'Application Stack',
            'outputs': ['ApiEndpoint', 'LambdaFunctionName']
        },
        'frontend': {
            'name': f'{project_name}-{environment}-frontend',
            'display': 'Frontend Stack',
            'outputs': ['PlayerClientURL', 'PlayerClientBucketName', 'PlayerClientDistributionId']
        }
    }
    
    if args.json:
        import json
        result = {
            'project': project_name,
            'environment': environment,
            'region': region,
            'stacks': {}
        }
    else:
        print("=" * 70)
        print("DiamondDrip Stack Endpoints")
        print("=" * 70)
        print(f"\nProject: {project_name}")
        print(f"Environment: {environment}")
        print(f"Region: {region}")
        print("\n" + "=" * 70)
    
    found_any = False
    
    for stack_key, stack_info in stacks.items():
        stack_name = stack_info['name']
        status = get_stack_status(stack_name, region)
        
        if status is None:
            if not args.json:
                print(f"\n❌ {stack_info['display']}: {stack_name}")
                print(f"   Status: Stack does not exist")
            else:
                result['stacks'][stack_key] = {
                    'name': stack_name,
                    'status': 'DOES_NOT_EXIST',
                    'outputs': {}
                }
            continue
        
        outputs = get_stack_outputs(stack_name, region)
        
        if not args.json:
            print(f"\n{'=' * 70}")
            print(f"{stack_info['display']}: {stack_name}")
            print(f"{'=' * 70}")
            print(f"Status: {status}")
            
            if outputs:
                found_any = True
                print(f"\n📡 Endpoints & Information:")
                
                # Application stack - show API endpoints
                if stack_key == 'application':
                    api_endpoint = outputs.get('ApiEndpoint')
                    lambda_name = outputs.get('LambdaFunctionName')
                    
                    if api_endpoint:
                        print(f"\n  🌐 API Endpoint:")
                        print(f"     {api_endpoint}")
                        print(f"\n  📋 Available Routes:")
                        print(f"     POST   {api_endpoint}/prediction")
                        print(f"     GET    {api_endpoint}/stats")
                        print(f"     GET    {api_endpoint}/recent?limit=100")
                        print(f"     GET    {api_endpoint}/health")
                        print(f"     GET    {api_endpoint}/")
                    
                    if lambda_name:
                        print(f"\n  ⚡ Lambda Function:")
                        print(f"     {lambda_name}")
                
                # Frontend stack - show CloudFront URL
                elif stack_key == 'frontend':
                    player_url = outputs.get('PlayerClientURL')
                    bucket_name = outputs.get('PlayerClientBucketName')
                    dist_id = outputs.get('PlayerClientDistributionId')
                    
                    if player_url:
                        full_url = format_url(player_url)
                        print(f"\n  🌐 Frontend URL:")
                        print(f"     {full_url}")
                    
                    if bucket_name:
                        print(f"\n  🪣 S3 Bucket:")
                        print(f"     {bucket_name}")
                    
                    if dist_id:
                        print(f"\n  ☁️  CloudFront Distribution ID:")
                        print(f"     {dist_id}")
                
                # Database stack - show connection info
                elif stack_key == 'database':
                    db_endpoint = outputs.get('DatabaseEndpoint')
                    db_port = outputs.get('DatabasePort')
                    
                    if db_endpoint:
                        print(f"\n  🗄️  Database Endpoint:")
                        print(f"     {db_endpoint}")
                    
                    if db_port:
                        print(f"\n  🔌 Database Port:")
                        print(f"     {db_port}")
                    
                    if db_endpoint and db_port:
                        print(f"\n  📝 Connection String:")
                        print(f"     Host: {db_endpoint}")
                        print(f"     Port: {db_port}")
                        print(f"     Database: diamonddrip")
                
                # Network stack - show VPC info
                elif stack_key == 'network':
                    vpc_id = outputs.get('VPCId')
                    
                    if vpc_id:
                        print(f"\n  🌐 VPC ID:")
                        print(f"     {vpc_id}")
                
                # Show any other outputs
                shown_keys = {
                    'application': ['ApiEndpoint', 'LambdaFunctionName'],
                    'frontend': ['PlayerClientURL', 'PlayerClientBucketName', 'PlayerClientDistributionId'],
                    'database': ['DatabaseEndpoint', 'DatabasePort'],
                    'network': ['VPCId']
                }
                
                other_outputs = {k: v for k, v in outputs.items() 
                               if k not in shown_keys.get(stack_key, [])}
                
                if other_outputs:
                    print(f"\n  📦 Other Outputs:")
                    for key, value in other_outputs.items():
                        print(f"     {key}: {value}")
            else:
                print(f"\n⚠️  No outputs available (stack may still be deploying)")
        else:
            # JSON output
            result['stacks'][stack_key] = {
                'name': stack_name,
                'status': status,
                'outputs': outputs or {}
            }
            if outputs:
                found_any = True
    
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print("\n" + "=" * 70)
        if found_any:
            print("\n💡 Tips:")
            print("   - Use these endpoints in your client configuration")
            print("   - API endpoints support CORS for web applications")
            print("   - Frontend URL may take a few minutes to become active after deployment")
            print("   - Database endpoint is only accessible from within the VPC")
        else:
            print("\n⚠️  No stacks with outputs found")
            print("   Make sure stacks are deployed and in CREATE_COMPLETE or UPDATE_COMPLETE state")
        print("=" * 70)

if __name__ == '__main__':
    # Change to aws directory
    script_dir = Path(__file__).parent
    os.chdir(script_dir)
    
    main()

