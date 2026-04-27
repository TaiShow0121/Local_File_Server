from flask import Flask, render_template, send_file, abort, jsonify, request, url_for, has_request_context, redirect, session
from flask_socketio import SocketIO, emit, join_room, leave_room
import os
import zipfile
import io
import json
import hashlib
import hmac
import ipaddress
from datetime import datetime
import time
from urllib.parse import unquote
import shutil
from markupsafe import escape
import mimetypes
import locale, unicodedata
import difflib
import subprocess
import base64
import secrets
import socket
import threading

try:
    locale.setlocale(locale.LC_COLLATE, 'ja_JP.UTF-8')
    def ja_sort_key(s: str) -> str:
        # NFKC 正規化してからロケール比較キーへ
        return locale.strxfrm(unicodedata.normalize('NFKC', s))
except locale.Error:
    # フォールバック：カタカナ→ひらがな、長音記号は無視
    _KATA_TO_HIRA = {c: chr(ord(c) - 0x60) for c in map(chr, range(0x30A1, 0x30FA + 1))}
    def _to_hira(s: str) -> str:
        s = unicodedata.normalize('NFKC', s)
        s = ''.join(_KATA_TO_HIRA.get(ch, ch) for ch in s)  # カタカナ→ひらがな
        s = s.replace('ー', '')  # 長音は無視（お好みで残してOK）
        return s
    def ja_sort_key(s: str) -> str:
        return _to_hira(s)
# ★ 静的/テンプレートパスを明示
app = Flask(__name__, static_url_path="/static", static_folder="static", template_folder="templates")
app.config['MAX_CONTENT_LENGTH'] = 102400 * 1024 * 1024  # 実際の上限はアプリ設定で制御
socketio = SocketIO(app, cors_allowed_origins="*")

# ファイルI/O競合防止用ロック
_file_io_lock = threading.Lock()

# --- リアルタイム編集: ルームごとの編集者を管理 ---
# { file_path: { sid: { 'ip': ..., 'color': ..., 'cursor': ... } } }
live_editors = {}
edit_locks = {}
EDITOR_COLORS = [
    '#6366f1', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
    '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#e11d64',
]

APP_ROOT = os.path.abspath(os.path.dirname(__file__))  # 例: local_server の絶対パス

# 表示ルート
DEFAULT_STORAGE_DIR = os.path.join(APP_ROOT, 'files')
BASE_DIR = DEFAULT_STORAGE_DIR
DEFAULT_SERVER_PORT = 5000
DEFAULT_UPLOAD_LIMIT_MB = 2048
DEFAULT_SHARE_LINK_EXPIRE_HOURS = 72
GLOBAL_README_CANDIDATES = [
    os.path.join(APP_ROOT, 'README.md'),
    os.path.join(APP_ROOT, 'readme.md'),
]
STATE_DIR = os.path.join(APP_ROOT, '.state')
HISTORY_DIR = os.path.join(APP_ROOT, '.history')
CHAT_HISTORY_LIMIT = 80
DM_HISTORY_LIMIT = 100
MAX_TERMINAL_OUTPUT = 40_000
CLIPBOARD_FILE = os.path.join(STATE_DIR, 'shared_clipboard.json')
DM_DIR = os.path.join(STATE_DIR, 'dm')
ACTIVITY_LOG_FILE = os.path.join(STATE_DIR, 'activity_log.json')
ACTIVITY_LOG_LIMIT = 200
SHARE_LINKS_FILE = os.path.join(STATE_DIR, 'share_links.json')
CHAT_HISTORY_FILE = os.path.join(STATE_DIR, 'chat_history.json')
APP_SETTINGS_FILE = os.path.join(STATE_DIR, 'app_settings.json')
APP_SECRET_FILE = os.path.join(STATE_DIR, 'flask_secret.txt')
chat_messages = []
share_links = {}  # メモリキャッシュ
# オンラインユーザー管理: { sid: { 'ip': ..., 'color': ..., 'connected_at': ... } }
online_users = {}
os.makedirs(DM_DIR, exist_ok=True)
os.makedirs(STATE_DIR, exist_ok=True)
os.makedirs(HISTORY_DIR, exist_ok=True)

def ensure_app_secret() -> str:
    if os.path.isfile(APP_SECRET_FILE):
        try:
            with open(APP_SECRET_FILE, 'r', encoding='utf-8') as f:
                secret = f.read().strip()
            if secret:
                return secret
        except Exception:
            pass
    secret = secrets.token_urlsafe(48)
    with open(APP_SECRET_FILE, 'w', encoding='utf-8') as f:
        f.write(secret)
    return secret

app.secret_key = ensure_app_secret()

# --- Markdown → HTML（markdown が無ければ <pre> でフォールバック） ---
try:
    import markdown as mdlib
except Exception:
    mdlib = None

def _md_to_html(md_text: str) -> str:
    if mdlib:
        return mdlib.markdown(md_text, extensions=["fenced_code", "tables", "toc"])
    return f"<pre>{escape(md_text)}</pre>"

# --- utils ---
def is_path_inside(parent: str, child: str) -> bool:
    try:
        parent_abs = os.path.abspath(parent)
        child_abs = os.path.abspath(child)
        return os.path.commonpath([parent_abs, child_abs]) == parent_abs
    except ValueError:
        return False

def safe_path(subpath):
    full_path = os.path.abspath(os.path.join(BASE_DIR, subpath))
    if not is_path_inside(BASE_DIR, full_path):
        abort(403)  # Directory traversal防止
    return full_path

def build_breadcrumbs(subpath: str):
    if not subpath:
        return []
    parts = [p for p in subpath.split('/') if p]
    crumbs, acc = [], ''
    for p in parts:
        acc = f"{acc}/{p}" if acc else p
        crumbs.append({'name': p, 'path': acc})
    return crumbs

def human_size(num, suffix="B"):
    for unit in ["", "K", "M", "G", "T"]:
        if abs(num) < 1024.0:
            return f"{num:3.1f}{unit}{suffix}"
        num /= 1024.0
    return f"{num:.1f}P{suffix}"

def folder_size(path):
    total = 0
    for root, dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


def is_same_or_child_path(parent: str, child: str) -> bool:
    return is_path_inside(parent, child)

def normalize_rel_path(subpath: str) -> str:
    return (subpath or '').replace('\\', '/').strip('/')

def edit_room_name(file_path: str) -> str:
    return f"edit:{normalize_rel_path(file_path)}"

def current_timestamp() -> str:
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')

def clamp_int(value, default: int, minimum: int, maximum: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    return max(minimum, min(maximum, number))

def normalize_storage_path(path: str | None) -> str:
    raw = (path or DEFAULT_STORAGE_DIR).strip() if isinstance(path, str) else DEFAULT_STORAGE_DIR
    expanded = os.path.expandvars(os.path.expanduser(raw))
    if not os.path.isabs(expanded):
        expanded = os.path.join(APP_ROOT, expanded)
    return os.path.abspath(expanded)

def apply_storage_dir(path: str | None) -> str:
    global BASE_DIR
    BASE_DIR = normalize_storage_path(path)
    os.makedirs(BASE_DIR, exist_ok=True)
    return BASE_DIR

def get_server_port(settings: dict | None = None) -> int:
    settings = settings or load_app_settings()
    return clamp_int(settings.get('server_port'), DEFAULT_SERVER_PORT, 1024, 65535)

def get_upload_limit_mb(settings: dict | None = None) -> int:
    settings = settings or load_app_settings()
    return clamp_int(settings.get('upload_limit_mb'), DEFAULT_UPLOAD_LIMIT_MB, 1, 102400)

def get_upload_limit_bytes(settings: dict | None = None) -> int:
    return get_upload_limit_mb(settings) * 1024 * 1024

def get_share_link_expire_hours(settings: dict | None = None) -> int:
    settings = settings or load_app_settings()
    return clamp_int(
        settings.get('share_link_expire_hours'),
        DEFAULT_SHARE_LINK_EXPIRE_HOURS,
        1,
        8760,
    )

def default_app_settings() -> dict:
    return {
        'setup_complete': False,
        'workspace_name': 'LAN Drive Pro',
        'share_key_enabled': False,
        'share_key_salt': '',
        'share_key_hash': '',
        'server_port': DEFAULT_SERVER_PORT,
        'storage_path': DEFAULT_STORAGE_DIR,
        'upload_limit_mb': DEFAULT_UPLOAD_LIMIT_MB,
        'share_link_expire_hours': DEFAULT_SHARE_LINK_EXPIRE_HOURS,
        'admin_mode_enabled': False,
        'terminal_admin_only': True,
        'terminal_remote_enabled': False,
        'created_at': '',
        'updated_at': '',
    }

def load_app_settings() -> dict:
    settings = default_app_settings()
    if os.path.isfile(APP_SETTINGS_FILE):
        try:
            with open(APP_SETTINGS_FILE, 'r', encoding='utf-8') as f:
                saved = json.load(f)
            if isinstance(saved, dict):
                settings.update(saved)
        except Exception:
            pass
    settings['workspace_name'] = (settings.get('workspace_name') or 'LAN Drive Pro').strip()[:48]
    settings['setup_complete'] = bool(settings.get('setup_complete'))
    settings['share_key_enabled'] = bool(settings.get('share_key_enabled'))
    settings['server_port'] = get_server_port(settings)
    settings['storage_path'] = normalize_storage_path(settings.get('storage_path'))
    settings['upload_limit_mb'] = get_upload_limit_mb(settings)
    settings['share_link_expire_hours'] = get_share_link_expire_hours(settings)
    settings['admin_mode_enabled'] = bool(settings.get('admin_mode_enabled'))
    settings['terminal_admin_only'] = bool(settings.get('terminal_admin_only', True))
    settings['terminal_remote_enabled'] = bool(settings.get('terminal_remote_enabled'))
    return settings

def save_app_settings(settings: dict):
    merged = default_app_settings()
    merged.update(settings)
    merged['workspace_name'] = (merged.get('workspace_name') or 'LAN Drive Pro').strip()[:48]
    merged['setup_complete'] = bool(merged.get('setup_complete'))
    merged['share_key_enabled'] = bool(merged.get('share_key_enabled'))
    merged['server_port'] = get_server_port(merged)
    merged['storage_path'] = normalize_storage_path(merged.get('storage_path'))
    merged['upload_limit_mb'] = get_upload_limit_mb(merged)
    merged['share_link_expire_hours'] = get_share_link_expire_hours(merged)
    merged['admin_mode_enabled'] = bool(merged.get('admin_mode_enabled'))
    merged['terminal_admin_only'] = bool(merged.get('terminal_admin_only', True))
    merged['terminal_remote_enabled'] = bool(merged.get('terminal_remote_enabled'))
    merged['updated_at'] = current_timestamp()
    if not merged.get('created_at'):
        merged['created_at'] = merged['updated_at']
    with _file_io_lock:
        with open(APP_SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)
    apply_storage_dir(merged.get('storage_path'))
    return merged

def public_app_settings(settings: dict | None = None) -> dict:
    settings = settings or load_app_settings()
    admin_controls_available = is_local_client()
    return {
        'setup_complete': bool(settings.get('setup_complete')),
        'workspace_name': settings.get('workspace_name') or 'LAN Drive Pro',
        'share_key_enabled': bool(settings.get('share_key_enabled')),
        'share_key_configured': bool(settings.get('share_key_hash')),
        'server_port': get_server_port(settings),
        'storage_path': settings.get('storage_path') if admin_controls_available else '',
        'upload_limit_mb': get_upload_limit_mb(settings),
        'share_link_expire_hours': get_share_link_expire_hours(settings),
        'admin_mode_enabled': bool(settings.get('admin_mode_enabled')),
        'terminal_admin_only': bool(settings.get('terminal_admin_only', True)),
        'terminal_available': is_terminal_allowed(settings),
        'terminal_remote_enabled': bool(settings.get('terminal_remote_enabled')),
        'admin_controls_available': admin_controls_available,
        'unlocked': is_request_unlocked(settings),
    }

def hash_share_key(key: str, salt: str) -> str:
    return hashlib.sha256(f'{salt}:{key}'.encode('utf-8')).hexdigest()

def apply_share_key(settings: dict, key: str):
    salt = secrets.token_hex(16)
    settings['share_key_salt'] = salt
    settings['share_key_hash'] = hash_share_key(key, salt)

def verify_share_key(key: str, settings: dict | None = None) -> bool:
    settings = settings or load_app_settings()
    salt = settings.get('share_key_salt') or ''
    expected = settings.get('share_key_hash') or ''
    if not salt or not expected:
        return False
    return hmac.compare_digest(hash_share_key(key, salt), expected)

def is_request_unlocked(settings: dict | None = None) -> bool:
    settings = settings or load_app_settings()
    if not settings.get('setup_complete') or not settings.get('share_key_enabled'):
        return True
    if not settings.get('share_key_hash') or not settings.get('share_key_salt'):
        return True
    return bool(session.get('share_key_ok'))

def safe_next_url(raw_next: str | None) -> str:
    if not raw_next or not raw_next.startswith('/') or raw_next.startswith('//'):
        return url_for('browse')
    return raw_next

def get_request_ip(default: str = '127.0.0.1') -> str:
    if not has_request_context():
        return default
    return request.headers.get('X-Forwarded-For', request.remote_addr or default).split(',')[0].strip() or default

def get_direct_client_ip(default: str = '127.0.0.1') -> str:
    if not has_request_context():
        return default
    return (request.remote_addr or default).strip() or default

def get_local_host_ips() -> set[str]:
    ips = {'127.0.0.1', '::1'}
    try:
        hostname = socket.gethostname()
        ips.update(socket.gethostbyname_ex(hostname)[2])
    except Exception:
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(('8.8.8.8', 80))
            ips.add(s.getsockname()[0])
    except Exception:
        pass
    return ips

def is_local_client() -> bool:
    ip = get_direct_client_ip()
    if ip in get_local_host_ips():
        return True
    try:
        return ipaddress.ip_address(ip).is_loopback
    except ValueError:
        return False

def is_terminal_allowed(settings: dict | None = None) -> bool:
    settings = settings or load_app_settings()
    if not settings.get('admin_mode_enabled'):
        return False
    if settings.get('terminal_admin_only', True):
        return is_local_client()
    return bool(settings.get('terminal_remote_enabled')) or is_local_client()

apply_storage_dir(load_app_settings().get('storage_path'))

def history_dir_for(subpath: str) -> str:
    rel = normalize_rel_path(subpath)
    if not rel:
        return HISTORY_DIR
    return os.path.join(HISTORY_DIR, *rel.split('/'))

def save_history_snapshot(subpath: str, content: str, reason: str = 'save', author: str | None = None):
    version_id = datetime.now().strftime('%Y%m%d%H%M%S%f')
    version_dir = history_dir_for(subpath)
    os.makedirs(version_dir, exist_ok=True)
    snapshot_path = os.path.join(version_dir, f'{version_id}.json')
    payload = {
        'id': version_id,
        'path': normalize_rel_path(subpath),
        'saved_at': current_timestamp(),
        'author': author or 'system',
        'reason': reason,
        'content': content,
    }
    with open(snapshot_path, 'w', encoding='utf-8', newline='') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return payload

def list_history_snapshots(subpath: str):
    version_dir = history_dir_for(subpath)
    if not os.path.isdir(version_dir):
        return []

    snapshots = []
    for name in sorted(os.listdir(version_dir), reverse=True):
        if not name.endswith('.json'):
            continue
        snap_path = os.path.join(version_dir, name)
        try:
            with open(snap_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            snapshots.append({
                'id': data.get('id', os.path.splitext(name)[0]),
                'saved_at': data.get('saved_at', '-'),
                'author': data.get('author', 'system'),
                'reason': data.get('reason', 'save'),
                'size': len(data.get('content', '')),
            })
        except Exception:
            continue
    return snapshots

def load_history_snapshot(subpath: str, version_id: str):
    snap_path = os.path.join(history_dir_for(subpath), f'{version_id}.json')
    if not os.path.isfile(snap_path):
        return None
    with open(snap_path, 'r', encoding='utf-8') as f:
        return json.load(f)

def load_clipboard_entries():
    if not os.path.isfile(CLIPBOARD_FILE):
        return []
    try:
        with open(CLIPBOARD_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []

def save_clipboard_entries(entries):
    with open(CLIPBOARD_FILE, 'w', encoding='utf-8') as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)

def load_chat_history() -> list:
    if not os.path.isfile(CHAT_HISTORY_FILE):
        return []
    try:
        with open(CHAT_HISTORY_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []

def save_chat_history():
    with _file_io_lock:
        with open(CHAT_HISTORY_FILE, 'w', encoding='utf-8') as f:
            json.dump(chat_messages[-CHAT_HISTORY_LIMIT:], f, ensure_ascii=False, indent=1)

def clip_terminal_output(text: str) -> str:
    text = text or ''
    if len(text) <= MAX_TERMINAL_OUTPUT:
        return text
    return '... output truncated ...\n' + text[-MAX_TERMINAL_OUTPUT:]

def build_diff_payload(before: str, after: str, left_label: str, right_label: str):
    before_lines = before.splitlines()
    after_lines = after.splitlines()
    matcher = difflib.SequenceMatcher(None, before_lines, after_lines)
    added = removed = changed = 0
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == 'insert':
            added += (j2 - j1)
        elif tag == 'delete':
            removed += (i2 - i1)
        elif tag == 'replace':
            changed += max(i2 - i1, j2 - j1)

    diff_html = difflib.HtmlDiff(wrapcolumn=100).make_table(
        before_lines,
        after_lines,
        fromdesc=str(escape(left_label)),
        todesc=str(escape(right_label)),
        context=True,
        numlines=3,
    )
    return {
        'html': diff_html,
        'stats': {
            'added': added,
            'removed': removed,
            'changed': changed,
        }
    }

def get_actor_label(default: str = 'system') -> str:
    return get_request_ip(default)

def dm_room_name(ip1: str, ip2: str) -> str:
    """2人のIPからDMルーム名を生成（順序不問で同じルームになる）"""
    pair = sorted([ip1, ip2])
    return f"dm:{pair[0]}:{pair[1]}"

def dm_file_path(ip1: str, ip2: str) -> str:
    pair = sorted([ip1, ip2])
    safe_name = f"{pair[0]}_{pair[1]}".replace(':', '_').replace('.', '_')
    return os.path.join(DM_DIR, f'{safe_name}.json')

def load_dm_history(ip1: str, ip2: str) -> list:
    path = dm_file_path(ip1, ip2)
    if not os.path.isfile(path):
        return []
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []

def save_dm_history(ip1: str, ip2: str, messages: list):
    path = dm_file_path(ip1, ip2)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(messages[-DM_HISTORY_LIMIT:], f, ensure_ascii=False, indent=1)

def _load_share_links() -> dict:
    global share_links
    if not os.path.isfile(SHARE_LINKS_FILE):
        return share_links
    try:
        with open(SHARE_LINKS_FILE, 'r', encoding='utf-8') as f:
            share_links = json.load(f)
    except Exception:
        pass
    return share_links

def _save_share_links():
    with open(SHARE_LINKS_FILE, 'w', encoding='utf-8') as f:
        json.dump(share_links, f, ensure_ascii=False, indent=1)

def create_share_token(subpath: str) -> str:
    token = secrets.token_urlsafe(16)
    share_links[token] = {
        'path': normalize_rel_path(subpath),
        'created_at': current_timestamp(),
        'creator': get_actor_label() if has_request_context() else 'system',
    }
    _save_share_links()
    return token

def is_share_link_expired(link: dict) -> bool:
    try:
        created = datetime.strptime(link['created_at'], '%Y-%m-%d %H:%M:%S')
        return (datetime.now() - created).total_seconds() > get_share_link_expire_hours() * 3600
    except Exception:
        return False

def cleanup_expired_share_links():
    expired = [t for t, l in share_links.items() if is_share_link_expired(l)]
    for t in expired:
        del share_links[t]
    if expired:
        _save_share_links()

# 起動時にshare_links読み込み & 期限切れ削除
_load_share_links()
cleanup_expired_share_links()

# 起動時にチャット履歴を読み込み
chat_messages.extend(load_chat_history())

def get_online_user_list() -> list:
    """ユニークなIPのオンラインユーザーリストを返す"""
    seen = {}
    for sid, info in online_users.items():
        ip = info['ip']
        if ip not in seen:
            seen[ip] = {
                'ip': ip,
                'color': info['color'],
                'connected_at': info['connected_at'],
            }
    return list(seen.values())

def broadcast_online_users():
    """全クライアントにオンラインユーザーリストを通知"""
    socketio.emit('online_users', {'users': get_online_user_list()})

def load_activity_log() -> list:
    if not os.path.isfile(ACTIVITY_LOG_FILE):
        return []
    try:
        with open(ACTIVITY_LOG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []

def save_activity_entry(entry: dict):
    with _file_io_lock:
        logs = load_activity_log()
        logs.insert(0, entry)
        logs = logs[:ACTIVITY_LOG_LIMIT]
        with open(ACTIVITY_LOG_FILE, 'w', encoding='utf-8') as f:
            json.dump(logs, f, ensure_ascii=False, indent=1)

def broadcast_system_notice(action: str, path: str = '', message: str = '', extra: dict | None = None):
    rel_path = normalize_rel_path(path)
    payload = {
        'action': action,
        'path': rel_path,
        'directory': os.path.dirname(rel_path).replace('\\', '/') if rel_path else '',
        'message': message or action,
        'actor': get_actor_label(),
        'timestamp': current_timestamp(),
    }
    if extra:
        payload.update(extra)
    socketio.emit('system_notice', payload)
    # アクティビティログに保存
    save_activity_entry({
        'action': action,
        'path': rel_path,
        'message': message or action,
        'actor': payload['actor'],
        'timestamp': payload['timestamp'],
    })

def build_lock_payload(file_path: str):
    file_path = normalize_rel_path(file_path)
    lock = edit_locks.get(file_path)
    return {
        'path': file_path,
        'locked': bool(lock),
        'holder': {
            'ip': lock['ip'],
            'color': lock['color'],
            'acquiredAt': lock['acquired_at'],
        } if lock else None,
        'holderSid': lock['sid'] if lock else None,
    }

def emit_lock_update(file_path: str):
    socketio.emit('edit_lock_update', build_lock_payload(file_path), to=edit_room_name(file_path))

def can_write_file(file_path: str, socket_id: str | None = None) -> tuple[bool, dict | None]:
    file_path = normalize_rel_path(file_path)
    lock = edit_locks.get(file_path)
    if not lock:
        return True, None
    if socket_id and lock.get('sid') == socket_id:
        return True, lock
    return False, lock

def _build_entries(subpath: str):
    current_dir = safe_path(subpath)
    if not os.path.isdir(current_dir):
        return None
    entries = []
    for name in os.listdir(current_dir):
        full_path = os.path.join(current_dir, name)
        rel_path = f"{subpath}/{name}" if subpath else name
        if os.path.isfile(full_path):
            size = os.path.getsize(full_path)
            etype = 'file'
        else:
            size = -1  # フォルダサイズは遅延計算（APIで取得）
            etype = 'folder'
        try:
            ts = os.path.getmtime(full_path)
            mtime_str = datetime.fromtimestamp(ts).strftime('%Y-%m-%d %H:%M')
        except Exception:
            mtime_str = '-'
        entries.append({
            'name': name,
            'path': rel_path.replace('\\', '/'),
            'type': etype,
            'size': human_size(size),
            'size_bytes': size,
            'mtime': mtime_str,
        })
    entries.sort(key=lambda e: (0 if e['type'] == 'folder' else 1, ja_sort_key(e['name'])))
    return entries


def _recent_workspace_files(limit: int = 8) -> dict:
    """Build lightweight dashboard metrics from the current storage root."""
    limit = clamp_int(limit, 8, 1, 50)
    midnight = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    total_files = 0
    total_folders = 0
    total_size = 0
    today_files = 0
    today_size = 0
    recent_files = []

    for root, dirs, files in os.walk(BASE_DIR):
        total_folders += len(dirs)
        for name in files:
            full = os.path.join(root, name)
            try:
                stat = os.stat(full)
            except OSError:
                continue
            rel_path = os.path.relpath(full, BASE_DIR).replace('\\', '/')
            size = stat.st_size
            mtime_ts = stat.st_mtime
            total_files += 1
            total_size += size
            if mtime_ts >= midnight:
                today_files += 1
                today_size += size
            recent_files.append({
                'name': name,
                'path': rel_path,
                'size': human_size(size),
                'size_bytes': size,
                'mtime': datetime.fromtimestamp(mtime_ts).strftime('%Y-%m-%d %H:%M'),
                'mtime_ts': mtime_ts,
                'extension': os.path.splitext(name)[1].lstrip('.').lower(),
            })
            if len(recent_files) > 200:
                recent_files.sort(key=lambda item: item['mtime_ts'], reverse=True)
                del recent_files[120:]

    recent_files.sort(key=lambda item: item['mtime_ts'], reverse=True)
    for item in recent_files:
        item.pop('mtime_ts', None)

    return {
        'total_files': total_files,
        'total_folders': total_folders,
        'total_size': total_size,
        'total_size_h': human_size(total_size),
        'today_files': today_files,
        'today_size': today_size,
        'today_size_h': human_size(today_size),
        'recent_files': recent_files[:limit],
    }


def build_dashboard_payload(limit: int = 8) -> dict:
    cleanup_expired_share_links()
    metrics = _recent_workspace_files(limit)
    settings = load_app_settings()
    active_links = [
        {'token': token, **link}
        for token, link in share_links.items()
        if not is_share_link_expired(link)
    ]
    return {
        **metrics,
        'active_share_links': len(active_links),
        'share_link_expire_hours': get_share_link_expire_hours(settings),
        'recent_activity': load_activity_log()[:6],
        'generated_at': current_timestamp(),
    }

AUTH_EXEMPT_ENDPOINTS = {
    'unlock',
    'auth_login',
    'auth_logout',
    'auth_status',
    'server_info',
    'static',
}

@app.before_request
def enforce_share_key():
    endpoint = request.endpoint or ''
    if request.method == 'OPTIONS':
        return None
    if endpoint in AUTH_EXEMPT_ENDPOINTS or request.path.startswith('/static/') or request.path.startswith('/socket.io/'):
        return None

    settings = load_app_settings()
    if is_request_unlocked(settings):
        return None

    if request.accept_mimetypes.accept_html and request.method == 'GET':
        return redirect(url_for('unlock', next=request.full_path if request.query_string else request.path))
    return jsonify({'ok': False, 'error': '共有キーが必要です'}), 401

# --- routes ---
@app.route('/unlock')
def unlock():
    settings = load_app_settings()
    if is_request_unlocked(settings):
        return redirect(safe_next_url(request.args.get('next')))
    return render_template(
        'unlock.html',
        app_settings=public_app_settings(settings),
        next_url=safe_next_url(request.args.get('next')),
    )

@app.route('/auth/login', methods=['POST'])
def auth_login():
    data = request.get_json(silent=True) or request.form or {}
    key = (data.get('shareKey') or data.get('share_key') or '').strip()
    next_url = safe_next_url(data.get('next') or request.args.get('next'))
    settings = load_app_settings()

    if is_request_unlocked(settings):
        return jsonify({'ok': True, 'next': next_url, 'settings': public_app_settings(settings)})
    if verify_share_key(key, settings):
        session['share_key_ok'] = True
        return jsonify({'ok': True, 'next': next_url, 'settings': public_app_settings(settings)})
    return jsonify({'ok': False, 'error': '共有キーが違います'}), 401

@app.route('/auth/logout', methods=['POST'])
def auth_logout():
    session.pop('share_key_ok', None)
    return jsonify({'ok': True})

@app.route('/auth/status')
def auth_status():
    settings = load_app_settings()
    return jsonify({'ok': True, 'settings': public_app_settings(settings)})

@app.route('/api/setup', methods=['POST'])
def api_setup():
    data = request.get_json(silent=True) or {}
    workspace_name = (data.get('workspaceName') or 'LAN Drive Pro').strip()[:48]
    share_key_enabled = bool(data.get('shareKeyEnabled'))
    share_key = (data.get('shareKey') or '').strip()

    if not workspace_name:
        return jsonify({'ok': False, 'error': '表示名を入力してください'}), 400
    if share_key_enabled and not (4 <= len(share_key) <= 32):
        return jsonify({'ok': False, 'error': '共有キーは4〜32文字で入力してください'}), 400

    settings = load_app_settings()
    settings['setup_complete'] = True
    settings['workspace_name'] = workspace_name
    settings['share_key_enabled'] = share_key_enabled
    if share_key_enabled:
        apply_share_key(settings, share_key)
        session['share_key_ok'] = True
    else:
        settings['share_key_salt'] = ''
        settings['share_key_hash'] = ''
        session.pop('share_key_ok', None)

    settings = save_app_settings(settings)
    return jsonify({'ok': True, 'settings': public_app_settings(settings)})

@app.route('/api/app-settings', methods=['GET', 'POST'])
def api_app_settings():
    settings = load_app_settings()
    if request.method == 'GET':
        return jsonify({'ok': True, 'settings': public_app_settings(settings)})

    data = request.get_json(silent=True) or {}
    workspace_name = (data.get('workspaceName') or settings.get('workspace_name') or 'LAN Drive Pro').strip()[:48]
    share_key_enabled = bool(data.get('shareKeyEnabled'))
    share_key = (data.get('shareKey') or '').strip()
    advanced_keys = {
        'serverPort',
        'storagePath',
        'uploadLimitMb',
        'shareLinkExpireHours',
        'adminModeEnabled',
        'terminalAdminOnly',
    }
    advanced_requested = any(key in data for key in advanced_keys)

    if not workspace_name:
        return jsonify({'ok': False, 'error': '表示名を入力してください'}), 400
    if share_key_enabled and not settings.get('share_key_hash') and not share_key:
        return jsonify({'ok': False, 'error': '共有キーを入力してください'}), 400
    if share_key and not (4 <= len(share_key) <= 32):
        return jsonify({'ok': False, 'error': '共有キーは4〜32文字で入力してください'}), 400
    if advanced_requested and not is_local_client():
        return jsonify({'ok': False, 'error': '詳細設定はこのPC上のブラウザからのみ変更できます'}), 403

    settings['setup_complete'] = True
    settings['workspace_name'] = workspace_name
    settings['share_key_enabled'] = share_key_enabled
    if share_key_enabled and share_key:
        apply_share_key(settings, share_key)
        session['share_key_ok'] = True
    elif not share_key_enabled:
        settings['share_key_salt'] = ''
        settings['share_key_hash'] = ''
        session.pop('share_key_ok', None)

    if advanced_requested:
        storage_path = normalize_storage_path(data.get('storagePath') or settings.get('storage_path'))
        try:
            os.makedirs(storage_path, exist_ok=True)
        except OSError as exc:
            return jsonify({'ok': False, 'error': f'保存先を作成できません: {exc}'}), 400
        settings['server_port'] = clamp_int(data.get('serverPort'), settings.get('server_port'), 1024, 65535)
        settings['storage_path'] = storage_path
        settings['upload_limit_mb'] = clamp_int(data.get('uploadLimitMb'), settings.get('upload_limit_mb'), 1, 102400)
        settings['share_link_expire_hours'] = clamp_int(
            data.get('shareLinkExpireHours'),
            settings.get('share_link_expire_hours'),
            1,
            8760,
        )
        settings['admin_mode_enabled'] = bool(data.get('adminModeEnabled'))
        settings['terminal_admin_only'] = bool(data.get('terminalAdminOnly', True))

    settings = save_app_settings(settings)
    return jsonify({'ok': True, 'settings': public_app_settings(settings)})

@app.route('/', defaults={'subpath': ''})
@app.route('/browse/', defaults={'subpath': ''})
@app.route('/browse/<path:subpath>')
def browse(subpath):
    entries = _build_entries(subpath)
    if entries is None:
        abort(404)
    parent_path = os.path.dirname(subpath) if subpath else None
    breadcrumbs = build_breadcrumbs(subpath)
    return render_template(
        'index.html',
        entries=entries,
        subpath=subpath,
        parent_path=parent_path,
        breadcrumbs=breadcrumbs,
        app_settings=public_app_settings(),
    )

@app.route('/receive')
def receive_mode():
    subpath = normalize_rel_path(request.args.get('path', ''))
    try:
        target = safe_path(subpath)
    except Exception:
        subpath = ''
        target = BASE_DIR
    if not os.path.isdir(target):
        subpath = ''
    return render_template(
        'receive.html',
        subpath=subpath,
        location_label=subpath or 'files',
        app_settings=public_app_settings(),
    )

@app.route('/api/entries/', defaults={'subpath': ''})
@app.route('/api/entries/<path:subpath>')
def api_entries(subpath):
    entries = _build_entries(subpath)
    if entries is None:
        return jsonify({'ok': False, 'error': 'not found'}), 404
    return jsonify({'ok': True, 'entries': entries, 'subpath': subpath})

@app.route('/api/folder-size/<path:subpath>')
def api_folder_size(subpath):
    """フォルダサイズを非同期で計算して返す"""
    subpath = unquote(subpath)
    full = safe_path(subpath)
    if not os.path.isdir(full):
        return jsonify({'ok': False, 'error': 'not found'}), 404
    size = folder_size(full)
    return jsonify({'ok': True, 'size': human_size(size), 'size_bytes': size})

@app.route('/raw/<path:subpath>')
def raw_file(subpath):
    """バイナリをそのまま返す（添付ではなくインライン表示）"""
    subpath = unquote(subpath)
    full_path = safe_path(subpath)
    if not os.path.isfile(full_path):
        abort(404)

    # 可能なら正しい Content-Type を付ける
    mt, _ = mimetypes.guess_type(full_path)
    # conditional=True で304などの省略転送にも対応
    return send_file(full_path, mimetype=mt or 'application/octet-stream',
                     as_attachment=False, conditional=True)
# --- ゴミ箱ヘルパー ---
def _load_trash_meta() -> list:
    if not os.path.isfile(TRASH_META_FILE):
        return []
    try:
        with open(TRASH_META_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []

def _save_trash_meta(meta: list):
    with open(TRASH_META_FILE, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)

def _move_to_trash(subpath: str) -> dict:
    """ファイル/フォルダをゴミ箱に移動し、メタデータを返す"""
    target = safe_path(subpath)
    trash_id = datetime.now().strftime('%Y%m%d%H%M%S%f')
    basename = os.path.basename(target.rstrip('/\\'))
    trash_name = f'{trash_id}_{basename}'
    trash_dest = os.path.join(TRASH_DIR, trash_name)
    shutil.move(target, trash_dest)
    entry = {
        'id': trash_id,
        'original_path': normalize_rel_path(subpath),
        'trash_name': trash_name,
        'name': basename,
        'type': 'folder' if os.path.isdir(trash_dest) else 'file',
        'deleted_at': current_timestamp(),
        'deleted_by': get_actor_label(),
    }
    meta = _load_trash_meta()
    meta.insert(0, entry)
    _save_trash_meta(meta)
    return entry

@app.route('/delete', methods=['POST'])
def delete_path():
    """
    JSON: { "subpath": "<相対パス>", "permanent": false }
    - permanent=false: ゴミ箱に移動（デフォルト）
    - permanent=true: 完全削除
    """
    data = request.get_json(silent=True) or {}
    subpath = unquote(data.get('subpath','')).strip()
    permanent = data.get('permanent', False)

    # ルート直下（BASE_DIRそのもの）は削除禁止
    if subpath == '':
        return jsonify({'ok': False, 'error': 'root deletion is not allowed'}), 400

    target = safe_path(subpath)
    if not os.path.exists(target):
        return jsonify({'ok': False, 'error': 'not found'}), 404

    try:
        if permanent:
            if os.path.isfile(target):
                os.remove(target)
            else:
                shutil.rmtree(target)
            broadcast_system_notice('delete', subpath, f'{subpath} を完全に削除しました')
        else:
            _move_to_trash(subpath)
            broadcast_system_notice('trash', subpath, f'{subpath} をゴミ箱に移動しました')
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/download-folder/<path:subpath>')
def download_folder(subpath):
    subpath = unquote(subpath)
    folder_path = safe_path(subpath)

    if not os.path.isdir(folder_path):
        return 'Folder not found', 404

    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(folder_path):
            for file in files:
                abs_file_path = os.path.join(root, file)
                rel_path = os.path.relpath(abs_file_path, folder_path)
                zf.write(abs_file_path, arcname=rel_path)
    memory_file.seek(0)

    folder_name = os.path.basename(folder_path.rstrip("/\\"))
    return send_file(memory_file, download_name=f"{folder_name}.zip", as_attachment=True)
@app.route('/upload/', defaults={'subpath': ''}, methods=['POST'])
@app.route('/upload/<path:subpath>', methods=['POST'])
def upload_file(subpath):
    subpath = unquote(subpath)
    upload_root = safe_path(subpath)
    settings = load_app_settings()
    upload_limit_bytes = get_upload_limit_bytes(settings)
    if request.content_length and request.content_length > upload_limit_bytes:
        limit_mb = get_upload_limit_mb(settings)
        return f'Upload exceeds the configured limit ({limit_mb} MB)', 413

    if not os.path.isdir(upload_root):
        return 'Not a directory', 400

    files_received = request.files.getlist('file')
    if not files_received:
        return 'No files received', 400

    uploaded_paths = []
    for fs in files_received:
        # 相対パスを安全に復元（フォルダごとアップロード対応）
        rel_path = fs.filename.replace("\\", "/")
        rel_path = rel_path.lstrip("/").lstrip("\\").split(":", 1)[-1]
        save_path = os.path.abspath(os.path.join(upload_root, rel_path))

        if not is_path_inside(upload_root, save_path):
            # 走査対策
            continue

        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        fs.save(save_path)
        uploaded_paths.append(os.path.relpath(save_path, BASE_DIR).replace('\\', '/'))

    if uploaded_paths:
        broadcast_system_notice('upload', uploaded_paths[0], (
            f'{uploaded_paths[0]} を追加しました'
            if len(uploaded_paths) == 1 else
            f'{len(uploaded_paths)}件のファイルをアップロードしました'
        ), {
            'paths': uploaded_paths,
            'directory': normalize_rel_path(subpath),
        })
    else:
        return 'No valid files received', 400

    return 'OK', 200

@app.route('/download/<path:subpath>')
def download(subpath):
    full_path = safe_path(subpath)
    if not os.path.isfile(full_path):
        abort(404)
    return send_file(full_path, as_attachment=True)

@app.route('/preview/<path:subpath>')
def preview_file(subpath):
    subpath = unquote(subpath)
    path = safe_path(subpath)
    if not os.path.isfile(path):
        return jsonify({'content': 'ファイルが存在しません'}), 404
    try:
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        return jsonify({'content': content})
    except Exception as e:
        return jsonify({'content': f'読み込みエラー: {str(e)}'}), 500

@app.get('/readme')
def get_readme():
    """
    ?subpath= で指定された現在フォルダ直下の README を優先。
    無ければプロジェクト直下 (APP_ROOT) の README を返す。
    """
    subpath = request.args.get('subpath', '').strip()
    candidates = []

    # まずは現在のフォルダ (files/ 以下) に README があればそれを優先
    if subpath:
        cur = safe_path(subpath)  # ← files/ の中に限定
        candidates += [
            os.path.join(cur, 'README.md'),
            os.path.join(cur, 'readme.md'),
        ]

    # フォルダに無ければ、プロジェクト直下の README を使う（files/ ではない）
    candidates += GLOBAL_README_CANDIDATES

    for p in candidates:
        if os.path.isfile(p):
            try:
                with open(p, 'r', encoding='utf-8', errors='ignore') as f:
                    md_text = f.read()
                html = _md_to_html(md_text)
                # 表示用パスはプロジェクトルートからの相対にする
                rel = os.path.relpath(p, APP_ROOT).replace('\\', '/')
                return jsonify({'ok': True, 'html': html, 'path': rel})
            except Exception as e:
                return jsonify({'ok': False, 'error': f'README読込エラー: {e}'}), 500

    return jsonify({'ok': False, 'error': 'README.md が見つかりません'}), 404

@app.route('/render-md/<path:subpath>')
def render_md(subpath):
    """任意の .md を HTML にして返す"""
    subpath = unquote(subpath)
    path = safe_path(subpath)
    if not os.path.isfile(path):
        return jsonify({'ok': False, 'error': 'not found'}), 404
    try:
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            md_text = f.read()
        html = _md_to_html(md_text)
        return jsonify({'ok': True, 'html': html, 'path': subpath})
    except Exception as e:
        return jsonify({'ok': False, 'error': f'render error: {e}'}), 500

@app.route('/render-md-raw', methods=['POST'])
def render_md_raw():
    """POSTされた生テキストをMarkdown→HTMLに変換して返す（ライブプレビュー用）"""
    data = request.get_json(silent=True) or {}
    text = data.get('text', '')
    html = _md_to_html(text)
    return jsonify({'ok': True, 'html': html})

# --- リネーム ---
@app.route('/rename', methods=['POST'])
def rename_path():
    data = request.get_json(silent=True) or {}
    old_subpath = unquote(data.get('oldPath', '')).strip()
    new_name = data.get('newName', '').strip()

    if not old_subpath or not new_name:
        return jsonify({'ok': False, 'error': 'missing parameters'}), 400
    if '/' in new_name or '\\' in new_name:
        return jsonify({'ok': False, 'error': 'invalid name'}), 400

    old_full = safe_path(old_subpath)
    if not os.path.exists(old_full):
        return jsonify({'ok': False, 'error': 'not found'}), 404

    new_full = os.path.join(os.path.dirname(old_full), new_name)
    if not is_path_inside(BASE_DIR, new_full):
        return jsonify({'ok': False, 'error': 'forbidden'}), 403
    if os.path.exists(new_full):
        return jsonify({'ok': False, 'error': 'name already exists'}), 409

    try:
        os.rename(old_full, new_full)
        new_rel = os.path.relpath(new_full, BASE_DIR).replace('\\', '/')
        broadcast_system_notice('rename', new_rel, f'{old_subpath} を {new_name} に変更しました', {
            'oldPath': normalize_rel_path(old_subpath),
            'newPath': new_rel,
        })
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


# --- 移動（ドラッグ＆ドロップ用） ---
@app.route('/move', methods=['POST'])
def move_path():
    data = request.get_json(silent=True) or {}
    source_subpath = unquote(data.get('sourcePath', '')).strip()
    target_dir_subpath = unquote(data.get('targetDir', '')).strip()

    if not source_subpath:
        return jsonify({'ok': False, 'error': 'missing source path'}), 400

    source_full = safe_path(source_subpath)
    target_dir_full = safe_path(target_dir_subpath) if target_dir_subpath else BASE_DIR

    if source_full == BASE_DIR:
        return jsonify({'ok': False, 'error': 'root move is not allowed'}), 400
    if not os.path.exists(source_full):
        return jsonify({'ok': False, 'error': 'source not found'}), 404
    if not os.path.isdir(target_dir_full):
        return jsonify({'ok': False, 'error': 'target folder not found'}), 404
    if os.path.dirname(source_full) == target_dir_full:
        return jsonify({'ok': False, 'error': 'already in this folder'}), 400

    if os.path.isdir(source_full) and is_same_or_child_path(source_full, target_dir_full):
        return jsonify({'ok': False, 'error': 'cannot move a folder into itself'}), 400

    destination_full = os.path.abspath(
        os.path.join(target_dir_full, os.path.basename(source_full.rstrip('/\\')))
    )
    if not is_path_inside(BASE_DIR, destination_full):
        return jsonify({'ok': False, 'error': 'forbidden'}), 403
    if os.path.exists(destination_full):
        return jsonify({'ok': False, 'error': 'same name already exists'}), 409

    try:
        shutil.move(source_full, destination_full)
        new_rel_path = os.path.relpath(destination_full, BASE_DIR).replace('\\', '/')
        broadcast_system_notice('move', new_rel_path, f'{source_subpath} を移動しました', {
            'oldPath': normalize_rel_path(source_subpath),
            'newPath': new_rel_path,
        })
        return jsonify({'ok': True, 'newPath': new_rel_path})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

# --- 新規フォルダ作成 ---
@app.route('/mkdir', methods=['POST'])
def mkdir():
    data = request.get_json(silent=True) or {}
    parent = unquote(data.get('parent', '')).strip()
    name = data.get('name', '').strip()

    if not name:
        return jsonify({'ok': False, 'error': 'missing folder name'}), 400
    if '/' in name or '\\' in name:
        return jsonify({'ok': False, 'error': 'invalid name'}), 400

    parent_full = safe_path(parent)
    if not os.path.isdir(parent_full):
        return jsonify({'ok': False, 'error': 'parent not found'}), 404

    new_dir = os.path.join(parent_full, name)
    if not is_path_inside(BASE_DIR, new_dir):
        return jsonify({'ok': False, 'error': 'forbidden'}), 403
    if os.path.exists(new_dir):
        return jsonify({'ok': False, 'error': 'already exists'}), 409

    try:
        os.makedirs(new_dir)
        rel_path = os.path.relpath(new_dir, BASE_DIR).replace('\\', '/')
        broadcast_system_notice('mkdir', rel_path, f'{name} フォルダを作成しました')
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

# --- 新規ファイル作成 ---
@app.route('/mkfile', methods=['POST'])
def mkfile():
    data = request.get_json(silent=True) or {}
    parent = unquote(data.get('parent', '')).strip()
    name = data.get('name', '').strip()

    if not name:
        return jsonify({'ok': False, 'error': 'missing file name'}), 400
    if '/' in name or '\\' in name:
        return jsonify({'ok': False, 'error': 'invalid name'}), 400

    parent_full = safe_path(parent)
    if not os.path.isdir(parent_full):
        return jsonify({'ok': False, 'error': 'parent not found'}), 404

    new_file = os.path.join(parent_full, name)
    if not is_path_inside(BASE_DIR, new_file):
        return jsonify({'ok': False, 'error': 'forbidden'}), 403
    if os.path.exists(new_file):
        return jsonify({'ok': False, 'error': 'already exists'}), 409

    try:
        with open(new_file, 'w', encoding='utf-8', newline='') as f:
            f.write('')
        rel_path = os.path.relpath(new_file, BASE_DIR).replace('\\', '/')
        broadcast_system_notice('mkfile', rel_path, f'{name} ファイルを作成しました')
        return jsonify({'ok': True, 'path': rel_path})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

# --- コピー ---
@app.route('/copy', methods=['POST'])
def copy_path():
    data = request.get_json(silent=True) or {}
    source_subpath = unquote(data.get('sourcePath', '')).strip()

    if not source_subpath:
        return jsonify({'ok': False, 'error': 'missing source path'}), 400

    source_full = safe_path(source_subpath)
    if not os.path.exists(source_full):
        return jsonify({'ok': False, 'error': 'source not found'}), 404

    parent_dir = os.path.dirname(source_full)
    base_name = os.path.basename(source_full.rstrip('/\\'))
    name_part, ext_part = os.path.splitext(base_name) if os.path.isfile(source_full) else (base_name, '')

    # 重複しない名前を生成
    copy_name = f'{name_part} - コピー{ext_part}'
    counter = 2
    while os.path.exists(os.path.join(parent_dir, copy_name)):
        copy_name = f'{name_part} - コピー ({counter}){ext_part}'
        counter += 1

    dest_full = os.path.join(parent_dir, copy_name)
    if not is_path_inside(BASE_DIR, dest_full):
        return jsonify({'ok': False, 'error': 'forbidden'}), 403

    try:
        if os.path.isfile(source_full):
            shutil.copy2(source_full, dest_full)
        else:
            shutil.copytree(source_full, dest_full)
        rel_path = os.path.relpath(dest_full, BASE_DIR).replace('\\', '/')
        broadcast_system_notice('copy', rel_path, f'{source_subpath} をコピーしました')
        return jsonify({'ok': True, 'newPath': rel_path, 'newName': copy_name})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

# --- サムネイル ---
@app.route('/thumbnail/<path:subpath>')
def thumbnail(subpath):
    subpath = unquote(subpath)
    full_path = safe_path(subpath)
    if not os.path.isfile(full_path):
        abort(404)
    mt, _ = mimetypes.guess_type(full_path)
    if not mt or not mt.startswith('image/'):
        abort(404)
    return send_file(full_path, mimetype=mt, as_attachment=False, conditional=True)

# --- テキストファイル保存 ---
@app.route('/save', methods=['POST'])
def save_file():
    data = request.get_json(silent=True) or {}
    subpath = unquote(data.get('subpath', '')).strip()
    content = data.get('content', '')
    socket_id = data.get('socketId', '').strip()

    if not subpath:
        return jsonify({'ok': False, 'error': 'missing path'}), 400

    full = safe_path(subpath)
    if not os.path.isfile(full):
        return jsonify({'ok': False, 'error': 'not found'}), 404

    allowed, lock = can_write_file(subpath, socket_id)
    if not allowed:
        return jsonify({'ok': False, 'error': f"{lock.get('ip') or '他のユーザー'} が編集中です"}), 409

    try:
        with open(full, 'r', encoding='utf-8', errors='ignore') as f:
            previous = f.read()
        if previous != content:
            save_history_snapshot(subpath, previous, reason='save', author=get_actor_label())
        with open(full, 'w', encoding='utf-8', newline='') as f:
            f.write(content)
        broadcast_system_notice('save', subpath, f'{subpath} を保存しました')
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/diff', methods=['POST'])
def api_diff():
    data = request.get_json(silent=True) or {}
    subpath = unquote(data.get('subpath', '')).strip()
    content = data.get('content', '')
    if not subpath:
        return jsonify({'ok': False, 'error': 'missing path'}), 400

    full = safe_path(subpath)
    if not os.path.isfile(full):
        return jsonify({'ok': False, 'error': 'not found'}), 404

    try:
        with open(full, 'r', encoding='utf-8', errors='ignore') as f:
            previous = f.read()
        payload = build_diff_payload(previous, content, '保存済み', '編集中')
        return jsonify({'ok': True, **payload})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/compare', methods=['POST'])
def api_compare():
    data = request.get_json(silent=True) or {}
    left_path = unquote(data.get('leftPath', '')).strip()
    right_path = unquote(data.get('rightPath', '')).strip()
    if not left_path or not right_path:
        return jsonify({'ok': False, 'error': '2つのファイルを指定してください'}), 400

    left_full = safe_path(left_path)
    right_full = safe_path(right_path)
    if not os.path.isfile(left_full) or not os.path.isfile(right_full):
        return jsonify({'ok': False, 'error': 'ファイルが見つかりません'}), 404

    try:
        with open(left_full, 'r', encoding='utf-8', errors='ignore') as f:
            left_content = f.read()
        with open(right_full, 'r', encoding='utf-8', errors='ignore') as f:
            right_content = f.read()
        payload = build_diff_payload(left_content, right_content, left_path, right_path)
        return jsonify({'ok': True, **payload})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/history/<path:subpath>')
def api_history(subpath):
    subpath = unquote(subpath)
    full = safe_path(subpath)
    if not os.path.isfile(full):
        return jsonify({'ok': False, 'error': 'not found'}), 404
    return jsonify({'ok': True, 'versions': list_history_snapshots(subpath)})

@app.route('/api/history/content/<path:subpath>')
def api_history_content(subpath):
    subpath = unquote(subpath)
    version_id = request.args.get('version_id', '').strip()
    if not version_id:
        return jsonify({'ok': False, 'error': 'missing version id'}), 400
    snapshot = load_history_snapshot(subpath, version_id)
    if not snapshot:
        return jsonify({'ok': False, 'error': 'version not found'}), 404
    return jsonify({'ok': True, 'content': snapshot.get('content', ''), 'meta': {
        'saved_at': snapshot.get('saved_at', '-'),
        'author': snapshot.get('author', 'system'),
        'reason': snapshot.get('reason', 'save'),
    }})

@app.route('/api/history/restore', methods=['POST'])
def api_history_restore():
    data = request.get_json(silent=True) or {}
    subpath = unquote(data.get('subpath', '')).strip()
    version_id = data.get('versionId', '').strip()
    socket_id = data.get('socketId', '').strip()
    if not subpath or not version_id:
        return jsonify({'ok': False, 'error': 'missing parameters'}), 400

    full = safe_path(subpath)
    if not os.path.isfile(full):
        return jsonify({'ok': False, 'error': 'not found'}), 404

    allowed, lock = can_write_file(subpath, socket_id)
    if not allowed:
        return jsonify({'ok': False, 'error': f"{lock.get('ip') or '他のユーザー'} が編集中です"}), 409

    snapshot = load_history_snapshot(subpath, version_id)
    if not snapshot:
        return jsonify({'ok': False, 'error': 'version not found'}), 404

    try:
        with open(full, 'r', encoding='utf-8', errors='ignore') as f:
            current = f.read()
        save_history_snapshot(subpath, current, reason='before-restore', author=get_actor_label())
        with open(full, 'w', encoding='utf-8', newline='') as f:
            f.write(snapshot.get('content', ''))
        socketio.emit('file_update', {
            'path': normalize_rel_path(subpath),
            'content': snapshot.get('content', ''),
            'cursor': 0,
            'sender': {
                'ip': get_actor_label(),
                'color': '#10b981',
            },
        }, to=edit_room_name(subpath))
        broadcast_system_notice('restore', subpath, f'{subpath} を履歴から復元しました', {
            'versionId': version_id,
        })
        return jsonify({'ok': True, 'content': snapshot.get('content', '')})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/chat')
def api_chat():
    return jsonify({'ok': True, 'messages': chat_messages[-CHAT_HISTORY_LIMIT:]})

@app.route('/api/online-users')
def api_online_users():
    return jsonify({'ok': True, 'users': get_online_user_list(), 'ip': _get_client_ip()})

@app.route('/api/dm/<path:target_ip>')
def api_dm_history(target_ip):
    my_ip = _get_client_ip()
    messages = load_dm_history(my_ip, target_ip)
    return jsonify({'ok': True, 'messages': messages})

@app.route('/api/share', methods=['POST'])
def api_share_create():
    """共有リンクを生成"""
    data = request.get_json(silent=True) or {}
    subpath = unquote(data.get('subpath', '')).strip()
    if not subpath:
        return jsonify({'ok': False, 'error': 'missing path'}), 400
    full = safe_path(subpath)
    if not os.path.exists(full):
        return jsonify({'ok': False, 'error': 'not found'}), 404
    token = create_share_token(subpath)
    url = f'/shared/{token}'
    return jsonify({'ok': True, 'token': token, 'url': url})

@app.route('/shared/<token>')
def shared_access(token):
    """共有リンクからファイルにアクセス"""
    link = share_links.get(token)
    if not link:
        abort(404)
    if is_share_link_expired(link):
        share_links.pop(token, None)
        _save_share_links()
        abort(410)  # Gone
    subpath = link['path']
    full = safe_path(subpath)
    if not os.path.exists(full):
        abort(404)
    if os.path.isfile(full):
        # テキストファイルならプレビューページへリダイレクト、バイナリならダウンロード
        mt, _ = mimetypes.guess_type(full)
        if mt and (mt.startswith('image/') or mt.startswith('audio/') or mt.startswith('video/')):
            return send_file(full, mimetype=mt, as_attachment=False, conditional=True)
        return send_file(full, as_attachment=True)
    else:
        # フォルダなら browse にリダイレクト
        return redirect(url_for('browse', subpath=subpath))

@app.route('/api/activity-log')
def api_activity_log():
    limit = request.args.get('limit', '50')
    try:
        limit = min(int(limit), ACTIVITY_LOG_LIMIT)
    except ValueError:
        limit = 50
    logs = load_activity_log()[:limit]
    return jsonify({'ok': True, 'logs': logs})


@app.route('/api/dashboard')
def api_dashboard():
    try:
        limit = int(request.args.get('limit', '8'))
    except ValueError:
        limit = 8
    return jsonify({'ok': True, 'dashboard': build_dashboard_payload(limit)})

@app.route('/api/clipboard', methods=['GET'])
def api_clipboard_get():
    return jsonify({'ok': True, 'entries': load_clipboard_entries()})

@app.route('/api/clipboard', methods=['POST'])
def api_clipboard_add():
    data = request.get_json(silent=True) or {}
    text = data.get('text', '').strip()
    if not text:
        return jsonify({'ok': False, 'error': 'text is empty'}), 400

    entries = load_clipboard_entries()
    entry = {
        'id': datetime.now().strftime('%Y%m%d%H%M%S%f'),
        'text': text,
        'author': get_actor_label(),
        'created_at': current_timestamp(),
    }
    entries.insert(0, entry)
    entries = entries[:50]
    save_clipboard_entries(entries)
    socketio.emit('clipboard_update', {'entries': entries, 'latest': entry})
    return jsonify({'ok': True, 'entries': entries})

@app.route('/api/clipboard', methods=['DELETE'])
def api_clipboard_delete():
    data = request.get_json(silent=True) or {}
    entry_id = data.get('id', '').strip()
    entries = load_clipboard_entries()
    if entry_id:
        entries = [entry for entry in entries if entry.get('id') != entry_id]
    else:
        entries = []
    save_clipboard_entries(entries)
    socketio.emit('clipboard_update', {'entries': entries})
    return jsonify({'ok': True, 'entries': entries})

@app.route('/api/terminal/run', methods=['POST'])
def api_terminal_run():
    settings = load_app_settings()
    if not settings.get('admin_mode_enabled'):
        return jsonify({
            'ok': False,
            'error': 'ターミナルは管理者モードをONにした時だけ利用できます',
        }), 403
    if not is_terminal_allowed(settings):
        return jsonify({
            'ok': False,
            'error': 'ターミナルはこのPC上のブラウザからのみ実行できます',
        }), 403

    data = request.get_json(silent=True) or {}
    command = data.get('command', '').strip()
    cwd_rel = unquote(data.get('cwd', '')).strip()
    scope = data.get('scope', 'files')

    if not command:
        return jsonify({'ok': False, 'error': 'missing command'}), 400

    timeout_sec = min(int(data.get('timeout', 15)), 120)  # 最大120秒

    if scope == 'project':
        cwd = APP_ROOT
    else:
        cwd = safe_path(cwd_rel) if cwd_rel else BASE_DIR
        if not os.path.isdir(cwd):
            return jsonify({'ok': False, 'error': 'cwd not found'}), 404

    shell_cmd = ['powershell', '-NoLogo', '-NoProfile', '-Command', command] if os.name == 'nt' else ['bash', '-lc', command]

    try:
        completed = subprocess.run(
            shell_cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='ignore',
            timeout=timeout_sec,
        )
        return jsonify({
            'ok': True,
            'code': completed.returncode,
            'stdout': clip_terminal_output(completed.stdout),
            'stderr': clip_terminal_output(completed.stderr),
            'cwd': cwd,
        })
    except subprocess.TimeoutExpired as e:
        return jsonify({
            'ok': False,
            'error': f'command timed out after {timeout_sec} seconds',
            'stdout': clip_terminal_output(e.stdout or ''),
            'stderr': clip_terminal_output(e.stderr or ''),
            'cwd': cwd,
        }), 408
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/image/save', methods=['POST'])
def api_image_save():
    data = request.get_json(silent=True) or {}
    subpath = unquote(data.get('subpath', '')).strip()
    data_url = data.get('dataUrl', '')
    if not subpath or ',' not in data_url:
        return jsonify({'ok': False, 'error': 'invalid payload'}), 400

    full = safe_path(subpath)
    if not os.path.isfile(full):
        return jsonify({'ok': False, 'error': 'not found'}), 404

    try:
        _, encoded = data_url.split(',', 1)
        image_bytes = base64.b64decode(encoded)
        with open(full, 'wb') as f:
            f.write(image_bytes)
        broadcast_system_notice('image-save', subpath, f'{subpath} の画像を更新しました')
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

# --- 全文検索 ---
@app.route('/search')
def search_files():
    q = request.args.get('q', '').strip()
    scope = request.args.get('scope', '').strip()
    if not q:
        return jsonify({'ok': True, 'results': []})

    search_root = safe_path(scope) if scope else BASE_DIR
    if not os.path.isdir(search_root):
        search_root = BASE_DIR

    results = []
    q_lower = q.lower()
    TEXT_EXT = {'.txt','.md','.py','.js','.html','.htm','.css','.json','.xml',
                '.csv','.yaml','.yml','.toml','.ini','.cfg','.bat','.sh','.log',
                '.java','.c','.cpp','.h','.rs','.go','.ts','.tsx','.jsx','.vue',
                '.rb','.php','.sql','.r','.m'}

    for root, dirs, files in os.walk(search_root):
        for fname in files:
            full = os.path.join(root, fname)
            rel = os.path.relpath(full, BASE_DIR).replace('\\', '/')

            # ファイル名マッチ
            name_match = q_lower in fname.lower()

            # 内容マッチ（テキスト系のみ）
            content_match = False
            snippet = ''
            ext = os.path.splitext(fname)[1].lower()
            if ext in TEXT_EXT:
                try:
                    with open(full, 'r', encoding='utf-8', errors='ignore') as f:
                        text = f.read(512_000)  # 最大500KB
                    idx = text.lower().find(q_lower)
                    if idx >= 0:
                        content_match = True
                        start = max(0, idx - 40)
                        end = min(len(text), idx + len(q) + 40)
                        snippet = ('…' if start > 0 else '') + text[start:end] + ('…' if end < len(text) else '')
                except Exception:
                    pass

            if name_match or content_match:
                is_file = os.path.isfile(full)
                results.append({
                    'path': rel,
                    'name': fname,
                    'type': 'file' if is_file else 'folder',
                    'nameMatch': name_match,
                    'contentMatch': content_match,
                    'snippet': snippet,
                })
            if len(results) >= 100:
                break
        if len(results) >= 100:
            break

    return jsonify({'ok': True, 'results': results})

# --- 一括ZIP ---
@app.route('/download-multi', methods=['POST'])
def download_multi():
    data = request.get_json(silent=True) or {}
    paths = data.get('paths', [])
    if not paths:
        return 'No files selected', 400

    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
        for p in paths:
            full = safe_path(p)
            if os.path.isfile(full):
                zf.write(full, arcname=os.path.basename(full))
            elif os.path.isdir(full):
                base = os.path.basename(full.rstrip("/\\"))
                for root, _, files in os.walk(full):
                    for fname in files:
                        abs_f = os.path.join(root, fname)
                        arc = os.path.join(base, os.path.relpath(abs_f, full))
                        zf.write(abs_f, arcname=arc)
    memory_file.seek(0)
    return send_file(memory_file, download_name="selected.zip", as_attachment=True)

# --- 一括削除 ---
@app.route('/delete-multi', methods=['POST'])
def delete_multi():
    data = request.get_json(silent=True) or {}
    paths = data.get('paths', [])
    permanent = data.get('permanent', False)
    if not paths:
        return jsonify({'ok': False, 'error': 'no paths'}), 400

    errors = []
    deleted = []
    for p in paths:
        if not p:
            continue
        target = safe_path(p)
        if not os.path.exists(target):
            continue
        try:
            if permanent:
                if os.path.isfile(target):
                    os.remove(target)
                else:
                    shutil.rmtree(target)
            else:
                _move_to_trash(p)
            deleted.append(normalize_rel_path(p))
        except Exception as e:
            errors.append(f'{p}: {e}')

    if errors:
        return jsonify({'ok': False, 'error': '; '.join(errors)}), 500
    if deleted:
        action = 'delete-multi' if permanent else 'trash-multi'
        msg = f'{len(deleted)}件を{"完全削除" if permanent else "ゴミ箱に移動"}しました'
        broadcast_system_notice(action, deleted[0], msg, {'paths': deleted})
    return jsonify({'ok': True})

# --- お気に入り（IPアドレスごとに管理） ---
FAVS_DIR = os.path.join(APP_ROOT, '.favs')
TRASH_DIR = os.path.join(APP_ROOT, '.trash')
TRASH_META_FILE = os.path.join(TRASH_DIR, '_meta.json')
os.makedirs(FAVS_DIR, exist_ok=True)
os.makedirs(TRASH_DIR, exist_ok=True)

def _get_client_ip():
    """プロキシ経由でも正しいIPを取得"""
    return get_request_ip()

def _favs_file(ip):
    safe_ip = ip.replace(':', '_')  # IPv6対策
    return os.path.join(FAVS_DIR, f'{safe_ip}.json')

def _load_favs(ip):
    path = _favs_file(ip)
    if os.path.isfile(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return []

def _save_favs(ip, favs):
    with open(_favs_file(ip), 'w', encoding='utf-8') as f:
        json.dump(favs, f, ensure_ascii=False, indent=1)

@app.route('/api/favs', methods=['GET'])
def get_favs():
    ip = _get_client_ip()
    return jsonify({'ok': True, 'favs': _load_favs(ip), 'ip': ip})

@app.route('/api/favs', methods=['POST'])
def add_fav():
    ip = _get_client_ip()
    data = request.get_json(silent=True) or {}
    path = data.get('path', '').strip()
    name = data.get('name', '').strip()
    ftype = data.get('type', 'file')
    if not path:
        return jsonify({'ok': False, 'error': 'missing path'}), 400

    favs = _load_favs(ip)
    if any(f['path'] == path for f in favs):
        return jsonify({'ok': True, 'favs': favs})
    favs.append({'path': path, 'name': name, 'type': ftype})
    _save_favs(ip, favs)
    return jsonify({'ok': True, 'favs': favs})

@app.route('/api/favs', methods=['DELETE'])
def remove_fav():
    ip = _get_client_ip()
    data = request.get_json(silent=True) or {}
    path = data.get('path', '').strip()
    if not path:
        return jsonify({'ok': False, 'error': 'missing path'}), 400

    favs = _load_favs(ip)
    favs = [f for f in favs if f['path'] != path]
    _save_favs(ip, favs)
    return jsonify({'ok': True, 'favs': favs})

# --- ゴミ箱 API ---
@app.route('/api/trash')
def api_trash_list():
    """ゴミ箱の中身一覧"""
    meta = _load_trash_meta()
    for entry in meta:
        trash_path = os.path.join(TRASH_DIR, entry['trash_name'])
        entry['exists'] = os.path.exists(trash_path)
        if entry['exists']:
            if os.path.isfile(trash_path):
                entry['size_h'] = human_size(os.path.getsize(trash_path))
            else:
                entry['size_h'] = human_size(folder_size(trash_path))
    return jsonify({'ok': True, 'items': meta})

@app.route('/api/trash/restore', methods=['POST'])
def api_trash_restore():
    """ゴミ箱から復元"""
    data = request.get_json(silent=True) or {}
    trash_id = data.get('id', '').strip()
    if not trash_id:
        return jsonify({'ok': False, 'error': 'missing id'}), 400

    meta = _load_trash_meta()
    entry = next((e for e in meta if e['id'] == trash_id), None)
    if not entry:
        return jsonify({'ok': False, 'error': 'not found in trash'}), 404

    trash_path = os.path.join(TRASH_DIR, entry['trash_name'])
    if not os.path.exists(trash_path):
        return jsonify({'ok': False, 'error': 'trash file missing'}), 404

    restore_path = os.path.join(BASE_DIR, entry['original_path'].replace('/', os.sep))
    if os.path.exists(restore_path):
        return jsonify({'ok': False, 'error': '同名のファイルが既に存在します'}), 409

    try:
        os.makedirs(os.path.dirname(restore_path), exist_ok=True)
        shutil.move(trash_path, restore_path)
        meta = [e for e in meta if e['id'] != trash_id]
        _save_trash_meta(meta)
        broadcast_system_notice('restore-trash', entry['original_path'],
                                f'{entry["name"]} をゴミ箱から復元しました')
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/trash/delete', methods=['POST'])
def api_trash_delete():
    """ゴミ箱から完全削除"""
    data = request.get_json(silent=True) or {}
    trash_id = data.get('id', '').strip()
    if not trash_id:
        return jsonify({'ok': False, 'error': 'missing id'}), 400

    meta = _load_trash_meta()
    entry = next((e for e in meta if e['id'] == trash_id), None)
    if not entry:
        return jsonify({'ok': False, 'error': 'not found'}), 404

    trash_path = os.path.join(TRASH_DIR, entry['trash_name'])
    try:
        if os.path.isfile(trash_path):
            os.remove(trash_path)
        elif os.path.isdir(trash_path):
            shutil.rmtree(trash_path)
        meta = [e for e in meta if e['id'] != trash_id]
        _save_trash_meta(meta)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/trash/empty', methods=['POST'])
def api_trash_empty():
    """ゴミ箱を空にする"""
    meta = _load_trash_meta()
    errors = []
    for entry in meta:
        trash_path = os.path.join(TRASH_DIR, entry['trash_name'])
        try:
            if os.path.isfile(trash_path):
                os.remove(trash_path)
            elif os.path.isdir(trash_path):
                shutil.rmtree(trash_path)
        except Exception as e:
            errors.append(str(e))
    _save_trash_meta([])
    if errors:
        return jsonify({'ok': False, 'error': '; '.join(errors)}), 500
    return jsonify({'ok': True})

# --- サーバー情報（QRコード用） ---
@app.route('/server-info')
def server_info():
    url_path = request.args.get('path', '/') or '/'
    if not url_path.startswith('/') or url_path.startswith('//'):
        url_path = '/'
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(('8.8.8.8', 80))
            ip = s.getsockname()[0]
    except Exception:
        hostname = socket.gethostname()
        try:
            ip = socket.gethostbyname(hostname)
        except Exception:
            ip = '127.0.0.1'
    settings = load_app_settings()
    port = request.host.rsplit(':', 1)[-1] if ':' in request.host else str(get_server_port(settings))
    try:
        port_number = int(port)
    except ValueError:
        port_number = get_server_port(settings)
    return jsonify({
        'ip': ip,
        'port': port_number,
        'url': f'http://{ip}:{port_number}{url_path}',
        'root_url': f'http://{ip}:{port_number}',
        'settings': public_app_settings(settings),
    })

# --- ストレージ使用量 ---
@app.route('/api/storage')
def api_storage():
    try:
        usage = shutil.disk_usage(BASE_DIR)
        files_size = folder_size(BASE_DIR)
        return jsonify({
            'ok': True,
            'total': usage.total,
            'used': usage.used,
            'free': usage.free,
            'files_size': files_size,
            'total_h': human_size(usage.total),
            'used_h': human_size(usage.used),
            'free_h': human_size(usage.free),
            'files_size_h': human_size(files_size),
            'percent': round(usage.used / usage.total * 100, 1) if usage.total else 0,
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

# --- ファイル詳細情報 ---
@app.route('/api/file-info/<path:subpath>')
def api_file_info(subpath):
    subpath = unquote(subpath)
    full = safe_path(subpath)
    if not os.path.exists(full):
        return jsonify({'ok': False, 'error': 'not found'}), 404

    stat = os.stat(full)
    is_file = os.path.isfile(full)
    info = {
        'path': normalize_rel_path(subpath),
        'name': os.path.basename(full),
        'type': 'file' if is_file else 'folder',
        'size': stat.st_size if is_file else folder_size(full),
        'size_h': human_size(stat.st_size) if is_file else human_size(folder_size(full)),
        'created': datetime.fromtimestamp(stat.st_ctime).strftime('%Y-%m-%d %H:%M:%S'),
        'modified': datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S'),
        'accessed': datetime.fromtimestamp(stat.st_atime).strftime('%Y-%m-%d %H:%M:%S'),
    }
    if is_file:
        mt, _ = mimetypes.guess_type(full)
        info['mime'] = mt or 'unknown'
        info['extension'] = os.path.splitext(full)[1].lstrip('.')
    else:
        # フォルダ内のファイル数を数える
        file_count = sum(len(files) for _, _, files in os.walk(full))
        dir_count = sum(len(dirs) for _, dirs, _ in os.walk(full))
        info['file_count'] = file_count
        info['dir_count'] = dir_count

    return jsonify({'ok': True, 'info': info})

# --- 一括移動 ---
@app.route('/move-multi', methods=['POST'])
def move_multi():
    data = request.get_json(silent=True) or {}
    paths = data.get('paths', [])
    target_dir = unquote(data.get('targetDir', '')).strip()

    if not paths:
        return jsonify({'ok': False, 'error': 'no paths'}), 400

    target_full = safe_path(target_dir) if target_dir else BASE_DIR
    if not os.path.isdir(target_full):
        return jsonify({'ok': False, 'error': 'target folder not found'}), 404

    errors = []
    moved = []
    for p in paths:
        if not p:
            continue
        source_full = safe_path(p)
        if not os.path.exists(source_full):
            continue
        if os.path.dirname(source_full) == target_full:
            continue
        dest = os.path.join(target_full, os.path.basename(source_full.rstrip('/\\')))
        if not is_path_inside(BASE_DIR, dest):
            errors.append(f'{p}: forbidden')
            continue
        if os.path.exists(dest):
            errors.append(f'{p}: 同名が既に存在します')
            continue
        if os.path.isdir(source_full) and is_same_or_child_path(source_full, target_full):
            errors.append(f'{p}: 自分自身には移動できません')
            continue
        try:
            shutil.move(source_full, dest)
            moved.append(normalize_rel_path(p))
        except Exception as e:
            errors.append(f'{p}: {e}')

    if moved:
        broadcast_system_notice('move-multi', moved[0], f'{len(moved)}件を移動しました', {
            'paths': moved,
            'targetDir': normalize_rel_path(target_dir),
        })
    if errors:
        return jsonify({'ok': False, 'error': '; '.join(errors), 'moved': moved}), 207
    return jsonify({'ok': True, 'moved': moved})

# --- SocketIO: 接続管理 ---
@socketio.on('connect')
def on_connect():
    if not is_request_unlocked():
        return False
    ip = request.headers.get('X-Forwarded-For', request.remote_addr or '').split(',')[0].strip() or 'unknown'
    color_idx = len(set(u['ip'] for u in online_users.values())) % len(EDITOR_COLORS)
    online_users[request.sid] = {
        'ip': ip,
        'color': EDITOR_COLORS[color_idx],
        'connected_at': current_timestamp(),
    }
    # 自分のIPルームに参加（DM受信用）
    join_room(f'user:{ip}')
    broadcast_online_users()

# --- SocketIO: リアルタイム同時編集 ---
@socketio.on('join_edit')
def on_join_edit(data):
    """ファイル編集ルームに参加"""
    file_path = normalize_rel_path(data.get('path', ''))
    if not file_path:
        return
    room = edit_room_name(file_path)
    join_room(room)

    if room not in live_editors:
        live_editors[room] = {}
    color_idx = len(live_editors[room]) % len(EDITOR_COLORS)
    ip = request.headers.get('X-Forwarded-For', request.remote_addr or '').split(',')[0].strip() or 'unknown'
    live_editors[room][request.sid] = {
        'ip': ip,
        'color': EDITOR_COLORS[color_idx],
        'cursor': 0,
    }
    if file_path not in edit_locks:
        edit_locks[file_path] = {
            'sid': request.sid,
            'ip': ip,
            'color': live_editors[room][request.sid]['color'],
            'acquired_at': current_timestamp(),
        }
    # 参加者リストを全員に通知
    emit('editors_update', {
        'editors': list(live_editors[room].values()),
        'count': len(live_editors[room]),
    }, to=room)
    emit_lock_update(file_path)

@socketio.on('leave_edit')
def on_leave_edit(data):
    """ファイル編集ルームから退出"""
    file_path = normalize_rel_path(data.get('path', ''))
    if not file_path:
        return
    room = edit_room_name(file_path)
    leave_room(room)
    if room in live_editors:
        live_editors[room].pop(request.sid, None)
        if not live_editors[room]:
            del live_editors[room]
        else:
            emit('editors_update', {
                'editors': list(live_editors[room].values()),
                'count': len(live_editors[room]),
            }, to=room)
    if edit_locks.get(file_path, {}).get('sid') == request.sid:
        edit_locks.pop(file_path, None)
    emit_lock_update(file_path)

@socketio.on('disconnect')
def on_disconnect():
    """切断時に全ルームから除去"""
    # オンラインユーザーから削除
    online_users.pop(request.sid, None)
    broadcast_online_users()

    rooms_to_clean = []
    for room, editors in list(live_editors.items()):
        if request.sid in editors:
            rooms_to_clean.append(room)
    for room in rooms_to_clean:
        live_editors[room].pop(request.sid, None)
        if not live_editors[room]:
            del live_editors[room]
        else:
            emit('editors_update', {
                'editors': list(live_editors[room].values()),
                'count': len(live_editors[room]),
            }, to=room)
        file_path = room.split(':', 1)[1]
        if edit_locks.get(file_path, {}).get('sid') == request.sid:
            edit_locks.pop(file_path, None)
        emit_lock_update(file_path)

@socketio.on('take_edit_lock')
def on_take_edit_lock(data):
    file_path = normalize_rel_path(data.get('path', ''))
    if not file_path:
        return
    room = edit_room_name(file_path)
    if room not in live_editors or request.sid not in live_editors[room]:
        return

    current = edit_locks.get(file_path)
    if current and current.get('sid') != request.sid:
        emit('edit_lock_denied', build_lock_payload(file_path))
        return

    editor = live_editors[room][request.sid]
    edit_locks[file_path] = {
        'sid': request.sid,
        'ip': editor['ip'],
        'color': editor['color'],
        'acquired_at': current_timestamp(),
    }
    emit_lock_update(file_path)

@socketio.on('release_edit_lock')
def on_release_edit_lock(data):
    file_path = normalize_rel_path(data.get('path', ''))
    if not file_path:
        return
    if edit_locks.get(file_path, {}).get('sid') == request.sid:
        edit_locks.pop(file_path, None)
        emit_lock_update(file_path)

# file_change 用: 最後に履歴を保存した時刻（ファイルごと）
_last_history_save = {}
_HISTORY_SAVE_INTERVAL = 30  # 秒（この間隔以上経ったら履歴を保存）

@socketio.on('file_change')
def on_file_change(data):
    """編集内容をルーム内の他ユーザーにブロードキャスト & 自動保存"""
    file_path = normalize_rel_path(data.get('path', ''))
    content = data.get('content', '')
    cursor = data.get('cursor', 0)
    if not file_path:
        return

    room = edit_room_name(file_path)
    current_lock = edit_locks.get(file_path)
    if current_lock and current_lock.get('sid') != request.sid:
        emit('edit_lock_denied', build_lock_payload(file_path))
        return

    # カーソル位置を更新
    if room in live_editors and request.sid in live_editors[room]:
        live_editors[room][request.sid]['cursor'] = cursor

    # ファイルに自動保存 + 一定間隔で履歴スナップショット
    try:
        full = safe_path(file_path)
        if os.path.isfile(full):
            now = time.time()
            last = _last_history_save.get(file_path, 0)
            if now - last >= _HISTORY_SAVE_INTERVAL:
                with open(full, 'r', encoding='utf-8', errors='ignore') as f:
                    previous = f.read()
                if previous != content:
                    ip = request.headers.get('X-Forwarded-For', request.remote_addr or '').split(',')[0].strip()
                    save_history_snapshot(file_path, previous, reason='auto-save', author=ip)
                _last_history_save[file_path] = now
            with open(full, 'w', encoding='utf-8', newline='') as f:
                f.write(content)
    except Exception:
        pass

    # 他のユーザーにブロードキャスト（送信元以外）
    sender_info = {}
    if room in live_editors and request.sid in live_editors[room]:
        sender_info = live_editors[room][request.sid]

    emit('file_update', {
        'path': file_path,
        'content': content,
        'cursor': cursor,
        'sender': sender_info,
    }, to=room, include_self=False)

@socketio.on('cursor_move')
def on_cursor_move(data):
    """カーソル位置のみ同期"""
    file_path = normalize_rel_path(data.get('path', ''))
    cursor = data.get('cursor', 0)
    selection_end = data.get('selectionEnd', cursor)
    if not file_path:
        return
    room = edit_room_name(file_path)
    if room in live_editors and request.sid in live_editors[room]:
        live_editors[room][request.sid]['cursor'] = cursor
        emit('cursor_update', {
            'cursor': cursor,
            'selectionEnd': selection_end,
            'sender': live_editors[room][request.sid],
        }, to=room, include_self=False)

@socketio.on('chat_send')
def on_chat_send(data):
    text = (data.get('text', '') or '').strip()
    if not text:
        return

    message = {
        'id': datetime.now().strftime('%Y%m%d%H%M%S%f'),
        'text': text[:4000],
        'author': get_actor_label(),
        'created_at': current_timestamp(),
    }
    chat_messages.append(message)
    del chat_messages[:-CHAT_HISTORY_LIMIT]
    save_chat_history()
    socketio.emit('chat_message', message)

@socketio.on('dm_send')
def on_dm_send(data):
    """個人チャット送信"""
    text = (data.get('text', '') or '').strip()
    target_ip = (data.get('targetIp', '') or '').strip()
    if not text or not target_ip:
        return

    sender_info = online_users.get(request.sid)
    if not sender_info:
        return
    my_ip = sender_info['ip']
    if my_ip == target_ip:
        return

    message = {
        'id': datetime.now().strftime('%Y%m%d%H%M%S%f'),
        'text': text[:4000],
        'author': my_ip,
        'target': target_ip,
        'created_at': current_timestamp(),
    }

    # 履歴に保存
    history = load_dm_history(my_ip, target_ip)
    history.append(message)
    save_dm_history(my_ip, target_ip, history)

    # 送信者と受信者のIPルームに通知
    socketio.emit('dm_message', message, to=f'user:{target_ip}')
    socketio.emit('dm_message', message, to=f'user:{my_ip}')

if __name__ == '__main__':
    settings = load_app_settings()
    apply_storage_dir(settings.get('storage_path'))
    debug_enabled = os.environ.get('LAN_DRIVE_DEBUG', '').lower() in {'1', 'true', 'yes'}
    socketio.run(
        app,
        host='0.0.0.0',
        port=get_server_port(settings),
        debug=debug_enabled,
        allow_unsafe_werkzeug=True,
    )
