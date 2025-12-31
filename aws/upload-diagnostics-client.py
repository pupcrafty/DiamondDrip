#!/usr/bin/env python3
"""
Upload diagnostics client files to S3 bucket
Maintains directory structure for relative paths
"""
import boto3
import os
from pathlib import Path
import sys

def upload_diagnostics_client(bucket_name, region='us-east-1', api_endpoint=None):
    """Upload diagnostics client files to S3"""
    s3 = boto3.client('s3', region_name=region)
    
    # Base directory for player files
    player_dir = Path(__file__).parent.parent / 'player'
    aws_dir = Path(__file__).parent
    
    if not player_dir.exists():
        print(f"[ERROR] Player directory not found: {player_dir}")
        return False
    
    diagnostics_dir = player_dir / 'diagnostics'
    if not diagnostics_dir.exists():
        print(f"[ERROR] Diagnostics directory not found: {diagnostics_dir}")
        return False
    
    print(f"Uploading diagnostics client files to S3 bucket: {bucket_name}")
    print(f"Source directory: {diagnostics_dir}")
    
    # Files to upload (maintaining structure)
    # Diagnostics HTML files go to root, but they reference ../beatDetector/ and ../config/
    files_to_upload = [
        # Diagnostics HTML files (to root)
        ('diagnostics/diagnostic.html', 'diagnostic.html'),
        ('diagnostics/beacon.html', 'beacon.html'),
        ('diagnostics/detectorTest.html', 'detectorTest.html'),
        ('diagnostics/legacyDetectorTest.html', 'legacyDetectorTest.html'),
        ('diagnostics/microphoneInfo.html', 'microphoneInfo.html'),
        ('diagnostics/predictionCallDiagnostic.html', 'predictionCallDiagnostic.html'),
        ('diagnostics/simpleDetectorTest.html', 'simpleDetectorTest.html'),
        
        # Diagnostics JS files (to js/ directory)
        ('diagnostics/js/detectorTest.js', 'js/detectorTest.js'),
        ('diagnostics/js/legacyBeatDetector.js', 'js/legacyBeatDetector.js'),
        ('diagnostics/js/simpleDetectorTest.js', 'js/simpleDetectorTest.js'),
        
        # Beat detector files (to ../beatDetector/js/ from diagnostics root, so beatDetector/js/)
        ('beatDetector/js/logger.js', 'beatDetector/js/logger.js'),
        ('beatDetector/js/beatDetection.js', 'beatDetector/js/beatDetection.js'),
        ('beatDetector/js/bpmEstimator.js', 'beatDetector/js/bpmEstimator.js'),
        ('beatDetector/js/energyClassifier.js', 'beatDetector/js/energyClassifier.js'),
        ('beatDetector/js/rhythmPredictor.js', 'beatDetector/js/rhythmPredictor.js'),
        ('beatDetector/js/sustainedBeatDetector.js', 'beatDetector/js/sustainedBeatDetector.js'),
        ('beatDetector/js/beat-worklet.js', 'beatDetector/js/beat-worklet.js'),
        
        # Config files (to ../config/ from diagnostics root, so config/)
        ('config/config.js', 'config/config.js'),
    ]
    
    uploaded = 0
    failed = 0
    
    for file_entry in files_to_upload:
        relative_path, s3_key = file_entry
        source_file = player_dir / relative_path
        
        if not source_file.exists():
            print(f"  [WARNING] File not found: {source_file}")
            failed += 1
            continue
        
        try:
            # Read file content
            with open(source_file, 'rb') as f:
                content = f.read()
            
            # If it's a diagnostic HTML file and we have an API endpoint, update prediction server URLs
            if s3_key.endswith('.html') and api_endpoint:
                content_str = content.decode('utf-8')
                import re
                
                # Update PREDICTION_SERVER_URL constant (handles both single and double quotes)
                content_str = re.sub(
                    r"const PREDICTION_SERVER_URL = ['\"](https?://[^'\"]+)['\"]",
                    f"const PREDICTION_SERVER_URL = '{api_endpoint}/prediction'",
                    content_str
                )
                
                # Update default input values - replace localhost URLs in value attributes
                # Handles: value="https://localhost:8444/prediction" or value='https://localhost:8444/prediction'
                content_str = re.sub(
                    r'(value=["\'])https?://localhost:\d+/prediction(["\'])',
                    rf'\1{api_endpoint}/prediction\2',
                    content_str
                )
                
                # Update placeholder text - replace localhost URLs in placeholder attributes
                # Handles: placeholder="https://localhost:8444/prediction" or placeholder='https://localhost:8444/prediction'
                content_str = re.sub(
                    r'(placeholder=["\'])https?://localhost:\d+/prediction(["\'])',
                    rf'\1{api_endpoint}/prediction\2',
                    content_str
                )
                
                # Update any other localhost:port references (for microphoneInfo.html and others)
                # This catches localhost:9001, localhost:8444, etc. but preserves paths
                content_str = re.sub(
                    r'https?://localhost:\d+([^"\'>\s]*)',
                    lambda m: f'{api_endpoint}{m.group(1) if m.group(1) else ""}',
                    content_str
                )
                
                # Also update any remaining localhost references without port (fallback)
                content_str = re.sub(
                    r'https?://localhost([^"\'>\s]*)',
                    lambda m: f'{api_endpoint}{m.group(1) if m.group(1) else ""}',
                    content_str
                )
                
                content = content_str.encode('utf-8')
            
            # Determine content type
            if source_file.suffix == '.html':
                content_type = 'text/html'
            elif source_file.suffix == '.js':
                content_type = 'application/javascript'
            else:
                content_type = 'text/plain'
            
            # Upload to S3
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
    
    parser = argparse.ArgumentParser(description='Upload diagnostics client to S3')
    parser.add_argument('--bucket', help='S3 bucket name')
    parser.add_argument('--stack-name', default='diamonddrip-production-diagnostics-frontend', help='CloudFormation stack name')
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
            args.bucket = outputs_dict.get('DiagnosticsClientBucketName')
            if not args.bucket:
                print(f"[ERROR] Could not find DiagnosticsClientBucketName in stack outputs")
                sys.exit(1)
        except Exception as e:
            print(f"[ERROR] Could not get bucket name from stack: {e}")
            sys.exit(1)
    
    # Get API endpoint if not provided (try to get from application stack)
    if not args.api_endpoint:
        cf = boto3.client('cloudformation', region_name=args.region)
        try:
            # Try to get from application stack
            # Stack name format: {project}-{env}-diagnostics-frontend
            # Application stack format: {project}-{env}-application
            stack_parts = args.stack_name.split('-')
            if len(stack_parts) >= 3:
                app_stack_name = f"{stack_parts[0]}-{stack_parts[1]}-application"
                outputs = cf.describe_stacks(StackName=app_stack_name)['Stacks'][0]['Outputs']
                outputs_dict = {o['OutputKey']: o['OutputValue'] for o in outputs}
                args.api_endpoint = outputs_dict.get('ApiEndpoint')
        except:
            pass
    
    # Upload files
    if upload_diagnostics_client(args.bucket, args.region, args.api_endpoint):
        print(f"\n[OK] Diagnostics client uploaded successfully!")
        
        # Invalidate CloudFront if requested
        if args.invalidate:
            cf = boto3.client('cloudformation', region_name=args.region)
            try:
                outputs = cf.describe_stacks(StackName=args.stack_name)['Stacks'][0]['Outputs']
                outputs_dict = {o['OutputKey']: o['OutputValue'] for o in outputs}
                distribution_id = outputs_dict.get('DiagnosticsClientDistributionId')
                if distribution_id:
                    invalidate_cloudfront(distribution_id, args.region)
            except Exception as e:
                print(f"[WARNING] Could not invalidate CloudFront: {e}")
        
        # Get CloudFront URL
        cf = boto3.client('cloudformation', region_name=args.region)
        try:
            outputs = cf.describe_stacks(StackName=args.stack_name)['Stacks'][0]['Outputs']
            outputs_dict = {o['OutputKey']: o['OutputValue'] for o in outputs}
            cloudfront_url = outputs_dict.get('DiagnosticsClientURL')
            if cloudfront_url:
                print(f"\nDiagnostics client available at:")
                print(f"  https://{cloudfront_url}")
        except:
            pass
    else:
        print(f"\n[ERROR] Upload failed")
        sys.exit(1)

if __name__ == '__main__':
    main()

