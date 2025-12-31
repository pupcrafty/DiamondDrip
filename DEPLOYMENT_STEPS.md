# Deployment Steps for Sustained Pulse Duration Data

This guide covers deploying the changes that add sustained pulse duration data (actuals and predicted) to the backend service and database.

## Summary of Changes

1. **Frontend**: Updated `player/playerClient/js/game.js` to send duration data
2. **Backend (AWS Lambda)**: Updated `aws/database.py` with new columns and migration code
3. **Backend (Local)**: Updated `synchronizer/prediction_server.py` for local development

## Deployment Steps

### 1. Deploy Backend Lambda Function (Database Changes)

The database schema changes include automatic migration code that will add the new columns when the Lambda function runs.

**Steps:**

```bash
cd aws

# Upload updated Lambda code (includes database.py changes)
python upload-lambda-code.py --stack-name diamonddrip-production-application
```

**What this does:**
- Packages `lambda_function.py` and `database.py` with dependencies
- Uploads to AWS Lambda
- The next time Lambda runs, `init_database()` will automatically add the new columns:
  - `recent_pulse_durations`
  - `recent_correct_prediction_durations`
  - `current_prediction_durations`

**Note:** The migration code runs automatically on the next Lambda invocation. No manual database migration is needed.

### 2. Deploy Frontend Client

Upload the updated `game.js` file to S3:

```bash
cd aws

# Upload player client files (includes updated game.js)
python upload-player-client.py --stack-name diamonddrip-production-frontend --invalidate
```

**What this does:**
- Uploads all player client files to S3
- Updates `js/game.js` with duration data sending code
- Invalidates CloudFront cache (so users get the new version)
- Auto-increments version number

### 3. Local Development (Synchronizer Server)

If you're running the local synchronizer server for development, just restart it:

```bash
cd synchronizer
python prediction_server.py
```

**What this does:**
- The updated schema code will automatically add the new columns to your local SQLite database
- No manual migration needed - happens on first run after update

## Verification Steps

### Verify Frontend is Sending Duration Data

1. Open browser DevTools (F12)
2. Go to Network tab
3. Filter for "prediction" requests
4. Check the request payload - it should now include:
   - `recentPulseDurations`
   - `recentCorrectPredictionDurations`
   - `currentPredictionDurations`

### Verify Backend is Storing Duration Data

You can check the database directly or use the viewer:

1. **Using AWS RDS:**
   ```sql
   SELECT 
       id,
       client_timestamp,
       recent_pulse_durations,
       recent_correct_prediction_durations,
       current_prediction_durations
   FROM predictions
   ORDER BY created_at DESC
   LIMIT 5;
   ```

2. **Using the viewer.html** (if deployed):
   - Navigate to the CloudFront URL
   - Access `/viewer.html`
   - Check that duration data appears in recent predictions

## Deployment Order

**Recommended order:**

1. **Backend first** (Lambda) - Deploy database changes
2. **Frontend second** - Deploy client changes
3. **Verify** - Check that data is flowing correctly

This order ensures the backend is ready to receive the new data fields before the frontend starts sending them.

## Rollback Plan

If you need to rollback:

1. **Frontend**: Revert `game.js` to previous version and redeploy
2. **Backend**: The database columns are nullable, so old code will continue to work even if new columns exist
3. **Database**: Columns can be left in place (they won't cause issues)

## Troubleshooting

### Lambda deployment fails
- Check CloudWatch Logs for Lambda execution errors
- Verify database connection is working
- Ensure RDS security groups allow Lambda connections

### Frontend not sending duration data
- Check browser console for JavaScript errors
- Verify `game.js` was uploaded correctly
- Clear CloudFront cache: `python upload-player-client.py --invalidate`

### Database columns not appearing
- Check Lambda logs to see if `init_database()` ran successfully
- Verify migration code executed (check CloudWatch Logs)
- Manually run migration if needed (see database.py for SQL)

## Files Changed

- ✅ `player/playerClient/js/game.js` - Sends duration data
- ✅ `aws/database.py` - Schema and insert method updated
- ✅ `synchronizer/prediction_server.py` - Local server updated

## Quick Command Reference

```bash
# Deploy everything (in order)
cd aws

# 1. Deploy Lambda (backend)
python upload-lambda-code.py --stack-name diamonddrip-production-application

# 2. Deploy Frontend
python upload-player-client.py --stack-name diamonddrip-production-frontend --invalidate

# Check endpoints
python get-endpoints.py
```




