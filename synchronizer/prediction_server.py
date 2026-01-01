#!/usr/bin/env python3
"""
Prediction data server for DiamondDrip game
Receives prediction data from the game via POST requests (HTTPS)
"""
import http.server
import socketserver
import socket
import sys
import ssl
import ipaddress
import json
import sqlite3
import hashlib
from datetime import datetime
from pathlib import Path
from contextlib import contextmanager
from urllib.parse import parse_qs, urlparse

PORT = 8444

class HTTPServer(socketserver.TCPServer):
    """HTTPS server with SSL support"""
    def __init__(self, server_address, RequestHandlerClass, ssl_context):
        self.ssl_context = ssl_context
        super().__init__(server_address, RequestHandlerClass)
    
    def server_bind(self):
        """Override to wrap socket with SSL"""
        super().server_bind()
        self.socket = self.ssl_context.wrap_socket(self.socket, server_side=True)

def get_local_ip():
    """Get the local IP address"""
    try:
        # Connect to a remote address to determine local IP
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "localhost"

def generate_self_signed_cert(cert_file, key_file):
    """Generate a self-signed SSL certificate for development"""
    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from datetime import datetime, timedelta
        
        # Generate private key
        private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048,
        )
        
        # Get local IP for certificate
        local_ip = get_local_ip()
        
        # Create certificate
        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
            x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "Development"),
            x509.NameAttribute(NameOID.LOCALITY_NAME, "Local"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "DiamondDrip"),
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
                # Try to parse as IPv4 address
                ip_addr = ipaddress.IPv4Address(local_ip)
                san_list.append(x509.IPAddress(ip_addr))
                san_list.append(x509.DNSName(local_ip))
            except (ValueError, ipaddress.AddressValueError):
                # If IP is not valid, just add as DNS name
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
        local_ip = get_local_ip()
        try:
            # Build subjectAltName
            san = "IP:127.0.0.1,DNS:localhost"
            if local_ip != "localhost":
                # Check if local_ip is a valid IP address
                try:
                    socket.inet_aton(local_ip)
                    san += f",IP:{local_ip},DNS:{local_ip}"
                except (socket.error, OSError):
                    san += f",DNS:{local_ip}"
            
            subprocess.run([
                "openssl", "req", "-x509", "-newkey", "rsa:2048", "-keyout", str(key_file),
                "-out", str(cert_file), "-days", "365", "-nodes",
                "-subj", f"/C=US/ST=Development/L=Local/O=DiamondDrip/CN={local_ip}",
                "-addext", f"subjectAltName={san}"
            ], check=True, capture_output=True)
            return True
        except (subprocess.CalledProcessError, FileNotFoundError):
            return False

class PredictionDatabase:
    """SQLite database for storing prediction data"""
    
    def __init__(self, db_path):
        self.db_path = Path(db_path)
        self.init_database()
    
    def init_database(self):
        """Initialize the database schema"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS predictions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    client_timestamp TEXT NOT NULL,
                    server_timestamp TEXT NOT NULL,
                    current_bpm REAL,
                    bpm_history TEXT,
                    recent_pulse_patterns TEXT,
                    recent_pulse_durations TEXT,
                    recent_correct_prediction_parts TEXT,
                    recent_correct_prediction_durations TEXT,
                    current_prediction TEXT,
                    current_prediction_durations TEXT,
                    hashed_ip TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Add hashed_ip column if it doesn't exist (for existing databases)
            try:
                cursor.execute('ALTER TABLE predictions ADD COLUMN hashed_ip TEXT')
            except sqlite3.OperationalError:
                # Column already exists, ignore
                pass
            
            # Add duration columns if they don't exist (for existing databases)
            for column_name in ['recent_pulse_durations', 'recent_correct_prediction_durations', 'current_prediction_durations']:
                try:
                    cursor.execute(f'ALTER TABLE predictions ADD COLUMN {column_name} TEXT')
                except sqlite3.OperationalError:
                    # Column already exists, ignore
                    pass
            
            # Create sources table for pulse tracking
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS sources (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    hashed_ip TEXT NOT NULL UNIQUE,
                    emoji TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Create pulse_timestamps table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS pulse_timestamps (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_id INTEGER NOT NULL,
                    bpm REAL NOT NULL,
                    pulse DATETIME NOT NULL,
                    duration_ms INTEGER,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (source_id) REFERENCES sources(id)
                )
            ''')
            
            # Create indexes for common queries
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_client_timestamp 
                ON predictions(client_timestamp)
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_server_timestamp 
                ON predictions(server_timestamp)
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_current_bpm 
                ON predictions(current_bpm)
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_created_at 
                ON predictions(created_at)
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_hashed_ip 
                ON predictions(hashed_ip)
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_sources_hashed_ip 
                ON sources(hashed_ip)
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_pulse_timestamps_source_id 
                ON pulse_timestamps(source_id)
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_pulse_timestamps_pulse 
                ON pulse_timestamps(pulse)
            ''')
            
            conn.commit()
    
    @contextmanager
    def get_connection(self):
        """Get a database connection with proper error handling"""
        conn = sqlite3.connect(self.db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row  # Enable column access by name
        try:
            yield conn
        except sqlite3.Error as e:
            conn.rollback()
            raise
        finally:
            conn.close()
    
    def _normalize_pattern_array(self, pattern):
        """Normalize pattern array from 0/1 numbers to boolean values for viewer compatibility"""
        if pattern is None:
            return None
        if isinstance(pattern, list):
            # Convert each element: 0/1 numbers -> False/True, keep booleans as-is
            return [bool(x) if isinstance(x, (int, float)) else x for x in pattern]
        return pattern
    
    def _normalize_pattern_arrays(self, patterns):
        """Normalize array of pattern arrays from 0/1 numbers to boolean values"""
        if patterns is None:
            return None
        if isinstance(patterns, list):
            return [self._normalize_pattern_array(p) for p in patterns]
        return patterns
    
    def insert_prediction(self, client_timestamp, server_timestamp, data, hashed_ip=None):
        """Insert a prediction record into the database
        
        Normalizes pattern arrays from 0/1 numbers to boolean values for viewer compatibility.
        """
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Normalize pattern arrays: convert 0/1 to False/True for viewer compatibility
            current_prediction = self._normalize_pattern_array(data.get('currentPrediction'))
            recent_pulse_patterns = self._normalize_pattern_arrays(data.get('recentPulsePatterns', []))
            recent_correct_prediction_parts = self._normalize_pattern_arrays(data.get('recentCorrectPredictionParts', []))
            
            cursor.execute('''
                INSERT INTO predictions (
                    client_timestamp, server_timestamp, current_bpm,
                    bpm_history, recent_pulse_patterns, recent_pulse_durations,
                    recent_correct_prediction_parts, recent_correct_prediction_durations,
                    current_prediction, current_prediction_durations, hashed_ip
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                client_timestamp,
                server_timestamp,
                data.get('currentBPM'),
                json.dumps(data.get('bpmHistory', [])),
                json.dumps(recent_pulse_patterns) if recent_pulse_patterns else json.dumps([]),
                json.dumps(data.get('recentPulseDurations')) if data.get('recentPulseDurations') is not None else None,
                json.dumps(recent_correct_prediction_parts) if recent_correct_prediction_parts else json.dumps([]),
                json.dumps(data.get('recentCorrectPredictionDurations')) if data.get('recentCorrectPredictionDurations') is not None else None,
                json.dumps(current_prediction) if current_prediction is not None else None,
                json.dumps(data.get('currentPredictionDurations')) if data.get('currentPredictionDurations') is not None else None,
                hashed_ip
            ))
            conn.commit()
            return cursor.lastrowid
    
    def update_prediction(self, prediction_id, current_prediction, current_prediction_durations):
        """Update a prediction record with the prediction result"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE predictions
                SET current_prediction = ?,
                    current_prediction_durations = ?
                WHERE id = ?
            ''', (
                json.dumps(current_prediction) if current_prediction is not None else None,
                json.dumps(current_prediction_durations) if current_prediction_durations is not None else None,
                prediction_id
            ))
            conn.commit()
            return cursor.rowcount > 0
    
    def get_recent_predictions(self, limit=100):
        """Get recent predictions from the database"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT * FROM predictions
                ORDER BY created_at DESC
                LIMIT ?
            ''', (limit,))
            return [dict(row) for row in cursor.fetchall()]
    
    def get_average_bpm(self):
        """Get the average BPM from all stored predictions"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT AVG(current_bpm) as avg_bpm
                FROM predictions
                WHERE current_bpm IS NOT NULL
            ''')
            result = cursor.fetchone()
            return result['avg_bpm'] if result and result['avg_bpm'] is not None else None
    
    def get_average_bpm_last_20_seconds(self):
        """Get the average BPM from predictions in the last 20 seconds"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            # Query using created_at field with SQLite datetime functions
            cursor.execute('''
                SELECT AVG(current_bpm) as avg_bpm, COUNT(*) as count
                FROM predictions
                WHERE current_bpm IS NOT NULL
                AND created_at >= datetime('now', '-20 seconds')
            ''')
            result = cursor.fetchone()
            avg_bpm = result['avg_bpm'] if result and result['avg_bpm'] is not None else None
            count = result['count'] if result else 0
            return avg_bpm, count
    
    def get_unique_sources_last_20_seconds(self):
        """Get the number of unique data sources in the last 20 seconds"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT COUNT(DISTINCT hashed_ip) as unique_sources
                FROM predictions
                WHERE hashed_ip IS NOT NULL
                AND created_at >= datetime('now', '-20 seconds')
            ''')
            result = cursor.fetchone()
            return result['unique_sources'] if result else 0
    
    def get_statistics(self):
        """Get basic statistics about stored predictions"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT COUNT(*) as count FROM predictions')
            count = cursor.fetchone()['count']
            
            cursor.execute('''
                SELECT 
                    AVG(current_bpm) as avg_bpm,
                    MIN(current_bpm) as min_bpm,
                    MAX(current_bpm) as max_bpm
                FROM predictions
                WHERE current_bpm IS NOT NULL
            ''')
            stats = dict(cursor.fetchone())
            
            # Count unique data sources (unique hashed IPs)
            cursor.execute('''
                SELECT COUNT(DISTINCT hashed_ip) as unique_sources
                FROM predictions
                WHERE hashed_ip IS NOT NULL
            ''')
            unique_sources = cursor.fetchone()['unique_sources']
            
            return {
                'total_predictions': count,
                'avg_bpm': stats['avg_bpm'],
                'min_bpm': stats['min_bpm'],
                'max_bpm': stats['max_bpm'],
                'unique_data_sources': unique_sources
            }
    
    def get_or_create_source(self, hashed_ip):
        """Get or create a source record for a hashed IP, assigning an emoji if new"""
        if not hashed_ip:
            return None
        
        # Large emoji pool (same as PostgreSQL version)
        emojis = [
            '🟢', '🔵', '🟡', '🟠', '🔴', '🟣', '⚫', '⚪', 
            '🟤', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', 
            '⬜', '🟫', '🔶', '🔷', '🔸', '🔹', '🔺', '🔻',
            '💚', '💙', '💛', '🧡', '❤️', '💜', '🖤', '🤍',
            '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖',
            '⭐', '🌟', '✨', '💫', '⭐️', '🌟', '💫',
            '🔥', '💧', '🌊', '🌈', '☀️', '🌙', '⭐', '☁️',
        ]
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            # Try to get existing source
            cursor.execute('SELECT id, emoji FROM sources WHERE hashed_ip = ?', (hashed_ip,))
            result = cursor.fetchone()
            
            if result:
                return result[0]
            
            # Source doesn't exist, create new one
            cursor.execute('SELECT COUNT(*) FROM sources')
            source_count = cursor.fetchone()[0]
            emoji = emojis[source_count % len(emojis)]
            
            cursor.execute('''
                INSERT INTO sources (hashed_ip, emoji)
                VALUES (?, ?)
            ''', (hashed_ip, emoji))
            conn.commit()
            source_id = cursor.lastrowid
            print(f"Created new source: ID={source_id}, hash={hashed_ip[:16]}..., emoji={emoji}")
            return source_id
    
    def get_all_sources(self):
        """Get all sources with their emojis"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT id, hashed_ip, emoji, created_at
                FROM sources
                ORDER BY created_at DESC
            ''')
            sources = []
            for row in cursor.fetchall():
                source_dict = dict(row)
                # Convert datetime to ISO format string for JSON serialization
                if 'created_at' in source_dict and source_dict['created_at']:
                    if isinstance(source_dict['created_at'], datetime):
                        source_dict['created_at'] = source_dict['created_at'].isoformat()
                    elif isinstance(source_dict['created_at'], str):
                        # Already a string, keep as-is
                        pass
                sources.append(source_dict)
            return sources
    
    def insert_pulse_timestamps(self, pulses):
        """Insert pulse timestamps into the database
        
        Args:
            pulses: List of tuples (source_id, bpm, pulse_datetime, duration_ms)
        """
        if not pulses:
            return 0
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.executemany('''
                INSERT INTO pulse_timestamps (source_id, bpm, pulse, duration_ms)
                VALUES (?, ?, ?, ?)
            ''', pulses)
            conn.commit()
            return cursor.rowcount

# Global database instance
db = None

# Global prediction API instance
prediction_api = None

def certificate_needs_regeneration(cert_file, current_ip):
    """Check if certificate needs to be regenerated (doesn't include current IP)"""
    if not cert_file.exists() or current_ip == "localhost":
        return False
    
    try:
        from cryptography import x509
        from cryptography.hazmat.backends import default_backend
        
        # Read and parse certificate
        with open(cert_file, 'rb') as f:
            cert_data = f.read()
        
        cert = x509.load_pem_x509_certificate(cert_data, default_backend())
        
        # Check Subject Alternative Names
        try:
            san_ext = cert.extensions.get_extension_for_oid(x509.ExtensionOID.SUBJECT_ALTERNATIVE_NAME)
            san = san_ext.value
            
            # Check if current IP is in the certificate
            try:
                current_ip_obj = ipaddress.IPv4Address(current_ip)
                for name in san:
                    if isinstance(name, x509.IPAddress):
                        if name.value == current_ip_obj:
                            return False  # IP is in certificate, no regeneration needed
            except (ValueError, ipaddress.AddressValueError):
                # Not a valid IP, skip IP check
                pass
            
            # Current IP not found in certificate
            print(f"Warning: Certificate does not include current IP ({current_ip})")
            print("  Certificate will be regenerated to include current IP address")
            return True
        except x509.ExtensionNotFound:
            # No SAN extension, should regenerate
            print(f"Warning: Certificate missing Subject Alternative Names")
            print("  Certificate will be regenerated to include current IP address")
            return True
    except ImportError:
        # Cryptography not available, can't check - assume certificate is fine
        return False
    except Exception as e:
        # If we can't check, assume it's fine (don't regenerate)
        print(f"Note: Could not verify certificate IP coverage: {e}")
        return False

def get_ssl_context():
    """Get SSL context, reusing player certificate if available, otherwise generating one"""
    script_dir = Path(__file__).parent
    player_dir = script_dir.parent / "player"
    current_ip = get_local_ip()
    
    # Try to reuse certificate from player directory first (so browser only needs to trust once)
    player_cert_file = player_dir / "server.crt"
    player_key_file = player_dir / "server.key"
    
    # Local certificate files
    cert_file = script_dir / "server.crt"
    key_file = script_dir / "server.key"
    
    # Prefer player server certificate if it exists (reuse for consistency)
    if player_cert_file.exists() and player_key_file.exists():
        # Check if certificate needs regeneration (IP changed)
        if certificate_needs_regeneration(player_cert_file, current_ip):
            print(f"Regenerating certificate to include current IP ({current_ip})...")
            # Regenerate in player directory (so both servers can use it)
            if generate_self_signed_cert(player_cert_file, player_key_file):
                print(f"✓ Certificate regenerated: {player_cert_file}")
            else:
                print("Warning: Failed to regenerate certificate, using existing one")
        cert_file = player_cert_file
        key_file = player_key_file
        print(f"Using certificate from player server: {cert_file}")
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
            sys.exit(1)
    else:
        # Local certificate exists, check if it needs regeneration
        if certificate_needs_regeneration(cert_file, current_ip):
            print(f"Regenerating certificate to include current IP ({current_ip})...")
            if generate_self_signed_cert(cert_file, key_file):
                print(f"✓ Certificate regenerated: {cert_file}")
            else:
                print("Warning: Failed to regenerate certificate, using existing one")
    
    # Create SSL context
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    try:
        context.load_cert_chain(cert_file, key_file)
        return context
    except Exception as e:
        print(f"Error loading SSL certificate: {e}")
        sys.exit(1)

class PredictionRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        """Handle POST requests with prediction data"""
        global prediction_api
        
        # New prediction engine endpoints
        if self.path == '/predict_phrase' or self.path == '/predict_phrase/':
            try:
                print(f"[SERVER] Received /predict_phrase request from {self.client_address}")
                content_length = int(self.headers.get('Content-Length', 0))
                print(f"[SERVER] Content-Length: {content_length}")
                body = self.rfile.read(content_length) if content_length > 0 else b'{}'
                print(f"[SERVER] Body read, length: {len(body)}")
                request_data = json.loads(body.decode('utf-8')) if body else {}
                print(f"[SERVER] Request parsed, calling handle_predict_phrase...")
                
                if prediction_api:
                    response = prediction_api.handle_predict_phrase(request_data)
                    print(f"[SERVER] Response received, status: {response.get('status', 'unknown')}")
                else:
                    response = {'status': 'error', 'message': 'Prediction engine not initialized'}
                    print(f"[SERVER] ERROR: Prediction engine not initialized")
                
                print(f"[SERVER] Sending response...")
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                response_json = json.dumps(response).encode('utf-8')
                self.wfile.write(response_json)
                print(f"[SERVER] Response sent, length: {len(response_json)}")
                return
                
            except Exception as e:
                print(f"[SERVER] EXCEPTION in /predict_phrase handler: {e}")
                import traceback
                traceback.print_exc()
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                response = {'status': 'error', 'message': str(e)}
                self.wfile.write(json.dumps(response).encode('utf-8'))
                return
        
        elif self.path == '/pulse' or self.path == '/pulse/':
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                request_data = json.loads(body.decode('utf-8'))
                
                if prediction_api:
                    response = prediction_api.handle_pulse(request_data)
                else:
                    response = {'status': 'error', 'message': 'Prediction engine not initialized'}
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(response).encode('utf-8'))
                return
                
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                response = {'status': 'error', 'message': str(e)}
                self.wfile.write(json.dumps(response).encode('utf-8'))
                return
        
        # Original prediction endpoint (for backward compatibility)
        elif self.path == '/prediction' or self.path == '/prediction/':
            try:
                # Read request body
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                
                # Parse JSON
                data = json.loads(body.decode('utf-8'))
                
                # Store in database first
                server_timestamp = datetime.now().isoformat()
                client_timestamp = data.get('timestamp', 'not provided')
                avg_bpm_last_20s = None
                
                # Get client IP and extract device/browser info from User-Agent
                client_address = self.client_address[0] if self.client_address else 'unknown'
                user_agent = self.headers.get('User-Agent', 'unknown')
                
                # Extract device type and browser from User-Agent
                device_type = 'unknown'
                browser = 'unknown'
                
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
                
                # Hash IP with device type and browser as salt
                salt_string = f"{client_address}:{device_type}:{browser}"
                hashed_ip = hashlib.sha256(salt_string.encode('utf-8')).hexdigest()
                
                if db is not None:
                    try:
                        db.insert_prediction(client_timestamp, server_timestamp, data, hashed_ip)
                        # Get average BPM from predictions in the last 20 seconds
                        avg_bpm_last_20s, count = db.get_average_bpm_last_20_seconds()
                        unique_sources = db.get_unique_sources_last_20_seconds()
                        if avg_bpm_last_20s is not None:
                            print(f"[{server_timestamp}] Average BPM (last 20s): {avg_bpm_last_20s:.2f} (from {count} predictions, {unique_sources} unique sources)")
                        else:
                            print(f"[{server_timestamp}] No BPM data available for last 20 seconds ({unique_sources} unique sources)")
                    except Exception as e:
                        print(f"[{server_timestamp}] Warning: Failed to store in database: {e}")
                else:
                    # Database not available, just log timestamp
                    print(f"[{server_timestamp}] Received prediction (database not available)")
                
                # Send success response with average BPM for last 20 seconds
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                response = {
                    'status': 'success',
                    'server_timestamp': server_timestamp,
                    'client_timestamp': client_timestamp,
                    'avg_bpm_last_20s': round(avg_bpm_last_20s, 2) if avg_bpm_last_20s is not None else None
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))
                
            except json.JSONDecodeError as e:
                # Invalid JSON
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                response = {'status': 'error', 'message': 'Invalid JSON', 'error': str(e)}
                self.wfile.write(json.dumps(response).encode('utf-8'))
                
            except Exception as e:
                # Other errors
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                response = {'status': 'error', 'message': 'Internal server error', 'error': str(e)}
                self.wfile.write(json.dumps(response).encode('utf-8'))
        else:
            # 404 for other paths
            self.send_response(404)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            response = {'status': 'error', 'message': 'Not found'}
            self.wfile.write(json.dumps(response).encode('utf-8'))
    
    def do_GET(self):
        """Handle GET requests for statistics and recent predictions"""
        global db
        
        if self.path == '/' or self.path == '/index.html' or self.path == '/viewer.html':
            # Serve the viewer HTML page
            try:
                script_dir = Path(__file__).parent
                viewer_path = script_dir / "viewer.html"
                if viewer_path.exists():
                    with open(viewer_path, 'rb') as f:
                        content = f.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/html')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(content)
                else:
                    self.send_response(404)
                    self.send_header('Content-Type', 'text/plain')
                    self.end_headers()
                    self.wfile.write(b'Viewer not found')
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(f'Error serving viewer: {e}'.encode('utf-8'))
        elif self.path == '/status' or self.path == '/status/':
            # Prediction engine status
            global prediction_api
            if prediction_api:
                try:
                    response = prediction_api.handle_status()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(response, indent=2).encode('utf-8'))
                except Exception as e:
                    self.send_response(500)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    response = {'status': 'error', 'message': str(e)}
                    self.wfile.write(json.dumps(response).encode('utf-8'))
            else:
                self.send_response(503)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                response = {'status': 'error', 'message': 'Prediction engine not initialized'}
                self.wfile.write(json.dumps(response).encode('utf-8'))
        
        elif self.path == '/stats' or self.path == '/stats/':
            # Return statistics
            if db is not None:
                try:
                    stats = db.get_statistics()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(stats, indent=2).encode('utf-8'))
                except Exception as e:
                    self.send_response(500)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    response = {'status': 'error', 'message': str(e)}
                    self.wfile.write(json.dumps(response).encode('utf-8'))
            else:
                self.send_response(503)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                response = {'status': 'error', 'message': 'Database not initialized'}
                self.wfile.write(json.dumps(response).encode('utf-8'))
        elif self.path == '/recent' or self.path.startswith('/recent?'):
            # Return recent predictions
            limit = 100
            if '?' in self.path:
                try:
                    query_params = parse_qs(urlparse(self.path).query)
                    if 'limit' in query_params:
                        limit = int(query_params['limit'][0])
                except (ValueError, KeyError):
                    pass
            
            if db is not None:
                try:
                    predictions = db.get_recent_predictions(limit=limit)
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(predictions, indent=2).encode('utf-8'))
                except Exception as e:
                    self.send_response(500)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    response = {'status': 'error', 'message': str(e)}
                    self.wfile.write(json.dumps(response).encode('utf-8'))
            else:
                self.send_response(503)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                response = {'status': 'error', 'message': 'Database not initialized'}
                self.wfile.write(json.dumps(response).encode('utf-8'))
        
        elif self.path == '/sources' or self.path == '/sources/':
            # Return all sources with emojis
            if db is not None:
                try:
                    sources = db.get_all_sources()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(sources, indent=2).encode('utf-8'))
                except Exception as e:
                    self.send_response(500)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    response = {'status': 'error', 'message': str(e)}
                    self.wfile.write(json.dumps(response).encode('utf-8'))
            else:
                self.send_response(503)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                response = {'status': 'error', 'message': 'Database not initialized'}
                self.wfile.write(json.dumps(response).encode('utf-8'))
        
        # Debug endpoints for prediction visualizer
        elif self.path == '/prediction/debug/state' or self.path == '/prediction/debug/state/':
            global prediction_api
            if prediction_api:
                try:
                    response = prediction_api.handle_debug_state()
                    status_code = 200 if response.get('status') == 'success' else 500
                    self.send_response(status_code)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(response, indent=2).encode('utf-8'))
                except Exception as e:
                    self.send_response(500)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    response = {'status': 'error', 'message': str(e)}
                    self.wfile.write(json.dumps(response).encode('utf-8'))
            else:
                self.send_response(503)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                response = {'status': 'error', 'message': 'Prediction engine not initialized'}
                self.wfile.write(json.dumps(response).encode('utf-8'))
        
        elif self.path == '/prediction/debug/pipeline' or self.path.startswith('/prediction/debug/pipeline?'):
            global prediction_api
            limit = 10
            if '?' in self.path:
                try:
                    query_params = parse_qs(urlparse(self.path).query)
                    if 'limit' in query_params:
                        limit = int(query_params['limit'][0])
                except (ValueError, KeyError):
                    pass
            
            if prediction_api:
                try:
                    response = prediction_api.handle_pipeline_trace(limit=limit)
                    status_code = 200 if response.get('status') == 'success' else 500
                    self.send_response(status_code)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(response, indent=2).encode('utf-8'))
                except Exception as e:
                    self.send_response(500)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    response = {'status': 'error', 'message': str(e)}
                    self.wfile.write(json.dumps(response).encode('utf-8'))
            else:
                self.send_response(503)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                response = {'status': 'error', 'message': 'Prediction engine not initialized'}
                self.wfile.write(json.dumps(response).encode('utf-8'))
        
        elif self.path == '/prediction/debug/history' or self.path.startswith('/prediction/debug/history?'):
            global prediction_api
            limit = 10
            if '?' in self.path:
                try:
                    query_params = parse_qs(urlparse(self.path).query)
                    if 'limit' in query_params:
                        limit = int(query_params['limit'][0])
                except (ValueError, KeyError):
                    pass
            
            if prediction_api:
                try:
                    response = prediction_api.handle_prediction_history(limit=limit)
                    status_code = 200 if response.get('status') == 'success' else 500
                    self.send_response(status_code)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps(response, indent=2).encode('utf-8'))
                except Exception as e:
                    self.send_response(500)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    response = {'status': 'error', 'message': str(e)}
                    self.wfile.write(json.dumps(response).encode('utf-8'))
            else:
                self.send_response(503)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                response = {'status': 'error', 'message': 'Prediction engine not initialized'}
                self.wfile.write(json.dumps(response).encode('utf-8'))
        else:
            # 404 for other paths
            self.send_response(404)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            response = {'status': 'error', 'message': 'Not found'}
            self.wfile.write(json.dumps(response).encode('utf-8'))
    
    def do_OPTIONS(self):
        """Handle CORS preflight requests"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def log_message(self, format, *args):
        """Override to customize log format"""
        # Only log errors, not every request
        if 'error' in format.lower() or args[0].startswith('5'):
            super().log_message(format, *args)

def main():
    global db, prediction_api
    
    # Get local IP
    local_ip = get_local_ip()
    
    print("=" * 60)
    print("DiamondDrip Prediction Server (HTTPS)")
    print("=" * 60)
    print(f"\nServer starting on port {PORT}...")
    
    # Initialize database
    script_dir = Path(__file__).parent
    db_path = script_dir / "predictions.db"
    try:
        db = PredictionDatabase(db_path)
        print(f"✓ Database initialized: {db_path}")
    except Exception as e:
        print(f"✗ Warning: Failed to initialize database: {e}")
        print("  Server will continue without database storage.")
        db = None
    
    # Initialize prediction engine (bootstrap mode by default)
    try:
        from prediction_api import PredictionAPI
        from prediction_engine import PredictionMode
        # Use bootstrap mode by default (per PredictorUpdates.md)
        prediction_api = PredictionAPI(
            database=db, 
            initial_bpm=120.0,
            mode=PredictionMode.BOOTSTRAP,
            enable_async_training=False  # Disabled by default per PredictorUpdates.md
        )
        print(f"✓ Prediction engine initialized (mode: bootstrap)")
    except Exception as e:
        print(f"✗ Warning: Failed to initialize prediction engine: {e}")
        print("  Prediction endpoints will not be available.")
        import traceback
        traceback.print_exc()
        prediction_api = None
    
    # Get SSL context
    ssl_context = get_ssl_context()
    
    print(f"\nLocal access:  https://localhost:{PORT}/prediction")
    print(f"Network access: https://{local_ip}:{PORT}/prediction")
    if prediction_api:
        print(f"\nPrediction engine endpoints:")
        print(f"  - Predict phrase: POST https://localhost:{PORT}/predict_phrase")
        print(f"  - Submit pulse: POST https://localhost:{PORT}/pulse")
        print(f"  - Engine status: GET https://localhost:{PORT}/status")
    if db is not None:
        print(f"\nDatabase endpoints:")
        print(f"  - Viewer: https://localhost:{PORT}/")
        print(f"  - Statistics: https://localhost:{PORT}/stats")
        print(f"  - Recent predictions: https://localhost:{PORT}/recent?limit=100")
    print("\nNote: You may see a security warning because this uses a")
    print("self-signed certificate. This is normal for development.")
    print("Click 'Advanced' → 'Proceed to site' (or similar) to continue.")
    print("\nPress Ctrl+C to stop the server")
    print("=" * 60)
    print()
    
    try:
        with HTTPServer(("0.0.0.0", PORT), PredictionRequestHandler, ssl_context) as httpd:
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n\nServer stopped.")
        sys.exit(0)
    except OSError as e:
        if "Address already in use" in str(e) or "address is already in use" in str(e):
            print(f"\nError: Port {PORT} is already in use.")
            print("Try closing other applications or use a different port.")
        else:
            print(f"\nError: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()

