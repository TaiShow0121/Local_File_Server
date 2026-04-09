/* =============================================================
   Local File Server — script.js (modernized)
   ============================================================= */

/* ========= Theme (Dark Mode) ========= */
function toggleTheme() {
  const html = document.documentElement;
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  document.getElementById('theme-toggle').innerHTML =
    `<span class="icon">${next === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19'}</span>`;
}

function applyStoredTheme() {
  const t = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.innerHTML = `<span class="icon">${t === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19'}</span>`;
}

/* ========= View Toggle (List / Grid) ========= */
let currentView = localStorage.getItem('viewMode') || 'list';
const INTERNAL_ENTRY_MIME = 'application/x-local-file-server-entry';
let activeDraggedEntry = null;

function toggleView() {
  currentView = currentView === 'list' ? 'grid' : 'list';
  localStorage.setItem('viewMode', currentView);
  applyView();
}

function applyView() {
  const fl = document.getElementById('file-list');
  const btn = document.getElementById('view-toggle');
  if (!fl) return;
  if (currentView === 'grid') {
    fl.classList.add('grid-view');
    if (btn) btn.innerHTML = '\uD83D\uDCCB リスト';
  } else {
    fl.classList.remove('grid-view');
    if (btn) btn.innerHTML = '\uD83D\uDD32 グリッド';
  }
}

/* ========= Filter (client-side) ========= */
function filterEntries() {
  const q = (document.getElementById('filter-input').value || '').toLowerCase();
  document.querySelectorAll('.file-entry').forEach(el => {
    const name = (el.dataset.name || '').toLowerCase();
    el.style.display = name.includes(q) ? '' : 'none';
  });
}

/* ========= Sort (client-side) ========= */
function sortEntries() {
  const sel = document.getElementById('sort-select');
  if (!sel) return;
  const [field, dir] = sel.value.split('-');
  const list = document.getElementById('file-list');
  const entries = [...list.querySelectorAll('.file-entry')];
  if (!entries.length) return;

  entries.sort((a, b) => {
    const aIsDir = a.dataset.type === 'folder' ? 0 : 1;
    const bIsDir = b.dataset.type === 'folder' ? 0 : 1;
    if (aIsDir !== bIsDir) return aIsDir - bIsDir;

    let cmp = 0;
    if (field === 'name') {
      cmp = (a.dataset.name || '').localeCompare(b.dataset.name || '', 'ja');
    } else if (field === 'size') {
      cmp = parseSizeStr(a.dataset.size) - parseSizeStr(b.dataset.size);
    } else if (field === 'date') {
      cmp = (a.dataset.mtime || '').localeCompare(b.dataset.mtime || '');
    }
    return dir === 'desc' ? -cmp : cmp;
  });

  entries.forEach(el => list.appendChild(el));
}

function parseSizeStr(s) {
  if (!s) return 0;
  const m = s.match(/([\d.]+)\s*(K|M|G|T|P)?B?/i);
  if (!m) return 0;
  const v = parseFloat(m[1]);
  const u = (m[2] || '').toUpperCase();
  const mult = { '': 1, 'K': 1024, 'M': 1048576, 'G': 1073741824, 'T': 1099511627776 };
  return v * (mult[u] || 1);
}

function isInteractiveTarget(el) {
  if (!el) return false;
  if (el.closest('.file-name')) return false;
  return !!el.closest('input, button, a, label, textarea, select');
}

function clearMoveDropHighlights(exceptEl = null) {
  document.querySelectorAll('.file-entry.drop-target, .folder-drop-target.drag-hover').forEach(el => {
    if (el !== exceptEl) {
      el.classList.remove('drop-target');
      el.classList.remove('drag-hover');
    }
  });
}

function canDropMovedEntry(targetPath) {
  if (!activeDraggedEntry || targetPath == null) return false;
  return activeDraggedEntry.path !== targetPath;
}

async function moveEntry(sourcePath, targetDir) {
  try {
    const res = await fetch('/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath, targetDir })
    });
    const j = await res.json();
    if (!res.ok || !j.ok) {
      showToast('移動失敗: ' + (j.error || ''), 'error');
      return;
    }
    showToast('移動しました', 'success');
    setTimeout(() => location.reload(), 450);
  } catch (e) {
    console.error(e);
    showToast('通信エラー', 'error');
  }
}

function bindMoveDropTarget(el, getTargetPath, hoverClass) {
  if (!el) return;

  const showHover = (e) => {
    const targetPath = getTargetPath();
    if (!canDropMovedEntry(targetPath)) return;
    e.preventDefault();
    e.stopPropagation();
    clearMoveDropHighlights(el);
    el.classList.add(hoverClass);
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  };

  el.addEventListener('dragenter', showHover);
  el.addEventListener('dragover', showHover);
  el.addEventListener('drop', async (e) => {
    const targetPath = getTargetPath();
    if (!canDropMovedEntry(targetPath)) return;
    e.preventDefault();
    e.stopPropagation();
    clearMoveDropHighlights();
    await moveEntry(activeDraggedEntry.path, targetPath);
  });
}

function initMoveDragAndDrop() {
  document.querySelectorAll('.file-entry').forEach(entryEl => {
    const path = entryEl.dataset.path || '';
    const type = entryEl.dataset.type || '';
    if (!path) return;

    entryEl.draggable = true;
    entryEl.addEventListener('dragstart', (e) => {
      if (isInteractiveTarget(e.target)) {
        e.preventDefault();
        return;
      }

      activeDraggedEntry = { path, type };
      clearMoveDropHighlights();
      entryEl.classList.add('dragging');

      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', path);
        try {
          e.dataTransfer.setData(INTERNAL_ENTRY_MIME, path);
        } catch (_) {
          // Some browsers only allow a limited set of drag payloads.
        }
      }
    });

    entryEl.addEventListener('dragend', () => {
      entryEl.classList.remove('dragging');
      clearMoveDropHighlights();
      activeDraggedEntry = null;
    });

    if (type === 'folder') {
      bindMoveDropTarget(entryEl, () => entryEl.dataset.path, 'drop-target');
    }
  });

  document.querySelectorAll('.folder-drop-target').forEach(targetEl => {
    bindMoveDropTarget(targetEl, () => targetEl.dataset.dropPath ?? '', 'drag-hover');
  });
}

function isExternalFileDrag(e) {
  if (activeDraggedEntry) return false;
  const types = [...(e.dataTransfer?.types || [])];
  return types.includes('Files');
}

/* ========= Multi-select & Batch ========= */
function updateBatchBar() {
  const cbs = document.querySelectorAll('.entry-cb:checked');
  const bar = document.getElementById('batch-bar');
  const cnt = document.getElementById('selected-count');
  const main = document.getElementById('main-area');
  if (cbs.length > 0) {
    bar.classList.add('active');
    main.classList.add('has-batch');
    cnt.textContent = `${cbs.length}件選択`;
  } else {
    bar.classList.remove('active');
    main.classList.remove('has-batch');
  }
}

function toggleSelectAll(checked) {
  document.querySelectorAll('.entry-cb').forEach(cb => {
    if (cb.closest('.file-entry').style.display !== 'none') cb.checked = checked;
  });
  updateBatchBar();
}

function clearSelection() {
  document.querySelectorAll('.entry-cb').forEach(cb => cb.checked = false);
  document.getElementById('select-all').checked = false;
  updateBatchBar();
}

function getSelectedPaths() {
  return [...document.querySelectorAll('.entry-cb:checked')].map(cb => cb.dataset.path);
}

async function batchDelete() {
  const paths = getSelectedPaths();
  if (!paths.length) return;
  if (!confirm(`${paths.length}件を削除します。よろしいですか？\n※元に戻せません`)) return;
  try {
    const res = await fetch('/delete-multi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths })
    });
    const j = await res.json();
    if (!j.ok) { showToast('削除エラー: ' + (j.error || ''), 'error'); return; }
    showToast(`${paths.length}件を削除しました`, 'success');
    setTimeout(() => location.reload(), 600);
  } catch (e) { console.error(e); showToast('通信エラー', 'error'); }
}

async function batchDownload() {
  const paths = getSelectedPaths();
  if (!paths.length) return;
  try {
    const res = await fetch('/download-multi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths })
    });
    if (!res.ok) { showToast('ダウンロードエラー', 'error'); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'selected.zip';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('ダウンロード開始', 'success');
  } catch (e) { console.error(e); showToast('通信エラー', 'error'); }
}

/* ========= Delete single ========= */
async function deletePath(path, isDir) {
  const label = isDir ? 'フォルダ' : 'ファイル';
  if (!confirm(`${label}「${path}」を削除します。よろしいですか？\n※元に戻せません`)) return;
  try {
    const res = await fetch('/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subpath: path })
    });
    const j = await res.json();
    if (!res.ok || !j.ok) { showToast('削除失敗: ' + (j.error || ''), 'error'); return; }
    showToast('削除しました', 'success');
    setTimeout(() => location.reload(), 600);
  } catch (e) { console.error(e); showToast('通信エラー', 'error'); }
}

/* ========= Rename ========= */
function openRename(path, oldName) {
  showInputModal('リネーム', '新しい名前', oldName, async (newName) => {
    if (!newName || newName === oldName) return;
    try {
      const res = await fetch('/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: path, newName })
      });
      const j = await res.json();
      if (!j.ok) { showToast('リネーム失敗: ' + (j.error || ''), 'error'); return; }
      showToast('リネームしました', 'success');
      setTimeout(() => location.reload(), 600);
    } catch (e) { console.error(e); showToast('通信エラー', 'error'); }
  });
}

/* ========= Mkdir ========= */
function openMkdir() {
  showInputModal('新規フォルダ作成', 'フォルダ名', '', async (name) => {
    if (!name) return;
    try {
      const res = await fetch('/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: window.__subpath || '', name })
      });
      const j = await res.json();
      if (!j.ok) { showToast('作成失敗: ' + (j.error || ''), 'error'); return; }
      showToast('フォルダを作成しました', 'success');
      setTimeout(() => location.reload(), 600);
    } catch (e) { console.error(e); showToast('通信エラー', 'error'); }
  });
}

/* ========= Input Modal helper ========= */
function showInputModal(title, label, defaultVal, onOk) {
  document.getElementById('input-modal-title').textContent = title;
  document.getElementById('input-modal-label').textContent = label;
  const inp = document.getElementById('input-modal-value');
  inp.value = defaultVal;
  document.getElementById('input-backdrop').style.display = 'flex';
  setTimeout(() => { inp.focus(); inp.select(); }, 50);

  const okBtn = document.getElementById('input-modal-ok');
  const handler = () => {
    closeModal('input-backdrop');
    okBtn.removeEventListener('click', handler);
    onOk(inp.value.trim());
  };
  const newBtn = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newBtn, okBtn);
  newBtn.addEventListener('click', handler);
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

/* ========= Toast Notification ========= */
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '\u2705', error: '\u274C', info: '\u2139\uFE0F' };
  toast.innerHTML = `<span>${icons[type] || ''}</span> ${escapeHtml(message)}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut .3s cubic-bezier(.4,0,.2,1) forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* ========= Context Menu ========= */
function showContextMenu(e, path, name, type) {
  e.preventDefault();
  const menu = document.getElementById('context-menu');
  const isFile = type === 'file';

  let items = '';
  if (isFile) {
    items += `<div class="context-menu-item" onclick="previewFile('${path}'); addRecent('${path}','${name}'); hideContextMenu();">\uD83D\uDC41 プレビュー</div>`;
    items += `<div class="context-menu-item" onclick="window.location.href='/download/${path}'; hideContextMenu();">\uD83D\uDCBE ダウンロード</div>`;
  } else {
    items += `<div class="context-menu-item" onclick="window.location.href='/browse/${path}'; hideContextMenu();">\uD83D\uDCC2 開く</div>`;
    items += `<div class="context-menu-item" onclick="window.location.href='/download-folder/${path}'; hideContextMenu();">\uD83D\uDCE6 ZIPダウンロード</div>`;
  }
  items += `<div class="context-menu-item" onclick="openRename('${path}','${name}'); hideContextMenu();">\u270F\uFE0F リネーム</div>`;
  items += `<div class="context-menu-item" onclick="toggleFav('${path}','${name}','${type}'); hideContextMenu();">\u2B50 お気に入り</div>`;
  items += `<div class="context-menu-sep"></div>`;
  items += `<div class="context-menu-item danger" onclick="deletePath('${path}', ${!isFile}); hideContextMenu();">\uD83D\uDDD1 削除</div>`;

  menu.innerHTML = items;
  menu.style.display = 'block';

  // Position
  const mx = e.clientX, my = e.clientY;
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = (mx + mw > window.innerWidth ? mx - mw : mx) + 'px';
  menu.style.top = (my + mh > window.innerHeight ? my - mh : my) + 'px';
}

function hideContextMenu() {
  document.getElementById('context-menu').style.display = 'none';
}

/* ========= Preview ========= */
function previewFile(path) {
  const el = document.getElementById('preview');
  const fileName = (path.split('/').pop() || path).toLowerCase();
  const dotIndex = fileName.lastIndexOf('.');
  const ext = dotIndex >= 0 ? fileName.slice(dotIndex + 1) : '';

  const imgExt = ['png','jpg','jpeg','gif','webp','bmp','svg'];
  const vidExt = ['mp4','webm','ogv','ogg'];
  const audExt = ['mp3','wav','ogg','m4a','aac'];
  const pdfExt = ['pdf'];
  const mdExt  = ['md','markdown','mdown','mkd','mkdown'];
  const htmlExt= ['html','htm'];
  const xlsExt = ['xlsx','xls','xlsm','xlsb','ods'];
  const docExt = ['docx'];
  const pptExt = ['pptx'];
  const zipExt = ['zip','jar','war','apk'];
  const archiveExt = ['tar','gz','tgz','bz2','xz','rar','7z','lz','zst'];
  const blockedBinaryExt = ['exe','msi','dll','bin','iso','img','class','o','obj','so','dylib'];
  const textExt= ['txt','py','js','ts','tsx','jsx','css','json','xml','csv','yaml','yml',
                   'toml','ini','cfg','bat','sh','log','java','c','cpp','h','rs','go',
                   'rb','php','sql','r','m','vue','svelte','cs','csproj','sln','razor',
                   'cshtml','ps1','env','properties','conf','service','gradle'];
  const textLikeNames = ['dockerfile','makefile','readme','license','.env'];
  const maxTextPreviewBytes = 2 * 1024 * 1024;

  // Highlight selected entry
  document.querySelectorAll('.file-entry').forEach(e => e.classList.remove('selected'));
  const entry = document.querySelector(`.file-entry[data-path="${CSS.escape(path)}"]`);
  if (entry) entry.classList.add('selected');
  const sizeBytes = Number(entry?.dataset.sizeBytes || 0);
  const isKnownText = textExt.includes(ext) || textLikeNames.includes(fileName);

  const showPreviewBlocked = (message) => {
    el.classList.remove('md-body');
    el.innerHTML = `<div style="padding:2rem;text-align:center;">
      <div style="font-size:3.5rem;margin-bottom:1rem;">\uD83D\uDCC4</div>
      <p style="font-size:1rem;font-weight:600;margin-bottom:.5rem;">${escapeHtml(path.split('/').pop())}</p>
      <p style="color:var(--text-secondary);margin-bottom:1rem;font-size:.88rem;">${escapeHtml(message)}</p>
      <a class="btn btn-accent" href="/download/${encodeURIComponent(path)}" download>\uD83D\uDCBE ダウンロード</a>
    </div>`;
  };

  if (blockedBinaryExt.includes(ext)) {
    showPreviewBlocked('実行ファイルやバイナリはプレビューしません');
    return;
  }

  if (!ext && !isKnownText && sizeBytes > 0) {
    showPreviewBlocked('この形式はプレビュー対象外です');
    return;
  }

  // ZIP archives - show folder structure
  if (zipExt.includes(ext)) {
    previewZip(path, el);
    return;
  }

  // Other archives - download only
  if (archiveExt.includes(ext)) {
    el.classList.remove('md-body');
    el.innerHTML = `<div style="padding:2rem;text-align:center;">
      <div style="font-size:4rem;margin-bottom:1rem;">\uD83D\uDDDC</div>
      <p style="font-size:1rem;font-weight:600;margin-bottom:.5rem;">${escapeHtml(path.split('/').pop())}</p>
      <p style="color:var(--text-secondary);margin-bottom:1rem;font-size:.88rem;">この形式のプレビューには対応していません</p>
      <a class="btn btn-accent" href="/download/${encodeURIComponent(path)}" download>\uD83D\uDCBE ダウンロード</a>
    </div>`;
    return;
  }

  // Excel
  if (xlsExt.includes(ext)) {
    previewExcel(path, el);
    return;
  }

  // Word
  if (docExt.includes(ext)) {
    previewWord(path, el);
    return;
  }

  // PowerPoint (basic)
  if (pptExt.includes(ext)) {
    previewPptx(path, el);
    return;
  }

  // Markdown
  if (mdExt.includes(ext)) {
    el.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);">読み込み中…</div>';
    fetch(`/render-md/${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(j => {
        if (!j.ok) throw new Error(j.error || 'failed');
        el.classList.add('md-body');
        el.innerHTML = `<div style="margin-bottom:.5rem;">
          <button class="btn btn-sm" onclick="editFile('${path}')">\u270F\uFE0F 編集</button>
        </div>` + j.html;
      })
      .catch(() => { el.textContent = 'Markdownの表示に失敗しました'; });
    return;
  }

  // HTML
  if (htmlExt.includes(ext)) {
    el.classList.remove('md-body');
    el.innerHTML = `
      <div style="display:flex;gap:.5rem;margin-bottom:.5rem;">
        <button class="btn btn-sm" id="tab-live">見た目</button>
        <button class="btn btn-sm" id="tab-code">コード</button>
        <button class="btn btn-sm" onclick="editFile('${path}')">\u270F\uFE0F 編集</button>
      </div>
      <div id="preview-pane"></div>`;
    const pane = document.getElementById('preview-pane');
    const showLive = () => {
      pane.innerHTML = `<iframe src="/raw/${encodeURIComponent(path)}"
        style="width:100%;height:75vh;border:1px solid var(--border);border-radius:8px;"
        sandbox="allow-scripts allow-forms allow-popups"></iframe>`;
    };
    const showCode = () => {
      pane.textContent = '読み込み中…';
      fetch(`/preview/${encodeURIComponent(path)}`)
        .then(r => r.json())
        .then(d => {
          pane.innerHTML = `<pre style="background:var(--code-bg);padding:.75rem;overflow:auto;border-radius:8px;white-space:pre-wrap;">${escapeHtml(d.content||'')}</pre>`;
        })
        .catch(() => { pane.textContent = '読み込みエラー'; });
    };
    document.getElementById('tab-live').onclick = showLive;
    document.getElementById('tab-code').onclick = showCode;
    showLive();
    return;
  }

  // Image
  if (imgExt.includes(ext)) {
    el.classList.remove('md-body');
    el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;"><img src="/raw/${encodeURIComponent(path)}" alt="" style="max-width:100%;max-height:90vh;height:auto;display:block;border-radius:8px;box-shadow:var(--shadow);"></div>`;
    return;
  }

  // PDF
  if (pdfExt.includes(ext)) {
    el.classList.remove('md-body');
    el.innerHTML = `<iframe src="/raw/${encodeURIComponent(path)}#view=FitH" style="width:100%;height:calc(100% - 8px);border:0;border-radius:8px;"></iframe>`;
    return;
  }

  // Video
  if (vidExt.includes(ext)) {
    el.classList.remove('md-body');
    el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;"><video src="/raw/${encodeURIComponent(path)}" controls style="max-width:100%;max-height:90vh;border-radius:8px;box-shadow:var(--shadow);"></video></div>`;
    return;
  }

  // Audio
  if (audExt.includes(ext)) {
    el.classList.remove('md-body');
    el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;"><div style="text-align:center;"><div style="font-size:4rem;margin-bottom:1rem;">\uD83C\uDFB5</div><audio src="/raw/${encodeURIComponent(path)}" controls style="width:320px;display:block;"></audio></div></div>`;
    return;
  }

  if (isKnownText && sizeBytes > maxTextPreviewBytes) {
    showPreviewBlocked(`サイズが大きいためプレビューしません（${Math.round(sizeBytes / 1024 / 1024)}MB）`);
    return;
  }

  if (!isKnownText) {
    showPreviewBlocked('この形式はプレビュー対象外です');
    return;
  }

  // Text (with edit button)
  el.classList.remove('md-body');
  el.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);">読み込み中…</div>';
  fetch(`/preview/${encodeURIComponent(path)}`)
    .then(r => r.json())
    .then(data => {
      const isTextEditable = textExt.includes(ext) || mdExt.includes(ext);
      const editBtn = isTextEditable
        ? `<div style="margin-bottom:.5rem;"><button class="btn btn-sm" onclick="editFile('${path}')">\u270F\uFE0F 編集</button></div>`
        : '';
      el.innerHTML = editBtn + `<pre style="background:var(--code-bg);padding:1rem;overflow:auto;border-radius:8px;white-space:pre-wrap;margin:0;border:1px solid var(--border);font-size:.88rem;line-height:1.6;">${escapeHtml(data.content||'')}</pre>`;
    })
    .catch(() => { el.textContent = '読み込みエラー'; });
}

/* ========= Text Editor ========= */
function editFile(path) {
  const el = document.getElementById('preview');
  el.classList.remove('md-body');
  el.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);">読み込み中…</div>';

  fetch(`/preview/${encodeURIComponent(path)}`)
    .then(r => r.json())
    .then(data => {
      el.innerHTML = `
        <div style="display:flex;gap:.5rem;margin-bottom:.5rem;align-items:center;">
          <button class="btn btn-sm btn-accent" id="save-btn" onclick="saveFile('${path}')">\uD83D\uDCBE 保存</button>
          <button class="btn btn-sm" onclick="previewFile('${path}')">キャンセル</button>
          <span id="save-status" style="font-size:.85rem;color:var(--text-secondary);"></span>
        </div>
        <textarea id="edit-area" style="width:100%;height:calc(100% - 50px);min-height:400px;
          font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
          font-size:.9rem;background:var(--code-bg);color:var(--text);
          border:1px solid var(--border);border-radius:8px;padding:.75rem;
          resize:vertical;tab-size:2;line-height:1.6;">${escapeHtml(data.content || '')}</textarea>`;

      const area = document.getElementById('edit-area');
      area.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          saveFile(path);
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          const s = area.selectionStart, end = area.selectionEnd;
          area.value = area.value.substring(0, s) + '  ' + area.value.substring(end);
          area.selectionStart = area.selectionEnd = s + 2;
        }
      });
    })
    .catch(() => { el.textContent = '読み込みエラー'; });
}

async function saveFile(path) {
  const area = document.getElementById('edit-area');
  const status = document.getElementById('save-status');
  if (!area) return;
  status.textContent = '保存中…';
  try {
    const res = await fetch('/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subpath: path, content: area.value })
    });
    const j = await res.json();
    if (!j.ok) { status.textContent = '保存失敗: ' + (j.error || ''); return; }
    status.textContent = '';
    showToast('保存しました', 'success');
  } catch (e) {
    console.error(e);
    status.textContent = '通信エラー';
  }
}

/* ========= Search (full-text) ========= */
async function doSearch() {
  const q = (document.getElementById('search-input').value || '').trim();
  if (!q) return;

  const panel = document.getElementById('side-panel');
  const body = document.getElementById('side-panel-body');
  const title = document.getElementById('side-panel-title');
  title.textContent = `検索: "${q}"`;
  body.innerHTML = '<div style="padding:1rem;color:var(--text-secondary);">検索中…</div>';
  panel.classList.add('active');

  try {
    const res = await fetch(`/search?q=${encodeURIComponent(q)}&scope=${encodeURIComponent(window.__subpath||'')}`);
    const j = await res.json();
    if (!j.ok || !j.results.length) {
      body.innerHTML = '<div style="padding:1rem;color:var(--text-secondary);">見つかりませんでした</div>';
      return;
    }
    body.innerHTML = j.results.map(r => `
      <div class="search-result">
        <div class="search-result-path" onclick="${r.type === 'file'
          ? `previewFile('${r.path}'); addRecent('${r.path}','${r.name}')`
          : `location.href='/browse/${r.path}'`}">
          ${r.type === 'folder' ? '\uD83D\uDCC1' : '\uD83D\uDCC4'} ${escapeHtml(r.path)}
          ${r.nameMatch ? '<span class="search-badge">名前</span>' : ''}
          ${r.contentMatch ? '<span class="search-badge">内容</span>' : ''}
        </div>
        ${r.snippet ? `<div class="search-result-snippet">${escapeHtml(r.snippet)}</div>` : ''}
      </div>
    `).join('');
  } catch (e) {
    console.error(e);
    body.innerHTML = '<div style="padding:1rem;color:var(--danger);">検索エラー</div>';
  }
}

function closeSidePanel() {
  document.getElementById('side-panel').classList.remove('active');
}

/* ========= Favorites (server-side, per IP) ========= */
let _favsCache = [];

async function fetchFavs() {
  try {
    const res = await fetch('/api/favs');
    const j = await res.json();
    if (j.ok) _favsCache = j.favs || [];
  } catch (e) { console.error('fetchFavs error', e); }
  return _favsCache;
}

async function toggleFav(path, name, type) {
  const isFav = _favsCache.some(f => f.path === path);
  try {
    const res = await fetch('/api/favs', {
      method: isFav ? 'DELETE' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, name, type })
    });
    const j = await res.json();
    if (j.ok) _favsCache = j.favs || [];
  } catch (e) { console.error('toggleFav error', e); }
  refreshStars();
  showToast(isFav ? 'お気に入りから削除' : 'お気に入りに追加', 'info', 1500);
}

function refreshStars() {
  const favPaths = new Set(_favsCache.map(f => f.path));
  document.querySelectorAll('.star-btn').forEach(btn => {
    const p = btn.dataset.path;
    if (favPaths.has(p)) {
      btn.textContent = '\u2605';
      btn.classList.add('active');
    } else {
      btn.textContent = '\u2606';
      btn.classList.remove('active');
    }
  });
}

async function showFavorites() {
  await fetchFavs();
  const panel = document.getElementById('side-panel');
  const body = document.getElementById('side-panel-body');
  document.getElementById('side-panel-title').textContent = '\u2B50 お気に入り';
  panel.classList.add('active');

  if (!_favsCache.length) {
    body.innerHTML = '<div style="padding:1rem;color:var(--text-secondary);">お気に入りがありません<br>\u2606をクリックして追加</div>';
    return;
  }
  body.innerHTML = _favsCache.map(f => `
    <div class="side-panel-item" onclick="${f.type === 'file'
      ? `previewFile('${f.path}'); addRecent('${f.path}','${f.name}')`
      : `location.href='/browse/${f.path}'`}">
      ${f.type === 'folder' ? '\uD83D\uDCC1' : '\uD83D\uDCC4'} ${escapeHtml(f.name)}
    </div>
  `).join('');
}

/* ========= Recent Files (localStorage) ========= */
function getRecent() {
  try { return JSON.parse(localStorage.getItem('recent') || '[]'); } catch { return []; }
}

function addRecent(path, name) {
  let recent = getRecent();
  recent = recent.filter(r => r.path !== path);
  recent.unshift({ path, name, time: Date.now() });
  if (recent.length > 30) recent = recent.slice(0, 30);
  localStorage.setItem('recent', JSON.stringify(recent));
}

function showRecent() {
  const recent = getRecent();
  const panel = document.getElementById('side-panel');
  const body = document.getElementById('side-panel-body');
  document.getElementById('side-panel-title').textContent = '\uD83D\uDD50 最近使ったファイル';
  panel.classList.add('active');

  if (!recent.length) {
    body.innerHTML = '<div style="padding:1rem;color:var(--text-secondary);">履歴がありません</div>';
    return;
  }
  body.innerHTML = recent.map(r => {
    const ago = timeAgo(r.time);
    return `
      <div class="side-panel-item" onclick="previewFile('${r.path}')">
        \uD83D\uDCC4 ${escapeHtml(r.name)}
        <span style="margin-left:auto;font-size:.75rem;color:var(--text-secondary);">${ago}</span>
      </div>`;
  }).join('');
}

function timeAgo(ts) {
  const d = Date.now() - ts;
  if (d < 60000) return '数秒前';
  if (d < 3600000) return `${Math.floor(d/60000)}分前`;
  if (d < 86400000) return `${Math.floor(d/3600000)}時間前`;
  return `${Math.floor(d/86400000)}日前`;
}

/* ========= README Modal ========= */
function openReadme() {
  const subpath = window.__subpath || '';
  const bd = document.getElementById('readme-body');
  const tt = document.getElementById('readme-title');
  bd.innerHTML = '読み込み中…';

  fetch(`/readme?subpath=${encodeURIComponent(subpath)}`)
    .then(r => r.json())
    .then(j => {
      if (!j.ok) { bd.textContent = j.error || 'READMEが見つかりません'; return; }
      tt.textContent = `README - ${j.path}`;
      bd.innerHTML = j.html;
    })
    .catch(() => { bd.textContent = '通信エラー'; });

  document.getElementById('readme-backdrop').style.display = 'flex';
}

/* ========= QR Code ========= */
async function openQR() {
  document.getElementById('qr-backdrop').style.display = 'flex';
  const urlEl = document.getElementById('qr-url');
  const canvas = document.getElementById('qr-canvas');
  urlEl.textContent = '取得中…';

  try {
    const res = await fetch('/server-info');
    const j = await res.json();
    urlEl.textContent = j.url;
    drawQR(canvas, j.url);
  } catch (e) {
    urlEl.textContent = 'エラー: サーバー情報を取得できません';
  }
}

function drawQR(canvas, text) {
  const ctx = canvas.getContext('2d');
  const size = 200;
  canvas.width = size;
  canvas.height = size;

  const modules = generateQRModules(text);
  if (!modules) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#333';
    ctx.font = '11px monospace';
    ctx.fillText('QR生成エラー', 10, 100);
    ctx.fillText(text, 10, 120);
    return;
  }
  const cellSize = Math.floor(size / modules.length);
  const offset = Math.floor((size - cellSize * modules.length) / 2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  for (let r = 0; r < modules.length; r++) {
    for (let c = 0; c < modules[r].length; c++) {
      if (modules[r][c]) {
        ctx.fillRect(offset + c * cellSize, offset + r * cellSize, cellSize, cellSize);
      }
    }
  }
}

function generateQRModules(text) {
  try {
    const len = text.length;
    let version, size;
    if (len <= 17) { version = 1; size = 21; }
    else if (len <= 32) { version = 2; size = 25; }
    else if (len <= 53) { version = 3; size = 29; }
    else { version = 4; size = 33; }

    const modules = Array.from({ length: size }, () => Array(size).fill(false));

    const addFinder = (r, c) => {
      for (let dr = -1; dr <= 7; dr++) {
        for (let dc = -1; dc <= 7; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
          if (dr === -1 || dr === 7 || dc === -1 || dc === 7) {
            modules[rr][cc] = false;
          } else if (dr === 0 || dr === 6 || dc === 0 || dc === 6) {
            modules[rr][cc] = true;
          } else if (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4) {
            modules[rr][cc] = true;
          } else {
            modules[rr][cc] = false;
          }
        }
      }
    };
    addFinder(0, 0);
    addFinder(0, size - 7);
    addFinder(size - 7, 0);

    for (let i = 8; i < size - 8; i++) {
      modules[6][i] = i % 2 === 0;
      modules[i][6] = i % 2 === 0;
    }

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if ((r < 9 && c < 9) || (r < 9 && c >= size - 8) || (r >= size - 8 && c < 9)) continue;
        if (r === 6 || c === 6) continue;
        const byteIdx = Math.floor((r * size + c) / 8) % text.length;
        const bitIdx = (r * size + c) % 8;
        const byte = text.charCodeAt(byteIdx);
        modules[r][c] = ((byte >> (7 - bitIdx)) & 1) === 1;
        if ((r + c) % 2 === 0) modules[r][c] = !modules[r][c];
      }
    }

    return modules;
  } catch (e) {
    return null;
  }
}

/* ========= ZIP Archive Preview ========= */
async function previewZip(path, el) {
  el.classList.remove('md-body');
  el.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);">\uD83D\uDDDC ZIPファイルを読み込み中…</div>';

  try {
    const res = await fetch(`/raw/${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error('fetch failed');
    const buf = await res.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);

    // Build tree structure from flat file list
    const tree = {};
    let totalFiles = 0;
    let totalSize = 0;

    zip.forEach((relativePath, zipEntry) => {
      const parts = relativePath.split('/').filter(p => p);
      let current = tree;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i === parts.length - 1 && !zipEntry.dir) {
          // File
          if (!current.__files__) current.__files__ = [];
          current.__files__.push({
            name: part,
            size: zipEntry._data ? (zipEntry._data.uncompressedSize || 0) : 0,
            date: zipEntry.date
          });
          totalFiles++;
          totalSize += zipEntry._data ? (zipEntry._data.uncompressedSize || 0) : 0;
        } else {
          // Directory
          if (!current[part]) current[part] = {};
          current = current[part];
        }
      }
    });

    const treeHtml = buildArchiveTreeHtml(tree, 0);
    const fileName = path.split('/').pop();

    el.innerHTML = `
      <div style="margin-bottom:.5rem;display:flex;gap:.5rem;align-items:center;">
        <a class="btn btn-sm" href="/download/${encodeURIComponent(path)}" download>\uD83D\uDCBE ダウンロード</a>
        <span style="font-size:.82rem;color:var(--text-muted);">${escapeHtml(fileName)}</span>
      </div>
      <div class="archive-info">
        <span>\uD83D\uDCC4 ${totalFiles} ファイル</span>
        <span>\uD83D\uDCBE ${humanSize(totalSize)}</span>
        <span>\uD83D\uDCC1 ${Object.keys(tree).filter(k => k !== '__files__').length} フォルダ</span>
      </div>
      <div class="archive-tree">${treeHtml}</div>`;
  } catch (e) {
    console.error('ZIP preview error:', e);
    el.innerHTML = `<div style="padding:2rem;text-align:center;">
      <p style="color:var(--danger);margin-bottom:.5rem;">ZIPプレビューに失敗しました</p>
      <a class="btn btn-sm" href="/download/${encodeURIComponent(path)}" download>\uD83D\uDCBE ダウンロードして開く</a>
    </div>`;
  }
}

function buildArchiveTreeHtml(node, depth) {
  let html = '';
  // Folders first
  const folders = Object.keys(node).filter(k => k !== '__files__').sort();
  for (const folder of folders) {
    const childCount = countTreeItems(node[folder]);
    html += `<div class="archive-tree-folder">
      <div class="archive-tree-toggle" onclick="this.parentElement.classList.toggle('collapsed')">
        <span class="arrow">\u25BC</span>
        <span class="tree-icon">\uD83D\uDCC1</span>
        <span class="tree-name">${escapeHtml(folder)}</span>
        <span class="tree-size">${childCount}項目</span>
      </div>
      <div class="archive-tree-children">
        ${buildArchiveTreeHtml(node[folder], depth + 1)}
      </div>
    </div>`;
  }
  // Files
  const files = (node.__files__ || []).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  for (const file of files) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const icon = getFileIcon(ext);
    html += `<div class="archive-tree-item">
      <span class="tree-icon">${icon}</span>
      <span class="tree-name">${escapeHtml(file.name)}</span>
      <span class="tree-size">${humanSize(file.size)}</span>
    </div>`;
  }
  return html;
}

function countTreeItems(node) {
  let count = (node.__files__ || []).length;
  for (const k of Object.keys(node)) {
    if (k !== '__files__') count += countTreeItems(node[k]) + 1;
  }
  return count;
}

function getFileIcon(ext) {
  const icons = {
    'png':'\uD83D\uDDBC','jpg':'\uD83D\uDDBC','jpeg':'\uD83D\uDDBC','gif':'\uD83D\uDDBC','webp':'\uD83D\uDDBC','svg':'\uD83D\uDDBC','bmp':'\uD83D\uDDBC',
    'mp4':'\uD83C\uDFA5','webm':'\uD83C\uDFA5','mov':'\uD83C\uDFA5','avi':'\uD83C\uDFA5',
    'mp3':'\uD83C\uDFB5','wav':'\uD83C\uDFB5','ogg':'\uD83C\uDFB5','m4a':'\uD83C\uDFB5',
    'pdf':'\uD83D\uDCC4','doc':'\uD83D\uDCC4','docx':'\uD83D\uDCC4',
    'xls':'\uD83D\uDCCA','xlsx':'\uD83D\uDCCA',
    'ppt':'\uD83D\uDCCA','pptx':'\uD83D\uDCCA',
    'zip':'\uD83D\uDDDC','rar':'\uD83D\uDDDC','7z':'\uD83D\uDDDC','tar':'\uD83D\uDDDC','gz':'\uD83D\uDDDC',
    'py':'\uD83D\uDC0D','js':'\uD83D\uDFE8','ts':'\uD83D\uDD35','html':'\uD83C\uDF10','css':'\uD83C\uDFA8',
    'json':'\uD83D\uDD27','xml':'\uD83D\uDD27','yaml':'\uD83D\uDD27','yml':'\uD83D\uDD27',
    'exe':'\u2699\uFE0F','msi':'\u2699\uFE0F','bat':'\u2699\uFE0F','sh':'\u2699\uFE0F',
  };
  return icons[ext] || '\uD83D\uDCC4';
}

function humanSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

/* ========= Excel Preview ========= */
async function previewExcel(path, el) {
  el.classList.remove('md-body');
  el.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);">\uD83D\uDCCA Excelファイルを読み込み中…</div>';

  try {
    const res = await fetch(`/raw/${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error('fetch failed');
    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellStyles: true });

    if (!wb.SheetNames.length) {
      el.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);">シートが見つかりません</div>';
      return;
    }

    // Build tabs
    let tabsHtml = '<div class="excel-tabs">';
    wb.SheetNames.forEach((name, i) => {
      tabsHtml += `<div class="excel-tab${i === 0 ? ' active' : ''}" onclick="switchExcelSheet(this, ${i})">${escapeHtml(name)}</div>`;
    });
    tabsHtml += '</div>';

    // Build sheets
    let sheetsHtml = '';
    wb.SheetNames.forEach((name, i) => {
      const ws = wb.Sheets[name];
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      const rowCount = range.e.r - range.s.r + 1;
      const colCount = range.e.c - range.s.c + 1;

      let tableHtml = '<table><thead><tr><th></th>';
      // Column headers (A, B, C, ...)
      for (let c = range.s.c; c <= range.e.c; c++) {
        tableHtml += `<th>${colToLetter(c)}</th>`;
      }
      tableHtml += '</tr></thead><tbody>';

      // Merged cells
      const merges = ws['!merges'] || [];

      for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 999); r++) {
        tableHtml += `<tr><td class="row-num">${r + 1}</td>`;
        for (let c = range.s.c; c <= range.e.c; c++) {
          // Check if this cell is hidden by a merge
          const skipMerge = merges.some(m =>
            r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c &&
            !(r === m.s.r && c === m.s.c)
          );
          if (skipMerge) continue;

          // Check if this cell starts a merge
          const merge = merges.find(m => m.s.r === r && m.s.c === c);
          let attrs = '';
          if (merge) {
            const rs = merge.e.r - merge.s.r + 1;
            const cs = merge.e.c - merge.s.c + 1;
            if (rs > 1) attrs += ` rowspan="${rs}"`;
            if (cs > 1) attrs += ` colspan="${cs}"`;
          }

          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[addr];
          let val = '';
          if (cell) {
            if (cell.w) val = cell.w;
            else if (cell.v !== undefined) val = String(cell.v);
          }
          tableHtml += `<td${attrs}>${escapeHtml(val)}</td>`;
        }
        tableHtml += '</tr>';
      }
      tableHtml += '</tbody></table>';

      const moreRows = rowCount > 1000 ? `<div style="padding:.5rem;color:var(--warning);font-size:.82rem;">※ 先頭1000行のみ表示 (全${rowCount}行)</div>` : '';

      sheetsHtml += `<div class="excel-sheet" id="excel-sheet-${i}" style="${i > 0 ? 'display:none;' : ''}">
        ${tableHtml}${moreRows}
      </div>`;

      // Info for first sheet
      if (i === 0) {
        sheetsHtml += `<div class="excel-info">
          <span>\uD83D\uDCCA ${wb.SheetNames.length}シート</span>
          <span>\uD83D\uDCC4 ${rowCount}行 × ${colCount}列</span>
        </div>`;
      }
    });

    el.innerHTML = `
      <div style="margin-bottom:.5rem;display:flex;gap:.5rem;align-items:center;">
        <a class="btn btn-sm" href="/download/${encodeURIComponent(path)}" download>\uD83D\uDCBE ダウンロード</a>
        <span style="font-size:.82rem;color:var(--text-muted);">${escapeHtml(path.split('/').pop())}</span>
      </div>
      <div class="excel-preview">${tabsHtml}${sheetsHtml}</div>`;
  } catch (e) {
    console.error('Excel preview error:', e);
    el.innerHTML = `<div style="padding:2rem;text-align:center;">
      <p style="color:var(--danger);margin-bottom:.5rem;">Excelプレビューに失敗しました</p>
      <a class="btn btn-sm" href="/download/${encodeURIComponent(path)}" download>\uD83D\uDCBE ダウンロードして開く</a>
    </div>`;
  }
}

function switchExcelSheet(tabEl, index) {
  document.querySelectorAll('.excel-tab').forEach(t => t.classList.remove('active'));
  tabEl.classList.add('active');
  document.querySelectorAll('.excel-sheet').forEach(s => s.style.display = 'none');
  const sheet = document.getElementById(`excel-sheet-${index}`);
  if (sheet) sheet.style.display = '';
}

function colToLetter(c) {
  let s = '';
  c++;
  while (c > 0) {
    c--;
    s = String.fromCharCode(65 + (c % 26)) + s;
    c = Math.floor(c / 26);
  }
  return s;
}

/* ========= Word (docx) Preview ========= */
async function previewWord(path, el) {
  el.classList.remove('md-body');
  el.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);">\uD83D\uDCC4 Wordファイルを読み込み中…</div>';

  try {
    const res = await fetch(`/raw/${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error('fetch failed');
    const buf = await res.arrayBuffer();

    const result = await mammoth.convertToHtml({ arrayBuffer: buf }, {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
      ]
    });

    el.innerHTML = `
      <div style="margin-bottom:.5rem;display:flex;gap:.5rem;align-items:center;">
        <a class="btn btn-sm" href="/download/${encodeURIComponent(path)}" download>\uD83D\uDCBE ダウンロード</a>
        <span style="font-size:.82rem;color:var(--text-muted);">${escapeHtml(path.split('/').pop())}</span>
        ${result.messages.length ? `<span style="font-size:.75rem;color:var(--warning);">\u26A0 ${result.messages.length}件の警告</span>` : ''}
      </div>
      <div class="docx-preview">${result.value}</div>`;
  } catch (e) {
    console.error('Word preview error:', e);
    el.innerHTML = `<div style="padding:2rem;text-align:center;">
      <p style="color:var(--danger);margin-bottom:.5rem;">Wordプレビューに失敗しました</p>
      <a class="btn btn-sm" href="/download/${encodeURIComponent(path)}" download>\uD83D\uDCBE ダウンロードして開く</a>
    </div>`;
  }
}

/* ========= PowerPoint (pptx) Preview ========= */
async function previewPptx(path, el) {
  el.classList.remove('md-body');
  el.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);">\uD83D\uDCCA PowerPointを読み込み中…</div>';

  try {
    const res = await fetch(`/raw/${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error('fetch failed');
    const buf = await res.arrayBuffer();

    // Use JSZip (bundled in SheetJS) to extract slide text
    const zip = await new Promise((resolve, reject) => {
      try {
        // SheetJS includes a zip reader we can leverage
        const wb = XLSX.read(buf, { type: 'array', bookSheets: true });
        resolve(wb);
      } catch (e) { reject(e); }
    }).catch(() => null);

    // Fallback: extract text from pptx XML using basic zip parsing
    // Since we can't easily parse pptx without a dedicated lib, show download option
    el.innerHTML = `<div style="padding:2rem;text-align:center;">
      <div style="font-size:4rem;margin-bottom:1rem;">\uD83D\uDCCA</div>
      <p style="font-size:1rem;font-weight:600;margin-bottom:.5rem;">${escapeHtml(path.split('/').pop())}</p>
      <p style="color:var(--text-secondary);margin-bottom:1rem;font-size:.88rem;">PowerPointのプレビューは現在限定的です</p>
      <a class="btn btn-accent" href="/download/${encodeURIComponent(path)}" download>\uD83D\uDCBE ダウンロードして開く</a>
    </div>`;
  } catch (e) {
    console.error('PPTX preview error:', e);
    el.innerHTML = `<div style="padding:2rem;text-align:center;">
      <p style="color:var(--danger);margin-bottom:.5rem;">プレビューに失敗しました</p>
      <a class="btn btn-sm" href="/download/${encodeURIComponent(path)}" download>\uD83D\uDCBE ダウンロードして開く</a>
    </div>`;
  }
}

/* ========= HTML escape ========= */
function escapeHtml(str) {
  const map = { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' };
  return String(str).replace(/[&<>"']/g, s => map[s]);
}

/* ========= File Upload via Button ========= */
function handleFileUpload(files) {
  if (!files || !files.length) return;
  uploadFilesOrEntries({ filesFallback: [...files] });
  // Reset the input so the same file can be re-selected
  document.getElementById('upload-input').value = '';
}

/* ========= Panel Resizer ========= */
function initResizer() {
  const resizer = document.getElementById('panel-resizer');
  const fileList = document.getElementById('file-list');
  if (!resizer || !fileList) return;

  let startX, startWidth;

  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = fileList.offsetWidth;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (e) => {
      const dx = e.clientX - startX;
      const newWidth = Math.max(240, Math.min(startWidth + dx, window.innerWidth * 0.8));
      fileList.style.width = newWidth + 'px';
    };

    const onUp = () => {
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/* ========= Keyboard Shortcuts ========= */
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ctrl+F: focus filter
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      const filter = document.getElementById('filter-input');
      if (filter && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        filter.focus();
        filter.select();
      }
    }
    // Escape: close modals, context menu, side panel
    if (e.key === 'Escape') {
      hideContextMenu();
      closeSidePanel();
      ['readme-backdrop', 'input-backdrop', 'qr-backdrop'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.style.display === 'flex') closeModal(id);
      });
    }
  });
}

/* ========= D&D Upload with Progress ========= */
window.addEventListener('DOMContentLoaded', () => {
  applyStoredTheme();
  applyView();
  initMoveDragAndDrop();
  initResizer();
  initKeyboardShortcuts();
  fetchFavs().then(() => refreshStars());

  // Close context menu on click elsewhere
  document.addEventListener('click', () => hideContextMenu());

  const overlay = document.getElementById('drop-overlay');
  let dragCounter = 0;

  document.addEventListener('dragenter', (e) => {
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    dragCounter++;
    overlay.style.display = 'flex';
  });
  document.addEventListener('dragleave', () => {
    if (activeDraggedEntry) return;
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter <= 0) overlay.style.display = 'none';
  });
  document.addEventListener('dragover', (e) => {
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('drop', async (e) => {
    if (activeDraggedEntry) {
      clearMoveDropHighlights();
      activeDraggedEntry = null;
      overlay.style.display = 'none';
      dragCounter = 0;
      return;
    }
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    overlay.style.display = 'none';
    dragCounter = 0;
    const items = [...(e.dataTransfer.items || [])];
    const files = [...(e.dataTransfer.files || [])];
    const hasEntries = items.some(it => typeof it.webkitGetAsEntry === 'function' && it.webkitGetAsEntry());
    if (hasEntries) {
      await uploadFilesOrEntries({ items });
    } else if (files.length) {
      await uploadFilesOrEntries({ filesFallback: files });
    } else {
      showToast('アップロードできる項目がありません', 'error');
    }
  });
});

/* ========= Upload Core (with progress) ========= */
async function uploadFilesOrEntries({ items = null, filesFallback = null }) {
  const full = decodeURIComponent(window.location.pathname);
  let currentPath = '';
  if (full === '/browse' || full === '/browse/') currentPath = '';
  else if (full.startsWith('/browse/')) currentPath = full.slice('/browse/'.length);

  const formData = new FormData();

  if (items && items.length) {
    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) await traverseEntry(entry, '', formData);
    }
  } else if (filesFallback && filesFallback.length) {
    for (const f of filesFallback) {
      const rel = f.webkitRelativePath && f.webkitRelativePath.length > 0
        ? f.webkitRelativePath : f.name;
      formData.append('file', f, rel);
    }
  }

  if ([...formData.entries()].length === 0) {
    showToast('アップロード対象がありません', 'error'); return;
  }

  const progressEl = document.getElementById('upload-progress');
  const barEl = document.getElementById('upload-bar');
  progressEl.style.display = 'block';
  barEl.style.width = '0%';
  showToast('アップロード中…', 'info', 60000);

  try {
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/upload/${encodeURIComponent(currentPath)}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          barEl.style.width = pct + '%';
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`${xhr.status} ${xhr.statusText}`));
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(formData);
    });

    barEl.style.width = '100%';
    // Remove pending toast
    document.querySelectorAll('.toast').forEach(t => t.remove());
    showToast('アップロード完了', 'success');
    setTimeout(() => {
      progressEl.style.display = 'none';
      location.reload();
    }, 800);
  } catch (e) {
    console.error(e);
    document.querySelectorAll('.toast').forEach(t => t.remove());
    showToast('アップロード失敗', 'error');
    setTimeout(() => { progressEl.style.display = 'none'; }, 3000);
  }
}

/* ========= Folder traversal ========= */
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
          readAll();
        }, () => resolve());
      };
      readAll();
    } else {
      resolve();
    }
  });
}
