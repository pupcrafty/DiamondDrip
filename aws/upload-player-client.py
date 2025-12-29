#!/usr/bin/env python3
"""
Upload player client files to S3 bucket
Maintains directory structure for relative paths
"""
import boto3
import os
from pathlib import Path
import sys

def upload_player_client(bucket_name, region='us-east-1', api_endpoint=None):
    """Upload player client files to S3"""
    s3 = boto3.client('s3', region_name=region)
    
    # Base directory for player files
    player_dir = Path(__file__).parent.parent / 'player'
    
    if not player_dir.exists():
        print(f"[ERROR] Player directory not found: {player_dir}")
        return False
    
    print(f"Uploading player client files to S3 bucket: {bucket_name}")
    print(f"Source directory: {player_dir}")
    
    # Files to upload (maintaining structure)
    files_to_upload = [
        # Player client files
        ('playerClient/index.html', 'index.html'),
        ('playerClient/js/game.js', 'js/game.js'),
        ('playerClient/js/marker.js', 'js/marker.js'),
        ('playerClient/js/target.js', 'js/target.js'),
        ('playerClient/js/beacon.js', 'js/beacon.js'),
        ('playerClient/diagnostic.html', 'diagnostic.html'),
        
        # Beat detector files
        ('beatDetector/js/logger.js', 'beatDetector/js/logger.js'),
        ('beatDetector/js/beatDetection.js', 'beatDetector/js/beatDetection.js'),
        ('beatDetector/js/bpmEstimator.js', 'beatDetector/js/bpmEstimator.js'),
        ('beatDetector/js/energyClassifier.js', 'beatDetector/js/energyClassifier.js'),
        ('beatDetector/js/rhythmPredictor.js', 'beatDetector/js/rhythmPredictor.js'),
        ('beatDetector/js/beat-worklet.js', 'beatDetector/js/beat-worklet.js'),
        
        # Config files
        ('config/config.js', 'config/config.js'),
    ]
    
    uploaded = 0
    failed = 0
    
    for relative_path, s3_key in files_to_upload:
        source_file = player_dir / relative_path
        
        if not source_file.exists():
            print(f"  [WARNING] File not found: {source_file}")
            failed += 1
            continue
        
        try:
            # Read file content
            with open(source_file, 'rb') as f:
                content = f.read()
            
            # If it's game.js and we have an API endpoint, update it
            if s3_key == 'js/game.js' and api_endpoint:
                content_str = content.decode('utf-8')
                # Update PREDICTION_SERVER_URL
                import re
                content_str = re.sub(
                    r"const PREDICTION_SERVER_URL = ['\"](https?://[^'\"]+)['\"]",
                    f"const PREDICTION_SERVER_URL = '{api_endpoint}/prediction'",
                    content_str
                )
                content = content_str.encode('utf-8')
            
            # Upload to S3
            content_type = 'text/html' if source_file.suffix == '.html' else 'application/javascript' if source_file.suffix == '.js' else 'text/plain'
            
            s3.put_object(
                Bucket=bucket_name,
                Key=s3_key,
                Body=content,
                ContentType=content_type,
                CacheControl='public, max-age=3600'
            )
            
            print(f"  [OK] Uploaded: {s3_key}")
            uploaded += 1
            
        except Exception as e:
            print(f"  [ERROR] Failed to upload {s3_key}: {e}")
            failed += 1
    
    print(f"\nUpload complete:")
    print(f"  Uploaded: {uploaded}")
    print(f"  Failed: {failed}")
    
    return failed == 0

def invalidate_cloudfront(distribution_id, region='us-east-1'):
    """Invalidate CloudFront cache"""
    cloudfront = boto3.client('cloudfront', region_name=region)
    
    try:
        print(f"\nInvalidating CloudFront cache: {distribution_id}")
        response = cloudfront.create_invalidation(
            DistributionId=distribution_id,
            InvalidationBatch={
                'Paths': {
                    'Quantity': 1,
                    'Items': ['/*']
                },
                'CallerReference': str(int(__import__('time').time()))
            }
        )
        print(f"  [OK] Invalidation created: {response['Invalidation']['Id']}")
        return True
    except Exception as e:
        print(f"  [ERROR] Failed to invalidate cache: {e}")
        return False

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Upload player client to S3')
    parser.add_argument('--bucket', help='S3 bucket name')
    parser.add_argument('--stack-name', default='diamonddrip-production', help='CloudFormation stack name')
    parser.add_argument('--region', default='us-east-1', help='AWS region')
    parser.add_argument('--api-endpoint', help='API Gateway endpoint (auto-detected if not provided)')
    parser.add_argument('--invalidate', action='store_true', help='Invalidate CloudFront cache')
    
    args = parser.parse_args()
    
    # Get bucket name from stack if not provided
    if not args.bucket:
        cf = boto3.client('cloudformation', region_name=args.region)
        try:
            outputs = cf.describe_stacks(StackName=args.stack_name)['Stacks'][0]['Outputs']
            outputs_dict = {o['OutputKey']: o['OutputValue'] for o in outputs}
            args.bucket = outputs_dict.get('PlayerClientBucketName')
            if not args.bucket:
                print(f"[ERROR] Could not find PlayerClientBucketName in stack outputs")
                sys.exit(1)
        except Exception as e:
            print(f"[ERROR] Could not get bucket name from stack: {e}")
            sys.exit(1)
    
    # Get API endpoint if not provided
    if not args.api_endpoint:
        cf = boto3.client('cloudformation', region_name=args.region)
        try:
            outputs = cf.describe_stacks(StackName=args.stack_name)['Stacks'][0]['Outputs']
            outputs_dict = {o['OutputKey']: o['OutputValue'] for o in outputs}
            args.api_endpoint = outputs_dict.get('ApiEndpoint')
        except:
            pass
    
    # Upload files
    if upload_player_client(args.bucket, args.region, args.api_endpoint):
        print(f"\n[OK] Player client uploaded successfully!")
        
        # Invalidate CloudFront if requested
        if args.invalidate:
            cf = boto3.client('cloudformation', region_name=args.region)
            try:
                outputs = cf.describe_stacks(StackName=args.stack_name)['Stacks'][0]['Outputs']
                outputs_dict = {o['OutputKey']: o['OutputValue'] for o in outputs}
                distribution_id = outputs_dict.get('PlayerClientDistributionId')
                if distribution_id:
                    invalidate_cloudfront(distribution_id, args.region)
            except Exception as e:
                print(f"[WARNING] Could not invalidate CloudFront: {e}")
        
        # Get CloudFront URL
        cf = boto3.client('cloudformation', region_name=args.region)
        try:
            outputs = cf.describe_stacks(StackName=args.stack_name)['Stacks'][0]['Outputs']
            outputs_dict = {o['OutputKey']: o['OutputValue'] for o in outputs}
            cloudfront_url = outputs_dict.get('PlayerClientURL')
            if cloudfront_url:
                print(f"\nPlayer client available at:")
                print(f"  https://{cloudfront_url}")
        except:
            pass
    else:
        print(f"\n[ERROR] Upload failed")
        sys.exit(1)

if __name__ == '__main__':
    main()

