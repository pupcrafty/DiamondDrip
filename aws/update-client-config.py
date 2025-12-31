#!/usr/bin/env python3
"""
Update client configuration with new API endpoint
"""
import json
import sys
import boto3
from pathlib import Path

def get_api_endpoint(stack_name, region='us-east-1'):
    """Get API endpoint from CloudFormation stack"""
    cf = boto3.client('cloudformation', region_name=region)
    
    try:
        response = cf.describe_stacks(StackName=stack_name)
        outputs = {o['OutputKey']: o['OutputValue'] 
                  for o in response['Stacks'][0]['Outputs']}
        return outputs.get('ApiEndpoint')
    except Exception as e:
        print(f"Error getting stack outputs: {e}")
        return None

def update_client_files(api_endpoint):
    """Update client configuration files with new endpoint"""
    if not api_endpoint:
        print("No API endpoint provided")
        return False
    
    prediction_url = f"{api_endpoint}/predict_phrase"
    
    # Files to update
    files_to_update = [
        '../player/playerClient/js/predictionApi.js',
        '../player/playerClient/js/game.js',  # Keep for backward compatibility
        '../player/diagnostics/predictionCallDiagnostic.html',
    ]
    
    updated = []
    
    for file_path in files_to_update:
        path = Path(file_path)
        if not path.exists():
            print(f"  ⚠ File not found: {file_path}")
            continue
        
        try:
            content = path.read_text(encoding='utf-8')
            
            # Update PREDICTION_SERVER_URL constant
            import re
            old_pattern = r"const PREDICTION_SERVER_URL = ['\"](https?://[^'\"]+)['\"]"
            
            if re.search(old_pattern, content):
                new_content = re.sub(
                    old_pattern,
                    f"const PREDICTION_SERVER_URL = '{prediction_url}'",
                    content
                )
                path.write_text(new_content, encoding='utf-8')
                updated.append(file_path)
                print(f"  SUCCESS: Updated: {file_path}")
            else:
                print(f"  ⚠ Pattern not found in: {file_path}")
        
        except Exception as e:
                print(f"  ERROR: Error updating {file_path}: {e}")
    
    if updated:
        print(f"\nSUCCESS: Updated {len(updated)} file(s)")
        print(f"\nNew endpoint: {prediction_url}")
        return True
    else:
        print("\nERROR: No files were updated")
        return False

def main():
    """Main function"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Update client config with API endpoint')
    parser.add_argument('--stack-name', default='diamonddrip-production',
                       help='CloudFormation stack name')
    parser.add_argument('--endpoint', help='API endpoint URL (overrides stack lookup)')
    parser.add_argument('--region', default='us-east-1', help='AWS region')
    
    args = parser.parse_args()
    
    print("Updating client configuration...")
    
    if args.endpoint:
        api_endpoint = args.endpoint
    else:
        print(f"Getting endpoint from stack: {args.stack_name}")
        api_endpoint = get_api_endpoint(args.stack_name, args.region)
    
    if not api_endpoint:
        print("ERROR: Could not get API endpoint")
        sys.exit(1)
    
    if update_client_files(api_endpoint):
        print("\nSUCCESS: Client configuration updated successfully!")
    else:
        print("\nERROR: Failed to update client configuration")
        sys.exit(1)

if __name__ == '__main__':
    main()




