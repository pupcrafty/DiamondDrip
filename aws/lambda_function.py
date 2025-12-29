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

# Initialize database connection (reused across Lambda invocations)
db = None

def get_database():
    """Get or create database connection"""
    global db
    if db is None:
        db_config = {
            'host': os.environ.get('DB_HOST'),
            'port': int(os.environ.get('DB_PORT', 5432)),
            'database': os.environ.get('DB_NAME', 'diamonddrip'),
            'user': os.environ.get('DB_USER'),
            'password': os.environ.get('DB_PASSWORD'),
        }
        
        if all(db_config.values()):
            db = PredictionDatabase(**db_config)
        else:
            print("Warning: Database configuration incomplete, running without database")
    
    return db

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    AWS Lambda handler for API Gateway requests
    """
    http_method = event.get('httpMethod', event.get('requestContext', {}).get('http', {}).get('method', 'GET'))
    path = event.get('path', '/')
    
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
    
    # Route requests
    if path == '/prediction' or path == '/prediction/':
        if http_method == 'POST':
            return handle_prediction_post(event)
        else:
            return create_response(405, {'error': 'Method not allowed'})
    
    elif path == '/stats' or path == '/stats/':
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
        return create_response(404, {'error': 'Not found'})

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
        return create_response(503, {'error': 'Database not available'})
    
    try:
        # Parse query parameters
        limit = 100
        if 'queryStringParameters' in event and event['queryStringParameters']:
            limit_param = event['queryStringParameters'].get('limit')
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
    db = get_database()
    return create_response(200, {
        'status': 'ok',
        'service': 'diamonddrip-prediction-server',
        'database': 'connected' if db is not None else 'not available'
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


