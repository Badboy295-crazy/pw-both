import os
import sqlite3
import logging
from typing import Optional, Dict, Any

logger = logging.getLogger('VideoVault')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, 'video_vault.db')

STORAGE_CHANNEL_ID = os.environ.get('STORAGE_CHANNEL_ID', '-1003948302054')


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_vault():
    """Initialize the SQLite schema for caching video deliveries."""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS cached_videos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    batch_id TEXT,
                    content_id TEXT NOT NULL,
                    quality TEXT NOT NULL,
                    channel_msg_id INTEGER,
                    file_id TEXT,
                    title TEXT,
                    subject TEXT,
                    topic TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    hits INTEGER DEFAULT 0,
                    UNIQUE(content_id, quality)
                )
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_cached_content_quality 
                ON cached_videos(content_id, quality)
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_cached_batch_id 
                ON cached_videos(batch_id)
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS content_payloads (
                    key TEXT PRIMARY KEY,
                    batch_id TEXT,
                    content_id TEXT,
                    name TEXT,
                    subject TEXT,
                    topic TEXT,
                    faculty TEXT,
                    image TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS vault_metrics (
                    key TEXT PRIMARY KEY,
                    val INTEGER DEFAULT 0
                )
            ''')
            cursor.execute('''
                INSERT OR IGNORE INTO vault_metrics (key, val) VALUES ('cache_hits', 0)
            ''')
            cursor.execute('''
                INSERT OR IGNORE INTO vault_metrics (key, val) VALUES ('cache_misses', 0)
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS referrals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    referrer_id INTEGER NOT NULL,
                    referred_id INTEGER NOT NULL UNIQUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id)
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS vip_users (
                    user_id INTEGER PRIMARY KEY,
                    is_vip INTEGER DEFAULT 1,
                    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    reason TEXT DEFAULT '3_referrals'
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS cached_pdfs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    batch_id TEXT,
                    content_id TEXT NOT NULL UNIQUE,
                    channel_msg_id INTEGER,
                    file_id TEXT,
                    title TEXT,
                    subject TEXT,
                    topic TEXT,
                    faculty TEXT,
                    pdf_url TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    hits INTEGER DEFAULT 0
                )
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_cached_pdf_content ON cached_pdfs(content_id)
            ''')
            conn.commit()
            logger.info("Video Vault SQLite database initialized successfully.")
    except Exception as e:
        logger.error(f"Failed to initialize Video Vault database: {e}")


def save_content_payload(key: str, payload: Dict[str, Any]):
    """Persist lecture metadata in SQLite so quality buttons never expire across restarts."""
    if not key or not payload:
        return
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO content_payloads 
                    (key, batch_id, content_id, name, subject, topic, faculty, image)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    batch_id = excluded.batch_id,
                    content_id = excluded.content_id,
                    name = excluded.name,
                    subject = excluded.subject,
                    topic = excluded.topic,
                    faculty = excluded.faculty,
                    image = excluded.image
            ''', (
                key,
                str(payload.get('batchId') or '').strip(),
                str(payload.get('contentId') or '').strip(),
                payload.get('name', ''),
                payload.get('subject', ''),
                payload.get('topic', ''),
                payload.get('faculty', ''),
                payload.get('image', '')
            ))
            conn.commit()
    except Exception as e:
        logger.error(f"Failed to save content payload: {e}")


def get_content_payload(key: str) -> Optional[Dict[str, Any]]:
    """Retrieve persisted lecture payload by store key or partial content id."""
    if not key:
        return None
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM content_payloads WHERE key = ?', (key,))
            row = cursor.fetchone()
            if not row and key.startswith('c_'):
                suffix = key[2:]
                cursor.execute(
                    'SELECT * FROM content_payloads WHERE content_id LIKE ? ORDER BY created_at DESC LIMIT 1', 
                    (f'%{suffix}',)
                )
                row = cursor.fetchone()
            if row:
                return {
                    'batchId': row['batch_id'],
                    'contentId': row['content_id'],
                    'name': row['name'],
                    'subject': row['subject'],
                    'topic': row['topic'],
                    'faculty': row['faculty'],
                    'image': row['image']
                }
    except Exception as e:
        logger.error(f"Failed to get content payload: {e}")
    return None


def vault_get_video(content_id: str, quality: str) -> Optional[Dict[str, Any]]:
    """Look up a video by content_id and quality in the vault."""
    if not content_id:
        return None

    c_id = str(content_id).strip()
    q = str(quality).lower().replace('p', '').strip()

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT batch_id, content_id, quality, channel_msg_id, file_id, title, subject, topic, created_at, hits
                FROM cached_videos
                WHERE content_id = ? AND quality = ?
            ''', (c_id, q))
            row = cursor.fetchone()
            if row:
                cursor.execute('UPDATE cached_videos SET hits = hits + 1 WHERE content_id = ? AND quality = ?', (c_id, q))
                cursor.execute("UPDATE vault_metrics SET val = val + 1 WHERE key = 'cache_hits'")
                conn.commit()
                return dict(row)
            else:
                cursor.execute("UPDATE vault_metrics SET val = val + 1 WHERE key = 'cache_misses'")
                conn.commit()
                return None
    except Exception as e:
        logger.error(f"Error querying Video Vault: {e}")
        return None


def vault_save_video(
    batch_id: str,
    content_id: str,
    quality: str,
    channel_msg_id: Optional[int] = None,
    file_id: Optional[str] = None,
    title: str = '',
    subject: str = '',
    topic: str = ''
) -> bool:
    """Save or update a video record in the vault."""
    if not content_id or not (channel_msg_id or file_id):
        logger.warning(f"Cannot save to vault: missing identifiers for content {content_id}")
        return False

    c_id = str(content_id).strip()
    b_id = str(batch_id or '').strip()
    q = str(quality).lower().replace('p', '').strip()

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO cached_videos 
                    (batch_id, content_id, quality, channel_msg_id, file_id, title, subject, topic)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(content_id, quality) DO UPDATE SET
                    batch_id = COALESCE(excluded.batch_id, cached_videos.batch_id),
                    channel_msg_id = COALESCE(excluded.channel_msg_id, cached_videos.channel_msg_id),
                    file_id = COALESCE(excluded.file_id, cached_videos.file_id),
                    title = COALESCE(excluded.title, cached_videos.title),
                    subject = COALESCE(excluded.subject, cached_videos.subject),
                    topic = COALESCE(excluded.topic, cached_videos.topic)
            ''', (b_id, c_id, q, channel_msg_id, file_id, title, subject, topic))
            conn.commit()
            logger.info(f"Video Vault saved: {c_id} ({q}p) -> ChannelMsg: {channel_msg_id}, FileID: {file_id[:16] if file_id else 'None'}...")
            return True
    except Exception as e:
        logger.error(f"Error saving to Video Vault: {e}")
        return False


def vault_get_pdf(content_id: str) -> Optional[Dict[str, Any]]:
    """Look up a PDF by content_id in the vault."""
    if not content_id:
        return None

    c_id = str(content_id).strip()
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT batch_id, content_id, channel_msg_id, file_id, title, subject, topic, faculty, pdf_url, created_at, hits
                FROM cached_pdfs
                WHERE content_id = ?
            ''', (c_id,))
            row = cursor.fetchone()
            if row:
                cursor.execute('UPDATE cached_pdfs SET hits = hits + 1 WHERE content_id = ?', (c_id,))
                cursor.execute("UPDATE vault_metrics SET val = val + 1 WHERE key = 'cache_hits'")
                conn.commit()
                return dict(row)
            else:
                return None
    except Exception as e:
        logger.error(f"Error querying PDF Vault: {e}")
        return None


def vault_save_pdf(
    batch_id: str,
    content_id: str,
    channel_msg_id: Optional[int] = None,
    file_id: Optional[str] = None,
    title: str = '',
    subject: str = '',
    topic: str = '',
    faculty: str = '',
    pdf_url: str = ''
) -> bool:
    """Save or update a PDF record in the vault."""
    if not content_id or not (channel_msg_id or file_id):
        logger.warning(f"Cannot save to PDF vault: missing identifiers for content {content_id}")
        return False

    c_id = str(content_id).strip()
    b_id = str(batch_id or '').strip()

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO cached_pdfs 
                    (batch_id, content_id, channel_msg_id, file_id, title, subject, topic, faculty, pdf_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(content_id) DO UPDATE SET
                    batch_id = COALESCE(excluded.batch_id, cached_pdfs.batch_id),
                    channel_msg_id = COALESCE(excluded.channel_msg_id, cached_pdfs.channel_msg_id),
                    file_id = COALESCE(excluded.file_id, cached_pdfs.file_id),
                    title = COALESCE(excluded.title, cached_pdfs.title),
                    subject = COALESCE(excluded.subject, cached_pdfs.subject),
                    topic = COALESCE(excluded.topic, cached_pdfs.topic),
                    faculty = COALESCE(excluded.faculty, cached_pdfs.faculty),
                    pdf_url = COALESCE(excluded.pdf_url, cached_pdfs.pdf_url)
            ''', (b_id, c_id, channel_msg_id, file_id, title, subject, topic, faculty, pdf_url))
            conn.commit()
            logger.info(f"PDF Vault saved: {c_id} -> ChannelMsg: {channel_msg_id}, FileID: {file_id[:16] if file_id else 'None'}...")
            return True
    except Exception as e:
        logger.error(f"Error saving to PDF Vault: {e}")
        return False


def vault_get_stats() -> Dict[str, Any]:
    """Retrieve vault status and metrics."""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT COUNT(*) as total, COUNT(DISTINCT content_id) as lectures FROM cached_videos')
            res = cursor.fetchone()
            total_vids = res['total'] if res else 0
            unique_lectures = res['lectures'] if res else 0

            cursor.execute('SELECT COUNT(*) as total_pdfs FROM cached_pdfs')
            pdf_res = cursor.fetchone()
            total_pdfs = pdf_res['total_pdfs'] if pdf_res else 0

            cursor.execute("SELECT val FROM vault_metrics WHERE key = 'cache_hits'")
            hit_row = cursor.fetchone()
            cache_hits = hit_row['val'] if hit_row else 0

            cursor.execute("SELECT val FROM vault_metrics WHERE key = 'cache_misses'")
            miss_row = cursor.fetchone()
            cache_misses = miss_row['val'] if miss_row else 0

            return {
                'total_videos': total_vids,
                'unique_lectures': unique_lectures,
                'total_pdfs': total_pdfs,
                'cache_hits': cache_hits,
                'cache_misses': cache_misses,
                'channel_id': STORAGE_CHANNEL_ID
            }
    except Exception as e:
        logger.error(f"Error reading vault stats: {e}")
        return {
            'total_videos': 0,
            'unique_lectures': 0,
            'total_pdfs': 0,
            'cache_hits': 0,
            'cache_misses': 0,
            'channel_id': STORAGE_CHANNEL_ID
        }


def record_referral(referrer_id: int, referred_id: int) -> bool:
    """Record a referral. Returns True if successfully recorded as a new referral."""
    if not referrer_id or not referred_id or referrer_id == referred_id:
        return False
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT OR IGNORE INTO referrals (referrer_id, referred_id) VALUES (?, ?)",
                (referrer_id, referred_id)
            )
            inserted = cursor.rowcount > 0
            if inserted:
                cursor.execute("SELECT COUNT(*) FROM referrals WHERE referrer_id = ?", (referrer_id,))
                count = cursor.fetchone()[0]
                if count >= 3:
                    cursor.execute(
                        "INSERT OR IGNORE INTO vip_users (user_id, is_vip, reason) VALUES (?, 1, '3_referrals')",
                        (referrer_id,)
                    )
            conn.commit()
            return inserted
    except Exception as e:
        logger.error(f"Error recording referral {referrer_id} <- {referred_id}: {e}")
        return False


def get_user_vip_info(user_id: int) -> Dict[str, Any]:
    """Return referral count and VIP status for a user."""
    if not user_id:
        return {'is_vip': False, 'referrals': 0, 'target': 3}
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM referrals WHERE referrer_id = ?", (user_id,))
            row = cursor.fetchone()
            count = row[0] if row else 0

            cursor.execute("SELECT is_vip FROM vip_users WHERE user_id = ?", (user_id,))
            vip_row = cursor.fetchone()
            is_vip = bool(vip_row and vip_row[0]) or (count >= 3)
            return {
                'is_vip': is_vip,
                'referrals': count,
                'target': 3
            }
    except Exception as e:
        logger.error(f"Error getting VIP info for {user_id}: {e}")
        return {'is_vip': False, 'referrals': 0, 'target': 3}


def grant_vip_status(user_id: int, reason: str = 'admin_grant') -> bool:
    """Manually grant VIP status."""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT OR REPLACE INTO vip_users (user_id, is_vip, reason) VALUES (?, 1, ?)",
                (user_id, reason)
            )
            conn.commit()
            return True
    except Exception as e:
        logger.error(f"Error granting VIP to {user_id}: {e}")
        return False


def is_vip_user(user_id: int) -> bool:
    """Quick check if a user is VIP."""
    info = get_user_vip_info(user_id)
    return info.get('is_vip', False)
