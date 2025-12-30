# CloudFormation Rollback Behavior

## Default Behavior

**Yes, by default CloudFormation automatically rolls back the entire stack if any resource creation fails.**

### Stack Creation (CREATE)
- **If ANY resource fails to create** → CloudFormation automatically deletes all successfully created resources
- Stack ends in `ROLLBACK_COMPLETE` state
- You can then fix the issue and try again

### Stack Update (UPDATE)
- **If ANY resource fails to update** → CloudFormation attempts to roll back to previous state
- Stack may end in `UPDATE_ROLLBACK_COMPLETE` or `UPDATE_ROLLBACK_FAILED`
- Successfully updated resources are rolled back

## Rollback Options

### Option 1: Automatic Rollback (Default - Recommended)
```bash
aws cloudformation create-stack \
    --stack-name my-stack \
    --template-body file://infrastructure.yaml \
    --disable-rollback false  # This is the default
```

**Pros:**
- Prevents partial deployments
- Keeps your account clean
- No orphaned resources

**Cons:**
- Must recreate everything if one thing fails
- Can be slow for large stacks

### Option 2: Disable Automatic Rollback
```bash
aws cloudformation create-stack \
    --stack-name my-stack \
    --template-body file://infrastructure.yaml \
    --disable-rollback true  # Keep resources even if creation fails
```

**Pros:**
- Can debug failed resources
- Keep successfully created resources
- Faster to retry (don't recreate everything)

**Cons:**
- Leaves orphaned resources
- Can cause conflicts on retry
- Manual cleanup required
- **Not recommended for production**

### Option 3: Retain Resources on Failure (Per Resource)
You can set `DeletionPolicy: Retain` on specific resources in your template:

```yaml
Resources:
  Database:
    Type: AWS::RDS::DBInstance
    DeletionPolicy: Retain  # Keep this even if stack is deleted
    Properties:
      # ...
```

**Use cases:**
- Critical data (databases)
- Expensive resources you want to keep
- Resources that take a long time to create

## Current Infrastructure Behavior

Your `infrastructure.yaml` has:
- **Database**: `DeletionPolicy: Snapshot` - Creates snapshot before deletion
- **All other resources**: Default deletion policy (deleted on rollback)

This means:
- If Database creation fails → Everything rolls back, Database snapshot is created
- If Lambda creation fails → Everything rolls back, Database is deleted (with snapshot)
- If API Gateway creation fails → Everything rolls back

## Best Practices

### 1. Use Smaller Stacks
Break large stacks into smaller ones:
- **Network stack** (VPC, subnets, etc.)
- **Database stack** (RDS)
- **Application stack** (Lambda, API Gateway)
- **Frontend stack** (S3, CloudFront)

**Benefits:**
- Faster rollbacks
- Can update one stack without affecting others
- Easier to debug

### 2. Use Change Sets
Preview changes before applying:
```bash
aws cloudformation create-change-set \
    --stack-name my-stack \
    --template-body file://infrastructure.yaml \
    --change-set-name my-changes

# Review changes
aws cloudformation describe-change-set \
    --stack-name my-stack \
    --change-set-name my-changes

# Apply if OK
aws cloudformation execute-change-set \
    --stack-name my-stack \
    --change-set-name my-changes
```

### 3. Test in Dev First
Always test infrastructure changes in a development environment before production.

### 4. Use Stack Policies
Protect critical resources from accidental updates:
```json
{
  "Statement": [
    {
      "Effect": "Deny",
      "Action": "Update:Replace",
      "Principal": "*",
      "Resource": "LogicalResourceId/Database"
    }
  ]
}
```

### 5. Monitor Stack Events
Watch stack events in real-time to catch failures early:
```bash
aws cloudformation describe-stack-events \
    --stack-name my-stack \
    --max-items 10
```

## Handling Failures

### If Rollback Fails (ROLLBACK_FAILED)
1. **Continue rollback:**
   ```bash
   aws cloudformation continue-update-rollback \
       --stack-name my-stack
   ```

2. **Skip blocking resources:**
   ```bash
   aws cloudformation continue-update-rollback \
       --stack-name my-stack \
       --resources-to-skip Database
   ```

3. **Use the fix script:**
   ```bash
   python aws/fix-rollback-failed.py my-stack
   ```

### If You Want to Keep Partial Resources
1. **Disable rollback before creating:**
   ```bash
   aws cloudformation create-stack \
       --stack-name my-stack \
       --template-body file://infrastructure.yaml \
       --disable-rollback true
   ```

2. **Manually fix failed resources**

3. **Update the stack** (CloudFormation will skip already-created resources)

## Recommendations for Your Project

**For DiamondDrip, I recommend:**

1. **Keep automatic rollback enabled** (default) - Prevents orphaned resources
2. **Use DeletionPolicy: Snapshot for Database** - Already configured ✓
3. **Break into smaller stacks** if deployment time becomes an issue:
   - Core infrastructure (VPC, RDS)
   - Application (Lambda, API Gateway)
   - Frontend (S3, CloudFront)
4. **Test in dev/staging first** before production
5. **Use change sets** for production updates

## Summary

- **Default**: Yes, entire stack rolls back on any failure
- **You can disable**: But not recommended
- **Best practice**: Keep rollback enabled, use smaller stacks, test first
- **Your current setup**: Good - Database has snapshot protection



