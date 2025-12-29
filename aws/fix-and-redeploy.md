# Fixing the Failed Stack

The stack failed because PostgreSQL version 15.4 is not available in your region.

## Solution

1. **Delete the failed stack first:**
   ```bash
   aws cloudformation delete-stack --stack-name diamonddrip-production --region us-east-1
   ```
   
   Wait for it to delete (check with):
   ```bash
   aws cloudformation describe-stacks --stack-name diamonddrip-production --region us-east-1
   ```

2. **The template has been updated** to use PostgreSQL 15.2 (or remove EngineVersion to use default)

3. **Redeploy:**
   ```bash
   python deploy-windows.py
   ```

## Alternative: Use Default Version

If you want to use the default PostgreSQL version for your region, you can remove the EngineVersion line from infrastructure.yaml:

```yaml
Engine: postgres
# EngineVersion: '15.2'  # Remove this line
```

This will use the latest available version automatically.

