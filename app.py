from flask import Flask, render_template, send_file, abort
from flask import jsonify
from flask import request
import os
import zipfile
import io
from urllib.parse import unquote

app = Flask(__name__)
BASE_DIR = os.path.abspath('./files')


def safe_path(subpath):
    full_path = os.path.abspath(os.path.join(BASE_DIR, subpath))
    if not full_path.startswith(BASE_DIR):
        abort(403)  # Directory traversal防止
    return full_path


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
        entry = {
            'name': name,
            'path': rel_path,
            'type': 'folder' if os.path.isdir(full_path) else 'file'
        }
        entries.append(entry)

    parent_path = os.path.dirname(subpath) if subpath else None

    return render_template('index.html', entries=entries, subpath=subpath, parent_path=parent_path)


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
    print(f"[DEBUG] preview_file: subpath={subpath}, path={path}") 
    if not os.path.isfile(path):
        return jsonify({'content': 'ファイルが存在しません'}), 404
    try:
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        return jsonify({'content': content})  # ← ここ重要！
    except Exception as e:
        return jsonify({'content': f'読み込みエラー: {str(e)}'}), 500

@app.route('/upload/', defaults={'subpath': ''}, methods=['POST'])
@app.route('/upload/<path:subpath>', methods=['POST'])
def upload_file(subpath):
    subpath = unquote(subpath)
    upload_root = safe_path(subpath)

    print(f"[DEBUG] upload_root={upload_root}")

    if not os.path.isdir(upload_root):
        print("[ERROR] Not a directory:", upload_root)
        return 'Not a directory', 400

    files_received = request.files.getlist('file')
    if not files_received:
        print("[ERROR] No files received.")
        return 'No files received', 400

    for file_storage in files_received:
        rel_path = file_storage.filename.replace("\\", "/")
        rel_path = rel_path.lstrip("/").lstrip("\\").split(":", 1)[-1]  # ← 追加
        save_path = os.path.abspath(os.path.join(upload_root, rel_path))

        print(f"[UPLOAD] filename={file_storage.filename}")
        print(f"[UPLOAD] save_path={save_path}")

        if not save_path.startswith(upload_root):
            print("[SECURITY] Path traversal detected:", save_path)
            continue

        try:
            os.makedirs(os.path.dirname(save_path), exist_ok=True)
            file_storage.save(save_path)
        except Exception as e:
            print(f"[ERROR] Exception while saving: {e}")
            return f"Save failed: {e}", 500

    return 'OK', 200



if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
