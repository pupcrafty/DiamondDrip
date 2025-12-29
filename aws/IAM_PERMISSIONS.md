# Required IAM Permissions for Deployment

Your IAM user `diamondDripper` needs additional permissions to create the CloudFormation stack.

## Required Permissions

The deployment needs permissions to:
- Create IAM roles and policies
- Create VPC, subnets, security groups
- Create RDS databases
- Create Lambda functions
- Create API Gateway
- Tag resources

## Solution Options

### Option 1: Add IAM Permissions to Your User (Recommended)

Attach this policy to your IAM user:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "iam:CreateRole",
                "iam:DeleteRole",
                "iam:GetRole",
                "iam:PassRole",
                "iam:AttachRolePolicy",
                "iam:DetachRolePolicy",
                "iam:PutRolePolicy",
                "iam:DeleteRolePolicy",
                "iam:GetRolePolicy",
                "iam:ListRolePolicies",
                "iam:ListAttachedRolePolicies",
                "iam:TagRole",
                "iam:UntagRole",
                "iam:ListRoleTags"
            ],
            "Resource": [
                "arn:aws:iam::*:role/diamonddrip-*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "cloudformation:*",
                "ec2:*",
                "rds:*",
                "lambda:*",
                "apigateway:*",
                "logs:*",
                "secretsmanager:*"
            ],
            "Resource": "*"
        }
    ]
}
```

### Option 2: Use AWS Managed Policy (Easier but Broader)

Attach the `PowerUserAccess` managed policy to your user (less secure but easier):

1. Go to IAM Console → Users → diamondDripper
2. Click "Add permissions" → "Attach policies directly"
3. Search for and attach: `PowerUserAccess`

**Note:** PowerUserAccess doesn't include IAM permissions, so you'll still need to add IAM permissions separately.

### Option 3: Use an Admin User/Role (For Testing)

For initial deployment/testing, you could temporarily use an admin user, then switch back.

## How to Add Permissions

### Via AWS Console:

1. Go to **IAM Console** → **Users** → **diamondDripper**
2. Click **"Add permissions"** → **"Create inline policy"**
3. Click **"JSON"** tab
4. Paste the policy from Option 1 above
5. Click **"Next"** → Name it `DiamondDripDeploymentPolicy`
6. Click **"Create policy"**

### Via AWS CLI:

```bash
# Create policy file
cat > diamonddrip-policy.json << 'EOF'
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "iam:CreateRole",
                "iam:DeleteRole",
                "iam:GetRole",
                "iam:PassRole",
                "iam:AttachRolePolicy",
                "iam:DetachRolePolicy",
                "iam:PutRolePolicy",
                "iam:DeleteRolePolicy",
                "iam:GetRolePolicy",
                "iam:ListRolePolicies",
                "iam:ListAttachedRolePolicies",
                "iam:TagRole",
                "iam:UntagRole",
                "iam:ListRoleTags"
            ],
            "Resource": [
                "arn:aws:iam::143842728536:role/diamonddrip-*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "cloudformation:*",
                "ec2:*",
                "rds:*",
                "lambda:*",
                "apigateway:*",
                "logs:*",
                "secretsmanager:*"
            ],
            "Resource": "*"
        }
    ]
}
EOF

# Attach to user
aws iam put-user-policy \
    --user-name diamondDripper \
    --policy-name DiamondDripDeploymentPolicy \
    --policy-document file://diamonddrip-policy.json
```

## Verify Permissions

After adding permissions, verify with:

```bash
aws iam get-user-policy --user-name diamondDripper --policy-name DiamondDripDeploymentPolicy
```

## After Adding Permissions

1. Delete the failed stack:
   ```bash
   python cleanup-and-redeploy.py
   ```

2. Redeploy:
   ```bash
   python deploy-windows.py
   ```

## Security Note

The policy above is scoped to only create roles with names starting with `diamonddrip-*`. This is more secure than allowing all IAM operations.

