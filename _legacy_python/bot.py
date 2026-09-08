import asyncio
import json
import logging
import os
import aiohttp
from aiohttp import web
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import base64
import hashlib
import hmac
import time
import urllib.parse
import re
import secrets
import random
import string
from datetime import datetime, timezone, timedelta

from bridge import VideoBridge
from vault import (
    init_vault, vault_get_video, vault_save_video, vault_get_stats, 
    vault_get_pdf, vault_save_pdf,
    save_content_payload, get_content_payload, STORAGE_CHANNEL_ID,
    record_referral, get_user_vip_info, grant_vip_status, is_vip_user
)
from guru_ai import solve_doubt

BOT_TOKEN = os.environ.get('BOT_TOKEN', '8822004090:AAGGfKxQKTe_VypYfn6nD03miEqOWsMjR5k')
BOT_USERNAME = os.environ.get('BOT_USERNAME', 'StudyBot')
BOT_NAME = os.environ.get('BOT_NAME', 'Study Hub')
TG_API_BASE = f'https://api.telegram.org/bot{BOT_TOKEN}'

WEBAPP_URL = os.environ.get('WEBAPP_URL', 'https://yourstudyhub.onrender.com/')
if not WEBAPP_URL.endswith('/'):
    WEBAPP_URL += '/'

def get_banner_filename() -> str:
    choice = str(os.environ.get('BANNER') or os.environ.get('BANNER_ID') or os.environ.get('BANNER_CHOICE') or '1').strip()
    return 'banner2.jpg' if choice == '2' else 'banner.jpg'

def get_banner_url(base_url: str = None) -> str:
    custom_url = os.environ.get('BANNER_URL', '').strip()
    if custom_url:
        return custom_url
    b_url = base_url or WEBAPP_URL or ''
    if b_url and not b_url.endswith('/'):
        b_url += '/'
    return f"{b_url}{get_banner_filename()}"


logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger('Study HubBot')

bridge = VideoBridge(BOT_TOKEN, BOT_USERNAME)
CONTENT_STORE = {}
LATEST_RELAYED_VIDEOS = asyncio.Queue()

# ════════════════════════════════════════════════════════════════
# PERSISTENT DATA STORAGE (Admins, Users, Global Settings)
# ════════════════════════════════════════════════════════════════
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
os.makedirs(DATA_DIR, exist_ok=True)
ADMINS_FILE = os.path.join(DATA_DIR, 'admins.json')
USERS_FILE = os.path.join(DATA_DIR, 'users.json')
SETTINGS_FILE = os.path.join(DATA_DIR, 'settings.json')

DEFAULT_SETTINGS = {
    'mini_app_enabled': True,
    'maintenance': False,
    'maintenance_msg': 'The Study Hub is currently paused for scheduled maintenance. Please check back shortly!',
    'forcesub': False,
    'channel_link': os.environ.get('CHANNEL_LINK', 'https://t.me/'),
    'channel_id': -1002711219748,
    'group_link': os.environ.get('GROUP_LINK', 'https://t.me/'),
    'group_id': -1002651264547,
    'protect_content': True
}

def load_json(filepath, default):
    if not os.path.exists(filepath):
        save_json(filepath, default)
        return default
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error loading {filepath}: {e}")
        return default

def save_json(filepath, data):
    try:
        tmp_path = filepath + '.tmp'
        with open(tmp_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        if os.path.exists(filepath):
            os.replace(tmp_path, filepath)
        else:
            os.rename(tmp_path, filepath)
    except Exception as e:
        logger.error(f"Error saving {filepath}: {e}")

# Permanent Master Config (Survives Render container redeploys & ephemeral disks)
PERMANENT_SUPER_ADMIN_ID = int(os.environ.get('SUPER_ADMIN_ID', 7974991150))
PERMANENT_CHANNEL_ID = int(os.environ.get('CHANNEL_ID', -1002711219748))
PERMANENT_GROUP_ID = int(os.environ.get('GROUP_ID', -1002651264547))

admins_data = load_json(ADMINS_FILE, {'super_admin': PERMANENT_SUPER_ADMIN_ID, 'admins': {}})
users_data = load_json(USERS_FILE, {})
settings_data = load_json(SETTINGS_FILE, DEFAULT_SETTINGS)

# Permanent Super Admin Guarantee across Render redeploys
SUPER_ADMIN_ID_VAL = int(os.environ.get('SUPER_ADMIN_ID', 0)) if str(os.environ.get('SUPER_ADMIN_ID', '')).isdigit() else 0
PERMANENT_OWNERS = {
    SUPER_ADMIN_ID_VAL: {'name': os.environ.get('SUPER_ADMIN_NAME', 'Super Admin'), 'username': os.environ.get('SUPER_ADMIN_USERNAME', 'admin')}
} if SUPER_ADMIN_ID_VAL else {}

if not admins_data.get('super_admin'):
    admins_data['super_admin'] = PERMANENT_SUPER_ADMIN_ID

for o_id, o_meta in PERMANENT_OWNERS.items():
    o_str = str(o_id)
    if o_str not in admins_data.setdefault('admins', {}):
        admins_data['admins'][o_str] = {
            'id': o_id,
            'username': o_meta['username'],
            'name': o_meta['name'],
            'role': 'Super Admin',
            'added_at': '2026-09-08T00:00:00+00:00',
            'promoted_by': 'Permanent System Config'
        }
save_json(ADMINS_FILE, admins_data)

# Permanent Channel & Group Guarantee across Render redeploys
if not settings_data.get('channel_id'):
    settings_data['channel_id'] = PERMANENT_CHANNEL_ID
    save_json(SETTINGS_FILE, settings_data)

if not settings_data.get('group_id'):
    settings_data['group_id'] = PERMANENT_GROUP_ID
    save_json(SETTINGS_FILE, settings_data)

def is_super_admin(user_id: int) -> bool:
    return admins_data.get('super_admin') == user_id or user_id in PERMANENT_OWNERS

def is_admin(user_id: int) -> bool:
    if is_super_admin(user_id):
        return True
    return str(user_id) in admins_data.get('admins', {})

def is_user_banned(user_id: int) -> bool:
    return users_data.get(str(user_id), {}).get('banned', False)

def update_user_db(user: dict):
    if not user or user.get('is_bot'):
        return
    uid = str(user.get('id'))
    now_iso = datetime.now(timezone.utc).isoformat()
    if uid not in users_data:
        users_data[uid] = {
            'id': user.get('id'),
            'username': user.get('username', ''),
            'first_name': user.get('first_name', ''),
            'last_name': user.get('last_name', ''),
            'joined_at': now_iso,
            'last_active': now_iso,
            'banned': False
        }
        save_json(USERS_FILE, users_data)
    else:
        u = users_data[uid]
        u['last_active'] = now_iso
        if user.get('username') is not None:
            u['username'] = user.get('username', '')
        if user.get('first_name') is not None:
            u['first_name'] = user.get('first_name', '')
        if user.get('last_name') is not None:
            u['last_name'] = user.get('last_name', '')
        save_json(USERS_FILE, users_data)

USER_COMMANDS = [
    {'command': 'start', 'description': 'Launch Study Hub'},
    {'command': 'batches', 'description': 'Explore all Batches'},
    {'command': 'guru', 'description': '🤖 AI Doubt Solver (Ask any doubt)'},
    {'command': 'invite', 'description': '🎁 Refer friends & earn VIP Status'},
    {'command': 'help', 'description': 'How to use this bot'}
]

ADMIN_COMMANDS = [
    {'command': 'start', 'description': 'Launch Study Hub'},
    {'command': 'batches', 'description': 'Explore all Batches'},
    {'command': 'guru', 'description': '🤖 AI Doubt Solver (Ask any doubt)'},
    {'command': 'invite', 'description': '🎁 Refer friends & earn VIP Status'},
    {'command': 'admin', 'description': '👑 Open Admin Control Panel & Dashboard'},
    {'command': 'forcesub', 'description': '🔒 Toggle ForceSub: on / off / status'},
    {'command': 'checkadmin', 'description': '🛡️ Audit bot permissions in channel/group'},
    {'command': 'broadcast', 'description': '📢 Broadcast message/media to all users'},
    {'command': 'stats', 'description': '📊 User & system performance statistics'},
    {'command': 'botoff', 'description': '🛑 Turn off Mini App (Maintenance mode)'},
    {'command': 'boton', 'description': '🟢 Turn on Mini App'},
    {'command': 'maintenance', 'description': '🛠️ Set custom maintenance notice text'},
    {'command': 'setchannelid', 'description': '📢 Set channel numerical ID: /setchannelid <id>'},
    {'command': 'setchannel', 'description': '🔗 Update official channel link'},
    {'command': 'setgroup', 'description': '💬 Update discussion group link'},
    {'command': 'protectmode', 'description': '🛡️ Toggle content protection (on/off)'},
    {'command': 'ban', 'description': '🔨 Ban user: /ban <id> [reason]'},
    {'command': 'unban', 'description': '✅ Unban user: /unban <id>'},
    {'command': 'exportusers', 'description': '📁 Download users database backup file'},
    {'command': 'adminlist', 'description': '👥 View list of all authorized admins'},
    {'command': 'revokeadmin', 'description': '❌ Revoke admin rights: /revokeadmin <id>'},
    {'command': 'finduser', 'description': '🔍 Lookup user details: /finduser <id/user>'},
    {'command': 'speedtest', 'description': '⚡ Latency test to Telegram & upstream APIs'},
    {'command': 'restart', 'description': '🔄 Soft reload bot configuration & cache'},
    {'command': 'help', 'description': '📖 Admin commands guide & manual'}
]

BOT_ID = int(BOT_TOKEN.split(':', 1)[0]) if ':' in BOT_TOKEN else 8822004090

async def check_chat_member(chat_target, user_id: int) -> bool:
    if not chat_target:
        return True
    try:
        res = await tg_call('getChatMember', {'chat_id': chat_target, 'user_id': user_id})
        if not res.get('ok'):
            return False
        status = res.get('result', {}).get('status', '')
        if status in ('creator', 'administrator', 'member'):
            return True
        if status == 'restricted':
            return res.get('result', {}).get('is_member', True)
        return False
    except Exception as e:
        logger.error(f"Error checking chat member for {chat_target}: {e}")
        return False

async def verify_user_sub(user_id: int) -> dict:
    if is_admin(user_id):
        return {'subscribed': True, 'channel_ok': True, 'group_ok': True, 'missing': []}

    if not settings_data.get('forcesub', False):
        return {'subscribed': True, 'channel_ok': True, 'group_ok': True, 'missing': []}

    # 1. Channel check
    channel_target = settings_data.get('channel_id')
    channel_ok = True
    if channel_target:
        channel_ok = await check_chat_member(channel_target, user_id)

    # 2. Group check (public username or ID)
    group_target = settings_data.get('group_id') or os.environ.get('GROUP_LINK', '@studyhub_chat')
    group_ok = await check_chat_member(group_target, user_id)

    missing = []
    if not channel_ok:
        missing.append('channel')
    if not group_ok:
        missing.append('group')

    return {
        'subscribed': (channel_ok and group_ok),
        'channel_ok': channel_ok,
        'group_ok': group_ok,
        'missing': missing
    }

async def send_forcesub_restriction(chat_id: int, sub_info: dict, message_id_to_edit: int = None):
    channel_url = settings_data.get('channel_link', os.environ.get('CHANNEL_LINK', 'https://t.me/'))
    group_url = settings_data.get('group_link', os.environ.get('GROUP_LINK', 'https://t.me/'))

    missing = sub_info.get('missing', [])
    channel_missing = 'channel' in missing
    group_missing = 'group' in missing

    buttons = []
    if channel_missing and group_missing:
        desc = (
            "🔒 **ACCESS RESTRICTED — ACTION REQUIRED** 🔒\n\n"
            "To use **Study Hub Study Bot** and launch the Mini App, you must join our official community:\n\n"
            "1. 📢 Join our **Official Channel** for batch updates & material\n"
            "2. 💬 Join our **Discussion Group** for study doubt-solving\n\n"
            "👇 Tap the buttons below to join, then click **Verify**:"
        )
        buttons.append([{'text': '📢 1. Join Official Channel', 'url': channel_url}])
        buttons.append([{'text': '💬 2. Join Discussion Group', 'url': group_url}])
    elif channel_missing:
        desc = (
            "🔒 **ACCESS RESTRICTED — CHANNEL PENDING** 🔒\n\n"
            "You have joined the group, but you have **NOT joined our Official Channel** yet!\n\n"
            "👇 Tap below to join our Official Channel, then click **Verify**:"
        )
        buttons.append([{'text': '📢 Join Official Channel', 'url': channel_url}])
    elif group_missing:
        desc = (
            "🔒 **ACCESS RESTRICTED — GROUP PENDING** 🔒\n\n"
            "You have joined the channel, but you have **NOT joined our Discussion Group** yet!\n\n"
            "👇 Tap below to join our Discussion Group, then click **Verify**:"
        )
        buttons.append([{'text': '💬 Join Discussion Group', 'url': group_url}])
    else:
        desc = "🔒 **ACCESS RESTRICTED**\nPlease join our official communities below:"
        buttons.append([{'text': '📢 Join Channel', 'url': channel_url}])
        buttons.append([{'text': '💬 Join Group', 'url': group_url}])

    buttons.append([{'text': '🔄 Joined! Verify Now', 'callback_data': 'check_forcesub'}])
    keyboard = {'inline_keyboard': buttons}

    if message_id_to_edit:
        await tg_call('editMessageText', {
            'chat_id': chat_id,
            'message_id': message_id_to_edit,
            'text': desc,
            'parse_mode': 'Markdown',
            'reply_markup': keyboard
        })
    else:
        await tg_call('sendMessage', {
            'chat_id': chat_id,
            'text': desc,
            'parse_mode': 'Markdown',
            'reply_markup': keyboard
        })

def get_launch_url(base_url: str) -> str:
    return base_url

async def send_verified_welcome(chat_id: int, first_name: str, app_url: str):
    channel_url = settings_data.get('channel_link', os.environ.get('CHANNEL_LINK', 'https://t.me/'))
    group_url = settings_data.get('group_link', os.environ.get('GROUP_LINK', 'https://t.me/'))
    dev_name = os.environ.get('DEVELOPER_NAME', 'Admin')
    dev_handle = os.environ.get('DEVELOPER_HANDLE', 'Support')
    dev_link = os.environ.get('DEVELOPER_LINK', 'https://t.me/')

    welcome_text = (
        f"⚡ **HEY {first_name.upper()}! WELCOME TO {BOT_NAME.upper()}** ⚡\n\n"
        f"🎓 **All-In-One Study Hub**\n"
        f"Access premium batches, video lectures, class notes, and DPPs across Physics Wallah, Next Topper, and Mission JEET in one seamless, high-speed interface.\n\n"
        f"👨‍💻 **Developer:** {dev_name} | [{dev_handle}]({dev_link})\n\n"
        f"✨ **Features:**\n"
        f"• Instant multi-quality streaming (720p / 480p / 360p / 240p)\n"
        f"• Organized chapters, folders & DPP notes\n"
        f"• Custom full-window responsive player\n\n"
        f"👇 Tap below to launch your Study Hub or join our official community:"
    )
    launch_url = get_launch_url(app_url)
    keyboard = {
        'inline_keyboard': [
            [{'text': '📦 Launch Study Hub', 'web_app': {'url': launch_url}}],
            [
                {'text': '🤖 Guru AI Doubt Solver', 'callback_data': 'btn_guru_info'},
                {'text': '🎁 Invite & Earn VIP', 'callback_data': 'btn_invite_info'}
            ],
            [
                {'text': '📢 Official Channel', 'url': channel_url},
                {'text': '💬 Discussion Group', 'url': group_url}
            ]
        ]
    }
    banner_url = get_banner_url(app_url)
    res = await tg_call('sendPhoto', {
        'chat_id': chat_id,
        'photo': banner_url,
        'caption': welcome_text,
        'parse_mode': 'Markdown',
        'reply_markup': keyboard
    })
    if not res.get('ok'):
        await tg_call('sendMessage', {
            'chat_id': chat_id,
            'text': welcome_text,
            'parse_mode': 'Markdown',
            'reply_markup': keyboard
        })

async def register_admin_commands(chat_id: int):
    res = await tg_call('setMyCommands', {
        'commands': ADMIN_COMMANDS,
        'scope': {'type': 'chat', 'chat_id': chat_id}
    })
    logger.info(f"Registered scoped admin commands for {chat_id}: {res.get('ok')}")
    return res.get('ok', False)

async def remove_admin_commands(chat_id: int):
    res = await tg_call('deleteMyCommands', {
        'scope': {'type': 'chat', 'chat_id': chat_id}
    })
    logger.info(f"Removed scoped admin commands for {chat_id}: {res.get('ok')}")
    return res.get('ok', False)

# Live HMAC-SHA256 Auth & Dynamic Session Handshake for AS Multiverse Providers
A1_SECRET = '1mBD4OQnsBMBaN6oISWwTmryX1lHjkW9XLZhsirCOT0='
A1_KEY_BYTES = base64.b64decode(A1_SECRET)

def generate_asmultiverse_device_id() -> str:
    # Mimic official web app: "WEB_" + Math.random().toString(36).substring(2, 15).toUpperCase()
    chars = string.ascii_uppercase + string.digits
    return 'WEB_' + ''.join(random.choices(chars, k=13))

AS_CURRENT_DEV = generate_asmultiverse_device_id()
AS_INITIALIZED_SESSIONS: dict = {}

BATCH_DETAILS_CACHE: dict = {}
TOPICS_CACHE: dict = {}
BATCH_CONTENT_CACHE: dict = {}
CONTENT_DETAILS_CACHE: dict = {}

def get_asmultiverse_headers(device_id: str = None) -> dict:
    global AS_CURRENT_DEV
    dev = device_id or AS_CURRENT_DEV
    ts = str(int(time.time()))
    auth_key = base64.b64encode(ts.encode('utf-8')).decode('utf-8')
    sig = hmac.new(A1_KEY_BYTES, ts.encode('utf-8'), hashlib.sha256).digest()
    auth_sig = base64.b64encode(sig).decode('utf-8')
    return {
        'X-Client-Id': dev,
        'MadX-Auth-Key': auth_key,
        'MadX-Auth-Signature': auth_sig,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    }

async def fetch_asmultiverse_json(session: aiohttp.ClientSession, url: str, prov: str) -> dict:
    global AS_CURRENT_DEV, AS_INITIALIZED_SESSIONS

    for attempt in range(3):
        dev = AS_CURRENT_DEV
        if prov not in AS_INITIALIZED_SESSIONS:
            AS_INITIALIZED_SESSIONS[prov] = set()

        # Upstream backend requires device handshake on /batches before sub-resources can be accessed
        if dev not in AS_INITIALIZED_SESSIONS[prov] and '/batches' not in url:
            init_url = f"https://api.asmultiverse.app/api/v1/{prov}/batches?page=1"
            try:
                async with session.get(init_url, headers=get_asmultiverse_headers(dev), timeout=8) as r_init:
                    if r_init.status == 200:
                        AS_INITIALIZED_SESSIONS[prov].add(dev)
            except Exception as ex:
                logger.warning(f"Session handshake for {prov} failed: {ex}")

        try:
            h = get_asmultiverse_headers(dev)
            async with session.get(url, headers=h, timeout=12) as resp:
                if resp.status == 200:
                    if '/batches' in url:
                        AS_INITIALIZED_SESSIONS[prov].add(dev)
                    data = await resp.json()
                    # Check logical status inside body (e.g. 403 or 429)
                    if data.get('status') in (403, 429) or not data.get('success', True):
                        logger.warning(f"Upstream logical status {data.get('status')} ({data.get('message')}), rotating device...")
                        AS_CURRENT_DEV = generate_asmultiverse_device_id()
                        await asyncio.sleep(0.3 * (attempt + 1))
                        continue
                    return data
                elif resp.status in (403, 429):
                    logger.warning(f"Upstream HTTP status {resp.status} on {url}, rotating device...")
                    AS_CURRENT_DEV = generate_asmultiverse_device_id()
                    await asyncio.sleep(0.4 * (attempt + 1))
                    continue
                else:
                    logger.warning(f"Upstream status {resp.status} on {url}")
                    return {}
        except Exception as e:
            logger.error(f"Error fetching asmultiverse {url} (attempt {attempt + 1}): {e}")
            if attempt < 2:
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
            return {}

    return {}

AS_MULTIVERSE_PROVIDERS = {
    'nexttopper': 'nt',
    'missionjeet': 'missionjeet',
    'vidyakul': 'vidyakul',
    'apnacollege': 'apnacollage',
    'sketchbook': 'sketchbook',
}

async def tg_call(method: str, payload: dict = None) -> dict:
    url = f'{TG_API_BASE}/{method}'
    try:
        payload = payload.copy() if payload else {}
        # Apply protect_content globally to prevent media saving/forwarding
        if settings_data.get('protect_content', True):
            content_methods = ('sendMessage', 'sendPhoto', 'sendVideo', 'sendDocument', 'sendAudio', 'sendAnimation', 'copyMessage')
            if method in content_methods and 'protect_content' not in payload:
                payload['protect_content'] = True

        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, timeout=20) as resp:
                data = await resp.json()
                if not data.get('ok'):
                    logger.warning(f'Telegram API error ({method}): {data}')
                return data
    except Exception as e:
        logger.error(f'Error calling {method}: {e}')
        return {'ok': False, 'error': str(e)}

async def send_document_file(chat_id: int, file_path: str, caption: str = "") -> dict:
    url = f'{TG_API_BASE}/sendDocument'
    try:
        data = aiohttp.FormData()
        data.add_field('chat_id', str(chat_id))
        if caption:
            data.add_field('caption', caption)
        if settings_data.get('protect_content', True):
            data.add_field('protect_content', 'true')
        
        with open(file_path, 'rb') as f:
            file_bytes = f.read()
            data.add_field('document', file_bytes, filename=os.path.basename(file_path), content_type='application/json')
            async with aiohttp.ClientSession() as session:
                async with session.post(url, data=data, timeout=30) as resp:
                    return await resp.json()
    except Exception as e:
        logger.error(f"Error sending file {file_path}: {e}")
        return {'ok': False, 'error': str(e)}

async def setup_bot_profile(app_url: str):
    launch_url = get_launch_url(app_url)
    logger.info(f'Configuring bot profile with WebApp URL: {launch_url}')
    await tg_call('setChatMenuButton', {
        'menu_button': {
            'type': 'web_app',
            'text': 'Study Hub',
            'web_app': {'url': launch_url}
        }
    })
    # Set default commands visible to all students
    await tg_call('setMyCommands', {
        'commands': USER_COMMANDS,
        'scope': {'type': 'default'}
    })
    await tg_call('setMyShortDescription', {
        'short_description': 'Study Hub - Free PW, NextTopper & MissionJEET batches.'
    })

    # Re-register chat-scoped admin commands for all authorized admins
    for admin_id_str in list(admins_data.get('admins', {}).keys()):
        try:
            await register_admin_commands(int(admin_id_str))
        except Exception as e:
            logger.warning(f"Could not register commands for admin {admin_id_str}: {e}")

    logger.info('Bot profile & scoped commands configured!')

async def handle_start(msg: dict, app_url: str):
    chat_id = msg['chat']['id']
    from_user = msg.get('from', {})
    user_id = from_user.get('id', chat_id)
    first_name = from_user.get('first_name', 'Student')
    # If not admin, ensure any stray chat-scoped admin commands are deleted
    if not is_admin(user_id):
        asyncio.create_task(remove_admin_commands(chat_id))

    # Maintenance Mode Check
    is_maint = (not settings_data.get('mini_app_enabled', True)) or settings_data.get('maintenance', False)
    if is_maint and not is_admin(user_id):
        m_msg = settings_data.get('maintenance_msg', 'The Study Hub is currently paused for scheduled maintenance.')
        channel_url = settings_data.get('channel_link', os.environ.get('CHANNEL_LINK', 'https://t.me/'))
        group_url = settings_data.get('group_link', os.environ.get('GROUP_LINK', 'https://t.me/'))
        await tg_call('sendMessage', {
            'chat_id': chat_id,
            'text': (
                "🛑 **MINI APP & BOT ARE CURRENTLY OFF (MAINTENANCE MODE)** 🛑\n\n"
                f"📢 **Maintenance Notice:**\n_{m_msg}_\n\n"
                "We are updating our servers and syncing new batches. Please check back shortly!\n\n"
                "Join our official communities below for instant alerts when we go live:"
            ),
            'parse_mode': 'Markdown',
            'reply_markup': {
                'inline_keyboard': [
                    [
                        {'text': '📢 Official Channel', 'url': channel_url},
                        {'text': '💬 Discussion Group', 'url': group_url}
                    ]
                ]
            }
        })
    # ForceSub Verification
    if settings_data.get('forcesub', False) and not is_admin(user_id):
        sub_info = await verify_user_sub(user_id)
        if not sub_info['subscribed']:
            await send_forcesub_restriction(chat_id, sub_info)
            return

    # Referral Tracking
    text = (msg.get('text') or '').strip()
    if 'ref_' in text:
        try:
            ref_part = text.split('ref_')[1].split()[0]
            if ref_part.lstrip('-').isdigit():
                referrer_id = int(ref_part)
                if referrer_id != user_id:
                    is_new = record_referral(referrer_id, user_id)
                    if is_new:
                        ref_info = get_user_vip_info(referrer_id)
                        curr_count = ref_info.get('referrals', 0)
                        if curr_count >= 3:
                            asyncio.create_task(tg_call('sendMessage', {
                                'chat_id': referrer_id,
                                'text': (
                                    "🎉 **CONGRATULATIONS! VIP STATUS UNLOCKED!** 👑\n"
                                    "━━━━━━━━━━━━━━━━━━━━━━\n"
                                    f"Your friend **{first_name}** just joined using your invite link!\n"
                                    f"You have reached **{curr_count}/3 referrals**.\n\n"
                                    "👑 You are now an official **VIP Student** on Study Hub Study Hub!\n"
                                    "Enjoy priority fast streaming and your glowing VIP Crown badge in the app.\n\n"
                                    "⚡ *Powered by Study Hub*"
                                ),
                                'parse_mode': 'Markdown'
                            }))
                        else:
                            asyncio.create_task(tg_call('sendMessage', {
                                'chat_id': referrer_id,
                                'text': (
                                    "🎁 **New Friend Joined via Your Link!**\n"
                                    "━━━━━━━━━━━━━━━━━━━━━━\n"
                                    f"Your friend **{first_name}** just joined Study Hub!\n"
                                    f"Your Progress: **{curr_count}/3 friends joined**.\n"
                                    f"Invite **{3 - curr_count} more** to unlock **👑 VIP Student Status**!\n\n"
                                    "⚡ *Powered by Study Hub*"
                                ),
                                'parse_mode': 'Markdown'
                            }))
        except Exception as e:
            logger.error(f"Error processing referral in handle_start: {e}")

    await send_verified_welcome(chat_id, first_name, app_url)

async def handle_callback_query(cq: dict):
    cq_id = cq.get('id')
    data = cq.get('data', '')
    chat_id = cq.get('message', {}).get('chat', {}).get('id')

    if data == 'close':
        await tg_call('answerCallbackQuery', {'callback_query_id': cq_id})
        msg_id = cq.get('message', {}).get('message_id')
        if msg_id and chat_id:
            await tg_call('deleteMessage', {'chat_id': chat_id, 'message_id': msg_id})
        return

    if data == 'btn_guru_info':
        await tg_call('answerCallbackQuery', {'callback_query_id': cq_id})
        await handle_guru_telegram({'chat': {'id': chat_id}, 'from': cq.get('from', {}), 'text': ''})
        return

    if data == 'btn_invite_info':
        await tg_call('answerCallbackQuery', {'callback_query_id': cq_id})
        await handle_invite({'chat': {'id': chat_id}, 'from': cq.get('from', {})})
        return

    if data == 'check_forcesub':
        from_id = cq.get('from', {}).get('id')
        first_name = cq.get('from', {}).get('first_name', 'Student')
        sub_info = await verify_user_sub(from_id)

        if not sub_info['subscribed']:
            missing = sub_info.get('missing', [])
            if 'channel' in missing and 'group' in missing:
                alert_txt = "❌ You haven't joined the Channel or Group yet!"
            elif 'channel' in missing:
                alert_txt = "❌ You haven't joined the Official Channel yet!"
            else:
                alert_txt = "❌ You haven't joined the Discussion Group yet!"
            await tg_call('answerCallbackQuery', {
                'callback_query_id': cq_id,
                'text': alert_txt,
                'show_alert': True
            })
            msg_id = cq.get('message', {}).get('message_id')
            if msg_id and chat_id:
                await send_forcesub_restriction(chat_id, sub_info, message_id_to_edit=msg_id)
            return

        # Verification Succeeded!
        await tg_call('answerCallbackQuery', {
            'callback_query_id': cq_id,
            'text': "✅ Verification Successful! Welcome to Study Hub."
        })
        msg_id = cq.get('message', {}).get('message_id')
        if msg_id and chat_id:
            await tg_call('deleteMessage', {'chat_id': chat_id, 'message_id': msg_id})
        
        await send_verified_welcome(chat_id, first_name, WEBAPP_URL)
        return

    if data.startswith('approve_admin:'):
        from_id = cq.get('from', {}).get('id')
        if not is_admin(from_id):
            await tg_call('answerCallbackQuery', {'callback_query_id': cq_id, 'text': '❌ Only authorized admins can approve.', 'show_alert': True})
            return

        target_id_str = data.split(':', 1)[1]
        target_id = int(target_id_str)
        u_info = users_data.get(target_id_str, {})
        u_name = u_info.get('first_name', 'Admin')
        u_user = u_info.get('username', '')

        admins_data['admins'][target_id_str] = {
            'id': target_id,
            'username': u_user,
            'name': u_name,
            'role': 'Admin',
            'added_at': datetime.now(timezone.utc).isoformat(),
            'promoted_by': from_id
        }
        save_json(ADMINS_FILE, admins_data)
        await register_admin_commands(target_id)

        await tg_call('answerCallbackQuery', {'callback_query_id': cq_id, 'text': f'✅ Admin rights granted to {target_id}'})
        msg_id = cq.get('message', {}).get('message_id')
        if msg_id and chat_id:
            approver_user = cq.get('from', {}).get('username') or str(from_id)
            await tg_call('editMessageText', {
                'chat_id': chat_id,
                'message_id': msg_id,
                'text': f"✅ **Admin Request Approved**\n\nUser `{target_id}` ({u_name} @{u_user}) has been granted Admin privileges by @{approver_user}.",
                'parse_mode': 'Markdown'
            })

        try:
            await tg_call('sendMessage', {
                'chat_id': target_id,
                'text': (
                    "🎉 **ADMIN PRIVILEGES GRANTED!** 🎉\n\n"
                    "The Super Admin has approved your authorization request.\n"
                    "You now have access to the Study Hub admin command suite.\n\n"
                    "Type `/` to view the admin command menu or `/help` for details."
                ),
                'parse_mode': 'Markdown'
            })
        except: pass
        return

    if data.startswith('reject_admin:'):
        from_id = cq.get('from', {}).get('id')
        if not is_admin(from_id):
            await tg_call('answerCallbackQuery', {'callback_query_id': cq_id, 'text': '❌ Only authorized admins can reject.', 'show_alert': True})
            return

        target_id_str = data.split(':', 1)[1]
        target_id = int(target_id_str)

        await tg_call('answerCallbackQuery', {'callback_query_id': cq_id, 'text': f'❌ Admin request rejected for {target_id}'})
        msg_id = cq.get('message', {}).get('message_id')
        if msg_id and chat_id:
            approver_user = cq.get('from', {}).get('username') or str(from_id)
            await tg_call('editMessageText', {
                'chat_id': chat_id,
                'message_id': msg_id,
                'text': f"❌ **Admin Request Rejected**\n\nRequest for user `{target_id}` was rejected by @{approver_user}.",
                'parse_mode': 'Markdown'
            })

        try:
            await tg_call('sendMessage', {
                'chat_id': target_id,
                'text': "🚫 **Admin Request Rejected**\n\nYour request for admin authorization was not approved.",
                'parse_mode': 'Markdown'
            })
        except: pass
        return

    if data.startswith('q:'):
        from_id = cq.get('from', {}).get('id')
        if settings_data.get('forcesub', False) and not is_admin(from_id):
            sub_info = await verify_user_sub(from_id)
            if not sub_info['subscribed']:
                await tg_call('answerCallbackQuery', {
                    'callback_query_id': cq_id,
                    'text': '🔒 Access Restricted! Please join our channel and group to stream.',
                    'show_alert': True
                })
                await send_forcesub_restriction(chat_id, sub_info)
                return

        parts = data.split(':', 2)
        if len(parts) < 3:
            await tg_call('answerCallbackQuery', {'callback_query_id': cq_id, 'text': 'Invalid request'})
            return

        quality = parts[1]
        payload_key = parts[2]
        payload = CONTENT_STORE.get(payload_key) or get_content_payload(payload_key) or {}

        batch_id = str(payload.get('batchId') or '').strip()
        content_id = str(payload.get('contentId') or '').strip()
        quality_num = quality.lower().replace('p', '').strip()

        # Check if we can recover content_id from SQLite if missing from memory
        if not content_id and payload_key.startswith('c_'):
            recovered = get_content_payload(payload_key)
            if recovered:
                payload = recovered
                batch_id = str(payload.get('batchId') or '').strip()
                content_id = str(payload.get('contentId') or '').strip()

        if not content_id:
            logger.warning(f"Payload not found for key {payload_key}. Alerting user.")
            await tg_call('answerCallbackQuery', {
                'callback_query_id': cq_id,
                'text': '⚠️ Session expired. Please open Study Hub and tap this lecture again to get the latest download buttons.',
                'show_alert': True
            })
            return

        faculty = payload.get('faculty', 'Faculty')
        name = payload.get('name', 'Lecture')
        subject = payload.get('subject', 'Physics')
        topic = payload.get('topic', 'General')

        await tg_call('answerCallbackQuery', {'callback_query_id': cq_id, 'text': f'Fetching {quality} video...'})

        status_res = await tg_call('sendMessage', {
            'chat_id': chat_id,
            'text': '⏳ Fetching file, please wait...'
        })
        status_msg_id = status_res.get('result', {}).get('message_id')

        faculty_header = f'By {faculty}\n\n' if faculty and str(faculty).strip().lower() not in ('none', '') else ''
        caption = (
            f'{faculty_header}'
            f'📹 Title: {name}\n\n'
            f'🏫 Subject: {subject}\n\n'
            f'🚩 Topic: {topic}\n\n'
            f'🎬 Quality: {quality}\n\n'
            f'⚡ Powered by Study Hub'
        )

        video_delivered = False

        # ─── 1. CHECK VIDEO VAULT (STORAGE CHANNEL & LOCAL CACHE) FIRST ───
        cached_vid = vault_get_video(content_id, quality_num)
        if cached_vid:
            logger.info(f"⚡ [VideoVault] Cache HIT for {content_id} ({quality_num}p)! Delivering directly from storage...")
            cached_ch_msg_id = cached_vid.get('channel_msg_id')
            cached_file_id = cached_vid.get('file_id')

            # Attempt A: copyMessage from storage channel (permanent, fast, zero forward tags)
            if cached_ch_msg_id and STORAGE_CHANNEL_ID:
                try:
                    copy_res = await tg_call('copyMessage', {
                        'chat_id': chat_id,
                        'from_chat_id': int(STORAGE_CHANNEL_ID),
                        'message_id': cached_ch_msg_id,
                        'caption': caption
                    })
                    if copy_res.get('ok'):
                        video_delivered = True
                        logger.info(f"⚡ [VideoVault] Delivered via copyMessage (Msg ID: {cached_ch_msg_id}) to {chat_id}")
                except Exception as ex:
                    logger.warning(f"[VideoVault] copyMessage failed: {ex}")

            # Attempt B: Fallback sendVideo using cached file_id
            if not video_delivered and cached_file_id:
                try:
                    send_res = await tg_call('sendVideo', {
                        'chat_id': chat_id,
                        'video': cached_file_id,
                        'caption': caption,
                        'supports_streaming': True
                    })
                    if send_res.get('ok'):
                        video_delivered = True
                        logger.info(f"⚡ [VideoVault] Delivered via cached file_id to {chat_id}")
                    else:
                        send_doc = await tg_call('sendDocument', {
                            'chat_id': chat_id,
                            'document': cached_file_id,
                            'caption': caption
                        })
                        if send_doc.get('ok'):
                            video_delivered = True
                except Exception as ex:
                    logger.warning(f"[VideoVault] Cached file_id send failed: {ex}")

        # ─── 2. CACHE MISS: QUERY TELETHON BRIDGE VIA @AS_Multiverserobot ───
        if not video_delivered and bridge.active:
            logger.info(f'Fetching {quality} video via AS_Multiverserobot Bridge for {chat_id}...')
            
            # Flush older queued items
            while not LATEST_RELAYED_VIDEOS.empty():
                try: LATEST_RELAYED_VIDEOS.get_nowait()
                except: break

            res_info = await bridge.fetch_and_forward_to_bot(chat_id, payload, quality=quality, caption=caption)
            if res_info:
                channel_msg_id = res_info.get('channel_msg_id') if isinstance(res_info, dict) else None
                
                # Save immediately to Video Vault cache
                if channel_msg_id:
                    vault_save_video(
                        batch_id=batch_id,
                        content_id=content_id,
                        quality=quality_num,
                        channel_msg_id=channel_msg_id,
                        file_id='',
                        title=name,
                        subject=subject,
                        topic=topic
                    )

                helper_id = getattr(bridge.me, 'id', None)
                if helper_id and chat_id == helper_id:
                    logger.info(f"Student {chat_id} is helper account — clean unforwarded video delivered in chat.")
                    video_delivered = True
                else:
                    try:
                        relayed = await asyncio.wait_for(LATEST_RELAYED_VIDEOS.get(), timeout=15)
                        file_id = relayed.get('file_id')
                        logger.info(f"Delivering video {file_id[:20]} directly to student {chat_id} from BOT...")
                        send_res = await tg_call('sendVideo', {
                            'chat_id': chat_id,
                            'video': file_id,
                            'caption': caption,
                            'supports_streaming': True
                        })
                        if send_res.get('ok'):
                            video_delivered = True
                        else:
                            # Fallback to document
                            send_doc_res = await tg_call('sendDocument', {
                                'chat_id': chat_id,
                                'document': file_id,
                                'caption': caption
                            })
                            if send_doc_res.get('ok'):
                                video_delivered = True

                        # Update vault with file_id for dual-delivery support
                        if video_delivered and file_id:
                            vault_save_video(
                                batch_id=batch_id,
                                content_id=content_id,
                                quality=quality_num,
                                channel_msg_id=channel_msg_id,
                                file_id=file_id,
                                title=name,
                                subject=subject,
                                topic=topic
                            )
                    except asyncio.TimeoutError:
                        logger.warning("Timed out waiting for relayed video update in bot_polling.")

        if status_msg_id:
            await tg_call('deleteMessage', {'chat_id': chat_id, 'message_id': status_msg_id})

        if not video_delivered:
            if not bridge.active:
                await tg_call('sendMessage', {
                    'chat_id': chat_id,
                    'text': '⚠️ Video Bridge is warming up. Please check TELETHON_SESSION in .env\n\n⚡ Powered by Study Hub'
                })
            else:
                await tg_call('sendMessage', {
                    'chat_id': chat_id,
                    'text': f'⏳ Upstream bot did not deliver {quality} video. It may not be available yet in the file store.\n\n⚡ Powered by Study Hub'
                })

# ════════════════════════════════════════════════════════════════
# ADMIN COMMAND HANDLERS
# ════════════════════════════════════════════════════════════════

async def handle_admincommandenable(msg: dict):
    from_user = msg.get('from', {})
    chat_id = msg['chat']['id']
    user_id = from_user.get('id')
    first_name = from_user.get('first_name', 'User')
    last_name = from_user.get('last_name', '')
    username = from_user.get('username', '')

    super_admin_id = admins_data.get('super_admin')
    now_iso = datetime.now(timezone.utc).isoformat()

    admin_suite_guide = (
        "👑 **SUPER ADMIN PRIVILEGES ACTIVATED!** 👑\n\n"
        f"Congratulations {first_name}, you have claimed permanent Super Admin ownership of Study Hub Bot.\n\n"
        "🔒 **YOUR EXCLUSIVE ADMIN COMMAND SUITE:**\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "⚙️ **System & Maintenance:**\n"
        "• `/admin` — Open live Admin Control Panel & Dashboard\n"
        "• `/forcesub on` — Enable mandatory channel & group join check\n"
        "• `/forcesub off` — Disable mandatory join check (open access)\n"
        "• `/forcesub status` — Check current ForceSub state & links\n"
        "• `/checkadmin` — Audit bot permissions in Channel & Group\n"
        "• `/botoff` — Put Mini App into Maintenance mode\n"
        "• `/boton` — Turn Mini App back online\n"
        "• `/maintenance <text>` — Set custom maintenance notice text\n"
        "• `/stats` — User metrics, active 24h count & server performance\n"
        "• `/speedtest` — Latency ping to Telegram, AS Multiverse & PW APIs\n"
        "• `/restart` — Soft reload bot cache & database\n\n"
        "📢 **Broadcasting:**\n"
        "• `/broadcast <text>` — Send announcement to all registered users\n"
        "• *Or reply to any photo/video/PDF with `/broadcast`*\n\n"
        "🔗 **Channel & Community Setup:**\n"
        "• `/setchannelid <id>` — Set numerical Channel ID (or forward a post from channel)\n"
        "• `/setchannel <url>` — Update channel invite link\n"
        "• `/setgroup <url>` — Update group discussion link\n"
        "• `/protectmode on/off` — Toggle anti-mirror (block media forward/saving)\n\n"
        "👥 **User Management:**\n"
        "• `/finduser <id/@username>` — Inspect student profile & activity\n"
        "• `/ban <id> [reason]` — Suspend user from bot & app\n"
        "• `/unban <id>` — Restore suspended user\n"
        "• `/exportusers` — Download student database JSON\n"
        "• `/adminlist` — View all authorized administrators\n"
        "• `/revokeadmin <id>` — Revoke admin privileges (Super Admin only)\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "💡 *These commands are visible ONLY to you. Regular students will only see /start, /batches, and /help.*"
    )

    # Case 1: First user claims Super Admin ownership
    if not super_admin_id:
        admins_data['super_admin'] = user_id
        admins_data['admins'][str(user_id)] = {
            'id': user_id,
            'username': username,
            'name': f"{first_name} {last_name}".strip(),
            'role': 'Super Admin',
            'added_at': now_iso,
            'promoted_by': 'System First Claim'
        }
        save_json(ADMINS_FILE, admins_data)
        await register_admin_commands(user_id)

        await tg_call('sendMessage', {
            'chat_id': chat_id,
            'text': admin_suite_guide,
            'parse_mode': 'Markdown'
        })
        return

    # Case 2: Already an authorized admin
    if is_admin(user_id):
        await register_admin_commands(user_id)
        await tg_call('sendMessage', {
            'chat_id': chat_id,
            'text': admin_suite_guide,
            'parse_mode': 'Markdown'
        })
        return

    # Case 3: Secondary applicant requesting admin access -> notify Super Admin
    req_text = (
        "🚨 **NEW ADMIN AUTHORIZATION REQUEST** 🚨\n\n"
        f"👤 **Applicant:** {first_name} {last_name}\n"
        f"🆔 **Telegram ID:** `{user_id}`\n"
        f"🔗 **Username:** @{username if username else 'N/A'}\n"
        f"📅 **Time:** `{now_iso[:19]} UTC`\n\n"
        "An authorization request has been submitted to enable admin commands. "
        "Do you approve granting this user full Admin privileges?"
    )
    keyboard = {
        'inline_keyboard': [
            [
                {'text': '✅ Approve Admin', 'callback_data': f'approve_admin:{user_id}'},
                {'text': '❌ Reject Request', 'callback_data': f'reject_admin:{user_id}'}
            ]
        ]
    }
    await tg_call('sendMessage', {
        'chat_id': super_admin_id,
        'text': req_text,
        'parse_mode': 'Markdown',
        'reply_markup': keyboard
    })

    await tg_call('sendMessage', {
        'chat_id': chat_id,
        'text': (
            "🔒 **Authorization Request Submitted**\n\n"
            "Your request to activate Admin privileges has been forwarded to the Super Admin for security review.\n"
            "You will be automatically notified once approved."
        ),
        'parse_mode': 'Markdown'
    })

async def handle_broadcast(msg: dict):
    chat_id = msg['chat']['id']
    reply_to = msg.get('reply_to_message')
    text_content = msg.get('text', '')
    parts = text_content.split(maxsplit=1)
    custom_text = parts[1] if len(parts) > 1 else ''

    if not reply_to and not custom_text:
        await tg_call('sendMessage', {
            'chat_id': chat_id,
            'text': (
                "⚠️ **Broadcast Usage:**\n\n"
                "1. Text Broadcast:\n`/broadcast Your announcement message here`\n\n"
                "2. Media / Formatted Broadcast:\nReply to ANY photo, video, document, or message with `/broadcast`"
            ),
            'parse_mode': 'Markdown'
        })
        return

    total_users = len(users_data)
    if total_users == 0:
        await tg_call('sendMessage', {'chat_id': chat_id, 'text': 'ℹ️ No registered users found to broadcast to.'})
        return

    status_msg = await tg_call('sendMessage', {
        'chat_id': chat_id,
        'text': f"📢 **Broadcasting in progress...**\nTarget audience: {total_users} users",
        'parse_mode': 'Markdown'
    })
    status_id = status_msg.get('result', {}).get('message_id')

    sent_count = 0
    failed_count = 0
    start_time = time.time()

    for uid_str, u_info in list(users_data.items()):
        if u_info.get('banned'):
            continue
        target_uid = u_info.get('id')
        if not target_uid:
            continue

        try:
            if reply_to:
                res = await tg_call('copyMessage', {
                    'chat_id': target_uid,
                    'from_chat_id': chat_id,
                    'message_id': reply_to['message_id']
                })
            else:
                res = await tg_call('sendMessage', {
                    'chat_id': target_uid,
                    'text': custom_text,
                    'parse_mode': 'Markdown'
                })
            
            if res.get('ok'):
                sent_count += 1
            else:
                failed_count += 1
        except Exception:
            failed_count += 1

        await asyncio.sleep(0.04)

    elapsed = round(time.time() - start_time, 1)
    report = (
        "📊 **BROADCAST COMPLETED!**\n\n"
        f"✅ Successfully Delivered: `{sent_count}`\n"
        f"❌ Failed / Blocked: `{failed_count}`\n"
        f"👥 Total Targeted: `{total_users}`\n"
        f"⏱️ Time Taken: `{elapsed}s`"
    )
    if status_id:
        await tg_call('editMessageText', {
            'chat_id': chat_id,
            'message_id': status_id,
            'text': report,
            'parse_mode': 'Markdown'
        })
    else:
        await tg_call('sendMessage', {'chat_id': chat_id, 'text': report, 'parse_mode': 'Markdown'})

async def handle_stats(msg: dict):
    chat_id = msg['chat']['id']
    total_users = len(users_data)
    now = datetime.now(timezone.utc)
    one_day_ago = now - timedelta(hours=24)
    
    active_24h = 0
    banned_count = 0
    for u in users_data.values():
        if u.get('banned'):
            banned_count += 1
        la = u.get('last_active')
        if la:
            try:
                la_dt = datetime.fromisoformat(la.replace('Z', '+00:00'))
                if la_dt >= one_day_ago:
                    active_24h += 1
            except:
                pass

    super_id = admins_data.get('super_admin')
    admin_count = len(admins_data.get('admins', {}))
    app_status = "🟢 LIVE (Active)" if settings_data.get('mini_app_enabled', True) else "🔴 OFF (Maintenance)"
    prot_status = "🛡️ ENABLED (Anti-Mirror)" if settings_data.get('protect_content', True) else "⚠️ DISABLED"
    force_status = "🔒 ENABLED" if settings_data.get('forcesub', False) else "🔓 DISABLED"
    bridge_status = f"🟢 Connected (@{bridge.me.username})" if (bridge.active and bridge.me) else "🟡 Passive / Disconnected"

    stats_text = (
        "📊 **{BOT_NAME.upper()} SYSTEM METRICS** 📊\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"👥 **Total Registered Users:** `{total_users}`\n"
        f"🔥 **Active (Last 24 Hours):** `{active_24h}`\n"
        f"🔨 **Banned Accounts:** `{banned_count}`\n"
        f"👑 **Super Admin ID:** `{super_id}`\n"
        f"🛡️ **Total Authorized Admins:** `{admin_count}`\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🚀 **Mini App Status:** {app_status}\n"
        f"🔒 **Anti-Mirror Protection:** {prot_status}\n"
        f"📌 **Force Subscribe Check:** {force_status}\n"
        f"⚡ **Telethon Bridge:** {bridge_status}\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"📢 **Channel:** {settings_data.get('channel_link')}\n"
        f"💬 **Group:** {settings_data.get('group_link')}"
    )
    await tg_call('sendMessage', {
        'chat_id': chat_id,
        'text': stats_text,
        'parse_mode': 'Markdown'
    })

async def handle_botoff(msg: dict):
    chat_id = msg['chat']['id']
    settings_data['mini_app_enabled'] = False
    settings_data['maintenance'] = True
    save_json(SETTINGS_FILE, settings_data)
    await tg_call('sendMessage', {
        'chat_id': chat_id,
        'text': (
            "🛑 **Mini App & Content Delivery are now DISABLED.**\n\n"
            "The app is currently in Maintenance Mode.\n"
            "Students will see your maintenance announcement.\n"
            "Use `/boton` to restore live operations."
        ),
        'parse_mode': 'Markdown'
    })

async def handle_boton(msg: dict):
    chat_id = msg['chat']['id']
    settings_data['mini_app_enabled'] = True
    settings_data['maintenance'] = False
    save_json(SETTINGS_FILE, settings_data)
    await tg_call('sendMessage', {
        'chat_id': chat_id,
        'text': "🟢 **Mini App & Content Delivery are now LIVE!**\n\nAll services operational.",
        'parse_mode': 'Markdown'
    })

async def handle_maintenance(msg: dict):
    chat_id = msg['chat']['id']
    text = msg.get('text', '')
    parts = text.split(maxsplit=1)
    if len(parts) < 2:
        curr_msg = settings_data.get('maintenance_msg', 'N/A')
        await tg_call('sendMessage', {
            'chat_id': chat_id,
            'text': f"🛠️ **Current Maintenance Notice:**\n\n_{curr_msg}_\n\nTo update, run:\n`/maintenance Your new message here`",
            'parse_mode': 'Markdown'
        })
        return

    new_msg = parts[1].strip()
    settings_data['maintenance_msg'] = new_msg
    save_json(SETTINGS_FILE, settings_data)
    await tg_call('sendMessage', {
        'chat_id': chat_id,
        'text': f"✅ **Maintenance notice updated:**\n\n_{new_msg}_",
        'parse_mode': 'Markdown'
    })

async def handle_forcesub(msg: dict):
    chat_id = msg['chat']['id']
    parts = msg.get('text', '').split()
    current = settings_data.get('forcesub', False)

    if len(parts) > 1:
        arg = parts[1].lower().strip()
        if arg in ('on', 'enable', '1', 'true'):
            settings_data['forcesub'] = True
        elif arg in ('off', 'disable', '0', 'false'):
            settings_data['forcesub'] = False
        elif arg == 'status':
            curr_str = "ENABLED 🟢 (Users must join community)" if current else "DISABLED 🔴 (Open access)"
            c_id = settings_data.get('channel_id')
            g_target = settings_data.get('group_id') or os.environ.get('GROUP_LINK', '@studyhub_chat')
            await tg_call('sendMessage', {
                'chat_id': chat_id,
                'text': (
                    f"🔒 **FORCESUB STATUS REPORT** 🔒\n"
                    "━━━━━━━━━━━━━━━━━━━━━━\n"
                    f"Current Mode: **{curr_str}**\n"
                    f"📢 Channel ID: `{c_id or 'Not Set'}`\n"
                    f"💬 Group: `{g_target}`\n"
                    "━━━━━━━━━━━━━━━━━━━━━━\n"
                    "• To Turn ON: `/forcesub on`\n"
                    "• To Turn OFF: `/forcesub off`\n"
                    "• To Audit Permissions: `/checkadmin`"
                ),
                'parse_mode': 'Markdown'
            })
            return
        else:
            settings_data['forcesub'] = not current
    else:
        settings_data['forcesub'] = not current

    save_json(SETTINGS_FILE, settings_data)
    status_str = "ENABLED 🟢 (Users must join Channel & Group)" if settings_data['forcesub'] else "DISABLED 🔴 (Open access for everyone)"
    await tg_call('sendMessage', {
        'chat_id': chat_id,
        'text': (
            f"🔒 **Force Subscribe Mode is now {status_str}**\n\n"
            f"• Enable: `/forcesub on`\n"
            f"• Disable: `/forcesub off`\n"
            f"• Toggle: `/forcesub`"
        ),
        'parse_mode': 'Markdown'
    })

async def handle_ban(msg: dict):
    chat_id = msg['chat']['id']
    parts = msg.get('text', '').split()
    if len(parts) < 2:
        await tg_call('sendMessage', {'chat_id': chat_id, 'text': "Usage: `/ban <user_id> [reason]`", 'parse_mode': 'Markdown'})
        return
    target_id_str = parts[1]
    if not target_id_str.isdigit():
        await tg_call('sendMessage', {'chat_id': chat_id, 'text': "❌ Invalid User ID. Must be numeric."})
        return
    
    target_id = int(target_id_str)
    if is_admin(target_id):
        await tg_call('sendMessage', {'chat_id': chat_id, 'text': "❌ Cannot ban an administrator!"})
        return

    if target_id_str not in users_data:
        users_data[target_id_str] = {'id': target_id, 'banned': True, 'joined_at': datetime.now(timezone.utc).isoformat()}
    else:
        users_data[target_id_str]['banned'] = True
    save_json(USERS_FILE, users_data)

    await tg_call('sendMessage', {
        'chat_id': chat_id,
        'text': f"🔨 **User `{target_id}` has been BANNED from Study Hub.**",
        'parse_mode': 'Markdown'
    })

async def handle_unban(msg: dict):
    chat_id = msg['chat']['id']
    parts = msg.get('text', '').split()
    if len(parts) < 2:
        await tg_call('sendMessage', {'chat_id': chat_id, 'text': "Usage: `/unban <user_id>`", 'parse_mode': 'Markdown'})
        return
    target_id_str = parts[1]
    if target_id_str in users_data:
        users_data[target_id_str]['banned'] = False
        save_json(USERS_FILE, users_data)
        await tg_call('sendMessage', {'chat_id': chat_id, 'text': f"✅ **User `{target_id_str}` has been UNBANNED.**", 'parse_mode': 'Markdown'})
    else:
        await tg_call('sendMessage', {'chat_id': chat_id, 'text': f"ℹ️ User `{target_id_str}` not found in database.", 'parse_mode': 'Markdown'})

async def handle_exportusers(msg: dict):
    chat_id = msg['chat']['id']
    if not os.path.exists(USERS_FILE):
        await tg_call('sendMessage', {'chat_id': chat_id, 'text': "❌ Users database file not found."})
        return
    caption = f"📁 **Study Hub Users Database Backup**\nTotal records: {len(users_data)}"
    await send_document_file(chat_id, USERS_FILE, caption=caption)

async def handle_adminlist(msg: dict):
    chat_id = msg['chat']['id']
    super_id = admins_data.get('super_admin')
    admins = admins_data.get('admins', {})

    lines = ["👥 **AUTHORIZED ADMINS LIST** 👥\n━━━━━━━━━━━━━━━━━━━━━━"]
    for aid_str, a in admins.items():
        is_sup = (int(aid_str) == super_id)
        role = "👑 Super Admin" if is_sup else "🛡️ Admin"
        name = a.get('name', 'Admin')
        uname = f"@{a.get('username')}" if a.get('username') else "No Username"
        lines.append(f"{role}\n• Name: {name}\n• Username: {uname}\n• ID: `{aid_str}`\n")

    await tg_call('sendMessage', {
        'chat_id': chat_id,
        'text': "\n".join(lines),
        'parse_mode': 'Markdown'
    })

async def handle_revokeadmin(msg: dict):
    chat_id = msg['chat']['id']
    from_id = msg.get('from', {}).get('id')
    if not is_super_admin(from_id):
        await tg_call('sendMessage', {'chat_id': chat_id, 'text': "❌ Only the Super Admin can revoke admin rights."})
        return

    parts = msg.get('text', '').split()
    if len(parts) < 2:
        await tg_call('sendMessage', {'chat_id': chat_id, 'text': "Usage: `/revokeadmin <user_id>`", 'parse_mode': 'Markdown'})
        return

    target_str = parts[1]
    if target_str == str(admins_data.get('super_admin')):
        await tg_call('sendMessage', {'chat_id': chat_id, 'text': "❌ Cannot revoke the Super Admin!"})
        return

    if target_str in admins_data.get('admins', {}):
        del admins_data['admins'][target_str]
        save_json(ADMINS_FILE, admins_data)
        try:
            await remove_admin_commands(int(target_str))
        except: pass

        await tg_call('sendMessage', {'chat_id': chat_id, 'text': f"✅ Revoked admin rights for `{target_str}`.", 'parse_mode': 'Markdown'})
        try:
            await tg_call('sendMessage', {
                'chat_id': int(target_str),
                'text': "ℹ️ Your administrator privileges have been revoked by the Super Admin."
            })
        except: pass
    else:
        await tg_call('sendMessage', {'chat_id': chat_id, 'text': f"❌ User `{target_str}` is not an admin."})

async def handle_finduser(msg: dict):
    chat_id = msg['chat']['id']
    parts = msg.get('text', '').split()
    if len(parts) < 2:
        await tg_call('sendMessage', {'chat_id': chat_id, 'text': "Usage: `/finduser <user_id or @username>`", 'parse_mode': 'Markdown'})
        return
    
    query = parts[1].replace('@', '').lower()
    found = None
    for uid_str, u in users_data.items():
        if uid_str == query or u.get('username', '').lower() == query:
            found = u
            break

    if not found:
        await tg_call('sendMessage', {'chat_id': chat_id, 'text': f"❌ User `{query}` not found in database.", 'parse_mode': 'Markdown'})
        return

    status = "🚫 BANNED" if found.get('banned') else "✅ Active"
    admin_role = "👑 Super Admin" if is_super_admin(found.get('id')) else ("🛡️ Admin" if is_admin(found.get('id')) else "Student")
    
    info = (
        "🔍 **USER PROFILE REPORT**\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"👤 **Name:** {found.get('first_name', '')} {found.get('last_name', '')}\n"
        f"🆔 **ID:** `{found.get('id')}`\n"
        f"🔗 **Username:** @{found.get('username') or 'None'}\n"
        f"🎖️ **Role:** {admin_role}\n"
        f"⚡ **Status:** {status}\n"
        f"📅 **First Seen:** `{found.get('joined_at', 'N/A')[:19]}`\n"
        f"🕒 **Last Active:** `{found.get('last_active', 'N/A')[:19]}`"
    )
    await tg_call('sendMessage', {'chat_id': chat_id, 'text': info, 'parse_mode': 'Markdown'})

async def handle_protectmode(msg: dict):
    chat_id = msg['chat']['id']
    parts = msg.get('text', '').split()
    if len(parts) < 2 or parts[1].lower() not in ('on', 'off'):
        curr = "ON" if settings_data.get('protect_content', True) else "OFF"
        await tg_call('sendMessage', {'chat_id': chat_id, 'text': f"🛡️ **Protect Mode is currently {curr}**\n\nTo toggle: `/protectmode on` or `/protectmode off`", 'parse_mode': 'Markdown'})
        return
    
    turn_on = (parts[1].lower() == 'on')
    settings_data['protect_content'] = turn_on
    save_json(SETTINGS_FILE, settings_data)
    state_str = "ENABLED (Anti-Mirror: Forwarding & media saving blocked)" if turn_on else "DISABLED (Normal forwarding allowed)"
    await tg_call('sendMessage', {'chat_id': chat_id, 'text': f"🛡️ **Content Protection is now {state_str}**", 'parse_mode': 'Markdown'})

async def handle_setchannel(msg: dict):
    chat_id = msg['chat']['id']
    parts = msg.get('text', '').split()
    if len(parts) < 2:
        curr = settings_data.get('channel_link', '')
        await tg_call('sendMessage', {'chat_id': chat_id, 'text': f"🔗 Current Channel: {curr}\n\nUsage: `/setchannel <link>`", 'parse_mode': 'Markdown'})
        return
    new_link = parts[1].strip()
    settings_data['channel_link'] = new_link
    save_json(SETTINGS_FILE, settings_data)
    await tg_call('sendMessage', {'chat_id': chat_id, 'text': f"✅ Channel link updated to: {new_link}"})

async def handle_setgroup(msg: dict):
    chat_id = msg['chat']['id']
    parts = msg.get('text', '').split()
    if len(parts) < 2:
        curr = settings_data.get('group_link', '')
        await tg_call('sendMessage', {'chat_id': chat_id, 'text': f"💬 Current Group: {curr}\n\nUsage: `/setgroup <link>`", 'parse_mode': 'Markdown'})
        return
    new_link = parts[1].strip()
    settings_data['group_link'] = new_link
    save_json(SETTINGS_FILE, settings_data)
    await tg_call('sendMessage', {'chat_id': chat_id, 'text': f"✅ Group link updated to: {new_link}"})

async def handle_setchannelid(msg: dict):
    chat_id = msg['chat']['id']
    text = msg.get('text', '').strip()
    parts = text.split()
    if len(parts) < 2:
        curr = settings_data.get('channel_id', 'Not Set')
        await tg_call('sendMessage', {
            'chat_id': chat_id,
            'text': (
                f"📢 **Current Channel ID:** `{curr}`\n\n"
                "**How to configure Channel ID:**\n"
                "1. **Easiest:** Forward any message or post from your channel to this bot chat.\n"
                "2. **Manual:** Run `/setchannelid -100xxxxxxxxxx`"
            ),
            'parse_mode': 'Markdown'
        })
        return

    new_cid = parts[1].strip()
    try:
        val = int(new_cid) if new_cid.lstrip('-').isdigit() else new_cid
        settings_data['channel_id'] = val
        save_json(SETTINGS_FILE, settings_data)
        is_adm = await check_chat_member(val, BOT_ID)
        adm_str = "✅ Bot is Admin in this channel!" if is_adm else "⚠️ Warning: Bot is not an Admin yet. Please add @StudyBot as admin in channel."
        await tg_call('sendMessage', {
            'chat_id': chat_id,
            'text': f"✅ **Channel ID updated to:** `{val}`\n\n**Admin Check:** {adm_str}",
            'parse_mode': 'Markdown'
        })
    except Exception as ex:
        await tg_call('sendMessage', {'chat_id': chat_id, 'text': f"❌ Error: {ex}"})

async def handle_checkadmin(msg: dict):
    chat_id = msg['chat']['id']
    c_id = settings_data.get('channel_id')
    g_target = settings_data.get('group_id') or os.environ.get('GROUP_LINK', '@studyhub_chat')
    c_link = settings_data.get('channel_link', os.environ.get('CHANNEL_LINK', 'https://t.me/'))

    c_admin = await check_chat_member(c_id, BOT_ID) if c_id else False
    g_admin = await check_chat_member(g_target, BOT_ID)

    if not c_id:
        c_status = "⚠️ **Channel ID Not Set**\n👉 *Forward any message from your channel to this bot to auto-detect ID!*"
    elif c_admin:
        c_status = "✅ **Bot is Admin!** (Members can be verified)"
    else:
        c_status = "❌ **Bot is NOT Admin**\n👉 *Add @StudyBot as Admin in Channel Settings*"

    if g_admin:
        g_status = "✅ **Bot is Admin!** (Members can be verified)"
    else:
        g_status = "❌ **Bot is NOT Admin**\n👉 *Add @StudyBot as Admin in Group Settings*"

    all_good = (c_admin and g_admin)
    summary = "🎉 **All permissions verified! ForceSub is ready to use.**" if all_good else "⚠️ **Action required: Make sure bot is Admin in both communities.**"

    report = (
        "🛡️ **BOT ADMIN PERMISSION AUDIT** 🛡️\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"📢 **Official Channel (`{c_id or 'Not Set'}`):**\n"
        f"• Link: {c_link}\n"
        f"• Status: {c_status}\n\n"
        f"💬 **Discussion Group (`{g_target}`):**\n"
        f"• Status: {g_status}\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"{summary}\n\n"
        "💡 *Tip: Forward any post from your channel to this chat to auto-link channel ID!*"
    )
    await tg_call('sendMessage', {'chat_id': chat_id, 'text': report, 'parse_mode': 'Markdown'})

async def handle_admin_panel(msg: dict):
    chat_id = msg['chat']['id']
    c_id = settings_data.get('channel_id', 'Not Set')
    g_target = settings_data.get('group_id') or settings_data.get('group_link', os.environ.get('GROUP_LINK', '@studyhub_chat'))
    app_status = "🟢 LIVE (Active)" if settings_data.get('mini_app_enabled', True) else "🔴 PAUSED (Maintenance)"
    fs_status = "🟢 ENABLED (Join Required)" if settings_data.get('forcesub', False) else "🔴 DISABLED (Open Access)"
    pm_status = "🟢 ENABLED (Anti-Mirror)" if settings_data.get('protect_content', True) else "🔴 DISABLED"

    panel_text = (
        "👑 **{BOT_NAME.upper()} ADMIN CONTROL PANEL** 👑\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🚀 **Mini App:** {app_status}\n"
        f"🔒 **ForceSub:** {fs_status}\n"
        f"🛡️ **Content Protect:** {pm_status}\n"
        f"📢 **Channel ID:** `{c_id}`\n"
        f"💬 **Group:** `{g_target}`\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        "📖 **ADMIN COMMANDS & HOW TO USE:**\n\n"
        "🔒 **Community & ForceSub Controls:**\n"
        "• `/forcesub on` — Enable mandatory channel & group join check\n"
        "• `/forcesub off` — Disable mandatory join check (open access)\n"
        "• `/forcesub status` — Check current ForceSub state & channel link\n"
        "• `/checkadmin` — Audit bot's admin permissions in Channel & Group\n"
        "• `/setchannelid <id>` — Set channel numerical ID (e.g., `-100xxxxxxxxxx`)\n"
        "• `/setchannel <url>` — Update channel invite link\n"
        "• `/setgroup <url>` — Update group discussion link\n"
        "💡 *Tip: Forward any message from your channel to this chat to auto-link it!*\n\n"
        "⚙️ **System & Maintenance:**\n"
        "• `/stats` — User metrics, active 24h count & server performance\n"
        "• `/botoff` — Put Mini App into Maintenance mode\n"
        "• `/boton` — Turn Mini App back online\n"
        "• `/maintenance <text>` — Set custom maintenance notice text\n"
        "• `/speedtest` — Latency ping to Telegram, AS Multiverse & PW APIs\n"
        "• `/restart` — Soft reload bot cache & database\n\n"
        "📢 **Broadcasting:**\n"
        "• `/broadcast <text>` — Send announcement to all registered users\n"
        "• *Or reply to any photo/video/PDF with `/broadcast`*\n\n"
        "👥 **User Management:**\n"
        "• `/finduser <id/@username>` — Inspect student profile & activity\n"
        "• `/ban <id> [reason]` — Suspend user from bot & app\n"
        "• `/unban <id>` — Restore suspended user\n"
        "• `/exportusers` — Download student database JSON\n"
        "• `/adminlist` — View all authorized administrators\n"
        "• `/revokeadmin <id>` — Revoke admin privileges (Super Admin only)\n"
        "━━━━━━━━━━━━━━━━━━━━━━"
    )
    await tg_call('sendMessage', {'chat_id': chat_id, 'text': panel_text, 'parse_mode': 'Markdown'})

async def handle_speedtest(msg: dict):
    chat_id = msg['chat']['id']
    status_msg = await tg_call('sendMessage', {'chat_id': chat_id, 'text': "⚡ Running network latency benchmarks..."})
    status_id = status_msg.get('result', {}).get('message_id')

    # 1. Telegram API ping
    t0 = time.time()
    tg_res = await tg_call('getMe')
    tg_ping = round((time.time() - t0) * 1000) if tg_res.get('ok') else -1

    # 2. AS Multiverse ping
    t1 = time.time()
    as_ping = -1
    try:
        async with aiohttp.ClientSession() as session:
            headers = get_asmultiverse_headers()
            async with session.get("https://api.asmultiverse.app/api/v1/nt/batches?limit=1", headers=headers, timeout=5) as r:
                if r.status == 200:
                    as_ping = round((time.time() - t1) * 1000)
    except: pass

    # 3. PW Upstream API ping
    t2 = time.time()
    pw_ping = -1
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get("https://pw-botv2-wz1c.onrender.com/api/batches?limit=1", timeout=5) as r:
                if r.status == 200:
                    pw_ping = round((time.time() - t2) * 1000)
    except: pass

    report = (
        "⚡ **NETWORK SPEEDTEST BENCHMARK** ⚡\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🤖 **Telegram Bot API:** `{tg_ping} ms`\n"
        f"🌌 **AS Multiverse API:** `{as_ping if as_ping >= 0 else 'Timeout'} ms`\n"
        f"⚛️ **PW Upstream Server:** `{pw_ping if pw_ping >= 0 else 'Timeout'} ms`\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        "Status: System responsive & operational."
    )
    if status_id:
        await tg_call('editMessageText', {'chat_id': chat_id, 'message_id': status_id, 'text': report, 'parse_mode': 'Markdown'})
    else:
        await tg_call('sendMessage', {'chat_id': chat_id, 'text': report, 'parse_mode': 'Markdown'})

async def handle_restart(msg: dict):
    chat_id = msg['chat']['id']
    global admins_data, users_data, settings_data, CONTENT_STORE
    CONTENT_STORE.clear()
    admins_data = load_json(ADMINS_FILE, {'super_admin': None, 'admins': {}})
    users_data = load_json(USERS_FILE, {})
    settings_data = load_json(SETTINGS_FILE, DEFAULT_SETTINGS)
    
    await tg_call('sendMessage', {
        'chat_id': chat_id,
        'text': (
            "🔄 **System Soft-Restart Completed!**\n\n"
            "• In-memory payload store cleared.\n"
            "• Configuration, database & admin state reloaded.\n"
            "• Bot polling and Telethon bridge active."
        ),
        'parse_mode': 'Markdown'
    })

async def handle_help(msg: dict):
    chat_id = msg['chat']['id']
    from_id = msg.get('from', {}).get('id')

    if is_admin(from_id):
        help_text = (
            "📖 **{BOT_NAME.upper()} ADMIN COMMAND MANUAL** 📖\n"
            "━━━━━━━━━━━━━━━━━━━━━━\n"
            "📢 **Broadcasting & Announcements:**\n"
            "• `/broadcast <text>` — Send announcement to all users\n"
            "• Reply to any message/media with `/broadcast`\n\n"
            "⚙️ **System & Maintenance:**\n"
            "• `/stats` — Real-time performance & user statistics\n"
            "• `/botoff` — Turn off Mini App (Maintenance mode)\n"
            "• `/boton` — Turn on Mini App\n"
            "• `/maintenance <text>` — Set custom maintenance notice\n"
            "• `/forcesub <on/off>` — Toggle or set mandatory community check\n"
            "• `/checkadmin` — Audit bot admin status in channel & group\n"
            "• `/speedtest` — Latency test to Telegram & APIs\n"
            "• `/restart` — Soft reload bot cache & config\n\n"
            "🛡️ **Security & User Management:**\n"
            "• `/ban <id>` — Suspend user from bot & app\n"
            "• `/unban <id>` — Restore suspended user\n"
            "• `/finduser <id/user>` — Lookup user registration info\n"
            "• `/exportusers` — Download users database JSON\n"
            "• `/protectmode <on/off>` — Anti-mirror content protection\n\n"
            "👥 **Admin Team Management:**\n"
            "• `/adminlist` — View all authorized admins\n"
            "• `/revokeadmin <id>` — Revoke admin rights (Super Admin only)\n\n"
            "🔗 **Community Setup & Links:**\n"
            "• `/setchannel <url>` — Update channel invite link\n"
            "• `/setchannelid <id>` — Set channel numerical ID (or forward post)\n"
            "• `/setgroup <url>` — Update group link\n"
            "━━━━━━━━━━━━━━━━━━━━━━"
        )
    else:
        help_text = (
            "ℹ️ **Study Hub Student Guide:**\n\n"
            "1. Click on **Study Hub** or type `/start`\n"
            "2. Choose your platform: Physics Wallah, Next Topper, or Mission JEET\n"
            "3. Select your Batch, Subject, and Chapter\n"
            "4. Tap on any lecture or notes to study directly!\n\n"
            "🤖 **AI Doubt Solver:** Type `/guru <question>` or send any question photo!\n"
            "🎁 **VIP Referrals:** Type `/invite` to invite friends & unlock 👑 VIP Student status!\n\n"
            f"📢 Channel: {settings_data.get('channel_link')}\n"
            f"💬 Group: {settings_data.get('group_link')}"
        )
    await tg_call('sendMessage', {'chat_id': chat_id, 'text': help_text, 'parse_mode': 'Markdown'})


async def handle_invite(msg: dict):
    chat_id = msg['chat']['id']
    from_user = msg.get('from', {})
    user_id = from_user.get('id', chat_id)
    first_name = from_user.get('first_name', 'Student')
    
    vip_info = get_user_vip_info(user_id)
    ref_count = vip_info.get('referrals', 0)
    is_vip = vip_info.get('is_vip', False)
    target = vip_info.get('target', 3)
    invite_link = f"https://t.me/{BOT_USERNAME}?start=ref_{user_id}"
    
    status_badge = "👑 VIP Student (Active)" if is_vip else f"Student ({ref_count}/{target} Invited)"
    share_text = "🔥 Join Study Hub Study Hub for free Physics Wallah, NextToppers & JEE/NEET Batches, full lecture video streaming, notes & DPPs!"
    share_url = f"https://t.me/share/url?url={urllib.parse.quote(invite_link)}&text={urllib.parse.quote(share_text)}"
    
    text = (
        f"🎁 **Study Hub Referral & VIP Program** 👑\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"Hey **{first_name}**!\n\n"
        f"Invite **{target} friends** to join Study Hub Bot and automatically unlock permanent **VIP Student Status**!\n\n"
        f"👑 **Your Status:** `{status_badge}`\n"
        f"👥 **Friends Joined:** `{ref_count} / {target}`\n\n"
        f"🔗 **Your Unique Invite Link:**\n"
        f"`{invite_link}`\n\n"
        f"🌟 **VIP Student Perks:**\n"
        f"• 👑 Glowing VIP Crown Badge in Mini App\n"
        f"• ⚡ Priority high-speed lecture streaming\n"
        f"• 🚀 Instant access to all premium batches & DPPs\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"⚡ *Powered by Study Hub*"
    )
    await tg_call('sendMessage', {
        'chat_id': chat_id,
        'text': text,
        'parse_mode': 'Markdown',
        'reply_markup': {
            'inline_keyboard': [
                [
                    {'text': '📤 Share Invite Link With Friends', 'url': share_url}
                ]
            ]
        }
    })


async def handle_guru_telegram(msg: dict):
    chat_id = msg['chat']['id']
    text = (msg.get('text') or msg.get('caption') or '').strip()
    
    if text.lower().startswith('/guru'):
        question = text[5:].strip()
    else:
        question = text
        
    photo = msg.get('photo')
    photo_b64 = None
    
    if photo and isinstance(photo, list):
        best_photo = photo[-1]
        file_id = best_photo.get('file_id')
        if file_id:
            file_res = await tg_call('getFile', {'file_id': file_id})
            if file_res.get('ok') and file_res.get('result'):
                file_path = file_res['result'].get('file_path')
                if file_path:
                    download_url = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file_path}"
                    try:
                        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as session:
                            async with session.get(download_url) as resp:
                                if resp.status == 200:
                                    raw_bytes = await resp.read()
                                    photo_b64 = f"data:image/jpeg;base64,{base64.b64encode(raw_bytes).decode('utf-8')}"
                    except Exception as e:
                        logger.warning(f"Failed to download photo for Guru: {e}")
                        
    if not question and not photo_b64:
        await tg_call('sendMessage', {
            'chat_id': chat_id,
            'text': (
                "🤖 **Study Hub Guru AI Doubt Solver** ⚡\n"
                "━━━━━━━━━━━━━━━━━━━━━━\n"
                "Send any question text or snap a photo of any numerical problem to get instant step-by-step solutions!\n\n"
                "**Usage:**\n"
                "• `/guru <your question>`\n"
                "• Or send any photo with your question as caption!\n"
                "• Or open the **🤖 Study Hub Guru** tab directly in the Mini App!\n\n"
                "⚡ *Powered by Study Hub*"
            ),
            'parse_mode': 'Markdown'
        })
        return

    wait_msg = await tg_call('sendMessage', {
        'chat_id': chat_id,
        'text': '🤖 **Guru AI is analyzing your doubt...**\n_Deriving step-by-step solution and identifying relevant PW lecture topic..._',
        'parse_mode': 'Markdown'
    })
    wait_msg_id = wait_msg.get('result', {}).get('message_id') if wait_msg.get('ok') else None
    
    result = await solve_doubt(question, photo_b64)
    
    subj = result.get('subject', 'STEM')
    answer = result.get('answer', '')
    rec = result.get('recommendation', 'Physics Wallah Arjuna / Lakshya Batches')
    
    resp_text = (
        f"🤖 **Study Hub Guru — Solution**\n"
        f"🏷️ **Subject:** `{subj}`\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"{answer}\n\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"💡 **Recommended PW Topic:**\n"
        f"*{rec}*"
    )
    
    if wait_msg_id:
        await tg_call('deleteMessage', {'chat_id': chat_id, 'message_id': wait_msg_id})
        
    await tg_call('sendMessage', {
        'chat_id': chat_id,
        'text': resp_text,
        'parse_mode': 'Markdown'
    })


async def bot_polling(app_url: str):
    offset = 0
    logger.info('Bot polling started...')
    while True:
        try:
            res = await tg_call('getUpdates', {'offset': offset, 'timeout': 20})
            if res.get('ok') and res.get('result'):
                for upd in res['result']:
                    offset = upd['update_id'] + 1
                    
                    if 'callback_query' in upd:
                        asyncio.create_task(handle_callback_query(upd['callback_query']))
                        continue

                    msg = upd.get('message')
                    if not msg:
                        continue

                    from_user = msg.get('from')
                    if from_user:
                        update_user_db(from_user)
                        if is_user_banned(from_user.get('id')):
                            await tg_call('sendMessage', {
                                'chat_id': msg['chat']['id'],
                                'text': '⛔ Your account has been suspended by the administrator.'
                            })
                            continue

                    # Capture relayed videos sent to the bot by the helper account
                    vid = msg.get('video') or (msg.get('document') if 'video' in msg.get('document', {}).get('mime_type', '') else None)
                    if vid and ('file_id' in vid):
                        file_id = vid['file_id']
                        logger.info(f"Bot polling captured relayed video file_id: {file_id[:20]}...")
                        await LATEST_RELAYED_VIDEOS.put({
                            'file_id': file_id,
                            'duration': vid.get('duration'),
                            'mime_type': vid.get('mime_type', 'video/mp4')
                        })
                        continue

                    text = msg.get('text', '').strip()
                    if not text and 'caption' in msg:
                        text = msg.get('caption', '').strip()

                    raw_cmd = text.split()[0].lower() if text else ''
                    cmd = raw_cmd.split('@')[0] if raw_cmd.startswith('/') else raw_cmd
                    from_id = from_user.get('id') if from_user else None
                    username = (from_user.get('username') or '').lower().lstrip('@')

                    # 1. Secret Super Admin activation & authorization gateway
                    if cmd == '/admincommandenable':
                        await handle_admincommandenable(msg)
                        continue

                    # 2. Forwarded Channel Post Detection (Auto-detect Channel ID for verified Admin)
                    fwd_chat = msg.get('forward_from_chat')
                    if not fwd_chat and 'forward_origin' in msg:
                        orig = msg.get('forward_origin', {})
                        if orig.get('type') == 'channel' and 'chat' in orig:
                            fwd_chat = orig['chat']

                    if fwd_chat and is_admin(from_id):
                        c_id = fwd_chat.get('id')
                        c_title = fwd_chat.get('title', 'Official Channel')
                        c_user = fwd_chat.get('username')
                        if c_id:
                            settings_data['channel_id'] = c_id
                            save_json(SETTINGS_FILE, settings_data)

                            bot_admin = await check_chat_member(c_id, BOT_ID)
                            status_emoji = "✅ Verified: Bot is Admin!" if bot_admin else "⚠️ Warning: Bot is NOT an Admin yet in this channel. Please promote @StudyBot to Admin."

                            await tg_call('sendMessage', {
                                'chat_id': msg['chat']['id'],
                                'text': (
                                    "🎉 **OFFICIAL CHANNEL AUTO-CONFIGURED!** 🎉\n"
                                    "━━━━━━━━━━━━━━━━━━━━━━\n"
                                    f"📢 **Channel Title:** {c_title}\n"
                                    f"🆔 **Channel ID:** `{c_id}`\n"
                                    f"🔗 **Username:** @{c_user or 'Private'}\n"
                                    f"🛡️ **Admin Status:** {status_emoji}\n"
                                    "━━━━━━━━━━━━━━━━━━━━━━\n"
                                    "Subscribers will now be verified against this channel when `/forcesub` is active."
                                ),
                                'parse_mode': 'Markdown'
                            })
                            continue

                    # 3. Scoped Admin Commands (Strict Admin Permission Required)
                    ADMIN_COMMANDS_SET = {
                        '/admin', '/adminhelp', '/broadcast', '/broadcasts',
                        '/stats', '/botoff', '/boton', '/maintenance', '/forcesub', '/checkadmin',
                        '/setchannelid', '/setchannel', '/setgroup', '/ban', '/unban', '/exportusers',
                        '/adminlist', '/revokeadmin', '/finduser', '/protectmode', '/speedtest', '/restart',
                        '/vault'
                    }

                    if cmd in ADMIN_COMMANDS_SET:
                        if not is_admin(from_id):
                            await tg_call('sendMessage', {
                                'chat_id': msg['chat']['id'],
                                'text': (
                                    "🚫 **Access Denied — Administrator Only**\n\n"
                                    "You are not an authorized administrator for Study Hub Bot.\n"
                                    "This command is strictly reserved for authorized bot administrators."
                                ),
                                'parse_mode': 'Markdown'
                            })
                            continue

                        # Execute matched command for verified admin
                        if cmd in ('/admin', '/adminhelp'):
                            await handle_admin_panel(msg)
                        elif cmd in ('/broadcast', '/broadcasts'):
                            await handle_broadcast(msg)
                        elif cmd == '/stats':
                            await handle_stats(msg)
                        elif cmd == '/botoff':
                            await handle_botoff(msg)
                        elif cmd == '/boton':
                            await handle_boton(msg)
                        elif cmd == '/maintenance':
                            await handle_maintenance(msg)
                        elif cmd == '/forcesub':
                            await handle_forcesub(msg)
                        elif cmd == '/checkadmin':
                            await handle_checkadmin(msg)
                        elif cmd.startswith('/setchannelid'):
                            await handle_setchannelid(msg)
                        elif cmd.startswith('/setchannel'):
                            await handle_setchannel(msg)
                        elif cmd.startswith('/setgroup'):
                            await handle_setgroup(msg)
                        elif cmd.startswith('/ban'):
                            await handle_ban(msg)
                        elif cmd.startswith('/unban'):
                            await handle_unban(msg)
                        elif cmd == '/exportusers':
                            await handle_exportusers(msg)
                        elif cmd == '/adminlist':
                            await handle_adminlist(msg)
                        elif cmd.startswith('/revokeadmin'):
                            await handle_revokeadmin(msg)
                        elif cmd.startswith('/finduser'):
                            await handle_finduser(msg)
                        elif cmd == '/protectmode':
                            await handle_protectmode(msg)
                        elif cmd == '/speedtest':
                            await handle_speedtest(msg)
                        elif cmd == '/restart':
                            await handle_restart(msg)
                        elif cmd == '/vault':
                            st = vault_get_stats()
                            tot = st.get('total_videos', 0)
                            lec = st.get('unique_lectures', 0)
                            pdfs = st.get('total_pdfs', 0)
                            hits = st.get('cache_hits', 0)
                            misses = st.get('cache_misses', 0)
                            ch = st.get('channel_id', 'Not configured')
                            await tg_call('sendMessage', {
                                'chat_id': msg['chat']['id'],
                                'text': (
                                    "📁 **Study Hub Video & PDF Vault Stats** ⚡\n"
                                    "━━━━━━━━━━━━━━━━━━━━━━\n"
                                    f"📦 **Cached Video Streams:** `{tot}`\n"
                                    f"📚 **Unique Lectures:** `{lec}`\n"
                                    f"📄 **Archived PDF Notes & DPPs:** `{pdfs}`\n"
                                    f"⚡ **Direct Cache Hits:** `{hits}` (Instant Deliveries)\n"
                                    f"🔄 **AS Multiverse Fetches:** `{misses}`\n"
                                    f"📢 **Storage Channel ID:** `{ch}`\n"
                                    "━━━━━━━━━━━━━━━━━━━━━━\n"
                                    "All requested videos and PDF notes are permanently preserved in your private storage channel and delivered instantly to students without countdown timers.\n\n"
                                    "⚡ *Powered by Study Hub*"
                                ),
                                'parse_mode': 'Markdown'
                            })
                        continue

                    if cmd == '/help':
                        if is_admin(from_id):
                            await handle_admin_panel(msg)
                        else:
                            await handle_help(msg)
                        continue

                    # Check forcesub on general messages
                    if settings_data.get('forcesub', False) and not is_admin(from_id) and cmd not in ('/start', '/help'):
                        sub_info = await verify_user_sub(from_id)
                        if not sub_info['subscribed']:
                            await send_forcesub_restriction(msg['chat']['id'], sub_info)
                            continue

                    # 3. Public User Commands
                    if cmd in ('/start', '/batches'):
                        await handle_start(msg, app_url)
                        continue
                    elif cmd in ('/invite', '/referral'):
                        await handle_invite(msg)
                        continue
                    elif cmd.startswith('/guru'):
                        await handle_guru_telegram(msg)
                        continue

                    # Direct photo doubt in private chat
                    if msg.get('photo') and msg.get('chat', {}).get('type') == 'private':
                        await handle_guru_telegram(msg)
                        continue
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f'Polling error: {e}')
            await asyncio.sleep(2)
        await asyncio.sleep(0.5)

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data, Authorization'
}

def verify_telegram_init_data(init_data: str, bot_token: str) -> tuple:
    """
    Validates Telegram WebApp initData HMAC-SHA256 cryptographic signature.
    Returns (is_valid: bool, user_dict: dict).
    """
    if not init_data:
        return False, {}
    try:
        parsed = dict(urllib.parse.parse_qsl(init_data, keep_blank_values=True))
        if 'hash' not in parsed:
            return False, {}
        received_hash = parsed.pop('hash')
        data_check_string = '\n'.join(f"{k}={v}" for k, v in sorted(parsed.items()))
        secret_key = hmac.new(b"WebAppData", bot_token.encode('utf-8'), hashlib.sha256).digest()
        computed_hash = hmac.new(secret_key, data_check_string.encode('utf-8'), hashlib.sha256).hexdigest()
        if hmac.compare_digest(computed_hash, received_hash):
            user_data = json.loads(parsed.get('user', '{}')) if 'user' in parsed else {}
            return True, user_data
    except Exception as e:
        logger.warning(f"Telegram initData verification error: {e}")
    return False, {}

# ════════════════════════════════════════════════════════════════
# LAYER 2: DYNAMIC ONE-TIME ROLLING SECURITY TOKEN SYSTEM
# Fully governed by Render Environment Variables (Zero code leaks)
# ════════════════════════════════════════════════════════════════
APP_SECURITY_KEY = os.environ.get('APP_SECURITY_KEY') or os.environ.get('SESSION_SECRET')
if not APP_SECURITY_KEY:
    APP_SECURITY_KEY = secrets.token_hex(32)
    logger.info("Generated ephemeral in-memory APP_SECURITY_KEY")
else:
    logger.info("Using permanent master APP_SECURITY_KEY from Render Environment")

SECURITY_KEY = APP_SECURITY_KEY.encode('utf-8')

# Dynamic format and cryptographic salt loaded from Render Environment
TOKEN_PREFIX = (os.environ.get('TOKEN_PREFIX') or 'rx').strip()
TOKEN_SALT = (os.environ.get('TOKEN_SALT') or 'rx_core_secure_salt_99').encode('utf-8')
TOKEN_DELIMITER = (os.environ.get('TOKEN_DELIMITER') or '_').strip() or '_'

# Master compound secret: cryptographically blends master signing key with private salt
COMPOUND_SECRET = hashlib.sha256(SECURITY_KEY + b':' + TOKEN_SALT).digest()

ACTIVE_NONCES: dict = {}
FAILED_TOKEN_ATTEMPTS: dict = {}  # ip -> (failed_count, ban_until_timestamp)

def clean_expired_nonces():
    now = time.time()
    expired = [k for k, (exp, _) in ACTIVE_NONCES.items() if exp < now]
    for k in expired:
        del ACTIVE_NONCES[k]
    # Clean expired IP bans
    expired_bans = [ip for ip, (_, ban_until) in FAILED_TOKEN_ATTEMPTS.items() if ban_until > 0 and ban_until < now]
    for ip in expired_bans:
        del FAILED_TOKEN_ATTEMPTS[ip]

def generate_rolling_token(user_id: str) -> str:
    """
    Generates a cryptographically signed, single-use rolling token.
    The internal structure is completely parameterized via Render environment variables:
    {TOKEN_PREFIX}{TOKEN_DELIMITER}{ts}{TOKEN_DELIMITER}{nonce}{TOKEN_DELIMITER}{sig}
    """
    clean_expired_nonces()
    ts = int(time.time())
    nonce = secrets.token_hex(16)
    payload = f"{TOKEN_PREFIX}:{user_id}:{ts}:{nonce}"
    sig = hmac.new(COMPOUND_SECRET, payload.encode('utf-8'), hashlib.sha256).hexdigest()[:24]
    token = f"{TOKEN_PREFIX}{TOKEN_DELIMITER}{ts}{TOKEN_DELIMITER}{nonce}{TOKEN_DELIMITER}{sig}"
    ACTIVE_NONCES[nonce] = (time.time() + 90, str(user_id))
    return token

def validate_and_consume_token(token: str, user_id: str) -> tuple:
    """
    Validates token structure, freshness (<90s), single-use nonce, and HMAC against COMPOUND_SECRET.
    Immediately BURNS the nonce (del ACTIVE_NONCES[nonce]) so it can never be reused.
    Returns (is_valid: bool, next_token: str).
    """
    clean_expired_nonces()
    if not token or not isinstance(token, str):
        return False, ''
    parts = token.split(TOKEN_DELIMITER)
    if len(parts) != 4:
        return False, ''
    prefix, ts_str, nonce, sig = parts
    if prefix != TOKEN_PREFIX:
        return False, ''
    try:
        ts = int(ts_str)
    except ValueError:
        return False, ''
    
    # Check timestamp freshness (within 90s)
    now = time.time()
    if abs(now - ts) > 90:
        return False, ''
    
    # Verify HMAC signature against COMPOUND_SECRET
    expected_payload = f"{TOKEN_PREFIX}:{user_id}:{ts}:{nonce}"
    expected_sig = hmac.new(COMPOUND_SECRET, expected_payload.encode('utf-8'), hashlib.sha256).hexdigest()[:24]
    if not hmac.compare_digest(sig, expected_sig):
        return False, ''
    
    # Check single-use nonce
    if nonce not in ACTIVE_NONCES:
        return False, ''
    
    exp, nonce_uid = ACTIVE_NONCES[nonce]
    # IMMEDIATELY BURN NONCE (anti-replay: token is destroyed instantly)
    del ACTIVE_NONCES[nonce]

    if str(nonce_uid) != str(user_id) and nonce_uid != 'guest':
        return False, ''

    next_token = generate_rolling_token(user_id)
    return True, next_token

async def options_handler(request: web.Request):
    return web.Response(headers=CORS_HEADERS)

async def execute_bot_send(data: dict) -> tuple:
    chat_id = data.get('chatId')
    content_type = data.get('type', 'Videos')
    name = data.get('name', 'Lecture')
    subject = data.get('subject', 'Physics')
    topic = data.get('topic', 'General')
    faculty = data.get('faculty', 'Faculty')
    image = data.get('image', '')
    pdf_url = data.get('pdfUrl', '')
    batch_id = data.get('batchId', '')
    content_id = str(data.get('contentId', '')) or str(abs(hash(name)))
    provider = data.get('provider', '').lower()

    # Use Study Hub branded banner for all AS Multiverse providers or if AS Multiverse / external watermark
    if provider in AS_MULTIVERSE_PROVIDERS or not image or 'asmultiverse' in str(image).lower() or 'ibb.co' in str(image).lower():
        image = get_banner_url(WEBAPP_URL)

    if not chat_id:
        return {'error': 'Missing chatId'}, 400

    if is_user_banned(chat_id):
        return {'error': 'Account suspended by administrator.'}, 403

    if not settings_data.get('mini_app_enabled', True):
        return {'error': settings_data.get('maintenance_msg', 'Bot is under scheduled maintenance.')}, 503

    if settings_data.get('forcesub', False) and not is_admin(chat_id):
        sub_info = await verify_user_sub(chat_id)
        if not sub_info['subscribed']:
            return {
                'error': 'Community membership required',
                'forcesub': True,
                'missing': sub_info.get('missing', [])
            }, 403

    logger.info(f'Delivering {content_type}: {name} to {chat_id}')

    store_key = f'c_{content_id[-8:]}'
    payload = {
        'batchId': batch_id,
        'contentId': content_id,
        'name': name,
        'subject': subject,
        'topic': topic,
        'faculty': faculty,
        'image': image
    }
    CONTENT_STORE[store_key] = payload
    save_content_payload(store_key, payload)

    # PDF Notes & DPP Delivery with Storage Channel Backup
    if content_type in ('Notes', 'DppNotes') and pdf_url:
        caption = (
            f'By {faculty}\n\n'
            f'📄 Title: {name}\n\n'
            f'🏫 Subject: {subject}\n\n'
            f'🚩 Topic: {topic}\n\n'
            f'⚡ Powered by Study Hub'
        )
        keyboard = {
            'inline_keyboard': [
                [{'text': '📥 Open / Download PDF', 'url': pdf_url}],
                [{'text': 'Close 🔒', 'callback_data': 'close'}]
            ]
        }

        # 1. Check if PDF already backed up in storage channel
        cached_pdf = vault_get_pdf(content_id)
        doc_to_send = None

        if cached_pdf and cached_pdf.get('file_id'):
            doc_to_send = cached_pdf['file_id']
            logger.info(f"PDF Vault Cache HIT for {content_id}: using file_id {doc_to_send[:16]}...")
        else:
            # 2. Upload and archive to private storage channel
            storage_caption = (
                f'By {faculty}\n\n'
                f'📄 Title: {name}\n\n'
                f'🏫 Subject: {subject}\n\n'
                f'🚩 Topic: {topic}\n\n'
                f'⚡ Powered by Study Hub'
            )
            ch_res = await tg_call('sendDocument', {
                'chat_id': STORAGE_CHANNEL_ID,
                'document': pdf_url,
                'caption': storage_caption
            })
            if ch_res.get('ok') and ch_res.get('result'):
                ch_msg = ch_res['result']
                ch_msg_id = ch_msg.get('message_id')
                doc_obj = ch_msg.get('document') or {}
                ch_file_id = doc_obj.get('file_id')
                if ch_file_id:
                    vault_save_pdf(
                        batch_id=batch_id,
                        content_id=content_id,
                        channel_msg_id=ch_msg_id,
                        file_id=ch_file_id,
                        title=name,
                        subject=subject,
                        topic=topic,
                        faculty=faculty,
                        pdf_url=pdf_url
                    )
                    doc_to_send = ch_file_id
                    logger.info(f"PDF successfully archived in storage channel {STORAGE_CHANNEL_ID} (Msg {ch_msg_id})")

        # 3. Deliver to student
        res = await tg_call('sendDocument', {
            'chat_id': chat_id,
            'document': doc_to_send or pdf_url,
            'caption': caption,
            'reply_markup': keyboard
        })
        if not res.get('ok'):
            res = await tg_call('sendMessage', {
                'chat_id': chat_id,
                'text': caption,
                'reply_markup': keyboard
            })
        return {'success': res.get('ok', False)}, 200

    caption = (
        f'By {faculty}\n\n'
        f'📹 Title: {name}\n\n'
        f'🏫 Subject: {subject}\n\n'
        f'🚩 Topic: {topic}\n\n'
        f'📊 Available: 720p, 480p, 360p, 240p\n\n'
        f'👇 Click a button to get the video'
    )
    keyboard = {
        'inline_keyboard': [
            [
                {'text': '720p ↗', 'callback_data': f'q:720p:{store_key}'},
                {'text': '480p ↗', 'callback_data': f'q:480p:{store_key}'}
            ],
            [
                {'text': '360p ↗', 'callback_data': f'q:360p:{store_key}'},
                {'text': '240p ↗', 'callback_data': f'q:240p:{store_key}'}
            ],
            [
                {'text': 'Close 🔒', 'callback_data': 'close'}]
        ]
    }

    if image:
        res = await tg_call('sendPhoto', {
            'chat_id': chat_id,
            'photo': image,
            'caption': caption,
            'reply_markup': keyboard
        })
    else:
        res = await tg_call('sendMessage', {
            'chat_id': chat_id,
            'text': caption,
            'reply_markup': keyboard
        })
    return {'success': res.get('ok', False)}, 200

async def bot_send_handler(request: web.Request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({'error': 'Invalid JSON'}, status=400, headers=CORS_HEADERS)
    res, status = await execute_bot_send(data)
    return web.json_response(res, status=status, headers=CORS_HEADERS)

# ════════════════════════════════════════════════════════════════
# MULTI-PROVIDER BACKEND API ROUTES
# ════════════════════════════════════════════════════════════════

async def fetch_batches_data(provider: str = 'pw', page: int = 1, limit: int = 20) -> dict:
    provider = (provider or 'pw').lower()
    page = int(page) if page else 1
    limit = int(limit) if limit else 20

    if provider in AS_MULTIVERSE_PROVIDERS:
        prov = AS_MULTIVERSE_PROVIDERS[provider]
        url = f"https://api.asmultiverse.app/api/v1/{prov}/batches?page={page}&limit={limit}"
        try:
            async with aiohttp.ClientSession() as session:
                data = await fetch_asmultiverse_json(session, url, prov)
                raw_batches = data.get('data') if isinstance(data.get('data'), list) else data.get('data', {}).get('batches', [])
                normalized = []
                for b in (raw_batches or []):
                    b_id = str(b.get('_id') or b.get('id') or '')
                    title = b.get('title') or b.get('name') or b.get('batchName') or 'Batch'
                    img = b.get('image') or b.get('previewImage') or ''
                    if not img or 'asmultiverse' in str(img).lower() or 'ibb.co' in str(img).lower():
                        img = get_banner_url(WEBAPP_URL)
                    normalized.append({
                        '_id': b_id,
                        'id': b_id,
                        'name': title,
                        'title': title,
                        'previewImage': img,
                        'image': img,
                        'class': b.get('class', '')
                    })
                return {'success': True, 'data': normalized}
        except Exception as e:
            logger.error(f"Error fetching {provider} batches live: {e}")
            return {'success': False, 'data': []}

    # Primary: PW batches via pw-botv2 onrender
    url = f"https://pw-botv2-wz1c.onrender.com/api/batches?page={page}&limit={limit}"
    try:
        async with aiohttp.ClientSession() as session:
            headers = {'User-Agent': 'Mozilla/5.0'}
            async with session.get(url, headers=headers, timeout=12) as resp:
                data = await resp.json()
                raw = data.get('data') if isinstance(data.get('data'), list) else []
                normalized = []
                for b in raw:
                    b_id = str(b.get('_id') or b.get('id') or '')
                    name = b.get('name') or b.get('title') or 'Batch'
                    img = b.get('previewImage') or b.get('image') or ''
                    normalized.append({
                        '_id': b_id,
                        'id': b_id,
                        'name': name,
                        'title': name,
                        'previewImage': img,
                        'image': img,
                        'class': b.get('class', '')
                    })
                return {'success': True, 'data': normalized}
    except Exception as e:
        logger.warning(f"PW batches primary failed ({e}), trying pimaxer fallback...")
        fb_url = f"https://a.pimaxer.in/v2/batches?page={page}&limit={limit}"
        try:
            async with aiohttp.ClientSession() as session:
                fb_headers = {'accept': '*/*', 'origin': 'https://pw.learntopper.in', 'referer': 'https://pw.learntopper.in/'}
                async with session.get(fb_url, headers=fb_headers, timeout=10) as resp:
                    data = await resp.json()
                    return data
        except Exception as ex:
            logger.error(f"Pimaxer fallback also failed: {ex}")
            return {'success': False, 'data': []}

async def search_batches_data(q: str, provider: str = 'pw') -> dict:
    q = (q or '').strip()
    provider = (provider or 'pw').lower()
    if not q:
        return {'success': True, 'data': []}

    if provider in AS_MULTIVERSE_PROVIDERS:
        prov = AS_MULTIVERSE_PROVIDERS[provider]
        url = f"https://api.asmultiverse.app/api/v1/{prov}/batches?page=1&limit=50"
        try:
            async with aiohttp.ClientSession() as session:
                data = await fetch_asmultiverse_json(session, url, prov)
                raw = data.get('data') if isinstance(data.get('data'), list) else data.get('data', {}).get('batches', [])
                matches = []
                for b in (raw or []):
                    title = b.get('title') or b.get('name') or b.get('batchName') or ''
                    if q.lower() in title.lower():
                        b_id = str(b.get('_id') or b.get('id') or '')
                        img = b.get('image') or b.get('previewImage') or ''
                        if not img or 'asmultiverse' in str(img).lower() or 'ibb.co' in str(img).lower():
                            img = get_banner_url(WEBAPP_URL)
                        matches.append({
                            '_id': b_id,
                            'id': b_id,
                            'name': title,
                            'title': title,
                            'previewImage': img,
                            'image': img,
                            'class': b.get('class', '')
                        })
                return {'success': True, 'data': matches}
        except Exception as e:
            logger.error(f"Live search failed for {provider}: {e}")
            return {'success': False, 'data': []}

    # Primary: PW search via pw-botv2 onrender
    url = f"https://pw-botv2-wz1c.onrender.com/api/batches/search?q={urllib.parse.quote(q)}"
    try:
        async with aiohttp.ClientSession() as session:
            headers = {'User-Agent': 'Mozilla/5.0'}
            async with session.get(url, headers=headers, timeout=12) as resp:
                data = await resp.json()
                raw = data.get('data') if isinstance(data.get('data'), list) else []
                normalized = []
                for b in raw:
                    b_id = str(b.get('_id') or b.get('id') or '')
                    name = b.get('name') or b.get('title') or 'Batch'
                    img = b.get('previewImage') or b.get('image') or ''
                    normalized.append({
                        '_id': b_id,
                        'id': b_id,
                        'name': name,
                        'title': name,
                        'previewImage': img,
                        'image': img,
                        'class': b.get('class', '')
                    })
                return {'success': True, 'data': normalized}
    except Exception as e:
        logger.error(f"PW live search error: {e}")
        return {'success': False, 'data': []}

async def fetch_batch_details_data(batch_id: str, provider: str = 'pw') -> dict:
    batch_id = str(batch_id or '')
    provider = (provider or 'pw').lower()

    if provider in AS_MULTIVERSE_PROVIDERS:
        prov = AS_MULTIVERSE_PROVIDERS[provider]
        cache_key = f"{prov}:{batch_id}"
        now = time.time()
        if cache_key in BATCH_DETAILS_CACHE:
            exp, cached_data = BATCH_DETAILS_CACHE[cache_key]
            if now < exp:
                return cached_data

        url = f"https://api.asmultiverse.app/api/v1/{prov}/batch/{batch_id}/details"
        try:
            async with aiohttp.ClientSession() as session:
                data = await fetch_asmultiverse_json(session, url, prov)
                subjects = data.get('data', {}).get('subjects', []) if isinstance(data.get('data'), dict) else []
                normalized_subjects = []
                for s in subjects:
                    s_id = str(s.get('_id') or s.get('id') or '')
                    title = s.get('title') or s.get('subject') or s.get('subjectName') or 'Subject'
                    v_count = s.get('totalVideos') or s.get('lectureCount') or 0
                    n_count = s.get('totalNotes') or 0
                    s_img = s.get('image') or ''
                    if not s_img or 'asmultiverse' in str(s_img).lower() or 'ibb.co' in str(img).lower():
                        s_img = get_banner_url(WEBAPP_URL)
                    normalized_subjects.append({
                        '_id': s_id,
                        'id': s_id,
                        'subject': title,
                        'title': title,
                        'lectureCount': v_count,
                        'totalVideos': v_count,
                        'totalNotes': n_count,
                        'imageId': s_img,
                        'image': s_img
                    })
                resp_payload = {'success': True, 'data': {'_id': batch_id, 'subjects': normalized_subjects}}
                if normalized_subjects:
                    BATCH_DETAILS_CACHE[cache_key] = (now + 7200, resp_payload)
                return resp_payload
        except Exception as e:
            logger.error(f"Live {provider} details error: {e}")
            return {'success': False, 'data': {'subjects': []}}

    # Primary: PW batch details
    url = f"https://pw-botv2-wz1c.onrender.com/api/batch/{batch_id}/details"
    try:
        async with aiohttp.ClientSession() as session:
            headers = {'User-Agent': 'Mozilla/5.0'}
            async with session.get(url, headers=headers, timeout=12) as resp:
                data = await resp.json()
                return data
    except Exception as e:
        logger.warning(f"PW batch details primary failed ({e}), trying pimaxer fallback...")
        fb_url = f"https://a.pimaxer.in/v2/batches/{batch_id}/subject"
        try:
            async with aiohttp.ClientSession() as session:
                fb_headers = {'accept': '*/*', 'origin': 'https://pw.learntopper.in', 'referer': 'https://pw.learntopper.in/'}
                async with session.get(fb_url, headers=fb_headers, timeout=10) as resp:
                    data = await resp.json()
                    return data
        except Exception as ex:
            return {'success': False, 'data': {'subjects': []}}

def clean_chapter_prefix(s: str) -> str:
    s = s.strip()
    for pfx in ['Video > ', 'PDF > ', 'VIDEO > ', 'DPP > ', 'Hand Written Notes > ', 'Dpp > ']:
        if s.startswith(pfx):
            s = s[len(pfx):].strip()
    return s

def norm_chapter_key(s: str) -> str:
    k = clean_chapter_prefix(s)
    k = re.sub(r'[^a-zA-Z0-9\u0900-\u097F]+', ' ', k.lower()).strip()
    words = [w for w in k.split() if w]
    norm_words = []
    for w in words:
        if w.endswith('s') and not w.endswith(('ss', 'us', 'is', 'as', 'tenses')):
            w = w[:-1]
        if w:
            norm_words.append(w)
    return ' '.join(norm_words)

def extract_chapter_and_lecture(raw_title: str, known_chapters: list = None) -> tuple:
    s = clean_chapter_prefix(raw_title)

    # 1. Delimiter ' > ' (supports multi-level hierarchical paths e.g. Branch > Chapter > Subfolder > Lecture)
    if ' > ' in s:
        parts = [p.strip() for p in s.split(' > ') if p.strip()]
        if len(parts) == 1:
            return parts[0], parts[0]
        elif len(parts) == 2:
            return parts[0], parts[1]
        elif len(parts) >= 3:
            skip_subfolders = {
                'summary lectures', 'summary lecture', 'handwritten notes',
                'hand written notes', 'notes', 'dpp', 'revision', 'ncert solutions'
            }
            if parts[-2].lower() in skip_subfolders:
                ch = parts[-3] if len(parts) >= 4 else parts[0]
                lec = f"{parts[-2]} - {parts[-1]}"
            else:
                ch = parts[1]
                lec = parts[-1]
            return ch, lec

    # 2. Delimiter ' | '
    if ' | ' in s:
        parts = s.split(' | ', 1)
        return parts[0].strip(), parts[1].strip()

    # 3. Hindi / structured chapters: 'Chapter N - Title - Subtitle'
    m = re.match(r'^(Chapter\s+\d+\s*-\s*[^-]+)\s*-\s*(.+)$', s, re.IGNORECASE)
    if m:
        return m.group(1).strip(), m.group(2).strip()

    m2 = re.match(r'^(Chapter\s+\d+\s*-\s*[^-]+)$', s, re.IGNORECASE)
    if m2:
        return m2.group(1).strip(), m2.group(1).strip()

    # 4. Delimiter ' - '
    if ' - ' in s:
        parts = s.split(' - ', 1)
        return parts[0].strip(), parts[1].strip()

    # 5. Check against known chapters list
    if known_chapters:
        for k in sorted(known_chapters, key=len, reverse=True):
            if k and (s.startswith(k) or k.lower() in s.lower()):
                rest = s[len(k):].strip(' -|:>')
                return k, rest or s

    # 6. Standalone single-unit item
    return s, s

def lecture_sort_key(item: dict) -> tuple:
    name = item.get('name', '')
    m = re.search(r'\b(?:L|Lecture|Class|Part)[-\s]*0*(\d+)\b', name, re.IGNORECASE)
    if m:
        return (0, int(m.group(1)))
    return (1, name.lower())

def is_dpp_pdf_item(raw_title: str) -> bool:
    t = (raw_title or '').lower()
    if any(k in t for k in ['class pdf', 'class notes', 'lecture notes', 'theory notes', 'lecture pdf']):
        return False
    dpp_patterns = [
        r'\bdpp\b', r'\bd\.p\.p\b', r'\bassignment\b', r'\bpractice sheet\b',
        r'\bpractice-sheet\b', r'\bworksheet\b', r'\bquestion paper\b',
        r'\btest paper\b', r'\bhomework\b', r'\bh\.w\b', r'\bh/w\b',
        r'\bquestion practice\b', r'\bdaily practice\b', r'\bexercise\b'
    ]
    return any(re.search(p, t) for p in dpp_patterns)

def is_dpp_video_item(raw_title: str) -> bool:
    t = (raw_title or '').lower()
    dpp_patterns = [
        r'\bdpp\b', r'\bd\.p\.p\b', r'\bdiscussion\b', r'\bsolution\b',
        r'\bexercise solution\b', r'\bncert solution\b', r'\btest solution\b',
        r'\bhomework discussion\b', r'\bquestion practice\b', r'\bdpp solution\b',
        r'\bproblem discussion\b'
    ]
    return any(re.search(p, t) for p in dpp_patterns)

async def fetch_batch_topics_data(batch_id: str, subject_id: str, provider: str = 'pw') -> dict:
    batch_id = str(batch_id or '')
    subject_id = str(subject_id or '')
    provider = (provider or 'pw').lower()

    if provider in AS_MULTIVERSE_PROVIDERS:
        prov = AS_MULTIVERSE_PROVIDERS[provider]
        cache_key = f"{prov}:{batch_id}:{subject_id}"
        now = time.time()
        if cache_key in TOPICS_CACHE:
            exp, cached_data = TOPICS_CACHE[cache_key]
            if now < exp:
                return cached_data

        v_url = f"https://api.asmultiverse.app/api/v1/{prov}/batch/{batch_id}/subject/{subject_id}/topics?contentType=VIDEO"
        p_url = f"https://api.asmultiverse.app/api/v1/{prov}/batch/{batch_id}/subject/{subject_id}/topics?contentType=PDF"
        try:
            async with aiohttp.ClientSession() as session:
                data_v, data_p = await asyncio.gather(
                    fetch_asmultiverse_json(session, v_url, prov),
                    fetch_asmultiverse_json(session, p_url, prov),
                    return_exceptions=True
                )
                v_chapters = []
                p_chapters = []
                if isinstance(data_v, dict) and isinstance(data_v.get('data'), dict):
                    v_chapters = data_v['data'].get('chapters', [])
                if isinstance(data_p, dict) and isinstance(data_p.get('data'), dict):
                    p_chapters = data_p['data'].get('chapters', [])

                all_chapters = v_chapters + p_chapters

                # First pass: collect known explicit chapter names
                known_chapters = []
                for ch in all_chapters:
                    raw = ch.get('title', '')
                    ech, _ = extract_chapter_and_lecture(raw)
                    if ech and ech != clean_chapter_prefix(raw) and ech not in known_chapters:
                        known_chapters.append(ech)

                # Cluster chapters by normalized key
                clusters = {}
                for v in v_chapters:
                    raw = v.get('title', '')
                    ch_name, _ = extract_chapter_and_lecture(raw, known_chapters)
                    key = norm_chapter_key(ch_name) or 'general'
                    if key not in clusters:
                        clusters[key] = {'name': ch_name, 'v_count': 0, 'p_count': 0, 'dpp_p_count': 0, 'dpp_v_count': 0}
                    if is_dpp_video_item(raw):
                        clusters[key]['dpp_v_count'] += 1
                    else:
                        clusters[key]['v_count'] += 1

                for p in p_chapters:
                    raw = p.get('title', '')
                    ch_name, _ = extract_chapter_and_lecture(raw, known_chapters)
                    key = norm_chapter_key(ch_name) or 'general'
                    if key not in clusters:
                        clusters[key] = {'name': ch_name, 'v_count': 0, 'p_count': 0, 'dpp_p_count': 0, 'dpp_v_count': 0}
                    if is_dpp_pdf_item(raw):
                        clusters[key]['dpp_p_count'] += 1
                    else:
                        clusters[key]['p_count'] += 1

                topics = []
                for key, data in clusters.items():
                    v_total = data['v_count'] if data['v_count'] > 0 else data['dpp_v_count']
                    p_total = data['p_count'] if data['p_count'] > 0 else data['dpp_p_count']
                    topics.append({
                        '_id': key,
                        'id': key,
                        'name': data['name'],
                        'slug': key,
                        'lectureVideos': v_total,
                        'notes': p_total,
                        'dppNotes': data['dpp_p_count'],
                        'dppVideos': data['dpp_v_count'],
                        'exercises': data['dpp_p_count']
                    })

                if not topics:
                    topics = [{
                        '_id': f'top_{subject_id}',
                        'id': f'top_{subject_id}',
                        'name': 'Course Curriculum & Lectures',
                        'slug': 'curriculum',
                        'lectureVideos': len(v_chapters) or 1,
                        'notes': len(p_chapters) or 1,
                        'exercises': 0
                    }]

                resp_payload = {'success': True, 'data': topics}
                if clusters:
                    TOPICS_CACHE[cache_key] = (now + 7200, resp_payload)
                return resp_payload
        except Exception as e:
            logger.error(f"Live {provider} topics error: {e}")
            return {'success': False, 'data': []}

    # Primary: PW topics via pw-botv2 onrender
    url = f"https://pw-botv2-wz1c.onrender.com/api/batch/{batch_id}/subject/{subject_id}/topics"
    try:
        async with aiohttp.ClientSession() as session:
            headers = {'User-Agent': 'Mozilla/5.0'}
            async with session.get(url, headers=headers, timeout=12) as resp:
                data = await resp.json()
                return data
    except Exception as e:
        logger.warning(f"PW topics primary failed ({e}), trying pimaxer fallback...")
        fb_url = f"https://a.pimaxer.in/v2/batches/{batch_id}/subject/{subject_id}/topics"
        try:
            async with aiohttp.ClientSession() as session:
                fb_headers = {'accept': '*/*', 'origin': 'https://pw.learntopper.in', 'referer': 'https://pw.learntopper.in/'}
                async with session.get(fb_url, headers=fb_headers, timeout=10) as resp:
                    data = await resp.json()
                    return data
        except Exception as ex:
            return {'success': False, 'data': []}

async def fetch_batch_content_data(batch_id: str, subject_id: str, tag: str = '', content_type: str = 'Videos', page: int = 1, provider: str = 'pw') -> dict:
    batch_id = str(batch_id or '')
    subject_id = str(subject_id or '')
    tag = str(tag or '')
    content_type = str(content_type or 'Videos')
    page = int(page) if page else 1
    provider = (provider or 'pw').lower()

    if provider in AS_MULTIVERSE_PROVIDERS:
        prov = AS_MULTIVERSE_PROVIDERS[provider]
        is_pdf_req = content_type.lower() in ('notes', 'dppnotes')
        c_type = 'PDF' if is_pdf_req else 'VIDEO'
        cache_key = f"{prov}:{batch_id}:{subject_id}:{content_type.lower()}:{tag or 'all'}"
        now = time.time()
        if cache_key in BATCH_CONTENT_CACHE:
            exp, cached_data = BATCH_CONTENT_CACHE[cache_key]
            if now < exp:
                return cached_data

        url = f"https://api.asmultiverse.app/api/v1/{prov}/batch/{batch_id}/subject/{subject_id}/topics?contentType={c_type}"
        try:
            async with aiohttp.ClientSession() as session:
                data = await fetch_asmultiverse_json(session, url, prov)
                chapters = data.get('data', {}).get('chapters', []) if isinstance(data.get('data'), dict) else []

                # Collect known chapters for precise matching
                known_chapters = []
                for ch in chapters:
                    raw = ch.get('title', '')
                    ech, _ = extract_chapter_and_lecture(raw)
                    if ech and ech != clean_chapter_prefix(raw) and ech not in known_chapters:
                        known_chapters.append(ech)

                tag_key = norm_chapter_key(tag) if tag else ''
                formatted = []
                for ch in chapters:
                    raw = ch.get('title', '')
                    ch_name, lec_name = extract_chapter_and_lecture(raw, known_chapters)
                    item_key = norm_chapter_key(ch_name) or 'general'

                    # Tag filter matching: compare normalized chapter key, exact ID, or substring
                    if tag and tag.lower() != 'all':
                        if item_key != tag_key and tag_key not in item_key and tag.lower() not in raw.lower() and str(ch.get('_id')) != tag:
                            continue

                    dur = ch.get('duration')
                    dur_str = f"{dur//60} mins" if isinstance(dur, int) and dur > 0 else (str(dur) if dur else '45 mins')
                    c_id = str(ch.get('_id'))
                    is_pdf = (c_type == 'PDF')
                    banner_img = get_banner_url(WEBAPP_URL)

                    display_title = lec_name if lec_name else ch_name

                    formatted.append({
                        '_id': c_id,
                        'id': c_id,
                        'topic': ch_name or 'Chapter',
                        'name': display_title,
                        'raw_title': raw,
                        'image': banner_img,
                        'duration': dur_str,
                        'date': ch.get('date', 0),
                        'batchId': batch_id,
                        'contentId': c_id,
                        'subjectId': subject_id,
                        'provider': provider,
                        'type': 'PDF' if is_pdf else 'VIDEO',
                        'videoDetails': {
                            '_id': c_id,
                            'id': c_id,
                            'name': display_title,
                            'image': banner_img,
                            'duration': dur_str
                        },
                        'pdfUrl': ch.get('url') or '',
                        'attBaseUrl': 'https://static.pw.live/',
                        'attKey': ''
                    })

                # Sequence items ascending (L1, L2, L3, ...)
                formatted.sort(key=lecture_sort_key)

                # STRICT TAB CONTENT SEPARATION:
                ct_lower = content_type.lower()
                if ct_lower == 'dppnotes':
                    formatted = [it for it in formatted if is_dpp_pdf_item(it.get('raw_title', '') + ' ' + it.get('name', ''))]
                elif ct_lower == 'notes':
                    non_dpp = [it for it in formatted if not is_dpp_pdf_item(it.get('raw_title', '') + ' ' + it.get('name', ''))]
                    if non_dpp:
                        formatted = non_dpp
                elif ct_lower == 'dppvideos':
                    formatted = [it for it in formatted if is_dpp_video_item(it.get('raw_title', '') + ' ' + it.get('name', ''))]
                elif ct_lower == 'videos':
                    regular_vids = [it for it in formatted if not is_dpp_video_item(it.get('raw_title', '') + ' ' + it.get('name', ''))]
                    if regular_vids:
                        formatted = regular_vids

                resp_payload = {'success': True, 'data': formatted}
                if formatted:
                    BATCH_CONTENT_CACHE[cache_key] = (now + 7200, resp_payload)
                return resp_payload
        except Exception as e:
            logger.error(f"Live {provider} content error: {e}")
            return {'success': False, 'data': []}

    # Primary: PW content via pw-botv2 onrender
    url = f"https://pw-botv2-wz1c.onrender.com/api/batch/{batch_id}/subject/{subject_id}/content?tag={tag}&type={content_type}&page={page}"
    try:
        async with aiohttp.ClientSession() as session:
            headers = {'User-Agent': 'Mozilla/5.0'}
            async with session.get(url, headers=headers, timeout=12) as resp:
                data = await resp.json()
                return data
    except Exception as e:
        logger.warning(f"PW content primary failed ({e}), trying pimaxer fallback...")
        pimaxer_type = content_type
        if content_type.lower() == 'notes': pimaxer_type = 'notes'
        elif content_type.lower() == 'videos': pimaxer_type = 'Videos'
        elif content_type.lower() == 'dppnotes': pimaxer_type = 'DppNotes'
        elif content_type.lower() == 'dppvideos': pimaxer_type = 'DppVideos'

        fb_url = f"https://a.pimaxer.in/v2/batches/{batch_id}/subject/{subject_id}/content?page={page}&contentType={pimaxer_type}&tag={tag}"
        try:
            async with aiohttp.ClientSession() as session:
                fb_headers = {'accept': '*/*', 'origin': 'https://pw.learntopper.in', 'referer': 'https://pw.learntopper.in/'}
                async with session.get(fb_url, headers=fb_headers, timeout=10) as resp:
                    data = await resp.json()
                    return data
        except Exception as ex:
            return {'success': False, 'data': []}

async def fetch_batch_content_details_data(batch_id: str, subject_id: str, content_id: str, provider: str = 'pw') -> dict:
    batch_id = str(batch_id or '')
    subject_id = str(subject_id or '')
    content_id = str(content_id or '')
    provider = (provider or 'pw').lower()

    if provider in AS_MULTIVERSE_PROVIDERS:
        prov = AS_MULTIVERSE_PROVIDERS[provider]
        cache_key = f"{prov}:{batch_id}:{subject_id}:{content_id}"
        now = time.time()

        if cache_key in CONTENT_DETAILS_CACHE:
            exp, cached_data = CONTENT_DETAILS_CACHE[cache_key]
            if now < exp:
                return cached_data

        url = f"https://api.asmultiverse.app/api/v1/{prov}/batches/{batch_id}/subjects/{subject_id}/contents/{content_id}/details"
        try:
            async with aiohttp.ClientSession() as session:
                data = await fetch_asmultiverse_json(session, url, prov)
                link = data.get('data', {}).get('link') or data.get('link')
                if link:
                    CONTENT_DETAILS_CACHE[cache_key] = (now + 7200, data)
                    return data
                elif data.get('success'):
                    return data
                else:
                    return {'success': False, 'message': 'Content details unavailable upstream'}
        except Exception as e:
            logger.error(f"Error fetching live {provider} content details: {e}")
            return {'success': False, 'error': str(e)}

    return {'success': False, 'message': 'Not supported for provider'}

# HTTP Handlers (delegating to unified async fetch functions)
async def api_batches_handler(request: web.Request):
    provider = request.query.get('provider', 'pw').lower()
    page = int(request.query.get('page', 1))
    limit = int(request.query.get('limit', 20))
    res = await fetch_batches_data(provider, page, limit)
    return web.json_response(res, headers=CORS_HEADERS)

async def api_batches_search_handler(request: web.Request):
    q = request.query.get('q', '').strip()
    provider = request.query.get('provider', 'pw').lower()
    res = await search_batches_data(q, provider)
    return web.json_response(res, headers=CORS_HEADERS)

async def api_batch_details_handler(request: web.Request):
    batch_id = request.match_info.get('batch_id', '')
    provider = request.query.get('provider', 'pw').lower()
    res = await fetch_batch_details_data(batch_id, provider)
    return web.json_response(res, headers=CORS_HEADERS)

async def api_batch_topics_handler(request: web.Request):
    batch_id = request.match_info.get('batch_id', '')
    subject_id = request.match_info.get('subject_id', '')
    provider = request.query.get('provider', 'pw').lower()
    res = await fetch_batch_topics_data(batch_id, subject_id, provider)
    return web.json_response(res, headers=CORS_HEADERS)

async def api_batch_content_handler(request: web.Request):
    batch_id = request.match_info.get('batch_id', '')
    subject_id = request.match_info.get('subject_id', '')
    tag = request.query.get('tag', '')
    content_type = request.query.get('type', 'Videos')
    page = int(request.query.get('page', 1))
    provider = request.query.get('provider', 'pw').lower()
    res = await fetch_batch_content_data(batch_id, subject_id, tag, content_type, page, provider)
    return web.json_response(res, headers=CORS_HEADERS)

async def api_batch_content_details_handler(request: web.Request):
    batch_id = request.match_info.get('batch_id', '')
    subject_id = request.match_info.get('subject_id', '')
    content_id = request.match_info.get('content_id', '')
    provider = request.query.get('provider', 'pw').lower()
    res = await fetch_batch_content_details_data(batch_id, subject_id, content_id, provider)
    return web.json_response(res, headers=CORS_HEADERS)

async def check_sub_data(user_id: int = None) -> dict:
    is_maint = (not settings_data.get('mini_app_enabled', True)) or settings_data.get('maintenance', False)
    maint_msg = settings_data.get('maintenance_msg', 'The Study Hub is currently paused for scheduled maintenance. Please check back shortly!')
    user_is_admin = is_admin(user_id) if user_id else False

    base_response = {
        'success': True,
        'maintenance': is_maint,
        'maintenance_msg': maint_msg,
        'is_admin': user_is_admin,
        'forcesub_active': settings_data.get('forcesub', False),
        'channel_link': settings_data.get('channel_link', os.environ.get('CHANNEL_LINK', 'https://t.me/')),
        'group_link': settings_data.get('group_link', os.environ.get('GROUP_LINK', 'https://t.me/'))
    }

    if not user_id:
        base_response['subscribed'] = True
        return base_response

    if user_is_admin or not settings_data.get('forcesub', False):
        base_response.update({
            'subscribed': True,
            'channel_ok': True,
            'group_ok': True,
            'missing': []
        })
        return base_response

    res = await verify_user_sub(user_id)
    base_response.update({
        'subscribed': res['subscribed'],
        'channel_ok': res['channel_ok'],
        'group_ok': res['group_ok'],
        'missing': res['missing']
    })
    return base_response

def get_vip_status_data(user_id: int) -> dict:
    if not user_id:
        return {'success': False, 'message': 'Missing user_id'}
    vip_info = get_user_vip_info(user_id)
    invite_link = f"https://t.me/{BOT_USERNAME}?start=ref_{user_id}"
    return {
        'success': True,
        'is_vip': vip_info.get('is_vip', False),
        'referrals': vip_info.get('referrals', 0),
        'target': vip_info.get('target', 3),
        'invite_link': invite_link
    }

async def solve_guru_doubt_data(question: str, photo_b64: str = None) -> dict:
    question = (question or '').strip()
    if not question and not photo_b64:
        return {'success': False, 'message': 'Please enter a question or attach a photo.'}
    try:
        result = await solve_doubt(question, photo_b64)
        return {
            'success': True,
            'subject': result.get('subject', 'STEM'),
            'answer': result.get('answer', ''),
            'recommendation': result.get('recommendation', 'Physics Wallah Batches')
        }
    except Exception as e:
        logger.error(f"Error in solve_guru_doubt_data: {e}", exc_info=True)
        return {'success': False, 'message': 'Failed to process doubt. Please try again.'}

async def api_check_sub_handler(request: web.Request):
    user_id = request.query.get('userId') or request.query.get('chatId')
    uid = int(user_id) if user_id and str(user_id).lstrip('-').isdigit() else None
    res = await check_sub_data(uid)
    return web.json_response(res, headers=CORS_HEADERS)

@web.middleware
async def maintenance_middleware(request: web.Request, handler):
    if request.path.startswith('/api/') and request.path not in ('/api/check-sub', '/api/user/vip-status', '/api/guru/solve'):
        is_maint = (not settings_data.get('mini_app_enabled', True)) or settings_data.get('maintenance', False)
        if is_maint:
            user_id = request.query.get('userId') or request.query.get('chatId')
            uid = int(user_id) if user_id and str(user_id).lstrip('-').isdigit() else None
            # Allow admins to bypass/preview
            if not (uid and is_admin(uid)):
                return web.json_response({
                    'success': False,
                    'maintenance': True,
                    'message': settings_data.get('maintenance_msg', 'The Study Hub is currently paused for scheduled maintenance. Please check back shortly!')
                }, headers=CORS_HEADERS)
    return await handler(request)

@web.middleware
async def telegram_auth_middleware(request: web.Request, handler):
    # Skip preflight OPTIONS and static paths
    if request.method == 'OPTIONS' or not (request.path.startswith('/api/') or request.path == '/bot/send'):
        return await handler(request)

    # Allow public endpoints without initData
    if request.path in ('/api/check-sub',):
        return await handler(request)

    client_ip = request.remote or ''
    is_local = client_ip in ('127.0.0.1', '::1', 'localhost')
    init_data = request.headers.get('X-Telegram-Init-Data') or request.query.get('initData') or ''

    if init_data:
        valid, tg_user = verify_telegram_init_data(init_data, BOT_TOKEN)
        if valid:
            request['tg_user'] = tg_user
            return await handler(request)
        else:
            logger.warning(f"Blocked request to {request.path} from {client_ip}: Invalid HMAC signature")
            return web.json_response({
                'success': False,
                'error': 'Unauthorized',
                'message': 'Access Denied: Invalid Telegram cryptographic signature.'
            }, status=403, headers=CORS_HEADERS)

    # Local development testing bypass
    if is_local:
        return await handler(request)

    # If accessed directly from Chrome without Telegram signature
    logger.warning(f"Blocked unauthorized direct browser API call to {request.path} from {client_ip}")
    return web.json_response({
        'success': False,
        'error': 'Unauthorized',
        'message': 'Access Denied: You must launch this app inside Telegram.'
    }, status=401, headers=CORS_HEADERS)

async def api_vip_status_handler(request: web.Request):
    try:
        user_id_str = request.query.get('user_id')
        user_id = int(user_id_str) if user_id_str and user_id_str.lstrip('-').isdigit() else None
        res = get_vip_status_data(user_id)
        return web.json_response(res, headers=CORS_HEADERS)
    except Exception as e:
        logger.error(f"Error in api_vip_status_handler: {e}")
        return web.json_response({'success': False, 'message': str(e)}, headers=CORS_HEADERS)

async def api_guru_solve_handler(request: web.Request):
    try:
        body = await request.json()
        question = body.get('question')
        photo_b64 = body.get('photo_base64')
        res = await solve_guru_doubt_data(question, photo_b64)
        return web.json_response(res, headers=CORS_HEADERS)
    except web.HTTPRequestEntityTooLarge:
        logger.error("Guru solve payload exceeded max size")
        return web.json_response({'success': False, 'message': 'Photo is too large. Please select a smaller photo or retry.'}, headers=CORS_HEADERS)
    except Exception as e:
        logger.error(f"Error in api_guru_solve_handler: {e}", exc_info=True)
        return web.json_response({'success': False, 'message': 'Failed to process doubt. Please try again.'}, headers=CORS_HEADERS)

# ════════════════════════════════════════════════════════════════
# PERSISTENT WEBSOCKET TUNNEL (/ws)
# Zero Fetch/XHR footprint with dynamic rolling nonce verification
# ════════════════════════════════════════════════════════════════
async def websocket_handler(request: web.Request):
    ws = web.WebSocketResponse(heartbeat=30.0, max_msg_size=30 * 1024 * 1024)
    await ws.prepare(request)

    client_ip = (request.headers.get('X-Forwarded-For') or '').split(',')[0].strip() or request.remote or ''
    is_local = client_ip in ('127.0.0.1', '::1', 'localhost')
    session_user = {'id': 'guest', 'first_name': 'Student'}
    authenticated = is_local
    active_token = None

    # Check IP brute-force lockout
    now = time.time()
    ban_until = FAILED_TOKEN_ATTEMPTS.get(client_ip, (0, 0))[1]
    if ban_until > now:
        await ws.send_str(json.dumps({
            'type': 'error',
            'error': f'Too many failed security attempts. IP temporarily locked for {int(ban_until - now)}s.'
        }))
        await ws.close(code=4403, message=b'Forbidden: Brute force blocked')
        return ws

    logger.info(f"⚡ WebSocket client connected from {client_ip}")

    try:
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                try:
                    payload = json.loads(msg.data)
                except Exception:
                    await ws.send_str(json.dumps({'type': 'error', 'message': 'Invalid JSON'}))
                    continue

                action = payload.get('action')
                req_id = payload.get('id')
                token = payload.get('token')
                params = payload.get('params') or {}

                # 1. Handshake Action: verifies Telegram signature and initializes rolling token chain
                if action == 'handshake':
                    init_data = payload.get('initData') or ''
                    if init_data:
                        valid, tg_user = verify_telegram_init_data(init_data, BOT_TOKEN)
                        if valid:
                            session_user = tg_user
                            authenticated = True
                        elif not is_local:
                            await ws.send_str(json.dumps({
                                'type': 'handshake_ack',
                                'success': False,
                                'error': 'Invalid Telegram cryptographic signature'
                            }))
                            continue
                    else:
                        if not is_local:
                            await ws.send_str(json.dumps({
                                'type': 'handshake_ack',
                                'success': False,
                                'error': 'Missing Telegram initData'
                            }))
                            continue
                        authenticated = True

                    uid = str(session_user.get('id', 'guest'))
                    active_token = generate_rolling_token(uid)
                    await ws.send_str(json.dumps({
                        'type': 'handshake_ack',
                        'success': True,
                        'token': active_token,
                        'user': session_user
                    }))
                    continue

                # 2. Ping / Pong Action
                if action == 'ping':
                    await ws.send_str(json.dumps({'type': 'pong', 'id': req_id}))
                    continue

                # Enforce Authentication & Challenge-Response Rolling Token
                if not authenticated:
                    await ws.send_str(json.dumps({
                        'id': req_id,
                        'success': False,
                        'error': 'Session unauthenticated. Please complete handshake.'
                    }))
                    continue

                uid = str(session_user.get('id', 'guest'))
                is_valid_token, next_token = validate_and_consume_token(token, uid)
                if not is_valid_token:
                    attempts, _ = FAILED_TOKEN_ATTEMPTS.get(client_ip, (0, 0))
                    attempts += 1
                    if attempts >= 4 and not is_local:
                        FAILED_TOKEN_ATTEMPTS[client_ip] = (attempts, time.time() + 300)
                        logger.warning(f"🚫 Potential token brute-force attack from IP {client_ip}. Banned for 5 minutes.")
                        await ws.send_str(json.dumps({
                            'id': req_id,
                            'success': False,
                            'error': 'Brute-force token attack detected. IP suspended for 5 minutes.'
                        }))
                        await ws.close(code=4403, message=b'Forbidden: Brute force blocked')
                        return ws
                    else:
                        FAILED_TOKEN_ATTEMPTS[client_ip] = (attempts, 0)

                    await ws.send_str(json.dumps({
                        'id': req_id,
                        'success': False,
                        'error': 'Security token invalid, expired, or already used (Replay blocked).'
                    }))
                    continue
                else:
                    if client_ip in FAILED_TOKEN_ATTEMPTS:
                        del FAILED_TOKEN_ATTEMPTS[client_ip]

                # 3. Dispatch Live Data Actions over Tunnel
                result_data = None
                try:
                    if action == 'get_batches':
                        result_data = await fetch_batches_data(
                            provider=params.get('provider', 'pw'),
                            page=params.get('page', 1),
                            limit=params.get('limit', 20)
                        )
                    elif action == 'search_batches':
                        result_data = await search_batches_data(
                            q=params.get('query') or params.get('q', ''),
                            provider=params.get('provider', 'pw')
                        )
                    elif action == 'get_batch_details':
                        result_data = await fetch_batch_details_data(
                            batch_id=params.get('batch_id', ''),
                            provider=params.get('provider', 'pw')
                        )
                    elif action == 'get_topics':
                        result_data = await fetch_batch_topics_data(
                            batch_id=params.get('batch_id', ''),
                            subject_id=params.get('subject_id', ''),
                            provider=params.get('provider', 'pw')
                        )
                    elif action == 'get_content':
                        result_data = await fetch_batch_content_data(
                            batch_id=params.get('batch_id', ''),
                            subject_id=params.get('subject_id', ''),
                            tag=params.get('tag', ''),
                            content_type=params.get('type', 'Videos'),
                            page=params.get('page', 1),
                            provider=params.get('provider', 'pw')
                        )
                    elif action == 'get_content_details':
                        result_data = await fetch_batch_content_details_data(
                            batch_id=params.get('batch_id', ''),
                            subject_id=params.get('subject_id', ''),
                            content_id=params.get('content_id', ''),
                            provider=params.get('provider', 'pw')
                        )
                    elif action == 'solve_doubt':
                        result_data = await solve_guru_doubt_data(
                            question=params.get('question', ''),
                            photo_b64=params.get('photo_base64')
                        )
                    elif action == 'send_bot':
                        res, _ = await execute_bot_send(params)
                        result_data = res
                    elif action == 'get_vip_status':
                        u_id = params.get('user_id') or session_user.get('id')
                        uid_int = int(u_id) if u_id and str(u_id).lstrip('-').isdigit() else 0
                        result_data = get_vip_status_data(uid_int)
                    elif action == 'check_sub':
                        u_id = params.get('userId') or params.get('chatId') or session_user.get('id')
                        uid_int = int(u_id) if u_id and str(u_id).lstrip('-').isdigit() else None
                        result_data = await check_sub_data(uid_int)
                    else:
                        result_data = {'success': False, 'message': f"Unknown action: {action}"}

                except Exception as ex:
                    logger.error(f"Error executing WS action '{action}': {ex}", exc_info=True)
                    result_data = {'success': False, 'message': 'Internal processing error'}

                await ws.send_str(json.dumps({
                    'id': req_id,
                    'success': result_data.get('success', True) if isinstance(result_data, dict) else True,
                    'token': next_token,
                    'response': result_data
                }))

            elif msg.type == aiohttp.WSMsgType.ERROR:
                logger.warning(f"WebSocket closed with error: {ws.exception()}")
    finally:
        logger.info(f"WebSocket client disconnected ({client_ip})")

    return ws

async def main():
    app = web.Application(client_max_size=30 * 1024 * 1024, middlewares=[maintenance_middleware, telegram_auth_middleware])
    base_dir = os.path.dirname(os.path.abspath(__file__))

    async def index_handler(request):
        return web.FileResponse(os.path.join(base_dir, 'index.html'))

    async def manifest_handler(request):
        return web.FileResponse(os.path.join(base_dir, 'manifest.json'), headers={'Content-Type': 'application/manifest+json', **CORS_HEADERS})

    async def sw_handler(request):
        return web.FileResponse(os.path.join(base_dir, 'sw.js'), headers={'Content-Type': 'application/javascript', 'Service-Worker-Allowed': '/', **CORS_HEADERS})

    app.router.add_get('/', index_handler)
    app.router.add_get('/manifest.json', manifest_handler)
    app.router.add_get('/sw.js', sw_handler)
    app.router.add_get('/ws', websocket_handler)
    app.router.add_options('/bot/send', options_handler)
    app.router.add_post('/bot/send', bot_send_handler)

    # API endpoints
    app.router.add_get('/api/check-sub', api_check_sub_handler)
    app.router.add_options('/api/check-sub', options_handler)
    app.router.add_get('/api/user/vip-status', api_vip_status_handler)
    app.router.add_options('/api/user/vip-status', options_handler)
    app.router.add_post('/api/guru/solve', api_guru_solve_handler)
    app.router.add_options('/api/guru/solve', options_handler)
    app.router.add_get('/api/batches', api_batches_handler)
    app.router.add_get('/api/batches/search', api_batches_search_handler)
    app.router.add_get('/api/batch/{batch_id}/details', api_batch_details_handler)
    app.router.add_get('/api/batch/{batch_id}/subject/{subject_id}/topics', api_batch_topics_handler)
    app.router.add_get('/api/batch/{batch_id}/subject/{subject_id}/content', api_batch_content_handler)
    app.router.add_get('/api/batch/{batch_id}/subject/{subject_id}/content/{content_id}/details', api_batch_content_details_handler)


    app.router.add_static('/', path=base_dir, name='static')

    port = int(os.environ.get('PORT', 8000))
    app_url = os.environ.get('WEBAPP_URL') or WEBAPP_URL
    if app_url and not app_url.endswith('/'):
        app_url += '/'

    init_vault()
    await bridge.initialize()
    await setup_bot_profile(app_url)
    polling_task = asyncio.create_task(bot_polling(app_url))

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', port)
    await site.start()
    logger.info(f'Study Hub Server running on port {port} | WebApp: {app_url}')

    try:
        await asyncio.Event().wait()
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        polling_task.cancel()
        await runner.cleanup()

if __name__ == '__main__':
    asyncio.run(main())

