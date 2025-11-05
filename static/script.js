/* ========= プレビュー（画像/動画/音声/PDF/Markdown対応） ========= */
function previewFile(path) {
  const el = document.getElementById('preview');
  const ext = (path.split('.').pop() || '').toLowerCase();

  const imgExt = ['png','jpg','jpeg','gif','webp','bmp','svg'];
  const vidExt = ['mp4','webm','ogv','ogg'];
  const audExt = ['mp3','wav','ogg','m4a','aac'];
  const pdfExt = ['pdf'];
  const mdExt  = ['md','markdown','mdown','mkd','mkdown'];
  const htmlExt= ['html','htm'];

  // Markdown（サーバでHTML化して表示）
  if (mdExt.includes(ext)) {
    el.innerHTML = '読み込み中…';
    fetch(`/render-md/${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(j => {
        if (!j.ok) throw new Error(j.error || 'failed');
        el.classList.add('md-body');
        el.innerHTML = j.html;
      })
      .catch(e => {
        console.error(e);
        el.textContent = 'Markdownの表示に失敗しました';
      });
    return;
  }

  // ★ HTML: デフォルトは「見た目」。タブで「コード」に切替可
  if (htmlExt.includes(ext)) {
    el.classList.remove('md-body');

    // タブUI（軽量）
    el.innerHTML = `
      <div style="display:flex; gap:.5rem; margin-bottom:.5rem;">
        <button class="btn" id="tab-live">見た目</button>
        <button class="btn" id="tab-code">コード</button>
      </div>
      <div id="preview-pane"></div>
    `;

    const pane = document.getElementById('preview-pane');

    // デフォルト：見た目（iframe サンドボックス）
    const showLive = () => {
      pane.innerHTML = `
        <iframe
          src="/raw/${encodeURIComponent(path)}"
          style="width:100%;height:80vh;border:1px solid #ddd;border-radius:6px;"
          sandbox="allow-scripts allow-forms allow-popups"
        ></iframe>`;
    };

    // コード表示（既存の /preview を利用）
    const showCode = () => {
      pane.textContent = '読み込み中…';
      fetch(`/preview/${encodeURIComponent(path)}`)
        .then(res => res.json())
        .then(data => {
          // プレーンテキストで表示（小さな整形）
          pane.innerHTML = `<pre style="background:#f6f8fa;padding:.75rem;overflow:auto;border-radius:6px;white-space:pre-wrap;">${
            escapeHtml(data.content || '')
          }</pre>`;
        })
        .catch(err => {
          console.error(err);
          pane.textContent = '読み込みエラー（コード表示）';
        });
    };

    // クリックで切替
    document.getElementById('tab-live').onclick = showLive;
    document.getElementById('tab-code').onclick = showCode;

    // 初期表示（見た目）
    showLive();
    return;
  }

  // 画像
  if (imgExt.includes(ext)) {
    el.classList.remove('md-body');
    el.innerHTML = `<img src="/raw/${encodeURIComponent(path)}" alt="" style="max-width:100%;height:auto;display:block;">`;
    return;
  }
  // PDF
  if (pdfExt.includes(ext)) {
    el.classList.remove('md-body');
    el.innerHTML = `<iframe src="/raw/${encodeURIComponent(path)}#view=FitH" style="width:100%;height:80vh;border:0;"></iframe>`;
    return;
  }
  // 動画
  if (vidExt.includes(ext)) {
    el.classList.remove('md-body');
    el.innerHTML = `<video src="/raw/${encodeURIComponent(path)}" controls style="max-width:100%;height:auto;display:block;"></video>`;
    return;
  }
  // 音声
  if (audExt.includes(ext)) {
    el.classList.remove('md-body');
    el.innerHTML = `<audio src="/raw/${encodeURIComponent(path)}" controls style="width:100%;display:block;"></audio>`;
    return;
  }

  // テキストその他は /preview でそのまま表示
  fetch(`/preview/${encodeURIComponent(path)}`)
    .then(res => res.json())
    .then(data => {
      el.classList.remove('md-body');
      el.textContent = data.content;
    })
    .catch(err => {
      console.error("Fetch error:", err);
      el.textContent = '読み込みエラー（JS側）';
    });
}

// HTMLエスケープ用ユーティリティ（上で使用）
function escapeHtml(str){
  const map = { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' };
  return String(str).replace(/[&<>"']/g, s => map[s]);
}

/* ========= README モーダル ========= */
function openReadme() {
  const subpath = decodeURIComponent(
    window.location.pathname.replace(/^\/browse\/?/, '')
  );
  const url = `/readme?subpath=${encodeURIComponent(subpath)}`;

  const bd = document.getElementById('readme-body');
  const tt = document.getElementById('readme-title');
  bd.innerHTML = '読み込み中…';

  fetch(url)
    .then(r => r.json())
    .then(j => {
      if (!j.ok) {
        bd.textContent = j.error || 'READMEが見つかりません';
        tt.textContent = 'README';
        return;
      }
      tt.textContent = `README - ${j.path}`;
      bd.innerHTML = j.html; // サーバ側で Markdown → HTML 済み
    })
    .catch(e => {
      console.error(e);
      bd.textContent = '通信エラーで取得できませんでした';
      tt.textContent = 'README';
    });

  document.getElementById('readme-backdrop').style.display = 'flex';
}

function closeReadme() {
  document.getElementById('readme-backdrop').style.display = 'none';
}

/* ========= D&D アップロード専用 ========= */
window.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('drop-overlay');
  let dragCounter = 0;

  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    overlay.style.display = 'flex';
  });

  document.addEventListener('dragleave', (e) => {
    dragCounter--;
    if (dragCounter <= 0) overlay.style.display = 'none';
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    overlay.style.display = 'none';
    dragCounter = 0;

    const items = [...(e.dataTransfer.items || [])];
    const files = [...(e.dataTransfer.files || [])];

    // entries が取れるならフォルダ構造も保持してアップロード
    const hasEntries = items.some(it => typeof it.webkitGetAsEntry === 'function' && it.webkitGetAsEntry());
    if (hasEntries) {
      await uploadFilesOrEntries({ items }); // entries 優先
    } else {
      // フォールバック：単発ファイル（Firefox等で必要）
      if (!files.length) {
        alert('アップロードできる項目がありません');
        return;
      }
      await uploadFilesOrEntries({ filesFallback: files });
    }
  });

  // HTMLの onclick から呼ぶためグローバル公開
  window.deletePath = async function(path, isDir) {
    const label = isDir ? 'フォルダ' : 'ファイル';
    const ok = confirm(`${label}「${path}」を削除します。よろしいですか？\n※元に戻せません`);
    if (!ok) return;

    try {
      const res = await fetch('/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subpath: path })
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        alert(`削除に失敗しました: ${json.error || res.statusText}`);
        return;
      }
      location.reload();
    } catch (e) {
      console.error(e);
      alert('通信エラーで削除に失敗しました');
    }
  };
});

/* ========= コア：アップロード送信 ========= */
async function uploadFilesOrEntries({ items = null, filesFallback = null }) {
 // 現在の /browse/ 以下の相対パスを安全に取り出す
  const full = decodeURIComponent(window.location.pathname);
  let currentPath = '';
  if (full === '/browse' || full === '/browse/') {
    currentPath = '';
  } else if (full.startsWith('/browse/')) {
    currentPath = full.slice('/browse/'.length);
  } else {
    currentPath = ''; // ルート '/' や想定外はルートにアップロード
  }

  const formData = new FormData();

  if (items && items.length) {
    // entries（フォルダ対応）
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) {
        await traverseEntry(entry, '', formData);
      }
    }
  } else if (filesFallback && filesFallback.length) {
    // 単発ファイル（webkitRelativePathがあればディレクトリ保持）
    for (const f of filesFallback) {
      const rel = f.webkitRelativePath && f.webkitRelativePath.length > 0
        ? f.webkitRelativePath
        : f.name;
      formData.append('file', f, rel);
    }
  }

  if ([...formData.entries()].length === 0) {
    alert('アップロード対象がありません');
    return;
  }

  try {
    const res = await fetch(`/upload/${encodeURIComponent(currentPath)}`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) {
      const t = await res.text().catch(()=> '');
      alert(`アップロード失敗: ${res.status} ${res.statusText}\n${t}`);
      return;
    }
    location.reload();
  } catch (e) {
    console.error(e);
    alert('アップロードエラー');
  }
}

/* ========= フォルダ再帰（単一定義） ========= */
async function traverseEntry(entry, path, formData) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file(file => {
        const fullPath = path ? `${path}/${file.name}` : file.name;
        formData.append('file', file, fullPath);
        resolve();
      }, () => resolve());
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readAll = () => {
        reader.readEntries(async entries => {
          if (!entries.length) return resolve();
          for (const child of entries) {
            await traverseEntry(child, path ? `${path}/${entry.name}` : entry.name, formData);
          }
          readAll(); // Safari 対策：一度に全部返らないことがある
        }, () => resolve());
      };
      readAll();
    } else {
      resolve();
    }
  });
}
