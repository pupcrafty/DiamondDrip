"""
AWS Lambda function for DiamondDrip Prediction Server
Handles prediction data via API Gateway
"""
print("[LAMBDA_INIT] Starting Lambda function module initialization...")
import json
import os
import hashlib
import threading
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional, List, Tuple
print("[LAMBDA_INIT] Standard library imports complete")

# Import database adapter (will be RDS PostgreSQL)
try:
    from database import PredictionDatabase
except ImportError:
    # Fallback for local testing
    PredictionDatabase = None

# Import prediction engine
try:
    from prediction_api import PredictionAPI
    from prediction_engine import PredictionMode
    PREDICTION_ENGINE_AVAILABLE = True
    print("Successfully imported prediction engine modules")
except ImportError as e:
    import traceback
    error_msg = str(e)
    traceback_str = traceback.format_exc()
    print(f"ERROR: Prediction engine import failed: {error_msg}")
    print(f"Traceback: {traceback_str}")
    PREDICTION_ENGINE_AVAILABLE = False
    PredictionAPI = None
    PredictionMode = None
except Exception as e:
    import traceback
    error_msg = str(e)
    traceback_str = traceback.format_exc()
    print(f"ERROR: Unexpected error importing prediction engine: {error_msg}")
    print(f"Traceback: {traceback_str}")
    PREDICTION_ENGINE_AVAILABLE = False
    PredictionAPI = None
    PredictionMode = None

# Import boto3 for Secrets Manager (optional)
try:
    import boto3
    SECRETS_MANAGER_AVAILABLE = True
except ImportError:
    SECRETS_MANAGER_AVAILABLE = False

# Initialize database connection (reused across Lambda invocations)
db = None

# Initialize prediction API (reused across Lambda invocations)
prediction_api = None

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

def get_prediction_api():
    """Get or create prediction API instance"""
    global prediction_api
    if prediction_api is None and PREDICTION_ENGINE_AVAILABLE:
        db = get_database()
        # Use bootstrap mode by default (faster, uses slot priors from DB)
        prediction_api = PredictionAPI(
            database=db,
            initial_bpm=120.0,
            mode=PredictionMode.BOOTSTRAP,
            enable_async_training=False
        )
        print("Prediction API initialized")
    return prediction_api

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
        
        elif path == '/sources':
            if http_method == 'GET':
                return handle_sources_get()
            else:
                return create_response(405, {'error': 'Method not allowed'})
        
        elif path == '/predict_phrase':
            if http_method == 'POST':
                return handle_predict_phrase_post(event)
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
                'available_paths': ['/prediction', '/predict_phrase', '/stats', '/recent', '/health', '/']
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

def extract_pulses_from_patterns(body: Dict[str, Any], client_timestamp_str: str, source_id: Optional[int] = None) -> List[Tuple[int, float, datetime, Optional[int]]]:
    """Extract pulse timestamps from ACTUAL patterns only (not predictions)
    
    This function processes only actual measured pulse data for use in server-side
    prediction analysis. It does NOT process any predicted patterns.
    
    Actual data sources:
    - recentPulsePatterns: Actual pulse patterns that occurred
    - recentPulseDurations: Actual sustained beat durations
    
    NOT processed (predictions):
    - currentPrediction: Predicted future pattern (ignored)
    - currentPredictionDurations: Predicted durations (ignored)
    
    Args:
        body: Request body containing prediction data
        client_timestamp_str: Client timestamp as ISO string
        source_id: Source ID from sources table (required)
    
    Returns:
        List of tuples (source_id, bpm, pulse_timestamp, duration_ms) where timestamp is UTC
    """
    pulses = []
    
    if source_id is None:
        print("Warning: source_id is required for pulse extraction")
        return pulses
    
    try:
        # Parse client timestamp
        try:
            # Handle various timestamp formats
            ts_str = client_timestamp_str.replace('Z', '+00:00')
            if '+' not in ts_str and ':' in ts_str and ts_str.count('-') >= 3:
                # Likely missing timezone, assume UTC
                ts_str += '+00:00'
            client_timestamp = datetime.fromisoformat(ts_str)
            # Convert to naive UTC datetime
            if client_timestamp.tzinfo is not None:
                client_timestamp = client_timestamp.astimezone(timezone.utc).replace(tzinfo=None)
        except Exception as e:
            print(f"Warning: Could not parse client timestamp '{client_timestamp_str}': {e}")
            # Fallback to current time if parsing fails
            client_timestamp = datetime.utcnow()
        
        current_bpm = body.get('currentBPM')
        if not current_bpm or current_bpm <= 0:
            return pulses
        
        # Process ONLY ACTUAL pulse patterns (measured, not predicted)
        # These represent real pulses that occurred in the audio
        recent_patterns = body.get('recentPulsePatterns', [])
        recent_durations = body.get('recentPulseDurations', [])
        
        # NOTE: We explicitly do NOT process:
        # - body.get('currentPrediction') - this is predicted data
        # - body.get('currentPredictionDurations') - this is predicted data
        # - body.get('recentCorrectPredictionParts') - these are actual but filtered
        
        if not recent_patterns or not isinstance(recent_patterns, list):
            return pulses
        
        # Constants for pattern structure
        PHRASE_BEATS = 4  # 4 beats per phrase
        BEATS_PER_PHRASE = 4
        SLOTS_PER_PATTERN = 32  # 4 beats * 8 thirty-second notes per beat
        
        # Calculate timing based on BPM
        beat_duration_seconds = 60.0 / current_bpm
        phrase_duration_seconds = beat_duration_seconds * BEATS_PER_PHRASE
        thirty_second_note_duration_seconds = beat_duration_seconds / 8.0
        
        # Process ACTUAL patterns (most recent first)
        # Each pattern in recentPulsePatterns represents an actual phrase that occurred
        # We calculate timestamps going backwards from the client timestamp
        for pattern_idx, pattern in enumerate(reversed(recent_patterns)):
            # Validate pattern structure (must be exactly 32 slots)
            if not pattern or not isinstance(pattern, list) or len(pattern) != SLOTS_PER_PATTERN:
                continue
            
            # Get corresponding ACTUAL durations if available
            durations = None
            if recent_durations and isinstance(recent_durations, list) and len(recent_durations) > pattern_idx:
                durations = recent_durations[len(recent_durations) - 1 - pattern_idx]
            
            # Calculate phrase start time (going backwards from client timestamp)
            # Most recent phrase ends just before client timestamp
            # Each earlier phrase is one phrase duration earlier
            phrases_before_current = pattern_idx
            phrase_end_time = client_timestamp - timedelta(seconds=phrases_before_current * phrase_duration_seconds)
            phrase_start_time = phrase_end_time - timedelta(seconds=phrase_duration_seconds)
            
            # Extract ACTUAL pulses from this pattern
            # Each True value in the pattern represents a real pulse that was detected
            for slot_idx, is_pulse in enumerate(pattern):
                if is_pulse:
                    # Calculate pulse timestamp within the phrase
                    # Each slot represents a 32nd note position
                    slot_offset_seconds = slot_idx * thirty_second_note_duration_seconds
                    pulse_timestamp = phrase_start_time + timedelta(seconds=slot_offset_seconds)
                    
                    # Get ACTUAL duration if available (from sustained beat detection)
                    duration_ms = None
                    if durations and isinstance(durations, list) and slot_idx < len(durations):
                        duration_32nd = durations[slot_idx]
                        if duration_32nd is not None and duration_32nd > 0:
                            # Convert 32nd note duration to milliseconds
                            # duration_32nd is the actual measured duration from sustained beat detector
                            duration_seconds = duration_32nd * thirty_second_note_duration_seconds
                            duration_ms = int(duration_seconds * 1000)
                    
                    # Store: (source_id, bpm, pulse_timestamp, duration_ms)
                    # This is actual measured data for server-side prediction analysis
                    pulses.append((source_id, current_bpm, pulse_timestamp, duration_ms))
        
    except Exception as e:
        print(f"Error extracting pulses from patterns: {e}")
        import traceback
        traceback.print_exc()
    
    return pulses

def process_pulses_async(body: Dict[str, Any], client_timestamp_str: str, hashed_ip: str):
    """Process and store pulse timestamps asynchronously"""
    try:
        db = get_database()
        if db is None:
            print("Warning: Database not available for pulse timestamp storage")
            return
        
        # Get or create source for this hashed IP
        source_id = db.get_or_create_source(hashed_ip)
        if source_id is None:
            print("Warning: Could not get or create source")
            return
        
        # Extract pulses with source_id
        pulses = extract_pulses_from_patterns(body, client_timestamp_str, source_id)
        
        if not pulses:
            return
        
        inserted_count = db.insert_pulse_timestamps(pulses)
        print(f"Processed and stored {inserted_count} pulse timestamps for source_id={source_id}")
    except Exception as e:
        print(f"Error in async pulse processing: {e}")
        import traceback
        traceback.print_exc()

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
        
        # Process pulses asynchronously (don't block response)
        if client_timestamp != 'not provided' and hashed_ip:
            thread = threading.Thread(
                target=process_pulses_async,
                args=(body, client_timestamp, hashed_ip),
                daemon=True
            )
            thread.start()
        
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

def handle_predict_phrase_post(event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle POST /predict_phrase requests with full prediction engine integration"""
    try:
        # Check if prediction engine is available
        print(f"[PREDICT_PHRASE] PREDICTION_ENGINE_AVAILABLE = {PREDICTION_ENGINE_AVAILABLE}")
        if not PREDICTION_ENGINE_AVAILABLE:
            server_timestamp = datetime.utcnow().isoformat()
            print(f"[PREDICT_PHRASE] Prediction engine not available, returning error")
            return create_response(503, {
                'status': 'error',
                'error': 'Prediction engine not available',
                'message': 'The prediction engine modules are not available in this Lambda deployment.',
                'server_timestamp': server_timestamp
            })
        
        # Parse request body
        if 'body' in event:
            if isinstance(event['body'], str):
                body = json.loads(event['body'])
            else:
                body = event['body']
        else:
            return create_response(400, {'error': 'Missing request body'})
        
        # Log the request for debugging
        sequence_id = body.get('sequence_id', 'unknown')
        print(f"[PREDICT_PHRASE] Received request: sequence_id={sequence_id}")
        print(f"[PREDICT_PHRASE] BPM: {body.get('currentBPM', 'N/A')}")
        print(f"[PREDICT_PHRASE] Pulse count: {len(body.get('recentPulseTimestamps', []))}")
        print(f"[PREDICT_PHRASE] Pattern count: {len(body.get('recentPulsePatterns', []))}")
        
        # Get device info for hashing (used for source identification)
        request_context = event.get('requestContext', {})
        source_ip = request_context.get('identity', {}).get('sourceIp', 'unknown')
        user_agent = event.get('headers', {}).get('User-Agent', event.get('headers', {}).get('user-agent', 'unknown'))
        
        device_type, browser = extract_device_info(user_agent)
        salt_string = f"{source_ip}:{device_type}:{browser}"
        hashed_ip = hashlib.sha256(salt_string.encode('utf-8')).hexdigest()
        
        # Add device_id to body if not present (for prediction API)
        if 'device_id' not in body:
            body['device_id'] = hashed_ip
        
        # Get prediction API instance
        api = get_prediction_api()
        if api is None:
            server_timestamp = datetime.utcnow().isoformat()
            return create_response(503, {
                'status': 'error',
                'error': 'Prediction API not initialized',
                'message': 'Failed to initialize prediction API. Database may not be available.',
                'server_timestamp': server_timestamp
            })
        
        # Call prediction API to handle the request
        print(f"[PREDICT_PHRASE] Calling prediction API...")
        result = api.handle_predict_phrase(body)
        print(f"[PREDICT_PHRASE] Prediction API returned: status={result.get('status')}")
        
        # Add server timestamp to response
        server_timestamp = datetime.utcnow().isoformat()
        result['server_timestamp'] = server_timestamp
        
        # Return appropriate status code based on result
        if result.get('status') == 'success':
            return create_response(200, result)
        else:
            # Error response from prediction API
            return create_response(500, result)
    
    except json.JSONDecodeError as e:
        return create_response(400, {'error': 'Invalid JSON', 'details': str(e)})
    except Exception as e:
        print(f"Error handling predict_phrase: {e}")
        import traceback
        traceback.print_exc()
        server_timestamp = datetime.utcnow().isoformat()
        return create_response(500, {
            'status': 'error',
            'error': 'Internal server error',
            'message': str(e),
            'server_timestamp': server_timestamp
        })

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

def handle_sources_get() -> Dict[str, Any]:
    """Handle GET /sources requests - returns all sources with emojis"""
    db = get_database()
    if db is None:
        return create_response(503, {
            'status': 'error',
            'error': 'Database not available'
        })
    
    try:
        sources = db.get_all_sources()
        return create_response(200, sources)
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



