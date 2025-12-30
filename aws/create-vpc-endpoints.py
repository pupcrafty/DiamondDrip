#!/usr/bin/env python3
"""
Create VPC endpoints for CloudWatch Logs and Secrets Manager.

This script creates VPC endpoints to allow Lambda functions in a VPC
to access AWS services without requiring a NAT Gateway or internet access.

Usage:
    python create-vpc-endpoints.py
    python create-vpc-endpoints.py --project diamonddrip --env production --region us-east-1
"""

import argparse
import boto3
import sys
from botocore.exceptions import ClientError


def get_stack_outputs(cloudformation, stack_name):
    """Get outputs from a CloudFormation stack."""
    try:
        response = cloudformation.describe_stacks(StackName=stack_name)
        stack = response['Stacks'][0]
        outputs = {output['OutputKey']: output['OutputValue'] 
                   for output in stack.get('Outputs', [])}
        return outputs
    except ClientError as e:
        print(f"Error getting stack outputs: {e}")
        return None


def get_vpc_endpoint_security_group(ec2, vpc_id, project, env):
    """Get or create security group for VPC endpoints."""
    sg_name = f"{project}-{env}-vpc-endpoint-sg"
    
    # Try to find existing security group
    try:
        response = ec2.describe_security_groups(
            Filters=[
                {'Name': 'vpc-id', 'Values': [vpc_id]},
                {'Name': 'group-name', 'Values': [sg_name]}
            ]
        )
        if response['SecurityGroups']:
            return response['SecurityGroups'][0]['GroupId']
    except ClientError as e:
        print(f"Error checking for existing security group: {e}")
    
    # Create new security group
    try:
        # Get Lambda security group ID
        lambda_sg_name = f"{project}-{env}-lambda-sg"
        lambda_sg_response = ec2.describe_security_groups(
            Filters=[
                {'Name': 'vpc-id', 'Values': [vpc_id]},
                {'Name': 'group-name', 'Values': [lambda_sg_name]}
            ]
        )
        
        if not lambda_sg_response['SecurityGroups']:
            print(f"Error: Lambda security group '{lambda_sg_name}' not found")
            return None
        
        lambda_sg_id = lambda_sg_response['SecurityGroups'][0]['GroupId']
        
        # Create VPC endpoint security group
        response = ec2.create_security_group(
            GroupName=sg_name,
            Description='Security group for VPC endpoints',
            VpcId=vpc_id
        )
        sg_id = response['GroupId']
        
        # Add ingress rule to allow HTTPS from Lambda
        ec2.authorize_security_group_ingress(
            GroupId=sg_id,
            IpPermissions=[
                {
                    'IpProtocol': 'tcp',
                    'FromPort': 443,
                    'ToPort': 443,
                    'UserIdGroupPairs': [{'GroupId': lambda_sg_id}]
                }
            ]
        )
        
        print(f"Created security group: {sg_id}")
        return sg_id
    except ClientError as e:
        if e.response['Error']['Code'] == 'InvalidGroup.Duplicate':
            # Security group already exists, find it
            response = ec2.describe_security_groups(
                Filters=[
                    {'Name': 'vpc-id', 'Values': [vpc_id]},
                    {'Name': 'group-name', 'Values': [sg_name]}
                ]
            )
            if response['SecurityGroups']:
                return response['SecurityGroups'][0]['GroupId']
        print(f"Error creating security group: {e}")
        return None


def create_vpc_endpoint(ec2, vpc_id, service_name, subnet_ids, security_group_ids, endpoint_name):
    """Create a VPC endpoint."""
    try:
        # Check if endpoint already exists
        response = ec2.describe_vpc_endpoints(
            Filters=[
                {'Name': 'vpc-id', 'Values': [vpc_id]},
                {'Name': 'service-name', 'Values': [service_name]}
            ]
        )
        
        if response['VpcEndpoints']:
            endpoint_id = response['VpcEndpoints'][0]['VpcEndpointId']
            state = response['VpcEndpoints'][0]['State']
            print(f"VPC endpoint for {service_name} already exists: {endpoint_id} (state: {state})")
            return endpoint_id
        
        # Create new endpoint
        response = ec2.create_vpc_endpoint(
            VpcId=vpc_id,
            ServiceName=service_name,
            VpcEndpointType='Interface',
            SubnetIds=subnet_ids,
            SecurityGroupIds=security_group_ids,
            PrivateDnsEnabled=True,
            TagSpecifications=[
                {
                    'ResourceType': 'vpc-endpoint',
                    'Tags': [
                        {'Key': 'Name', 'Value': endpoint_name}
                    ]
                }
            ]
        )
        
        endpoint_id = response['VpcEndpoint']['VpcEndpointId']
        print(f"Creating VPC endpoint for {service_name}: {endpoint_id}")
        print(f"  State: {response['VpcEndpoint']['State']}")
        return endpoint_id
        
    except ClientError as e:
        print(f"Error creating VPC endpoint for {service_name}: {e}")
        return None


def main():
    parser = argparse.ArgumentParser(
        description='Create VPC endpoints for CloudWatch Logs and Secrets Manager'
    )
    parser.add_argument('--project', '-p', default='diamonddrip',
                       help='Project name (default: diamonddrip)')
    parser.add_argument('--env', '-e', default='production',
                       choices=['development', 'staging', 'production'],
                       help='Environment (default: production)')
    parser.add_argument('--region', '-r', default='us-east-1',
                       help='AWS region (default: us-east-1)')
    parser.add_argument('--vpc-id', help='VPC ID (auto-detected from stack if not provided)')
    parser.add_argument('--subnet-ids', nargs='+',
                       help='Subnet IDs (auto-detected from stack if not provided)')
    parser.add_argument('--security-group-id',
                       help='Security group ID for endpoints (auto-created if not provided)')
    
    args = parser.parse_args()
    
    # Initialize AWS clients
    session = boto3.Session(region_name=args.region)
    ec2 = session.client('ec2')
    cloudformation = session.client('cloudformation')
    
    stack_name = f"{args.project}-{args.env}-network"
    
    # Get VPC and subnet IDs from CloudFormation stack
    if not args.vpc_id or not args.subnet_ids:
        print(f"Getting network information from stack: {stack_name}")
        outputs = get_stack_outputs(cloudformation, stack_name)
        
        if not outputs:
            print(f"Error: Could not get outputs from stack {stack_name}")
            print("Please provide --vpc-id and --subnet-ids manually")
            sys.exit(1)
        
        vpc_id = args.vpc_id or outputs.get('VPCId')
        subnet1_id = outputs.get('PrivateSubnet1Id')
        subnet2_id = outputs.get('PrivateSubnet2Id')
        
        if not vpc_id:
            print("Error: VPC ID not found in stack outputs")
            sys.exit(1)
        
        if not subnet1_id or not subnet2_id:
            print("Error: Subnet IDs not found in stack outputs")
            sys.exit(1)
        
        subnet_ids = args.subnet_ids or [subnet1_id, subnet2_id]
    else:
        vpc_id = args.vpc_id
        subnet_ids = args.subnet_ids
    
    print(f"\nVPC ID: {vpc_id}")
    print(f"Subnet IDs: {', '.join(subnet_ids)}")
    
    # Get or create security group for VPC endpoints
    if args.security_group_id:
        security_group_ids = [args.security_group_id]
    else:
        sg_id = get_vpc_endpoint_security_group(ec2, vpc_id, args.project, args.env)
        if not sg_id:
            print("Error: Could not get or create security group")
            sys.exit(1)
        security_group_ids = [sg_id]
    
    print(f"Security Group IDs: {', '.join(security_group_ids)}")
    
    # Create VPC endpoints
    print("\n" + "="*60)
    print("Creating VPC Endpoints")
    print("="*60)
    
    region = args.region
    
    # CloudWatch Logs endpoint
    logs_service = f"com.amazonaws.{region}.logs"
    logs_endpoint_name = f"{args.project}-{args.env}-logs-vpc-endpoint"
    logs_endpoint_id = create_vpc_endpoint(
        ec2, vpc_id, logs_service, subnet_ids, security_group_ids, logs_endpoint_name
    )
    
    # Secrets Manager endpoint
    secrets_service = f"com.amazonaws.{region}.secretsmanager"
    secrets_endpoint_name = f"{args.project}-{args.env}-secretsmanager-vpc-endpoint"
    secrets_endpoint_id = create_vpc_endpoint(
        ec2, vpc_id, secrets_service, subnet_ids, security_group_ids, secrets_endpoint_name
    )
    
    print("\n" + "="*60)
    print("Summary")
    print("="*60)
    
    if logs_endpoint_id:
        print(f"✓ CloudWatch Logs VPC Endpoint: {logs_endpoint_id}")
    else:
        print("✗ Failed to create CloudWatch Logs VPC Endpoint")
    
    if secrets_endpoint_id:
        print(f"✓ Secrets Manager VPC Endpoint: {secrets_endpoint_id}")
    else:
        print("✗ Failed to create Secrets Manager VPC Endpoint")
    
    if logs_endpoint_id and secrets_endpoint_id:
        print("\n✓ VPC endpoints created successfully!")
        print("\nNote: It may take a few minutes for the endpoints to become available.")
        print("Your Lambda function should now be able to access CloudWatch Logs and Secrets Manager.")
    else:
        print("\n⚠ Some endpoints failed to create. Please check the errors above.")
        sys.exit(1)


if __name__ == '__main__':
    main()

