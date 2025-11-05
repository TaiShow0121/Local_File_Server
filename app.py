from flask import Flask, render_template, send_file, abort, jsonify, request, url_for
import os
import zipfile
import io
from datetime import datetime 
import time      
from urllib.parse import unquote
import shutil
from markupsafe import escape
import mimetypes
import locale, unicodedata


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

# 表示ルート
BASE_DIR = os.path.abspath('./files')
APP_ROOT = os.path.abspath(os.path.dirname(__file__))  # 例: local_server の絶対パス
GLOBAL_README_CANDIDATES = [
    os.path.join(APP_ROOT, 'README.md'),
    os.path.join(APP_ROOT, 'readme.md'),
]

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
def safe_path(subpath):
    full_path = os.path.abspath(os.path.join(BASE_DIR, subpath))
    if not full_path.startswith(BASE_DIR):
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

# --- routes ---
@app.route('/', defaults={'subpath': ''})
@app.route('/browse/', defaults={'subpath': ''})
@app.route('/browse/<path:subpath>')
def browse(subpath):
    current_dir = safe_path(subpath)
    if not os.path.isdir(current_dir):
        abort(404)

    entries = []
    for name in os.listdir(current_dir):
        full_path = os.path.join(current_dir, name)
        rel_path = f"{subpath}/{name}" if subpath else name

        if os.path.isfile(full_path):
            size = os.path.getsize(full_path)
            etype = 'file'
        else:
            size = folder_size(full_path)
            etype = 'folder'

        # ここで更新日時を取得して表示用に整形（YYYY-MM-DD HH:MM）
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
            'mtime': mtime_str,            # ★追加
        })

    # ソートは従来どおり
    entries.sort(key=lambda e: (0 if e['type'] == 'folder' else 1, ja_sort_key(e['name'])))

    parent_path = os.path.dirname(subpath) if subpath else None
    breadcrumbs = build_breadcrumbs(subpath)

    return render_template(
        'index.html',
        entries=entries,
        subpath=subpath,
        parent_path=parent_path,
        breadcrumbs=breadcrumbs,
    )
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
@app.route('/delete', methods=['POST'])
def delete_path():
    """
    JSON: { "subpath": "<相対パス>" }
    - ファイル: os.remove
    - フォルダ: shutil.rmtree（中身ごと）
    """
    data = request.get_json(silent=True) or {}
    subpath = unquote(data.get('subpath','')).strip()

    # ルート直下（BASE_DIRそのもの）は削除禁止
    if subpath == '':
        return jsonify({'ok': False, 'error': 'root deletion is not allowed'}), 400

    target = safe_path(subpath)
    if not os.path.exists(target):
        return jsonify({'ok': False, 'error': 'not found'}), 404

    try:
        if os.path.isfile(target):
            os.remove(target)
        else:
            shutil.rmtree(target)
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

    if not os.path.isdir(upload_root):
        return 'Not a directory', 400

    files_received = request.files.getlist('file')
    if not files_received:
        return 'No files received', 400

    for fs in files_received:
        # 相対パスを安全に復元（フォルダごとアップロード対応）
        rel_path = fs.filename.replace("\\", "/")
        rel_path = rel_path.lstrip("/").lstrip("\\").split(":", 1)[-1]
        save_path = os.path.abspath(os.path.join(upload_root, rel_path))

        if not save_path.startswith(upload_root):
            # 走査対策
            continue

        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        fs.save(save_path)

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
        html = _md_to_html(md_text)  # 既存の関数（markdown無ければ<pre>でフォールバック）
        return jsonify({'ok': True, 'html': html, 'path': subpath})
    except Exception as e:
        return jsonify({'ok': False, 'error': f'render error: {e}'}), 500
    
if __name__ == '__main__':
    os.makedirs(BASE_DIR, exist_ok=True)
    app.run(host='0.0.0.0', port=5000, debug=True)
