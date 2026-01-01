"""
RDS PostgreSQL database adapter for DiamondDrip Prediction Server
Replaces SQLite with PostgreSQL for AWS deployment
"""
import json
import os
from contextlib import contextmanager
from typing import Optional, Tuple, List, Dict, Any
from datetime import datetime, timedelta

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    from psycopg2.pool import SimpleConnectionPool
    PSYCOPG2_AVAILABLE = True
except ImportError:
    PSYCOPG2_AVAILABLE = False
    print("Warning: psycopg2 not available. Install with: pip install psycopg2-binary")


class PredictionDatabase:
    """PostgreSQL database for storing prediction data"""
    
    def __init__(self, host: str, port: int = 5432, database: str = 'diamonddrip', 
                 user: str = None, password: str = None, pool_size: int = 5, 
                 connect_timeout: int = 10):
        if not PSYCOPG2_AVAILABLE:
            raise ImportError("psycopg2 is required for PostgreSQL support. Install with: pip install psycopg2-binary")
        
        self.host = host
        self.port = port
        self.database = database
        self.user = user
        self.password = password
        
        # Create connection pool for Lambda (reuse connections)
        # Use longer timeout for VPC connections (default 10 seconds)
        try:
            print(f"Creating connection pool with timeout={connect_timeout}s, pool_size={pool_size}")
            self.pool = SimpleConnectionPool(
                minconn=1,
                maxconn=pool_size,
                host=host,
                port=port,
                database=database,
                user=user,
                password=password,
                connect_timeout=connect_timeout,
                # Additional connection parameters for better reliability
                keepalives=1,
                keepalives_idle=30,
                keepalives_interval=10,
                keepalives_count=5
            )
            
            # Test the connection by initializing the database schema
            print("Testing database connection...")
            self.init_database()
            print("Database connection pool created and tested successfully")
        except Exception as e:
            print(f"Error creating database connection pool: {e}")
            import traceback
            print(f"Traceback: {traceback.format_exc()}")
            raise
    
    def init_database(self):
        """Initialize the database schema"""
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                # Create predictions table
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS predictions (
                        id SERIAL PRIMARY KEY,
                        client_timestamp TEXT NOT NULL,
                        server_timestamp TEXT NOT NULL,
                        current_bpm REAL,
                        bpm_history JSONB,
                        recent_pulse_patterns JSONB,
                        recent_pulse_durations JSONB,
                        recent_correct_prediction_parts JSONB,
                        recent_correct_prediction_durations JSONB,
                        current_prediction JSONB,
                        current_prediction_durations JSONB,
                        hashed_ip TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')
                
                # Add new duration columns to existing table if they don't exist (for migration)
                cursor.execute('''
                    DO $$ 
                    BEGIN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                     WHERE table_name='predictions' AND column_name='recent_pulse_durations') THEN
                            ALTER TABLE predictions ADD COLUMN recent_pulse_durations JSONB;
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                     WHERE table_name='predictions' AND column_name='recent_correct_prediction_durations') THEN
                            ALTER TABLE predictions ADD COLUMN recent_correct_prediction_durations JSONB;
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                     WHERE table_name='predictions' AND column_name='current_prediction_durations') THEN
                            ALTER TABLE predictions ADD COLUMN current_prediction_durations JSONB;
                        END IF;
                    END $$;
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
                
                # Create GIN index for JSONB columns (for faster JSON queries)
                cursor.execute('''
                    CREATE INDEX IF NOT EXISTS idx_bpm_history_gin 
                    ON predictions USING GIN (bpm_history)
                ''')
                
                # Create sources table to track IP hashes with emojis
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS sources (
                        id SERIAL PRIMARY KEY,
                        hashed_ip TEXT NOT NULL UNIQUE,
                        emoji TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')
                
                # Create indexes for sources
                cursor.execute('''
                    CREATE INDEX IF NOT EXISTS idx_sources_hashed_ip 
                    ON sources(hashed_ip)
                ''')
                
                # Create pulse_timestamps table with source reference
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS pulse_timestamps (
                        id SERIAL PRIMARY KEY,
                        source_id INTEGER NOT NULL REFERENCES sources(id),
                        bpm REAL NOT NULL,
                        pulse TIMESTAMP NOT NULL,
                        duration_ms INTEGER,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')
                
                # Add source_id column to existing pulse_timestamps if it doesn't exist (migration)
                cursor.execute('''
                    DO $$ 
                    BEGIN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                     WHERE table_name='pulse_timestamps' AND column_name='source_id') THEN
                            -- Create sources table if it doesn't exist first
                            IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='sources') THEN
                                CREATE TABLE sources (
                                    id SERIAL PRIMARY KEY,
                                    hashed_ip TEXT NOT NULL UNIQUE,
                                    emoji TEXT NOT NULL,
                                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                                );
                            END IF;
                            
                            -- Add source_id column
                            ALTER TABLE pulse_timestamps ADD COLUMN source_id INTEGER;
                            
                            -- Create foreign key constraint
                            ALTER TABLE pulse_timestamps 
                            ADD CONSTRAINT fk_pulse_timestamps_source 
                            FOREIGN KEY (source_id) REFERENCES sources(id);
                            
                            -- Create index
                            CREATE INDEX IF NOT EXISTS idx_pulse_timestamps_source_id 
                            ON pulse_timestamps(source_id);
                        END IF;
                    END $$;
                ''')
                
                # Create indexes for pulse_timestamps
                cursor.execute('''
                    CREATE INDEX IF NOT EXISTS idx_pulse_timestamps_bpm 
                    ON pulse_timestamps(bpm)
                ''')
                cursor.execute('''
                    CREATE INDEX IF NOT EXISTS idx_pulse_timestamps_pulse 
                    ON pulse_timestamps(pulse)
                ''')
                cursor.execute('''
                    CREATE INDEX IF NOT EXISTS idx_pulse_timestamps_created_at 
                    ON pulse_timestamps(created_at)
                ''')
                cursor.execute('''
                    CREATE INDEX IF NOT EXISTS idx_pulse_timestamps_source_id 
                    ON pulse_timestamps(source_id)
                ''')
                
                conn.commit()
    
    @contextmanager
    def get_connection(self):
        """Get a database connection from the pool"""
        conn = None
        retries = 2
        for attempt in range(retries):
            try:
                conn = self.pool.getconn()
                # Test the connection is still alive
                with conn.cursor() as cursor:
                    cursor.execute('SELECT 1')
                    cursor.fetchone()
                break  # Connection is good, exit retry loop
            except Exception as e:
                if conn:
                    try:
                        self.pool.putconn(conn, close=True)  # Close bad connection
                    except:
                        pass
                    conn = None
                if attempt < retries - 1:
                    print(f"Connection attempt {attempt + 1} failed: {e}, retrying...")
                else:
                    raise
        
        try:
            yield conn
        except Exception as e:
            if conn:
                try:
                    conn.rollback()
                except:
                    pass
            raise
        finally:
            if conn:
                try:
                    self.pool.putconn(conn)
                except Exception as e:
                    print(f"Warning: Error returning connection to pool: {e}")
                    try:
                        self.pool.putconn(conn, close=True)
                    except:
                        pass
    
    def insert_prediction(self, client_timestamp: str, server_timestamp: str, 
                         data: Dict[str, Any], hashed_ip: Optional[str] = None) -> int:
        """Insert a prediction record into the database"""
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute('''
                    INSERT INTO predictions (
                        client_timestamp, server_timestamp, current_bpm,
                        bpm_history, recent_pulse_patterns, recent_pulse_durations,
                        recent_correct_prediction_parts, recent_correct_prediction_durations,
                        current_prediction, current_prediction_durations, hashed_ip
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                ''', (
                    client_timestamp,
                    server_timestamp,
                    data.get('currentBPM'),
                    json.dumps(data.get('bpmHistory', [])),
                    json.dumps(data.get('recentPulsePatterns', [])),
                    json.dumps(data.get('recentPulseDurations')) if data.get('recentPulseDurations') is not None else None,
                    json.dumps(data.get('recentCorrectPredictionParts', [])),
                    json.dumps(data.get('recentCorrectPredictionDurations')) if data.get('recentCorrectPredictionDurations') is not None else None,
                    json.dumps(data.get('currentPrediction')),
                    json.dumps(data.get('currentPredictionDurations')) if data.get('currentPredictionDurations') is not None else None,
                    hashed_ip
                ))
                conn.commit()
                return cursor.fetchone()[0]
    
    def get_recent_predictions(self, limit: int = 100) -> List[Dict[str, Any]]:
        """Get recent predictions from the database"""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute('''
                    SELECT * FROM predictions
                    ORDER BY created_at DESC
                    LIMIT %s
                ''', (limit,))
                rows = cursor.fetchall()
                # Convert datetime objects to ISO format strings for JSON serialization
                result = []
                for row in rows:
                    row_dict = dict(row)
                    # Convert created_at datetime to ISO format string
                    if 'created_at' in row_dict and isinstance(row_dict['created_at'], datetime):
                        row_dict['created_at'] = row_dict['created_at'].isoformat()
                    result.append(row_dict)
                return result
    
    def get_average_bpm(self) -> Optional[float]:
        """Get the average BPM from all stored predictions"""
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute('''
                    SELECT AVG(current_bpm) as avg_bpm
                    FROM predictions
                    WHERE current_bpm IS NOT NULL
                ''')
                result = cursor.fetchone()
                return result[0] if result and result[0] is not None else None
    
    def get_average_bpm_last_20_seconds(self) -> Tuple[Optional[float], int]:
        """Get the average BPM from predictions in the last 20 seconds"""
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute('''
                    SELECT AVG(current_bpm) as avg_bpm, COUNT(*) as count
                    FROM predictions
                    WHERE current_bpm IS NOT NULL
                    AND created_at >= NOW() - INTERVAL '20 seconds'
                ''')
                result = cursor.fetchone()
                avg_bpm = result[0] if result and result[0] is not None else None
                count = result[1] if result else 0
                return avg_bpm, count
    
    def get_unique_sources_last_20_seconds(self) -> int:
        """Get the number of unique data sources in the last 20 seconds"""
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute('''
                    SELECT COUNT(DISTINCT hashed_ip) as unique_sources
                    FROM predictions
                    WHERE hashed_ip IS NOT NULL
                    AND created_at >= NOW() - INTERVAL '20 seconds'
                ''')
                result = cursor.fetchone()
                return result[0] if result else 0
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get basic statistics about stored predictions"""
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute('SELECT COUNT(*) as count FROM predictions')
                count = cursor.fetchone()[0]
                
                cursor.execute('''
                    SELECT 
                        AVG(current_bpm) as avg_bpm,
                        MIN(current_bpm) as min_bpm,
                        MAX(current_bpm) as max_bpm
                    FROM predictions
                    WHERE current_bpm IS NOT NULL
                ''')
                stats = cursor.fetchone()
                
                # Count unique data sources
                cursor.execute('''
                    SELECT COUNT(DISTINCT hashed_ip) as unique_sources
                    FROM predictions
                    WHERE hashed_ip IS NOT NULL
                ''')
                unique_sources = cursor.fetchone()[0]
                
                return {
                    'total_predictions': count,
                    'avg_bpm': float(stats[0]) if stats[0] is not None else None,
                    'min_bpm': float(stats[1]) if stats[1] is not None else None,
                    'max_bpm': float(stats[2]) if stats[2] is not None else None,
                    'unique_data_sources': unique_sources
                }
    
    def get_or_create_source(self, hashed_ip: str) -> int:
        """Get or create a source record for a hashed IP, assigning an emoji if new
        
        Args:
            hashed_ip: Hashed IP address
        
        Returns:
            Source ID
        """
        if not hashed_ip:
            return None
        
        # Large emoji pool for assignment (150+ emojis)
        emojis = [
            # Colored circles and shapes
            '🟢', '🔵', '🟡', '🟠', '🔴', '🟣', '⚫', '⚪', 
            '🟤', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', 
            '⬜', '🟫', '🔶', '🔷', '🔸', '🔹', '🔺', '🔻',
            # Hearts
            '💚', '💙', '💛', '🧡', '❤️', '💜', '🖤', '🤍',
            '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖',
            # Stars and sparkles
            '⭐', '🌟', '✨', '💫', '⭐️', '🌟', '💫',
            # Nature
            '🔥', '💧', '🌊', '🌈', '☀️', '🌙', '⭐', '☁️',
            '🌧️', '⛈️', '❄️', '🌨️', '💨', '🌪️', '☂️', '☔',
            '🌸', '🌺', '🌻', '🌷', '🌹', '🥀', '🌵', '🌲',
            # Animals
            '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼',
            '🐨', '🐯', '🦁', '🐮', '🐷', '🐽', '🐸', '🐵',
            '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇',
            '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌',
            '🐞', '🐜', '🦟', '🦗', '🕷️', '🦂', '🦀', '🐙',
            # Food
            '🍎', '🍌', '🍇', '🍓', '🥝', '🍑', '🍒', '🍊',
            '🍋', '🍉', '🍈', '🍐', '🥭', '🥥', '🍍', '🥑',
            '🍅', '🥔', '🥕', '🌽', '🌶️', '🥒', '🥬', '🥦',
            '🍄', '🥜', '🌰', '🍞', '🥐', '🥖', '🥨', '🥯',
            # Objects and symbols
            '🎯', '🎲', '🎮', '🎰', '🎳', '🎸', '🎹', '🎺',
            '🎻', '🥁', '🎤', '🎧', '🎨', '🖌️', '🖍️', '🖊️',
            '✏️', '✒️', '🖋️', '📝', '💼', '📁', '📂', '📋',
            '📊', '📈', '📉', '📌', '📍', '🗂️', '🗃️', '🗄️',
            # Transport
            '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑',
            '🚒', '🚐', '🚚', '🚛', '🚜', '🏍️', '🛵', '🚲',
            '🛴', '🛹', '🛼', '🚁', '✈️', '🛩️', '🛫', '🛬',
            '🚀', '🛸', '🚢', '⛵', '🛥️', '🚤', '⛴️', '🛳️'
        ]
        
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                # Try to get existing source
                cursor.execute('''
                    SELECT id, emoji FROM sources WHERE hashed_ip = %s
                ''', (hashed_ip,))
                result = cursor.fetchone()
                
                if result:
                    # Source exists, return its ID
                    return result[0]
                
                # Source doesn't exist, create new one
                # Assign next available emoji based on current count
                cursor.execute('SELECT COUNT(*) FROM sources')
                source_count = cursor.fetchone()[0]
                emoji = emojis[source_count % len(emojis)]
                
                cursor.execute('''
                    INSERT INTO sources (hashed_ip, emoji)
                    VALUES (%s, %s)
                    RETURNING id
                ''', (hashed_ip, emoji))
                source_id = cursor.fetchone()[0]
                conn.commit()
                print(f"Created new source: ID={source_id}, hash={hashed_ip[:16]}..., emoji={emoji}")
                return source_id
    
    def get_all_sources(self) -> List[Dict[str, Any]]:
        """Get all sources with their emojis
        
        Returns:
            List of source dictionaries with id, hashed_ip, emoji, created_at (as ISO string)
        """
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute('''
                    SELECT id, hashed_ip, emoji, created_at
                    FROM sources
                    ORDER BY created_at ASC
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
    
    def insert_pulse_timestamps(self, pulses: List[Tuple[int, float, datetime, Optional[int]]]) -> int:
        """Insert pulse timestamps into the database
        
        Args:
            pulses: List of tuples (source_id, bpm, pulse_timestamp, duration_ms)
        
        Returns:
            Number of pulses inserted
        """
        if not pulses:
            return 0
        
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.executemany('''
                    INSERT INTO pulse_timestamps (source_id, bpm, pulse, duration_ms)
                    VALUES (%s, %s, %s, %s)
                ''', pulses)
                conn.commit()
                return cursor.rowcount




