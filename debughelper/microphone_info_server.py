#!/usr/bin/env python3
"""
Microphone Info Collection Server
Receives and stores microphone API detection data from browsers
"""
import json
import os
import re
import socket
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote

try:
    from flask import Flask, request, jsonify
    try:
        from flask_cors import CORS
        CORS_AVAILABLE = True
    except ImportError:
        CORS_AVAILABLE = False
        print("Warning: flask-cors not installed. CORS headers will be added manually.")
except ImportError:
    print("Error: Flask is not installed.")
    print("Please install it with: pip install flask")
    sys.exit(1)

app = Flask(__name__)

# Enable CORS
if CORS_AVAILABLE:
    # Use flask-cors with explicit configuration
    CORS(app, 
         resources={r"/api/*": {"origins": "*", "methods": ["GET", "POST", "OPTIONS"], "allow_headers": ["Content-Type", "Authorization"]}},
         supports_credentials=True)
else:
    # Manual CORS headers
    @app.after_request
    def after_request(response):
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response
    
    @app.before_request
    def handle_preflight():
        if request.method == "OPTIONS":
            response = jsonify({})
            response.headers.add('Access-Control-Allow-Origin', '*')
            response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
            response.headers.add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            return response

# Configuration
DATA_DIR = Path(__file__).parent / "data"
MAX_JSON_SIZE = 1024 * 1024  # 1MB max JSON size
ALLOWED_CHARS_PATTERN = re.compile(r'^[a-zA-Z0-9_\-\.\s]+$')  # For folder names

# Expected JSON structure (required top-level keys)
REQUIRED_KEYS = ['timestamp', 'browser', 'audioContext', 'mediaDevices', 
                 'legacyGetUserMedia', 'mediaStream', 'constraints', 
                 'permissions', 'testResult', 'rawAPIs']

# Allowed keys in the JSON (for validation)
ALLOWED_TOP_LEVEL_KEYS = set(REQUIRED_KEYS + ['rawAPIs'])


def sanitize_filename(name):
    """
    Sanitize a string to be safe for use as a filename/folder name
    """
    if not name or not isinstance(name, str):
        return "unknown"
    
    # Remove or replace dangerous characters
    name = re.sub(r'[<>:"/\\|?*]', '_', name)
    name = re.sub(r'\.\.', '_', name)  # Prevent directory traversal
    name = name.strip('. ')  # Remove leading/trailing dots and spaces
    
    # Limit length
    if len(name) > 100:
        name = name[:100]
    
    # If empty after sanitization, use default
    if not name:
        return "unknown"
    
    return name


def sanitize_string(value, max_length=10000):
    """
    Sanitize a string value to prevent injection attacks
    """
    if not isinstance(value, str):
        return str(value)
    
    # Limit length
    if len(value) > max_length:
        value = value[:max_length]
    
    # Remove null bytes and control characters (except newlines and tabs for JSON)
    value = re.sub(r'[\x00-\x08\x0b-\x0c\x0e-\x1f]', '', value)
    
    return value


def validate_json_structure(data):
    """
    Validate that the JSON matches the expected microphone info format
    """
    if not isinstance(data, dict):
        return False, "Root must be a JSON object"
    
    # Check for required top-level keys
    missing_keys = [key for key in REQUIRED_KEYS if key not in data]
    if missing_keys:
        return False, f"Missing required keys: {', '.join(missing_keys)}"
    
    # Check for unexpected top-level keys (security)
    unexpected_keys = set(data.keys()) - ALLOWED_TOP_LEVEL_KEYS
    if unexpected_keys:
        return False, f"Unexpected top-level keys: {', '.join(unexpected_keys)}"
    
    # Validate browser info structure
    if 'browser' in data and isinstance(data['browser'], dict):
        browser = data['browser']
        expected_browser_keys = ['browser', 'userAgent', 'platform', 'vendor', 
                                'language', 'cookieEnabled', 'onLine']
        # Allow extra keys in browser dict (for flexibility)
    
    # Validate testResult structure
    if 'testResult' in data:
        test_result = data['testResult']
        if test_result is not None:
            if not isinstance(test_result, dict):
                return False, "testResult must be an object or null"
            
            # Should have success boolean or error object
            if 'success' not in test_result and 'error' not in test_result:
                return False, "testResult must have 'success' or 'error' field"
    
    return True, "Valid"


def sanitize_json_data(data):
    """
    Recursively sanitize JSON data to prevent malicious content
    """
    if isinstance(data, dict):
        sanitized = {}
        for key, value in data.items():
            # Sanitize keys
            safe_key = sanitize_string(str(key), max_length=100)
            # Recursively sanitize values
            sanitized[safe_key] = sanitize_json_data(value)
        return sanitized
    elif isinstance(data, list):
        # Limit list size to prevent DoS
        max_list_size = 1000
        if len(data) > max_list_size:
            data = data[:max_list_size]
        return [sanitize_json_data(item) for item in data]
    elif isinstance(data, str):
        return sanitize_string(data)
    elif isinstance(data, (int, float, bool)) or data is None:
        return data
    else:
        # Convert unknown types to string
        return sanitize_string(str(data))


def get_device_type(data):
    """
    Extract device type from the browser data
    """
    if 'browser' in data and isinstance(data['browser'], dict):
        platform = data['browser'].get('platform', '').lower()
        user_agent = data['browser'].get('userAgent', '').lower()
        
        # Detect device type
        if any(x in platform or x in user_agent for x in ['iphone', 'ipad', 'ipod']):
            return 'ios'
        elif 'android' in platform or 'android' in user_agent:
            return 'android'
        elif 'windows' in platform:
            return 'windows'
        elif 'mac' in platform or 'macintosh' in platform:
            return 'macos'
        elif 'linux' in platform:
            return 'linux'
        elif any(x in user_agent for x in ['mobile', 'tablet']):
            return 'mobile'
        else:
            return 'desktop'
    
    return 'unknown'


def get_browser_name(data):
    """
    Extract browser name from the browser data
    """
    if 'browser' in data and isinstance(data['browser'], dict):
        browser = data['browser'].get('browser', 'unknown')
        return sanitize_filename(browser)
    
    return 'unknown'


def save_json_data(data):
    """
    Save the JSON data to the appropriate folder structure
    """
    # Sanitize the data first
    sanitized_data = sanitize_json_data(data)
    
    # Get device type and browser
    device_type = get_device_type(sanitized_data)
    browser_name = get_browser_name(sanitized_data)
    
    # Create folder structure: data/device_type/browser/
    device_dir = DATA_DIR / sanitize_filename(device_type)
    browser_dir = device_dir / sanitize_filename(browser_name)
    
    # Create directories if they don't exist
    browser_dir.mkdir(parents=True, exist_ok=True)
    
    # Generate filename with timestamp
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")[:-3]  # Include milliseconds
    filename = f"microphone_info_{timestamp}.json"
    filepath = browser_dir / filename
    
    # Write JSON file
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(sanitized_data, f, indent=2, ensure_ascii=False)
        
        return True, str(filepath.relative_to(DATA_DIR))
    except Exception as e:
        return False, str(e)


@app.route('/api/microphone-info', methods=['POST', 'OPTIONS'])
def receive_microphone_info():
    """
    Endpoint to receive and store microphone info JSON
    """
    # Handle preflight OPTIONS request
    if request.method == 'OPTIONS':
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response, 200
    
    try:
        # Check content type
        if not request.is_json:
            return jsonify({
                'success': False,
                'error': 'Content-Type must be application/json'
            }), 400
        
        # Get JSON data
        try:
            data = request.get_json(force=True)
        except Exception as e:
            return jsonify({
                'success': False,
                'error': f'Invalid JSON: {str(e)}'
            }), 400
        
        # Check JSON size
        json_str = json.dumps(data)
        if len(json_str) > MAX_JSON_SIZE:
            return jsonify({
                'success': False,
                'error': f'JSON too large (max {MAX_JSON_SIZE} bytes)'
            }), 400
        
        # Validate structure
        is_valid, message = validate_json_structure(data)
        if not is_valid:
            return jsonify({
                'success': False,
                'error': f'Invalid JSON structure: {message}'
            }), 400
        
        # Save the data
        success, result = save_json_data(data)
        
        if success:
            return jsonify({
                'success': True,
                'message': 'Data saved successfully',
                'path': result
            }), 200
        else:
            return jsonify({
                'success': False,
                'error': f'Failed to save data: {result}'
            }), 500
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Server error: {str(e)}'
        }), 500


@app.route('/health', methods=['GET'])
def health_check():
    """
    Health check endpoint
    """
    return jsonify({
        'status': 'ok',
        'service': 'microphone-info-collector',
        'data_dir': str(DATA_DIR)
    }), 200


@app.route('/', methods=['GET'])
def index():
    """
    Simple index page with API information
    """
    return jsonify({
        'service': 'Microphone Info Collection Server',
        'version': '1.0.0',
        'endpoints': {
            'POST /api/microphone-info': 'Submit microphone info JSON',
            'GET /health': 'Health check'
        },
        'data_directory': str(DATA_DIR)
    }), 200


def check_port_available(port):
    """
    Check if a port is available
    """
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1)
            result = s.connect_ex(('localhost', port))
            return result != 0  # Port is available if connection fails
    except Exception:
        return False


def find_available_port(start_port, max_attempts=10):
    """
    Find an available port starting from start_port
    """
    for i in range(max_attempts):
        port = start_port + i
        if check_port_available(port):
            return port
    return None


def generate_self_signed_cert(cert_file, key_file):
    """Generate a self-signed SSL certificate for development"""
    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from datetime import datetime, timedelta
        import socket
        import ipaddress
        
        # Generate private key
        private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048,
        )
        
        # Get local IP for certificate
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
        except Exception:
            local_ip = "localhost"
        
        # Create certificate
        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
            x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "Development"),
            x509.NameAttribute(NameOID.LOCALITY_NAME, "Local"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "MicrophoneInfoServer"),
            x509.NameAttribute(NameOID.COMMON_NAME, f"{local_ip}"),
        ])
        
        # Build Subject Alternative Names
        san_list = [
            x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
            x509.DNSName("localhost"),
        ]
        
        # Add local IP if it's a valid IP address (not "localhost")
        if local_ip != "localhost":
            try:
                ip_addr = ipaddress.IPv4Address(local_ip)
                san_list.append(x509.IPAddress(ip_addr))
                san_list.append(x509.DNSName(local_ip))
            except (ValueError, ipaddress.AddressValueError):
                san_list.append(x509.DNSName(local_ip))
        
        cert = x509.CertificateBuilder().subject_name(
            subject
        ).issuer_name(
            issuer
        ).public_key(
            private_key.public_key()
        ).serial_number(
            x509.random_serial_number()
        ).not_valid_before(
            datetime.utcnow()
        ).not_valid_after(
            datetime.utcnow() + timedelta(days=365)
        ).add_extension(
            x509.SubjectAlternativeName(san_list),
            critical=False,
        ).sign(private_key, hashes.SHA256())
        
        # Write certificate
        with open(cert_file, "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))
        
        # Write private key
        with open(key_file, "wb") as f:
            f.write(private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption()
            ))
        
        return True
    except ImportError:
        # Fallback: use openssl command if available
        import subprocess
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
        except Exception:
            local_ip = "localhost"
        
        try:
            san = "IP:127.0.0.1,DNS:localhost"
            if local_ip != "localhost":
                try:
                    socket.inet_aton(local_ip)
                    san += f",IP:{local_ip},DNS:{local_ip}"
                except (socket.error, OSError):
                    san += f",DNS:{local_ip}"
            
            subprocess.run([
                "openssl", "req", "-x509", "-newkey", "rsa:2048", "-keyout", str(key_file),
                "-out", str(cert_file), "-days", "365", "-nodes",
                "-subj", f"/C=US/ST=Development/L=Local/O=MicrophoneInfoServer/CN={local_ip}",
                "-addext", f"subjectAltName={san}"
            ], check=True, capture_output=True)
            return True
        except (subprocess.CalledProcessError, FileNotFoundError):
            return False

def get_ssl_context():
    """Get SSL context, reusing game server certificate if available, otherwise generating new one"""
    import ssl
    import ipaddress
    from pathlib import Path
    
    script_dir = Path(__file__).parent
    # Try to reuse certificate from game server first (so browser only needs to trust once)
    game_server_dir = script_dir.parent / "player"
    game_cert_file = game_server_dir / "server.crt"
    game_key_file = game_server_dir / "server.key"
    
    # Local certificate files
    cert_file = script_dir / "server.crt"
    key_file = script_dir / "server.key"
    
    # Prefer game server certificate if it exists (reuse for consistency)
    if game_cert_file.exists() and game_key_file.exists():
        cert_file = game_cert_file
        key_file = game_key_file
        print(f"Reusing certificate from game server: {cert_file}")
    elif not cert_file.exists() or not key_file.exists():
        print("No SSL certificate found. Generating self-signed certificate...")
        if generate_self_signed_cert(cert_file, key_file):
            print(f"✓ Certificate generated: {cert_file}")
            print(f"✓ Private key generated: {key_file}")
        else:
            print("Error: Could not generate certificate.")
            print("Please install 'cryptography' package:")
            print("  pip install cryptography")
            print("Or install OpenSSL and ensure it's in your PATH.")
            return None
    
    # Create SSL context
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    try:
        context.load_cert_chain(cert_file, key_file)
        return context
    except Exception as e:
        print(f"Error loading SSL certificate: {e}")
        return None

def main():
    """
    Main function to start the server
    """
    # Ensure data directory exists
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    # Get port from environment or use default
    default_port = 9001
    port = int(os.environ.get('PORT', default_port))
    # Default to HTTPS (required for iPhone/mobile browser microphone access)
    use_https = os.environ.get('HTTPS', 'true').lower() == 'true'
    
    # Get SSL context if HTTPS is enabled
    ssl_context = None
    if use_https:
        ssl_context = get_ssl_context()
        if ssl_context is None:
            print("Warning: HTTPS requested but certificate generation failed.")
            print("Falling back to HTTP mode.")
            use_https = False
            protocol = "http"
        else:
            protocol = "https"
    else:
        protocol = "http"
    
    # Check if port is available
    if not check_port_available(port):
        print(f"Warning: Port {port} is already in use.")
        print(f"Attempting to find an available port...")
        available_port = find_available_port(port)
        if available_port:
            print(f"Found available port: {available_port}")
            port = available_port
        else:
            print(f"Error: Could not find an available port near {port}")
            print("Please specify a different port using the PORT environment variable:")
            print(f"  PORT=9002 python microphone_info_server.py")
            sys.exit(1)
    
    print("=" * 60)
    print("Microphone Info Collection Server")
    if use_https:
        print("(HTTPS Mode)")
    print("=" * 60)
    print(f"\nServer starting on port {port}...")
    print(f"Data directory: {DATA_DIR}")
    print(f"\nEndpoints:")
    print(f"  POST {protocol}://localhost:{port}/api/microphone-info")
    print(f"  GET  {protocol}://localhost:{port}/health")
    if use_https:
        print(f"\nNote: You may see a security warning because this uses a")
        print(f"self-signed certificate. This is normal for development.")
        print(f"Click 'Advanced' -> 'Proceed to site' (or similar) to continue.")
    print(f"\nPress Ctrl+C to stop the server")
    print("=" * 60)
    print()
    
    try:
        app.run(host='0.0.0.0', port=port, debug=False, ssl_context=ssl_context)
    except KeyboardInterrupt:
        print("\n\nServer stopped.")
        sys.exit(0)
    except Exception as e:
        print(f"\nError: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()

