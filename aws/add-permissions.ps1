# PowerShell script to add required IAM permissions
# Run this script to add the necessary permissions to your IAM user

$policyDocument = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Effect = "Allow"
            Action = @(
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
            )
            Resource = @(
                "arn:aws:iam::*:role/diamonddrip-*"
            )
        },
        @{
            Effect = "Allow"
            Action = @(
                "cloudformation:*",
                "ec2:*",
                "rds:*",
                "lambda:*",
                "apigateway:*",
                "logs:*",
                "secretsmanager:*"
            )
            Resource = "*"
        }
    )
} | ConvertTo-Json -Depth 10

Write-Host "IAM Policy Document:" -ForegroundColor Cyan
Write-Host $policyDocument
Write-Host ""

Write-Host "To apply this policy:" -ForegroundColor Yellow
Write-Host "1. Go to AWS IAM Console" -ForegroundColor White
Write-Host "2. Navigate to Users -> diamondDripper" -ForegroundColor White
Write-Host "3. Click 'Add permissions' -> 'Create inline policy'" -ForegroundColor White
Write-Host "4. Select JSON tab and paste the policy above" -ForegroundColor White
Write-Host "5. Name it 'DiamondDripDeploymentPolicy' and create" -ForegroundColor White
Write-Host ""
Write-Host "Or use AWS CLI:" -ForegroundColor Yellow
Write-Host "aws iam put-user-policy --user-name diamondDripper --policy-name DiamondDripDeploymentPolicy --policy-document file://policy.json" -ForegroundColor White

# Save policy to file
$policyDocument | Out-File -FilePath "diamonddrip-policy.json" -Encoding UTF8
Write-Host ""
Write-Host "Policy saved to: diamonddrip-policy.json" -ForegroundColor Green

