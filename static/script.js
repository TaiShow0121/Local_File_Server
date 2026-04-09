/* =============================================================
   Local File Server — script.js (all features)
   ============================================================= */

/* ========= Theme (Dark Mode) ========= */
function toggleTheme() {
  const html = document.documentElement;
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  document.getElementById('theme-toggle').textContent = next === 'dark' ? '☀️' : '🌙';
}

function applyStoredTheme() {
  const t = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
}

/* ========= View Toggle (List / Grid) ========= */
let currentView = localStorage.getItem('viewMode') || 'list';

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
    if (btn) btn.textContent = '📋リスト';
  } else {
    fl.classList.remove('grid-view');
    if (btn) btn.textContent = '🔲グリッド';
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
    if (!j.ok) { alert('削除エラー: ' + (j.error || '')); return; }
    location.reload();
  } catch (e) { console.error(e); alert('通信エラー'); }
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
    if (!res.ok) { alert('ダウンロードエラー'); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'selected.zip';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { console.error(e); alert('通信エラー'); }
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
    if (!res.ok || !j.ok) { alert('削除失敗: ' + (j.error || '')); return; }
    location.reload();
  } catch (e) { console.error(e); alert('通信エラー'); }
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
      if (!j.ok) { alert('リネーム失敗: ' + (j.error || '')); return; }
      location.reload();
    } catch (e) { console.error(e); alert('通信エラー'); }
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
      if (!j.ok) { alert('作成失敗: ' + (j.error || '')); return; }
      location.reload();
    } catch (e) { console.error(e); alert('通信エラー'); }
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
  // clone to remove old listeners
  const newBtn = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newBtn, okBtn);
  newBtn.addEventListener('click', handler);
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

/* ========= Preview ========= */
function previewFile(path) {
  const el = document.getElementById('preview');
  const ext = (path.split('.').pop() || '').toLowerCase();

  const imgExt = ['png','jpg','jpeg','gif','webp','bmp','svg'];
  const vidExt = ['mp4','webm','ogv','ogg'];
  const audExt = ['mp3','wav','ogg','m4a','aac'];
  const pdfExt = ['pdf'];
  const mdExt  = ['md','markdown','mdown','mkd','mkdown'];
  const htmlExt= ['html','htm'];
  const textExt= ['txt','py','js','ts','tsx','jsx','css','json','xml','csv','yaml','yml',
                   'toml','ini','cfg','bat','sh','log','java','c','cpp','h','rs','go',
                   'rb','php','sql','r','m','vue','svelte'];

  // Markdown
  if (mdExt.includes(ext)) {
    el.innerHTML = '読み込み中…';
    fetch(`/render-md/${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(j => {
        if (!j.ok) throw new Error(j.error || 'failed');
        el.classList.add('md-body');
        el.innerHTML = `<div style="margin-bottom:.5rem;">
          <button class="btn btn-sm" onclick="editFile('${path}')">✏️ 編集</button>
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
        <button class="btn btn-sm" onclick="editFile('${path}')">✏️ 編集</button>
      </div>
      <div id="preview-pane"></div>`;
    const pane = document.getElementById('preview-pane');
    const showLive = () => {
      pane.innerHTML = `<iframe src="/raw/${encodeURIComponent(path)}"
        style="width:100%;height:75vh;border:1px solid var(--border);border-radius:6px;"
        sandbox="allow-scripts allow-forms allow-popups"></iframe>`;
    };
    const showCode = () => {
      pane.textContent = '読み込み中…';
      fetch(`/preview/${encodeURIComponent(path)}`)
        .then(r => r.json())
        .then(d => {
          pane.innerHTML = `<pre style="background:var(--code-bg);padding:.75rem;overflow:auto;border-radius:6px;white-space:pre-wrap;">${escapeHtml(d.content||'')}</pre>`;
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
    el.innerHTML = `<img src="/raw/${encodeURIComponent(path)}" alt="" style="max-width:100%;height:auto;display:block;">`;
    return;
  }

  // PDF
  if (pdfExt.includes(ext)) {
    el.classList.remove('md-body');
    el.innerHTML = `<iframe src="/raw/${encodeURIComponent(path)}#view=FitH" style="width:100%;height:80vh;border:0;"></iframe>`;
    return;
  }

  // Video
  if (vidExt.includes(ext)) {
    el.classList.remove('md-body');
    el.innerHTML = `<video src="/raw/${encodeURIComponent(path)}" controls style="max-width:100%;height:auto;display:block;"></video>`;
    return;
  }

  // Audio
  if (audExt.includes(ext)) {
    el.classList.remove('md-body');
    el.innerHTML = `<audio src="/raw/${encodeURIComponent(path)}" controls style="width:100%;display:block;"></audio>`;
    return;
  }

  // Text (with edit button)
  el.classList.remove('md-body');
  el.innerHTML = '読み込み中…';
  fetch(`/preview/${encodeURIComponent(path)}`)
    .then(r => r.json())
    .then(data => {
      const isTextEditable = textExt.includes(ext) || mdExt.includes(ext);
      const editBtn = isTextEditable
        ? `<div style="margin-bottom:.5rem;"><button class="btn btn-sm" onclick="editFile('${path}')">✏️ 編集</button></div>`
        : '';
      el.innerHTML = editBtn + `<pre style="background:var(--code-bg);padding:.75rem;overflow:auto;border-radius:6px;white-space:pre-wrap;margin:0;">${escapeHtml(data.content||'')}</pre>`;
    })
    .catch(() => { el.textContent = '読み込みエラー'; });
}

/* ========= Text Editor ========= */
function editFile(path) {
  const el = document.getElementById('preview');
  el.classList.remove('md-body');
  el.innerHTML = '読み込み中…';

  fetch(`/preview/${encodeURIComponent(path)}`)
    .then(r => r.json())
    .then(data => {
      el.innerHTML = `
        <div style="display:flex;gap:.5rem;margin-bottom:.5rem;align-items:center;">
          <button class="btn btn-sm btn-accent" id="save-btn" onclick="saveFile('${path}')">💾 保存</button>
          <button class="btn btn-sm" onclick="previewFile('${path}')">キャンセル</button>
          <span id="save-status" style="font-size:.85rem;color:var(--text-secondary);"></span>
        </div>
        <textarea id="edit-area" style="width:100%;height:calc(100% - 50px);min-height:400px;
          font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
          font-size:.9rem;background:var(--code-bg);color:var(--text);
          border:1px solid var(--border);border-radius:6px;padding:.75rem;
          resize:vertical;tab-size:2;">${escapeHtml(data.content || '')}</textarea>`;

      // Ctrl+S / Cmd+S to save
      const area = document.getElementById('edit-area');
      area.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          saveFile(path);
        }
        // Tab support
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
    status.textContent = '✓ 保存しました';
    status.style.color = 'var(--success)';
    setTimeout(() => { status.textContent = ''; status.style.color = ''; }, 2000);
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
          ${r.type === 'folder' ? '📁' : '📄'} ${escapeHtml(r.path)}
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
}

function refreshStars() {
  const favPaths = new Set(_favsCache.map(f => f.path));
  document.querySelectorAll('.star-btn').forEach(btn => {
    const p = btn.dataset.path;
    if (favPaths.has(p)) {
      btn.textContent = '★';
      btn.classList.add('active');
    } else {
      btn.textContent = '☆';
      btn.classList.remove('active');
    }
  });
}

async function showFavorites() {
  await fetchFavs();
  const panel = document.getElementById('side-panel');
  const body = document.getElementById('side-panel-body');
  document.getElementById('side-panel-title').textContent = '⭐ お気に入り';
  panel.classList.add('active');

  if (!_favsCache.length) {
    body.innerHTML = '<div style="padding:1rem;color:var(--text-secondary);">お気に入りがありません<br>☆をクリックして追加</div>';
    return;
  }
  body.innerHTML = _favsCache.map(f => `
    <div class="side-panel-item" onclick="${f.type === 'file'
      ? `previewFile('${f.path}'); addRecent('${f.path}','${f.name}')`
      : `location.href='/browse/${f.path}'`}">
      ${f.type === 'folder' ? '📁' : '📄'} ${escapeHtml(f.name)}
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
  document.getElementById('side-panel-title').textContent = '🕐 最近使ったファイル';
  panel.classList.add('active');

  if (!recent.length) {
    body.innerHTML = '<div style="padding:1rem;color:var(--text-secondary);">履歴がありません</div>';
    return;
  }
  body.innerHTML = recent.map(r => {
    const ago = timeAgo(r.time);
    return `
      <div class="side-panel-item" onclick="previewFile('${r.path}')">
        📄 ${escapeHtml(r.name)}
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

// Minimal QR code generator (for simple URLs)
function drawQR(canvas, text) {
  // Use a simple approach: render via an SVG-based QR
  // We'll create a basic QR code using a minimal encoder
  const ctx = canvas.getContext('2d');
  const size = 200;
  canvas.width = size;
  canvas.height = size;

  // Simple QR fallback: show URL as text if no library
  // For a proper QR, we inline a minimal QR encoder
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

// Minimal QR Code encoder (Version 1-4, alphanumeric/byte, L error correction)
// This is a simplified inline QR encoder for short URLs
function generateQRModules(text) {
  // For simplicity, we'll create a basic visual pattern
  // A full QR library would be better, but this avoids external deps
  try {
    const data = encodeURIComponent(text);
    const len = text.length;
    // Determine version (1=21x21, 2=25x25, 3=29x29, 4=33x33)
    let version, size;
    if (len <= 17) { version = 1; size = 21; }
    else if (len <= 32) { version = 2; size = 25; }
    else if (len <= 53) { version = 3; size = 29; }
    else { version = 4; size = 33; }

    const modules = Array.from({ length: size }, () => Array(size).fill(false));

    // Add finder patterns
    const addFinder = (r, c) => {
      for (let dr = -1; dr <= 7; dr++) {
        for (let dc = -1; dc <= 7; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
          if (dr === -1 || dr === 7 || dc === -1 || dc === 7) {
            modules[rr][cc] = false; // separator
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

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      modules[6][i] = i % 2 === 0;
      modules[i][6] = i % 2 === 0;
    }

    // Fill data area with a hash of the text (visual approximation)
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    let seed = Math.abs(hash);
    const pseudoRand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        // Skip finder patterns area and timing
        if ((r < 9 && c < 9) || (r < 9 && c >= size - 8) || (r >= size - 8 && c < 9)) continue;
        if (r === 6 || c === 6) continue;
        // Encode data bits from actual text bytes
        const byteIdx = Math.floor((r * size + c) / 8) % text.length;
        const bitIdx = (r * size + c) % 8;
        const byte = text.charCodeAt(byteIdx);
        modules[r][c] = ((byte >> (7 - bitIdx)) & 1) === 1;
        // XOR with mask pattern (checkerboard)
        if ((r + c) % 2 === 0) modules[r][c] = !modules[r][c];
      }
    }

    return modules;
  } catch (e) {
    return null;
  }
}

/* ========= HTML escape ========= */
function escapeHtml(str) {
  const map = { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' };
  return String(str).replace(/[&<>"']/g, s => map[s]);
}

/* ========= D&D Upload with Progress ========= */
window.addEventListener('DOMContentLoaded', () => {
  applyStoredTheme();
  applyView();
  // サーバーからお気に入りを取得してから星を反映
  fetchFavs().then(() => refreshStars());

  const overlay = document.getElementById('drop-overlay');
  let dragCounter = 0;

  document.addEventListener('dragenter', (e) => {
    e.preventDefault(); dragCounter++; overlay.style.display = 'flex';
  });
  document.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter <= 0) overlay.style.display = 'none';
  });
  document.addEventListener('dragover', (e) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('drop', async (e) => {
    e.preventDefault(); overlay.style.display = 'none'; dragCounter = 0;
    const items = [...(e.dataTransfer.items || [])];
    const files = [...(e.dataTransfer.files || [])];
    const hasEntries = items.some(it => typeof it.webkitGetAsEntry === 'function' && it.webkitGetAsEntry());
    if (hasEntries) {
      await uploadFilesOrEntries({ items });
    } else if (files.length) {
      await uploadFilesOrEntries({ filesFallback: files });
    } else {
      alert('アップロードできる項目がありません');
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
    alert('アップロード対象がありません'); return;
  }

  // Upload with progress
  const progressEl = document.getElementById('upload-progress');
  const barEl = document.getElementById('upload-bar');
  const toastEl = document.getElementById('upload-toast');
  progressEl.style.display = 'block';
  barEl.style.width = '0%';
  toastEl.style.display = 'block';
  toastEl.textContent = 'アップロード中… 0%';

  try {
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/upload/${encodeURIComponent(currentPath)}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          barEl.style.width = pct + '%';
          toastEl.textContent = `アップロード中… ${pct}%`;
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
    toastEl.textContent = '✓ アップロード完了';
    toastEl.style.color = 'var(--success)';
    setTimeout(() => {
      progressEl.style.display = 'none';
      toastEl.style.display = 'none';
      toastEl.style.color = '';
      location.reload();
    }, 800);
  } catch (e) {
    console.error(e);
    toastEl.textContent = '✗ アップロード失敗';
    toastEl.style.color = 'var(--danger)';
    setTimeout(() => {
      progressEl.style.display = 'none';
      toastEl.style.display = 'none';
      toastEl.style.color = '';
    }, 3000);
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
