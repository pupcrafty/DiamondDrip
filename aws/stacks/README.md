# DiamondDrip Multi-Stack Infrastructure

The infrastructure has been split into 4 smaller, modular stacks for better management, faster rollbacks, and easier updates.

## Stack Architecture

### 1. Network Stack (`network.yaml`)
**Deployment Order: 1**

Contains:
- VPC, Subnets (Public & Private)
- Internet Gateway, NAT Gateway
- Route Tables
- Security Groups (Lambda & Database)

**Exports:**
- VPC ID
- Subnet IDs
- Security Group IDs

**Dependencies:** None (base stack)

### 2. Database Stack (`database.yaml`)
**Deployment Order: 2**

Contains:
- RDS PostgreSQL Instance
- DB Subnet Group
- Secrets Manager Secret (optional)

**Exports:**
- Database Endpoint
- Database Port
- Database Secret ARN

**Dependencies:** Network Stack (imports VPC, subnets, security groups)

### 3. Application Stack (`application.yaml`)
**Deployment Order: 3**

Contains:
- Lambda Function
- API Gateway (HTTP API)
- IAM Roles & Policies

**Exports:**
- API Endpoint URL
- Lambda Function Name

**Dependencies:** 
- Network Stack (imports VPC, subnets, security groups)
- Database Stack (imports DB endpoint, port, secret)

### 4. Frontend Stack (`frontend.yaml`)
**Deployment Order: 4**

Contains:
- S3 Bucket
- CloudFront Distribution

**Exports:**
- S3 Bucket Name
- CloudFront URL
- CloudFront Distribution ID

**Dependencies:** None (independent)

## Deployment

### Deploy All Stacks

```bash
cd aws
python deploy-stacks.py
```

Or with environment variables:

```bash
export PROJECT_NAME=diamonddrip
export ENVIRONMENT=production
export AWS_REGION=us-east-1
python deploy-stacks.py
```

### Deploy Individual Stacks

```bash
# Network
aws cloudformation deploy \
    --template-file stacks/network.yaml \
    --stack-name diamonddrip-production-network \
    --parameter-overrides ProjectName=diamonddrip Environment=production

# Database
aws cloudformation deploy \
    --template-file stacks/database.yaml \
    --stack-name diamonddrip-production-database \
    --parameter-overrides \
        ProjectName=diamonddrip \
        Environment=production \
        DatabaseMasterUsername=diamonddrip_admin \
        DatabaseMasterPassword=YourPassword123

# Application
aws cloudformation deploy \
    --template-file stacks/application.yaml \
    --stack-name diamonddrip-production-application \
    --parameter-overrides \
        ProjectName=diamonddrip \
        Environment=production \
        DatabaseMasterUsername=diamonddrip_admin \
        DatabaseMasterPassword=YourPassword123 \
    --capabilities CAPABILITY_NAMED_IAM

# Frontend
aws cloudformation deploy \
    --template-file stacks/frontend.yaml \
    --stack-name diamonddrip-production-frontend \
    --parameter-overrides ProjectName=diamonddrip Environment=production
```

## Cleanup

### Delete All Stacks

```bash
cd aws
python cleanup-stacks.py
```

Stacks are deleted in reverse order:
1. Frontend
2. Application
3. Database
4. Network

### Delete Individual Stacks

```bash
aws cloudformation delete-stack --stack-name diamonddrip-production-frontend
aws cloudformation delete-stack --stack-name diamonddrip-production-application
aws cloudformation delete-stack --stack-name diamonddrip-production-database
aws cloudformation delete-stack --stack-name diamonddrip-production-network
```

## Benefits of Multi-Stack Architecture

### 1. Faster Rollbacks
- If Application stack fails, only Application rolls back
- Network and Database remain intact
- Much faster than rolling back entire infrastructure

### 2. Independent Updates
- Update Application without touching Database
- Update Frontend without affecting backend
- Update Network only when needed

### 3. Better Resource Management
- Smaller stacks = faster CloudFormation operations
- Easier to debug specific components
- Can delete/recreate individual stacks

### 4. Cost Optimization
- Can delete Frontend stack without affecting backend
- Can scale Database independently
- Better resource isolation

## Stack Dependencies

```
Network (Base)
    ↓
    ├──→ Database
    │       ↓
    │       └──→ Application
    │
    └──→ Application

Frontend (Independent)
```

## Cross-Stack References

Stacks use CloudFormation **Exports** and **Imports** to share values:

- Network exports: VPC ID, Subnet IDs, Security Group IDs
- Database exports: DB Endpoint, Port, Secret ARN
- Application imports: All of the above
- Frontend: Independent (no imports)

## Migration from Single Stack

If you have an existing single-stack deployment:

1. **Export outputs** from existing stack
2. **Create new stacks** with same values
3. **Verify** everything works
4. **Delete old stack** once confirmed

Or use the cleanup script to remove old stack first, then deploy new stacks.

## Troubleshooting

### Stack Import Errors
If you see "Export not found" errors:
- Ensure Network stack is deployed first
- Check export names match exactly
- Verify stack names match your parameters

### Dependency Issues
- Always deploy in order: Network → Database → Application → Frontend
- Always delete in reverse order: Frontend → Application → Database → Network

### Rollback Issues
- If one stack fails, only that stack rolls back
- Other stacks remain intact
- Fix the issue and redeploy just that stack


