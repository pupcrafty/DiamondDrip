#!/usr/bin/env python3
"""
Simple HTTPS server for DiamondDrip game
Accessible on local network (not just localhost)
"""
import http.server
import socketserver
import socket
import sys
import ssl
import ipaddress
from pathlib import Path

PORT = 8443

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add CORS headers to allow cross-origin requests if needed
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

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

def get_ssl_context():
    """Get SSL context, generating certificate if needed"""
    script_dir = Path(__file__).parent
    cert_file = script_dir / "server.crt"
    key_file = script_dir / "server.key"
    
    # Check if certificate files exist
    if not cert_file.exists() or not key_file.exists():
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
    
    # Create SSL context
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    try:
        context.load_cert_chain(cert_file, key_file)
        return context
    except Exception as e:
        print(f"Error loading SSL certificate: {e}")
        sys.exit(1)

def main():
    # Get local IP
    local_ip = get_local_ip()
    
    print("=" * 60)
    print("DiamondDrip Game Server (HTTPS)")
    print("=" * 60)
    print(f"\nServer starting on port {PORT}...")
    
    # Get SSL context
    ssl_context = get_ssl_context()
    
    print(f"\nLocal access:  https://localhost:{PORT}")
    print(f"Network access: https://{local_ip}:{PORT}")
    print("\nTo access from another device:")
    print(f"  1. Make sure it's on the same network")
    print(f"  2. Open browser and go to: https://{local_ip}:{PORT}")
    print("\nNote: You may see a security warning because this uses a")
    print("self-signed certificate. This is normal for development.")
    print("Click 'Advanced' → 'Proceed to site' (or similar) to continue.")
    print("\nPress Ctrl+C to stop the server")
    print("=" * 60)
    print()
    
    try:
        with HTTPServer(("0.0.0.0", PORT), MyHTTPRequestHandler, ssl_context) as httpd:
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


