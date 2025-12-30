"""
AWS Lambda function for DiamondDrip Prediction Server
Handles prediction data via API Gateway
"""
import json
import os
import hashlib
from datetime import datetime
from typing import Dict, Any, Optional

# Import database adapter (will be RDS PostgreSQL)
try:
    from database import PredictionDatabase
except ImportError:
    # Fallback for local testing
    PredictionDatabase = None

# Import boto3 for Secrets Manager (optional)
try:
    import boto3
    SECRETS_MANAGER_AVAILABLE = True
except ImportError:
    SECRETS_MANAGER_AVAILABLE = False

# Initialize database connection (reused across Lambda invocations)
db = None

def get_secrets_manager_credentials(secret_arn: str) -> Optional[Dict[str, str]]:
    """Get database credentials from AWS Secrets Manager"""
    if not SECRETS_MANAGER_AVAILABLE:
        print("Warning: boto3 not available, cannot use Secrets Manager")
        return None
    
    try:
        secrets_client = boto3.client('secretsmanager')
        response = secrets_client.get_secret_value(SecretId=secret_arn)
        secret_string = response['SecretString']
        secret_data = json.loads(secret_string)
        return {
            'user': secret_data.get('username'),
            'password': secret_data.get('password'),
            'database': secret_data.get('database', 'diamonddrip')
        }
    except Exception as e:
        print(f"Warning: Failed to retrieve credentials from Secrets Manager: {e}")
        return None

def get_database():
    """Get or create database connection"""
    global db
    if db is None:
        # Check if PredictionDatabase is available
        if PredictionDatabase is None:
            print("Warning: PredictionDatabase not available (psycopg2 not installed)")
            return None
        
        db_port = os.environ.get('DB_PORT', '5432')
        try:
            db_port = int(db_port)
        except (ValueError, TypeError):
            db_port = 5432  # Default to 5432 if invalid
        
        # Try to get credentials from Secrets Manager first, fallback to environment variables
        db_user = None
        db_password = None
        db_name = os.environ.get('DB_NAME', 'diamonddrip')
        
        secret_arn = os.environ.get('DB_SECRET_ARN')
        if secret_arn:
            print(f"Attempting to retrieve credentials from Secrets Manager: {secret_arn}")
            secret_creds = get_secrets_manager_credentials(secret_arn)
            if secret_creds:
                db_user = secret_creds.get('user')
                db_password = secret_creds.get('password')
                if secret_creds.get('database'):
                    db_name = secret_creds.get('database')
                print("Successfully retrieved credentials from Secrets Manager")
        
        # Fallback to environment variables if Secrets Manager didn't provide credentials
        if not db_user:
            db_user = os.environ.get('DB_USER')
        if not db_password:
            db_password = os.environ.get('DB_PASSWORD')
        
        db_config = {
            'host': os.environ.get('DB_HOST'),
            'port': db_port,
            'database': db_name,
            'user': db_user,
            'password': db_password,
        }
        
        # Check which config values are missing
        missing_config = [key for key, value in db_config.items() if not value]
        if missing_config:
            print(f"Warning: Database configuration incomplete. Missing: {', '.join(missing_config)}")
            print(f"  DB_HOST: {'set' if db_config['host'] else 'NOT SET'}")
            print(f"  DB_PORT: {db_config['port']}")
            print(f"  DB_NAME: {db_config['database']}")
            print(f"  DB_USER: {'set' if db_config['user'] else 'NOT SET'}")
            print(f"  DB_PASSWORD: {'set' if db_config['password'] else 'NOT SET'}")
            print(f"  DB_SECRET_ARN: {'set' if secret_arn else 'NOT SET'}")
            db = None
        else:
            try:
                print(f"Attempting to connect to RDS database: {db_config['host']}:{db_config['port']}/{db_config['database']} as {db_config['user']}")
                # Use longer timeout for VPC connections (10 seconds)
                db = PredictionDatabase(**db_config, connect_timeout=10)
                print("Database connection established successfully")
            except Exception as e:
                import traceback
                print(f"Error connecting to database: {e}")
                print(f"Traceback: {traceback.format_exc()}")
                print("Lambda will continue without database functionality")
                db = None  # Set to None so we don't keep retrying on every invocation
    
    return db

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    AWS Lambda handler for API Gateway requests
    Supports both API Gateway v1 (REST API) and v2 (HTTP API) event structures
    """
    try:
        # Extract HTTP method - supports both v1 and v2
        http_method = event.get('httpMethod')
        if not http_method:
            http_method = event.get('requestContext', {}).get('http', {}).get('method', 'GET')
        
        # Extract path - supports both v1 and v2
        # API Gateway v1 uses 'path', v2 uses 'rawPath'
        path = event.get('rawPath') or event.get('path', '/')
        
        # Strip API Gateway stage prefix if present (e.g., /production, /dev, /staging)
        # The stage is part of the path in the rawPath, so we need to strip it
        # Common stages: production, dev, staging, test, etc.
        path_parts = path.split('/', 2)  # Split into ['', 'stage', 'actual/path'] or ['', 'stage']
        if len(path_parts) >= 2 and path_parts[1] in ['production', 'dev', 'staging', 'test', 'beta', 'alpha']:
            # This is a stage prefix, remove it
            if len(path_parts) >= 3:
                path = '/' + path_parts[2]  # Reconstruct path without stage
            else:
                path = '/'  # Stage root becomes root
        
        # Normalize path (remove trailing slash for consistency, except for root)
        if path != '/' and path.endswith('/'):
            path = path.rstrip('/')
        
        # Debug logging (can be removed in production)
        print(f"Request: {http_method} {path}")
        print(f"Event keys: {list(event.keys())}")
        if 'rawPath' in event:
            print(f"rawPath: {event.get('rawPath')}")
        if 'path' in event:
            print(f"path: {event.get('path')}")
        
        # Handle CORS preflight
        if http_method == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Max-Age': '86400'
                },
                'body': ''
            }
        
        # Route requests (path is already normalized, no trailing slash except root)
        if path == '/prediction':
            if http_method == 'POST':
                return handle_prediction_post(event)
            elif http_method == 'GET':
                return handle_prediction_get()
            else:
                return create_response(405, {'error': 'Method not allowed'})
        
        elif path == '/stats':
            if http_method == 'GET':
                return handle_stats_get()
            else:
                return create_response(405, {'error': 'Method not allowed'})
        
        elif path == '/recent' or path.startswith('/recent'):
            if http_method == 'GET':
                return handle_recent_get(event)
            else:
                return create_response(405, {'error': 'Method not allowed'})
        
        elif path == '/' or path == '/health':
            return handle_health_check()
        
        else:
            # Return 404 with debug info
            return create_response(404, {
                'error': 'Not found',
                'path': path,
                'method': http_method,
                'available_paths': ['/prediction', '/stats', '/recent', '/health', '/']
            })
    
    except Exception as e:
        # Catch any unhandled exceptions to prevent Lambda crashes
        import traceback
        error_msg = str(e)
        traceback_str = traceback.format_exc()
        print(f"Unhandled exception in lambda_handler: {error_msg}")
        print(f"Traceback: {traceback_str}")
        return create_response(500, {
            'error': 'Internal server error',
            'message': error_msg
        })

def handle_prediction_post(event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle POST /prediction requests"""
    try:
        # Parse request body
        if 'body' in event:
            if isinstance(event['body'], str):
                body = json.loads(event['body'])
            else:
                body = event['body']
        else:
            return create_response(400, {'error': 'Missing request body'})
        
        # Get client information
        request_context = event.get('requestContext', {})
        source_ip = request_context.get('identity', {}).get('sourceIp', 'unknown')
        user_agent = event.get('headers', {}).get('User-Agent', event.get('headers', {}).get('user-agent', 'unknown'))
        
        # Extract device type and browser
        device_type, browser = extract_device_info(user_agent)
        
        # Hash IP with device type and browser as salt
        salt_string = f"{source_ip}:{device_type}:{browser}"
        hashed_ip = hashlib.sha256(salt_string.encode('utf-8')).hexdigest()
        
        # Store in database
        server_timestamp = datetime.utcnow().isoformat()
        client_timestamp = body.get('timestamp', 'not provided')
        avg_bpm_last_20s = None
        
        db = get_database()
        if db is not None:
            try:
                db.insert_prediction(client_timestamp, server_timestamp, body, hashed_ip)
                avg_bpm_last_20s, count = db.get_average_bpm_last_20_seconds()
                unique_sources = db.get_unique_sources_last_20_seconds()
                print(f"[{server_timestamp}] Average BPM (last 20s): {avg_bpm_last_20s:.2f if avg_bpm_last_20s else 'N/A'} (from {count} predictions, {unique_sources} unique sources)")
            except Exception as e:
                print(f"[{server_timestamp}] Warning: Failed to store in database: {e}")
        
        # Return success response
        return create_response(200, {
            'status': 'success',
            'server_timestamp': server_timestamp,
            'client_timestamp': client_timestamp,
            'avg_bpm_last_20s': round(avg_bpm_last_20s, 2) if avg_bpm_last_20s is not None else None
        })
    
    except json.JSONDecodeError as e:
        return create_response(400, {'error': 'Invalid JSON', 'details': str(e)})
    except Exception as e:
        print(f"Error handling prediction: {e}")
        return create_response(500, {'error': 'Internal server error', 'details': str(e)})

def handle_prediction_get() -> Dict[str, Any]:
    """Handle GET /prediction requests - returns latest averaged BPM"""
    db = get_database()
    if db is None:
        return create_response(503, {
            'status': 'error',
            'error': 'Database not available',
            'avg_bpm_last_20s': None
        })
    
    try:
        avg_bpm_last_20s, count = db.get_average_bpm_last_20_seconds()
        unique_sources = db.get_unique_sources_last_20_seconds()
        
        return create_response(200, {
            'status': 'ok',
            'service': 'diamonddrip-prediction-server',
            'database': 'connected',
            'avg_bpm_last_20s': round(avg_bpm_last_20s, 2) if avg_bpm_last_20s is not None else None,
            'prediction_count': count,
            'unique_sources': unique_sources
        })
    except Exception as e:
        print(f"Error getting average BPM: {e}")
        return create_response(500, {
            'status': 'error',
            'error': str(e),
            'avg_bpm_last_20s': None
        })

def handle_stats_get() -> Dict[str, Any]:
    """Handle GET /stats requests"""
    db = get_database()
    if db is None:
        return create_response(503, {'error': 'Database not available'})
    
    try:
        stats = db.get_statistics()
        return create_response(200, stats)
    except Exception as e:
        return create_response(500, {'error': str(e)})

def handle_recent_get(event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle GET /recent requests"""
    db = get_database()
    if db is None:
        return create_response(503, {
            'status': 'error',
            'error': 'Database not available',
            'message': 'Database connection not available'
        })
    
    try:
        # Parse query parameters - supports both v1 and v2
        limit = 100
        query_params = event.get('queryStringParameters') or {}
        if query_params:
            limit_param = query_params.get('limit')
            if limit_param:
                try:
                    limit = int(limit_param)
                except ValueError:
                    pass
        
        predictions = db.get_recent_predictions(limit=limit)
        return create_response(200, predictions)
    except Exception as e:
        return create_response(500, {'error': str(e)})

def handle_health_check() -> Dict[str, Any]:
    """Handle health check requests"""
    global db
    db = get_database()
    
    # Test database connection if available
    database_status = 'not available'
    if db is not None:
        try:
            # Test connection by executing a simple query
            with db.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute('SELECT 1')
                    cursor.fetchone()
            database_status = 'connected'
        except Exception as e:
            print(f"Health check: Database connection test failed: {e}")
            database_status = f'connection failed: {str(e)}'
            # Reset db to None so it will retry on next invocation
            db = None
    
    return create_response(200, {
        'status': 'ok',
        'service': 'diamonddrip-prediction-server',
        'database': database_status
    })

def extract_device_info(user_agent: str) -> tuple:
    """Extract device type and browser from User-Agent"""
    user_agent_lower = user_agent.lower()
    
    # Detect device type
    if 'mobile' in user_agent_lower or 'android' in user_agent_lower or 'iphone' in user_agent_lower or 'ipod' in user_agent_lower:
        device_type = 'mobile'
    elif 'tablet' in user_agent_lower or 'ipad' in user_agent_lower:
        device_type = 'tablet'
    elif 'tv' in user_agent_lower or 'smart-tv' in user_agent_lower:
        device_type = 'tv'
    else:
        device_type = 'desktop'
    
    # Detect browser
    if 'chrome' in user_agent_lower and 'edg' not in user_agent_lower:
        browser = 'chrome'
    elif 'firefox' in user_agent_lower:
        browser = 'firefox'
    elif 'safari' in user_agent_lower and 'chrome' not in user_agent_lower:
        browser = 'safari'
    elif 'edg' in user_agent_lower:
        browser = 'edge'
    elif 'opera' in user_agent_lower or 'opr' in user_agent_lower:
        browser = 'opera'
    elif 'msie' in user_agent_lower or 'trident' in user_agent_lower:
        browser = 'ie'
    else:
        browser = 'unknown'
    
    return device_type, browser

def create_response(status_code: int, body: Any, headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Create a standardized API Gateway response"""
    response_headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    }
    
    if headers:
        response_headers.update(headers)
    
    return {
        'statusCode': status_code,
        'headers': response_headers,
        'body': json.dumps(body) if not isinstance(body, str) else body
    }



