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
let commandDeckVisible = localStorage.getItem('commandDeckVisible') !== 'hidden';
const MARKDOWN_EDITOR_MODES = ['edit', 'preview', 'split'];
let markdownEditorMode = localStorage.getItem('markdownEditorMode') || 'edit';
const INTERNAL_ENTRY_MIME = 'application/x-local-file-server-entry';
let activeDraggedEntry = null;
let remoteCursorData = {};
let currentPreviewPath = '';
let currentEditLock = null;
let previewTabs = [];  // [{ path, name }]
let editorDirty = false;
let chatMessages = [];
let clipboardEntries = [];
let onlineUsers = [];
let currentChatChannel = 'all';  // 'all' or IP address for DM
let dmMessages = {};  // { ip: [messages] }
let dmUnread = {};    // { ip: true/false }
let imageEditorState = null;
let appSettings = window.__appSettings || {
  setup_complete: false,
  workspace_name: 'LAN Drive Pro',
  share_key_enabled: false,
  share_key_configured: false,
  server_port: 5000,
  storage_path: '',
  upload_limit_mb: 2048,
  share_link_expire_hours: 72,
  admin_mode_enabled: false,
  terminal_admin_only: true,
  terminal_available: false,
  admin_controls_available: false,
  unlocked: true,
};
let latestShareUrl = '';
let latestReceiveUrl = '';
let dashboardState = { recent_files: [] };

const CODE_LANGUAGE_MAP = {
  py: 'python',
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  css: 'css',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'bash',
  bat: 'dos',
  ps1: 'powershell',
  sql: 'sql',
  php: 'php',
  rb: 'ruby',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  rs: 'rust',
  go: 'go',
};
const TEXT_LIKE_NAMES = ['dockerfile', 'makefile', 'readme', 'license', '.env'];
const TEXT_EXTENSIONS = ['txt','py','js','ts','tsx','jsx','css','json','xml','csv','yaml','yml',
  'toml','ini','cfg','bat','sh','log','java','c','cpp','h','hpp','rs','go',
  'rb','php','sql','r','m','vue','svelte','cs','csproj','sln','razor',
  'cshtml','ps1','env','properties','conf','service','gradle','md','markdown','html','htm'];
const IMAGE_EDITABLE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

function currentSubpath() {
  return window.__subpath || '';
}

function getEditorArea() {
  return document.getElementById('edit-area');
}

function getEditorValue() {
  return getEditorArea()?.value || '';
}

function setEditorValue(value) {
  const area = getEditorArea();
  if (!area) return;
  area.value = value;
  const activePath = liveEditPath || currentPreviewPath || '';
  updateLineNumbers();
  syncLineNumberScroll();
  if (isMarkdownFile(activePath)) updateMdLivePreview(activePath);
  else syncHighlightedCode(activePath);
}

function getEditorSelection() {
  const area = getEditorArea();
  if (!area) return { start: 0, end: 0 };
  return {
    start: area.selectionStart || 0,
    end: area.selectionEnd || 0,
  };
}

function detectCodeLanguage(path) {
  const name = (path.split('/').pop() || '').toLowerCase();
  if (TEXT_LIKE_NAMES.includes(name)) return 'bash';
  const ext = name.includes('.') ? name.split('.').pop() : '';
  return CODE_LANGUAGE_MAP[ext] || 'plaintext';
}

function isTextFilePath(path) {
  const name = (path.split('/').pop() || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  return TEXT_EXTENSIONS.includes(ext) || TEXT_LIKE_NAMES.includes(name);
}

function syncHighlightedCode(path = liveEditPath) {
  const codeEl = document.getElementById('code-highlight');
  const area = getEditorArea();
  if (!codeEl || !area) return;

  const code = area.value || '';
  const lang = detectCodeLanguage(path || currentPreviewPath || '');
  let html = escapeHtml(code || ' ');
  if (window.hljs) {
    try {
      html = lang && lang !== 'plaintext'
        ? window.hljs.highlight(code, { language: lang }).value
        : window.hljs.highlightAuto(code).value;
    } catch (_) {
      html = escapeHtml(code || ' ');
    }
  }
  codeEl.className = 'hljs language-' + lang;
  codeEl.innerHTML = html || '&nbsp;';
  const shell = document.getElementById('code-highlight-shell');
  if (shell) {
    shell.scrollTop = area.scrollTop;
    shell.scrollLeft = area.scrollLeft;
  }
}

function getCurrentEntry(path = currentPreviewPath) {
  return document.querySelector(`.file-entry[data-path="${CSS.escape(path)}"]`);
}

function getCurrentImageMime(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return 'image/png';
}

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
  updateProDashboard();
}

function toggleCommandDeck() {
  commandDeckVisible = !commandDeckVisible;
  localStorage.setItem('commandDeckVisible', commandDeckVisible ? 'visible' : 'hidden');
  applyCommandDeckVisibility();
}

function applyCommandDeckVisibility() {
  const btn = document.getElementById('deck-toggle');
  if (!commandDeckVisible) {
    document.documentElement.setAttribute('data-command-deck', 'hidden');
  } else {
    document.documentElement.removeAttribute('data-command-deck');
  }
  if (btn) {
    btn.setAttribute('aria-pressed', commandDeckVisible ? 'true' : 'false');
    btn.innerHTML = commandDeckVisible ? '&#x25A3; 概要 ON' : '&#x25A2; 概要 OFF';
    btn.title = commandDeckVisible ? '概要カードを隠す' : '概要カードを表示';
  }
}

/* ========= Filter (client-side) ========= */
function filterEntries() {
  const q = (document.getElementById('filter-input').value || '').toLowerCase();
  document.querySelectorAll('.file-entry').forEach(el => {
    const name = (el.dataset.name || '').toLowerCase();
    el.style.display = name.includes(q) ? '' : 'none';
  });
  updateProDashboard();
}

/* ========= Sort (client-side) ========= */
function sortEntries() {
  const sel = document.getElementById('sort-select');
  if (!sel) return;
  localStorage.setItem('sortOrder', sel.value);
  const [field, dir] = sel.value.split('-');
  const container = document.getElementById('file-list');
  const list = container.querySelector('.file-list-scroll') || container;
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
    setTimeout(() => refreshFileList(), 450);
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
  updateProDashboard();
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
  if (!confirm(`${paths.length}件をゴミ箱に移動します。よろしいですか？`)) return;
  try {
    const res = await fetch('/delete-multi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths })
    });
    const j = await res.json();
    if (!j.ok) { showToast('削除エラー: ' + (j.error || ''), 'error'); return; }
    showToast(`${paths.length}件を削除しました`, 'success');
    setTimeout(() => refreshFileList(), 600);
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
  if (!confirm(`${label}「${path}」をゴミ箱に移動します。よろしいですか？`)) return;
  try {
    const res = await fetch('/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subpath: path })
    });
    const j = await res.json();
    if (!res.ok || !j.ok) { showToast('削除失敗: ' + (j.error || ''), 'error'); return; }
    showToast('削除しました', 'success');
    setTimeout(() => refreshFileList(), 600);
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
      setTimeout(() => refreshFileList(), 600);
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
      setTimeout(() => refreshFileList(), 600);
    } catch (e) { console.error(e); showToast('通信エラー', 'error'); }
  });
}

/* ========= Mkfile (新規ファイル作成) ========= */
function openMkfile() {
  showInputModal('新規ファイル作成', 'ファイル名（例: memo.txt）', '', async (name) => {
    if (!name) return;
    try {
      const res = await fetch('/mkfile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: window.__subpath || '', name })
      });
      const j = await res.json();
      if (!j.ok) { showToast('作成失敗: ' + (j.error || ''), 'error'); return; }
      showToast('ファイルを作成しました', 'success');
      setTimeout(() => refreshFileList(), 600);
    } catch (e) { console.error(e); showToast('通信エラー', 'error'); }
  });
}

/* ========= Copy (ファイル/フォルダ複製) ========= */
async function copyPath(path) {
  try {
    const res = await fetch('/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath: path })
    });
    const j = await res.json();
    if (!res.ok || !j.ok) { showToast('コピー失敗: ' + (j.error || ''), 'error'); return; }
    showToast('コピーしました: ' + (j.newName || ''), 'success');
    setTimeout(() => refreshFileList(), 600);
  } catch (e) { console.error(e); showToast('通信エラー', 'error'); }
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

function closeModal(id, force = false) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!force && id === 'setup-backdrop' && el.dataset.required === '1' && !appSettings.setup_complete) {
    return;
  }
  el.style.display = 'none';
  if (id === 'image-editor-backdrop') imageEditorState = null;
}

function encodedPathExpr(path) {
  return `decodeURIComponent('${encodeURIComponent(path)}')`;
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
  const pe = encodedPathExpr(path);
  const ne = encodedPathExpr(name);
  const te = encodedPathExpr(type);

  let items = '';
  if (isFile) {
    items += `<div class="context-menu-item" onclick="previewFile(${pe}); addRecent(${pe},${ne}); hideContextMenu();">\uD83D\uDC41 プレビュー</div>`;
    items += `<div class="context-menu-item" onclick="window.location.href='/download/'+encodeURIComponent(${pe}); hideContextMenu();">\uD83D\uDCBE ダウンロード</div>`;
  } else {
    items += `<div class="context-menu-item" onclick="window.location.href='/browse/'+encodeURIComponent(${pe}); hideContextMenu();">\uD83D\uDCC2 開く</div>`;
    items += `<div class="context-menu-item" onclick="window.location.href='/download-folder/'+encodeURIComponent(${pe}); hideContextMenu();">\uD83D\uDCE6 ZIPダウンロード</div>`;
  }
  items += `<div class="context-menu-item" onclick="openRename(${pe},${ne}); hideContextMenu();">\u270F\uFE0F リネーム</div>`;
  items += `<div class="context-menu-item" onclick="copyPath(${pe}); hideContextMenu();">\uD83D\uDCCB コピー</div>`;
  items += `<div class="context-menu-item" onclick="toggleFav(${pe},${ne},${te}); hideContextMenu();">\u2B50 お気に入り</div>`;
  items += `<div class="context-menu-item" onclick="createShareLink(${pe}); hideContextMenu();">\uD83D\uDD17 共有リンク</div>`;
  items += `<div class="context-menu-item" onclick="copyPathToClipboard(${pe}); hideContextMenu();">&#128203; パスコピー</div>`;
  items += `<div class="context-menu-item" onclick="openFileInfo(${pe}); hideContextMenu();">&#8505; 詳細情報</div>`;
  items += `<div class="context-menu-sep"></div>`;
  items += `<div class="context-menu-item danger" onclick="deletePath(${pe}, ${!isFile}); hideContextMenu();">\uD83D\uDDD1 削除</div>`;

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

/* ========= Preview Tabs ========= */
function addPreviewTab(path) {
  const name = path.split('/').pop() || path;
  if (!previewTabs.some(t => t.path === path)) {
    previewTabs.push({ path, name });
  }
  renderPreviewTabs(path);
}

function removePreviewTab(path) {
  const idx = previewTabs.findIndex(t => t.path === path);
  if (idx < 0) return;
  previewTabs.splice(idx, 1);
  if (previewTabs.length === 0) {
    renderPreviewTabs(null);
    showEmptyPreview();
    return;
  }
  if (currentPreviewPath === path) {
    const nextIdx = Math.min(idx, previewTabs.length - 1);
    previewFile(previewTabs[nextIdx].path);
  } else {
    renderPreviewTabs(currentPreviewPath);
  }
}

function renderPreviewTabs(activePath) {
  const container = document.getElementById('preview-tabs');
  const preview = document.getElementById('preview');
  if (!container) return;
  if (previewTabs.length === 0) {
    container.style.display = 'none';
    preview.classList.remove('has-tabs');
    return;
  }
  container.style.display = 'flex';
  preview.classList.add('has-tabs');
  container.innerHTML = previewTabs.map(t => {
    const isActive = t.path === activePath;
    const pe = encodedPathExpr(t.path);
    return `<button class="preview-tab${isActive ? ' active' : ''}" onclick="previewFile(${pe})" title="${escapeHtml(t.path)}">
      <span>${escapeHtml(t.name)}</span>
      <span class="tab-close" onclick="event.stopPropagation(); removePreviewTab(${pe});">&times;</span>
    </button>`;
  }).join('');
}

function showEmptyPreview() {
  const el = document.getElementById('preview');
  currentPreviewPath = '';
  document.querySelectorAll('.file-entry').forEach(e => e.classList.remove('selected'));
  el.classList.remove('md-body', 'editor-view');
  el.style.padding = '';
  el.innerHTML = `<div class="empty-state">
    <div class="empty-icon">&#128065;</div>
    <p class="empty-title">プレビュー</p>
    <p class="empty-desc">ファイルをクリックして表示</p>
  </div>`;
  updatePreviewHeader();
  updateProDashboard();
}

/* ========= Preview ========= */
function previewFile(path) {
  addPreviewTab(path);
  const el = document.getElementById('preview');
  currentPreviewPath = path;
  el.classList.remove('editor-view');
  updatePreviewHeader(path);
  updateProDashboard();
  const pathExpr = encodedPathExpr(path);
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
        el.innerHTML = j.html;
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
    el.innerHTML = `<div style="display:flex;gap:.5rem;margin-bottom:.75rem;flex-wrap:wrap;">
        <a class="btn btn-sm" href="/download/${encodeURIComponent(path)}" download>\uD83D\uDCBE ダウンロード</a>
      </div>
      <div style="display:flex;align-items:center;justify-content:center;height:100%;"><img src="/raw/${encodeURIComponent(path)}?t=${Date.now()}" alt="" style="max-width:100%;max-height:90vh;height:auto;display:block;border-radius:8px;box-shadow:var(--shadow);"></div>`;
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
      el.innerHTML = `<pre style="background:var(--code-bg);padding:1rem;overflow:auto;border-radius:8px;white-space:pre-wrap;margin:0;border:1px solid var(--border);font-size:.88rem;line-height:1.6;">${escapeHtml(data.content||'')}</pre>`;
    })
    .catch(() => { el.textContent = '読み込みエラー'; });
}

/* ========= Live Collaborative Editing (Socket.IO) ========= */
let liveSocket = null;
let liveEditPath = null;
let liveChangeTimer = null;
let isReceivingUpdate = false;

function initLiveSocket() {
  if (liveSocket) return liveSocket;
  liveSocket = io({ transports: ['websocket', 'polling'] });
  liveSocket.on('connect', () => console.log('[Live] connected:', liveSocket.id));

  // 他ユーザーからの編集を受信
  liveSocket.on('file_update', (data) => {
    const area = getEditorArea();
    if (!area || data.path !== liveEditPath) return;
    const { start: myStart, end: myEnd } = getEditorSelection();
    const oldLen = getEditorValue().length;
    isReceivingUpdate = true;
    setEditorValue(data.content);
    isReceivingUpdate = false;
    const newLen = getEditorValue().length;
    const diff = newLen - oldLen;
    const newStart = Math.max(0, Math.min(myStart + (myStart >= data.cursor ? diff : 0), newLen));
    const newEnd = Math.max(0, Math.min(myEnd + (myEnd >= data.cursor ? diff : 0), newLen));
    area.selectionStart = newStart;
    area.selectionEnd = newEnd;
    updateSaveStatus('auto-saved');
    // 送信者のカーソルバッジも更新
    if (data.sender && data.sender.ip) {
      showRemoteCursorBadge(data.sender, data.cursor);
    }
  });

  // 参加者リスト更新
  liveSocket.on('editors_update', (data) => {
    const badge = document.getElementById('live-editors-badge');
    if (badge) {
      badge.textContent = data.count + ' users';
      badge.title = data.editors.map(e => e.ip).join(', ');
      const dots = document.getElementById('live-editor-dots');
      if (dots) {
        dots.innerHTML = data.editors.map(e =>
          `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${e.color};border:1px solid var(--border);" title="${e.ip}"></span>`
        ).join('');
      }
    }
    // 退出したユーザーのカーソルバッジを削除
    const bar = document.getElementById('remote-cursors-bar');
    if (bar) {
      const activeIPs = new Set(data.editors.map(e => e.ip));
      bar.querySelectorAll('[data-cursor-ip]').forEach(el => {
        if (!activeIPs.has(el.getAttribute('data-cursor-ip'))) el.remove();
      });
      const overlay = document.getElementById('cursor-overlay-container');
      overlay?.querySelectorAll('[data-cursor-ip]').forEach(el => {
        if (!activeIPs.has(el.getAttribute('data-cursor-ip'))) el.remove();
      });
    }
  });

  // 他ユーザーのカーソル位置（行番号バッジ表示）
  liveSocket.on('cursor_update', (data) => {
    showRemoteCursorBadge(data.sender, data.cursor);
  });

  liveSocket.on('edit_lock_update', (data) => {
    if (data.path === liveEditPath) applyEditLockState(data);
  });

  liveSocket.on('edit_lock_denied', (data) => {
    if (data.path === liveEditPath) {
      applyEditLockState(data);
      showToast(`${data.holder?.ip || '他のユーザー'} が編集中です`, 'info');
    }
  });

  liveSocket.on('system_notice', (data) => {
    handleSystemNotice(data);
  });

  liveSocket.on('chat_message', (message) => {
    appendChatMessage(message, true);
  });

  liveSocket.on('clipboard_update', (payload) => {
    clipboardEntries = payload.entries || [];
    renderClipboardEntries();
    if (payload.latest && payload.latest.author !== window.__clientIp) {
      showToast(`${payload.latest.author} が共有クリップボードを更新しました`, 'info');
    }
  });

  liveSocket.on('online_users', (data) => {
    onlineUsers = data.users || [];
    renderOnlineUsers();
  });

  liveSocket.on('dm_message', (message) => {
    if (!message?.id) return;
    const peerIp = message.author === window.__clientIp ? message.target : message.author;
    if (!dmMessages[peerIp]) dmMessages[peerIp] = [];
    if (!dmMessages[peerIp].some(m => m.id === message.id)) {
      dmMessages[peerIp].push(message);
      dmMessages[peerIp] = dmMessages[peerIp].slice(-100);
    }
    if (currentChatChannel === peerIp) {
      renderDmMessages(peerIp);
    } else if (message.author !== window.__clientIp) {
      dmUnread[peerIp] = true;
      renderOnlineUsers();
      const drawer = document.getElementById('chat-drawer');
      if (!drawer?.classList.contains('open')) {
        document.getElementById('chat-unread')?.classList.add('visible');
      }
      showToast(`DM ${message.author}: ${message.text.slice(0, 48)}`, 'info');
    }
  });

  return liveSocket;
}

function joinEditRoom(path) {
  const sock = initLiveSocket();
  if (liveEditPath && liveEditPath !== path) {
    sock.emit('leave_edit', { path: liveEditPath });
  }
  liveEditPath = path;
  sock.emit('join_edit', { path: path });
}

function leaveEditRoom() {
  if (liveSocket && liveEditPath) {
    liveSocket.emit('leave_edit', { path: liveEditPath });
    liveEditPath = null;
  }
  remoteCursorData = {};
  currentEditLock = null;
  editorDirty = false;
  // エディタ終了時にpreviewのpaddingを元に戻す
  const el = document.getElementById('preview');
  if (el) el.style.padding = '';
}

function broadcastChange(path) {
  if (!liveSocket || isReceivingUpdate) return;
  const area = getEditorArea();
  if (!area) return;
  clearTimeout(liveChangeTimer);
  liveChangeTimer = setTimeout(() => {
    const selection = getEditorSelection();
    liveSocket.emit('file_change', {
      path: path,
      content: getEditorValue(),
      cursor: selection.start,
    });
    updateSaveStatus('auto-saved');
  }, 150);
}

function broadcastCursor(path) {
  if (!liveSocket || isReceivingUpdate) return;
  const area = getEditorArea();
  if (!area) return;
  const selection = getEditorSelection();
  liveSocket.emit('cursor_move', {
    path: path,
    cursor: selection.start,
    selectionEnd: selection.end,
  });
}

function getCaretCoordinates(area, position) {
  // テキストエリア内のカーソルのピクセル座標を行番号から直接計算
  const cs = getComputedStyle(area);
  const text = area.value.substring(0, position);
  const lines = text.split('\n');
  const lineIndex = lines.length - 1; // 0始まりの行番号
  const colText = lines[lineIndex];   // カーソル行のカーソルまでのテキスト

  // line-heightをピクセル値で確実に取得
  const fontSize = parseFloat(cs.fontSize);
  let lineHeight;
  const lhRaw = cs.lineHeight;
  if (lhRaw === 'normal') {
    lineHeight = fontSize * 1.2;
  } else if (lhRaw.endsWith('px')) {
    lineHeight = parseFloat(lhRaw);
  } else {
    // 単位なし(1.6等)の場合、font-sizeを掛ける
    lineHeight = parseFloat(lhRaw) * fontSize;
  }

  const paddingTop = parseFloat(cs.paddingTop) || 0;
  const paddingLeft = parseFloat(cs.paddingLeft) || 0;
  const borderTop = parseFloat(cs.borderTopWidth) || 0;
  const borderLeft = parseFloat(cs.borderLeftWidth) || 0;

  // 文字幅をcanvasで計測
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const colWidth = ctx.measureText(colText).width;

  const x = borderLeft + paddingLeft + colWidth;
  const y = borderTop + paddingTop + lineIndex * lineHeight;

  return { x, y, lineHeight };
}

function showRemoteCursorBadge(sender, cursor) {
  if (!sender || !sender.ip) return;
  const area = getEditorArea();
  const container = document.getElementById('remote-cursors-bar');
  if (!area || !container) return;

  // スクロール時の再描画用に保存
  remoteCursorData[sender.ip] = { sender, cursor };

  const text = getEditorValue().substring(0, cursor);
  const lineNum = text.split('\n').length;

  // ステータスバーのバッジ
  let badge = container.querySelector(`[data-cursor-ip="${sender.ip}"]`);
  if (!badge) {
    badge = document.createElement('span');
    badge.setAttribute('data-cursor-ip', sender.ip);
    badge.style.cssText = `display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;font-size:.75rem;color:#fff;background:${sender.color};white-space:nowrap;transition:all .2s;`;
    container.appendChild(badge);
  }
  badge.textContent = `${sender.ip} : ${lineNum}行目`;
  clearTimeout(badge._fadeTimer);
  badge.style.opacity = '1';
  badge._fadeTimer = setTimeout(() => { badge.style.opacity = '.4'; }, 5000);

  // テキストエリア上のカーソル表示
  const overlay = document.getElementById('cursor-overlay-container');
  if (!overlay) return;

  const coords = getCaretCoordinates(area, cursor);

  let marker = overlay.querySelector(`[data-cursor-ip="${sender.ip}"]`);
  if (!marker) {
    marker = document.createElement('div');
    marker.setAttribute('data-cursor-ip', sender.ip);
    marker.style.cssText = 'position:absolute;pointer-events:none;z-index:10;transition:left .12s,top .12s;';
    marker.innerHTML = `<div style="width:2px;height:1.2em;background:${sender.color};border-radius:1px;"></div>
      <div style="font-size:9px;background:${sender.color};color:#fff;padding:1px 5px;border-radius:3px;white-space:nowrap;position:absolute;bottom:100%;left:0;margin-bottom:2px;">${sender.ip}</div>`;
    overlay.appendChild(marker);
  }

  // overlayとtextareaの実際の位置差を補正
  const areaRect = area.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  const offsetX = areaRect.left - overlayRect.left;
  const offsetY = areaRect.top  - overlayRect.top;

  const posX = offsetX + coords.x - area.scrollLeft;
  const posY = offsetY + coords.y - area.scrollTop;
  marker.style.left = posX + 'px';
  marker.style.top  = posY + 'px';

  // テキストエリア外にはみ出たら非表示
  const mx = overlayRect.left + posX;
  const my = overlayRect.top  + posY;
  marker.style.display = (mx < areaRect.left || mx > areaRect.right || my < areaRect.top || my > areaRect.bottom) ? 'none' : '';
}

function refreshRemoteCursors() {
  for (const ip in remoteCursorData) {
    const d = remoteCursorData[ip];
    showRemoteCursorBadge(d.sender, d.cursor);
  }
}

function updateSaveStatus(type) {
  const status = document.getElementById('save-status');
  if (!status) return;
  if (type === 'auto-saved') {
    status.innerHTML = '<span style="color:var(--success);">auto-saved</span>';
    clearTimeout(status._clearTimer);
    status._clearTimer = setTimeout(() => { status.textContent = ''; }, 2000);
  } else if (type === 'saved') {
    status.innerHTML = '<span style="color:var(--success);">saved</span>';
    clearTimeout(status._clearTimer);
    status._clearTimer = setTimeout(() => { status.textContent = ''; }, 2500);
  } else if (type === 'readonly') {
    status.innerHTML = '<span style="color:var(--warning);">read only</span>';
  } else {
    status.textContent = type || '';
  }
}

function canEditCurrentFile() {
  return !currentEditLock?.locked || currentEditLock?.holderSid === liveSocket?.id;
}

function applyEditLockState(lockData) {
  currentEditLock = lockData;
  const area = getEditorArea();
  const lockStatus = document.getElementById('edit-lock-status');
  const lockBtn = document.getElementById('edit-lock-btn');
  const saveBtn = document.getElementById('save-btn');
  const canEdit = canEditCurrentFile();

  if (area) area.readOnly = !canEdit;
  if (saveBtn) saveBtn.disabled = !canEdit;

  if (lockStatus) {
    if (!lockData?.locked) {
      lockStatus.textContent = 'ロック解除中';
    } else if (canEdit) {
      lockStatus.textContent = 'あなたが編集中';
    } else {
      lockStatus.textContent = `${lockData.holder?.ip || '他のユーザー'} が編集中`;
    }
  }

  if (lockBtn) {
    if (!lockData?.locked || canEdit) {
      lockBtn.disabled = false;
      lockBtn.textContent = canEdit ? 'ロック解除' : 'ロック取得';
    } else {
      lockBtn.disabled = true;
      lockBtn.textContent = 'ロック中';
    }
  }

  if (!canEdit) updateSaveStatus('readonly');
}

function toggleEditLock() {
  if (!liveSocket || !liveEditPath) return;
  if (!currentEditLock?.locked) {
    liveSocket.emit('take_edit_lock', { path: liveEditPath });
    return;
  }
  if (currentEditLock.holderSid === liveSocket.id) {
    liveSocket.emit('release_edit_lock', { path: liveEditPath });
  } else {
    showToast(`${currentEditLock.holder?.ip || '他のユーザー'} が編集中です`, 'info');
  }
}

/* ========= Text Editor ========= */
function isMarkdownFile(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  return ['md','markdown','mdown','mkd','mkdown'].includes(ext);
}

function getMarkdownEditorMode() {
  return MARKDOWN_EDITOR_MODES.includes(markdownEditorMode) ? markdownEditorMode : 'edit';
}

function setMarkdownEditorMode(mode, path = liveEditPath || currentPreviewPath || '') {
  const nextMode = MARKDOWN_EDITOR_MODES.includes(mode) ? mode : 'edit';
  markdownEditorMode = nextMode;
  localStorage.setItem('markdownEditorMode', nextMode);

  const split = document.getElementById('editor-split');
  if (split) split.dataset.mdMode = nextMode;

  document.querySelectorAll('.editor-mode-btn').forEach((btn) => {
    const active = btn.dataset.mode === nextMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  if (nextMode !== 'edit') updateMdLivePreview(path);
  requestAnimationFrame(() => {
    syncLineNumberScroll();
    refreshRemoteCursors();
    if (nextMode !== 'preview') getEditorArea()?.focus({ preventScroll: true });
  });
}

function updateLineNumbers() {
  const area = getEditorArea();
  const gutter = document.getElementById('line-numbers');
  if (!area || !gutter) return;
  const lines = area.value.split('\n').length;
  const current = gutter.children.length;
  if (lines === current) {
    syncLineNumberScroll();
    return;
  }
  let html = '';
  for (let i = 1; i <= lines; i++) html += `<div>${i}</div>`;
  gutter.innerHTML = html;
  syncLineNumberScroll();
}

function syncLineNumberScroll() {
  const area = getEditorArea();
  const gutter = document.getElementById('line-numbers');
  if (area && gutter) gutter.scrollTop = area.scrollTop;
}

function updateMdLivePreview(path) {
  const area = getEditorArea();
  const pane = document.getElementById('md-live-preview');
  if (!area || !pane || !isMarkdownFile(path)) return;
  clearTimeout(pane._timer);
  pane._timer = setTimeout(() => {
    const text = area.value || '';
    fetch('/render-md-raw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    }).then(r => r.json()).then(j => {
      if (j.ok) pane.innerHTML = j.html;
    }).catch(() => {});
  }, 400);
}

let editorSearchState = { matches: [], index: -1 };

function toggleEditorSearch() {
  if (isMarkdownFile(liveEditPath || currentPreviewPath || '') && getMarkdownEditorMode() === 'preview') {
    setMarkdownEditorMode('edit', liveEditPath || currentPreviewPath);
  }
  const bar = document.getElementById('editor-search-bar');
  if (!bar) return;
  const visible = bar.classList.toggle('visible');
  if (visible) {
    document.getElementById('editor-search-input')?.focus();
  } else {
    editorSearchState = { matches: [], index: -1 };
  }
}

function doEditorSearch() {
  const area = getEditorArea();
  const input = document.getElementById('editor-search-input');
  const countEl = document.getElementById('editor-search-count');
  if (!area || !input) return;
  const query = input.value;
  if (!query) { editorSearchState = { matches: [], index: -1 }; if (countEl) countEl.textContent = ''; return; }

  const text = area.value;
  const matches = [];
  let idx = text.toLowerCase().indexOf(query.toLowerCase());
  while (idx >= 0) {
    matches.push(idx);
    idx = text.toLowerCase().indexOf(query.toLowerCase(), idx + 1);
  }
  editorSearchState.matches = matches;
  editorSearchState.index = matches.length > 0 ? 0 : -1;
  if (countEl) countEl.textContent = matches.length > 0 ? `${1}/${matches.length}` : '0件';
  if (matches.length > 0) selectEditorMatch();
}

function editorSearchNext() {
  if (!editorSearchState.matches.length) return;
  editorSearchState.index = (editorSearchState.index + 1) % editorSearchState.matches.length;
  const countEl = document.getElementById('editor-search-count');
  if (countEl) countEl.textContent = `${editorSearchState.index + 1}/${editorSearchState.matches.length}`;
  selectEditorMatch();
}

function editorSearchPrev() {
  if (!editorSearchState.matches.length) return;
  editorSearchState.index = (editorSearchState.index - 1 + editorSearchState.matches.length) % editorSearchState.matches.length;
  const countEl = document.getElementById('editor-search-count');
  if (countEl) countEl.textContent = `${editorSearchState.index + 1}/${editorSearchState.matches.length}`;
  selectEditorMatch();
}

function selectEditorMatch() {
  const area = getEditorArea();
  if (!area || editorSearchState.index < 0) return;
  const pos = editorSearchState.matches[editorSearchState.index];
  const query = document.getElementById('editor-search-input')?.value || '';
  area.focus();
  area.setSelectionRange(pos, pos + query.length);
  // スクロール位置調整
  const text = area.value.substring(0, pos);
  const lineNum = text.split('\n').length;
  const lineHeight = parseFloat(getComputedStyle(area).lineHeight) || 20;
  area.scrollTop = Math.max(0, (lineNum - 5) * lineHeight);
  syncLineNumberScroll();
}

function doEditorReplace() {
  const area = getEditorArea();
  if (!area || !canEditCurrentFile()) return;
  const query = document.getElementById('editor-search-input')?.value || '';
  const replacement = document.getElementById('editor-replace-input')?.value || '';
  if (!query || editorSearchState.index < 0) return;
  const pos = editorSearchState.matches[editorSearchState.index];
  area.value = area.value.substring(0, pos) + replacement + area.value.substring(pos + query.length);
  editorDirty = true;
  updateLineNumbers();
  if (isMarkdownFile(liveEditPath || currentPreviewPath || '')) updateMdLivePreview(liveEditPath || currentPreviewPath);
  else syncHighlightedCode(liveEditPath);
  broadcastChange(liveEditPath);
  doEditorSearch();
}

function doEditorReplaceAll() {
  const area = getEditorArea();
  if (!area || !canEditCurrentFile()) return;
  const query = document.getElementById('editor-search-input')?.value || '';
  const replacement = document.getElementById('editor-replace-input')?.value || '';
  if (!query) return;
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  area.value = area.value.replace(regex, replacement);
  editorDirty = true;
  updateLineNumbers();
  if (isMarkdownFile(liveEditPath || currentPreviewPath || '')) updateMdLivePreview(liveEditPath || currentPreviewPath);
  else syncHighlightedCode(liveEditPath);
  broadcastChange(liveEditPath);
  doEditorSearch();
}

function editFile(path) {
  const el = document.getElementById('preview');
  el.classList.remove('md-body');
  el.classList.add('editor-view');
  currentPreviewPath = path;
  currentEditLock = null;
  editorDirty = false;
  const pathExpr = encodedPathExpr(path);
  const isMd = isMarkdownFile(path);
  el.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);">読み込み中…</div>';

  fetch(`/preview/${encodeURIComponent(path)}`)
    .then(r => r.json())
    .then(data => {
      el.style.padding = '.5rem';

      const rightPanel = isMd
        ? `<div id="md-live-preview" class="md-live-preview md-body" aria-label="Markdownプレビュー"></div>`
        : `<div class="code-highlight-wrap">
            <div class="code-highlight-head">シンタックスハイライト</div>
            <pre id="code-highlight-shell" class="code-highlight-shell"><code id="code-highlight" class="hljs"></code></pre>
          </div>`;
      const mdMode = getMarkdownEditorMode();
      const mdModeControls = isMd
        ? `<div class="editor-mode-toolbar" role="group" aria-label="Markdown表示切替">
            <button type="button" class="editor-mode-btn" data-mode="edit" aria-pressed="false" onclick="setMarkdownEditorMode('edit', ${pathExpr})">編集</button>
            <button type="button" class="editor-mode-btn" data-mode="preview" aria-pressed="false" onclick="setMarkdownEditorMode('preview', ${pathExpr})">プレビュー</button>
            <button type="button" class="editor-mode-btn" data-mode="split" aria-pressed="false" onclick="setMarkdownEditorMode('split', ${pathExpr})">分割</button>
          </div>`
        : '';

      el.innerHTML = `
        <div style="display:flex;gap:.5rem;margin-bottom:.25rem;align-items:center;flex-wrap:wrap;">
          <button class="btn btn-sm btn-accent" id="save-btn" onclick="saveFile(${pathExpr})">\uD83D\uDCBE 保存</button>
          <button class="btn btn-sm" onclick="openDiffViewer(${pathExpr})">\u0394 差分</button>
          <button class="btn btn-sm" onclick="openHistoryModal(${pathExpr})">\uD83D\uDCDC 履歴</button>
          <button class="btn btn-sm" onclick="toggleEditorSearch()">\uD83D\uDD0D 検索</button>
          ${mdModeControls}
          <button class="btn btn-sm" id="edit-lock-btn" onclick="toggleEditLock()">ロック取得</button>
          <button class="btn btn-sm" onclick="leaveEditRoom(); previewFile(${pathExpr})">キャンセル</button>
          <span id="save-status" style="font-size:.85rem;color:var(--text-secondary);"></span>
          <span id="edit-lock-status" style="font-size:.82rem;color:var(--text-secondary);">ロック確認中…</span>
          <div style="margin-left:auto;display:flex;align-items:center;gap:6px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#10b981;animation:pulse-live 2s infinite;"></span>
            <span id="live-editors-badge" style="font-size:.8rem;color:var(--text-secondary);">1 users</span>
            <span id="live-editor-dots" style="display:flex;gap:3px;"></span>
          </div>
        </div>
        <div id="editor-search-bar" class="editor-search-bar">
          <input id="editor-search-input" placeholder="検索…" oninput="doEditorSearch()" onkeydown="if(event.key==='Enter'){event.preventDefault(); editorSearchNext();}">
          <span id="editor-search-count" class="search-count"></span>
          <button class="btn btn-sm" onclick="editorSearchPrev()">\u25B2</button>
          <button class="btn btn-sm" onclick="editorSearchNext()">\u25BC</button>
          <input id="editor-replace-input" placeholder="置換…" onkeydown="if(event.key==='Enter'){event.preventDefault(); doEditorReplace();}">
          <button class="btn btn-sm" onclick="doEditorReplace()">置換</button>
          <button class="btn btn-sm" onclick="doEditorReplaceAll()">全置換</button>
          <button class="btn btn-sm btn-ghost" onclick="toggleEditorSearch()">\u2715</button>
        </div>
        <div id="remote-cursors-bar" style="display:flex;gap:6px;flex-wrap:wrap;min-height:18px;margin-bottom:2px;"></div>
        <div id="editor-split" class="editor-split${isMd ? ' md-editor-split' : ''}"${isMd ? ` data-md-mode="${mdMode}"` : ''}>
          <div class="editor-main-panel">
            <div id="cursor-overlay-container" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:5;"></div>
            <div class="editor-container">
              <div class="line-numbers" id="line-numbers"></div>
              <textarea id="edit-area" wrap="off" spellcheck="false" style="width:100%;height:100%;
              font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
              font-size:.9rem;background:var(--code-bg);color:var(--text);
              border:1px solid var(--border);padding:.75rem;
              resize:none;tab-size:2;line-height:1.6;white-space:pre;">${escapeHtml(data.content || '')}</textarea>
            </div>
          </div>
          ${rightPanel}
        </div>`;

      joinEditRoom(path);

      const area = getEditorArea();
      area.readOnly = true;
      document.getElementById('save-btn').disabled = true;
      updateLineNumbers();
      if (!isMd) syncHighlightedCode(path);
      if (isMd) {
        updateMdLivePreview(path);
        setMarkdownEditorMode(mdMode, path);
      }

      area.addEventListener('input', () => {
        editorDirty = true;
        updateLineNumbers();
        if (isMd) updateMdLivePreview(path);
        else syncHighlightedCode(path);
        broadcastChange(path);
      });
      area.addEventListener('click', () => broadcastCursor(path));
      area.addEventListener('keyup', () => broadcastCursor(path));
      area.addEventListener('scroll', () => {
        syncLineNumberScroll();
        if (!isMd) syncHighlightedCode(path);
        refreshRemoteCursors();
      });

      area.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          saveFile(path);
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'h' || e.key === 'H')) {
          e.preventDefault();
          toggleEditorSearch();
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          const s = area.selectionStart, end = area.selectionEnd;
          area.value = area.value.substring(0, s) + '  ' + area.value.substring(end);
          area.selectionStart = area.selectionEnd = s + 2;
          updateLineNumbers();
          if (isMd) updateMdLivePreview(path);
          else syncHighlightedCode(path);
          broadcastChange(path);
        }
      });
    })
    .catch(() => { el.textContent = '読み込みエラー'; });
}

async function saveFile(path) {
  const area = getEditorArea();
  const status = document.getElementById('save-status');
  if (!area) return;
  if (!canEditCurrentFile()) {
    showToast(`${currentEditLock?.holder?.ip || '他のユーザー'} が編集中です`, 'info');
    updateSaveStatus('readonly');
    return;
  }
  status.textContent = '保存中…';
  try {
    const res = await fetch('/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subpath: path, content: getEditorValue(), socketId: liveSocket?.id || '' })
    });
    const j = await res.json();
    if (!j.ok) { status.textContent = '保存失敗: ' + (j.error || ''); return; }
    editorDirty = false;
    updateSaveStatus('saved');
    showToast('保存しました', 'success');
  } catch (e) {
    console.error(e);
    status.textContent = '通信エラー';
  }
}

async function openDiffViewer(path) {
  const modal = document.getElementById('diff-backdrop');
  const body = document.getElementById('diff-body');
  const title = document.getElementById('diff-title');
  title.textContent = `差分ビュー: ${path}`;
  body.innerHTML = '<div style="padding:1rem;color:var(--text-secondary);">差分を計算中…</div>';
  modal.style.display = 'flex';

  try {
    const res = await fetch('/api/diff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subpath: path, content: getEditorValue() }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'diff error');
    body.innerHTML = `
      <div class="diff-stats">
        <span>+${data.stats.added}</span>
        <span>-${data.stats.removed}</span>
        <span>~${data.stats.changed}</span>
      </div>
      <div class="diff-table-wrap">${data.html}</div>`;
  } catch (e) {
    body.innerHTML = `<div style="padding:1rem;color:var(--danger);">${escapeHtml(e.message || '差分の取得に失敗しました')}</div>`;
  }
}

async function openHistoryModal(path) {
  const modal = document.getElementById('history-backdrop');
  const listEl = document.getElementById('history-list');
  const previewEl = document.getElementById('history-preview');
  const pathExpr = encodedPathExpr(path);
  document.getElementById('history-title').textContent = `変更履歴: ${path}`;
  listEl.innerHTML = '<div style="padding:1rem;color:var(--text-secondary);">履歴を読み込み中…</div>';
  previewEl.textContent = '左の履歴を選ぶと内容が表示されます';
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/api/history/${encodeURIComponent(path)}`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'history error');
    if (!data.versions.length) {
      listEl.innerHTML = '<div style="padding:1rem;color:var(--text-secondary);">履歴はまだありません</div>';
      return;
    }

    listEl.innerHTML = data.versions.map((version) => `
      <button class="history-item" onclick="showHistoryVersion(${pathExpr}, '${version.id}', this)">
        <strong>${escapeHtml(version.saved_at)}</strong>
        <span>${escapeHtml(version.author)} / ${escapeHtml(version.reason)}</span>
        <span>${version.size} chars</span>
      </button>
    `).join('');
  } catch (e) {
    listEl.innerHTML = `<div style="padding:1rem;color:var(--danger);">${escapeHtml(e.message || '履歴の取得に失敗しました')}</div>`;
  }
}

async function showHistoryVersion(path, versionId, btn) {
  document.querySelectorAll('.history-item.active').forEach(el => el.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const previewEl = document.getElementById('history-preview');
  previewEl.textContent = '読み込み中…';
  try {
    const res = await fetch(`/api/history/content/${encodeURIComponent(path)}?version_id=${encodeURIComponent(versionId)}`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'version error');
    const pathExpr = encodedPathExpr(path);
    previewEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:.75rem;margin-bottom:.75rem;flex-wrap:wrap;">
        <div style="font-size:.82rem;color:var(--text-secondary);">
          ${escapeHtml(data.meta.saved_at)} / ${escapeHtml(data.meta.author)} / ${escapeHtml(data.meta.reason)}
        </div>
        <button class="btn btn-sm btn-accent" onclick="restoreHistoryVersion(${pathExpr}, '${versionId}')">この版に戻す</button>
      </div>
      <pre class="history-preview-code">${escapeHtml(data.content || '')}</pre>`;
  } catch (e) {
    previewEl.innerHTML = `<div style="color:var(--danger);">${escapeHtml(e.message || '履歴内容の取得に失敗しました')}</div>`;
  }
}

async function restoreHistoryVersion(path, versionId) {
  if (!confirm('このバージョンに戻しますか？ 現在の内容は履歴に退避されます。')) return;
  try {
    const res = await fetch('/api/history/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subpath: path, versionId, socketId: liveSocket?.id || '' }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'restore error');
    if (path === liveEditPath && getEditorArea()) {
      setEditorValue(data.content || '');
      editorDirty = false;
    } else {
      previewFile(path);
    }
    showToast('履歴から復元しました', 'success');
    openHistoryModal(path);
  } catch (e) {
    showToast(e.message || '復元に失敗しました', 'error');
  }
}

function handleSystemNotice(data) {
  if (!data || !data.message) return;
  if (data.actor && data.actor === window.__clientIp) return;
  showToast(`${data.actor || '他のユーザー'}: ${data.message}`, 'info', 3500);

  // ファイルリストをリアルタイム更新（現在のディレクトリに関係あれば）
  const affectedDir = data.directory || '';
  const currentDir = currentSubpath();
  if (affectedDir === currentDir || data.action === 'upload' || data.action === 'mkdir' || data.action === 'mkfile') {
    refreshFileList();
  }
  if (['upload', 'delete', 'trash', 'delete-multi', 'trash-multi', 'move', 'move-multi', 'copy', 'rename', 'mkdir', 'mkfile'].includes(data.action)) {
    fetchDashboardInfo();
    fetchStorageInfo();
  }
}

let _refreshTimer = null;
function refreshFileList() {
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/entries/${encodeURIComponent(currentSubpath())}`);
      const data = await res.json();
      if (!data.ok) return;
      renderFileList(data.entries);
      fetchDashboardInfo();
      fetchStorageInfo();
    } catch (e) {
      console.error('refreshFileList error', e);
    }
  }, 300);
}

function renderFileList(entries) {
  const container = document.getElementById('file-list');
  if (!container) return;
  const list = container.querySelector('.file-list-scroll') || container;
  const isGrid = container.classList.contains('grid-view');

  if (!entries.length) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon">&#128194;</div>
      <p class="empty-title">ファイルがありません</p>
      <p class="empty-desc">ドラッグ&ドロップまたはアップロードボタンで追加</p>
      <button class="btn btn-accent" onclick="openMkdir()" style="margin-top:.75rem;">+ 新規フォルダ作成</button>
    </div>`;
    updateProDashboard();
    return;
  }

  const IMG_EXTS = ['png','jpg','jpeg','gif','webp','bmp','svg'];

  list.innerHTML = entries.map(e => {
    const ext = e.name.includes('.') ? e.name.rsplit ? e.name.split('.').pop().toLowerCase() : e.name.split('.').pop().toLowerCase() : '';
    const isImg = IMG_EXTS.includes(ext) && e.type === 'file';
    const pe = encodedPathExpr(e.path);
    const ne = encodedPathExpr(e.name);
    const te = encodedPathExpr(e.type);
    const iconClass = e.type === 'folder' ? 'folder' : (ext ? 'ext-' + ext : 'ext-default');
    const iconContent = e.type === 'folder' ? '&#128193;' : (ext ? escapeHtml(ext.slice(0, 4)) : '?');
    const iconHtml = isImg
      ? `<div class="file-icon has-thumb"><img src="/thumbnail/${encodeURIComponent(e.path)}" alt="" loading="lazy"></div>`
      : `<div class="file-icon ${iconClass}">${iconContent}</div>`;
    const nameHtml = e.type === 'file'
      ? `<span class="file-name" onclick="previewFile(${pe}); addRecent(${pe}, ${ne});">${escapeHtml(e.name)}</span>`
      : `<a class="file-name" href="/browse/${encodeURIComponent(e.path)}">${escapeHtml(e.name)}/</a>`;
    const dlBtn = e.type === 'file'
      ? `<a class="action-btn" href="/download/${encodeURIComponent(e.path)}" download title="保存">&#x1F4BE;</a>`
      : `<a class="action-btn" href="/download-folder/${encodeURIComponent(e.path)}" title="ZIP">&#x1F4E6;</a>`;

    return `<div class="file-entry" data-path="${escapeHtml(e.path)}" data-name="${escapeHtml(e.name)}" data-type="${e.type}" data-size="${escapeHtml(e.size)}" data-size-bytes="${e.size_bytes}" data-mtime="${escapeHtml(e.mtime)}" oncontextmenu="showContextMenu(event, ${pe}, ${ne}, ${te})">
      <input type="checkbox" class="entry-cb" data-path="${escapeHtml(e.path)}" onchange="updateBatchBar()">
      <button class="star-btn" onclick="toggleFav(${pe}, ${ne}, ${te})" data-path="${escapeHtml(e.path)}">&#x2606;</button>
      ${iconHtml}
      <div class="file-info">
        ${nameHtml}
        <div class="file-meta"><span class="entry-size" ${e.type === 'folder' ? `data-folder-path="${escapeHtml(e.path)}"` : ''}>${e.type === 'folder' ? '...' : escapeHtml(e.size)}</span><span>${escapeHtml(e.mtime)}</span></div>
      </div>
      <div class="file-actions">
        <button class="action-btn" onclick="openRename(${pe}, ${ne})" title="リネーム">&#x270F;&#xFE0F;</button>
        ${dlBtn}
        <button class="action-btn danger" onclick="deletePath(${pe}, ${e.type === 'folder'})" title="削除">&#x1F5D1;</button>
      </div>
    </div>`;
  }).join('');

  // 再初期化
  refreshStars();
  initMoveDragAndDrop();
  const savedSort = localStorage.getItem('sortOrder');
  if (savedSort) {
    const sel = document.getElementById('sort-select');
    if (sel) { sel.value = savedSort; sortEntries(); }
  }
  filterEntries();
  // フォルダサイズを非同期で取得
  lazyLoadFolderSizes();
  updateProDashboard();
}

function lazyLoadFolderSizes() {
  document.querySelectorAll('.entry-size[data-folder-path]').forEach(el => {
    const p = el.getAttribute('data-folder-path');
    fetch(`/api/folder-size/${encodeURIComponent(p)}`)
      .then(r => r.json())
      .then(d => { if (d.ok) el.textContent = d.size; })
      .catch(() => { el.textContent = '-'; });
  });
}

function toggleChatDrawer(forceOpen = null) {
  const drawer = document.getElementById('chat-drawer');
  if (!drawer) return;
  const shouldOpen = forceOpen == null ? !drawer.classList.contains('open') : forceOpen;
  drawer.classList.toggle('open', shouldOpen);
  if (shouldOpen) {
    document.getElementById('chat-input')?.focus();
    document.getElementById('chat-unread')?.classList.remove('visible');
  }
}

function appendChatMessage(message, fromSocket = false) {
  if (!message?.id || chatMessages.some(entry => entry.id === message.id)) return;
  chatMessages.push(message);
  chatMessages = chatMessages.slice(-80);
  if (currentChatChannel === 'all') {
    renderChatMessages();
  }
  if (fromSocket && !document.getElementById('chat-drawer')?.classList.contains('open') && message.author !== window.__clientIp) {
    document.getElementById('chat-unread')?.classList.add('visible');
    showToast(`${message.author}: ${message.text.slice(0, 48)}`, 'info');
  }
}

function renderChatMessages() {
  const body = document.getElementById('chat-messages');
  if (!body) return;
  if (!chatMessages.length) {
    body.innerHTML = '<div class="chat-empty">まだメッセージがありません</div>';
    return;
  }
  body.innerHTML = chatMessages.map((message) => `
    <div class="chat-message ${message.author === window.__clientIp ? 'self' : ''}">
      <div class="chat-meta">${escapeHtml(message.author)} <span>${escapeHtml(message.created_at || '')}</span></div>
      <div class="chat-text">${escapeHtml(message.text)}</div>
    </div>
  `).join('');
  body.scrollTop = body.scrollHeight;
}

async function fetchChatHistory() {
  try {
    const res = await fetch('/api/chat');
    const data = await res.json();
    if (!res.ok || !data.ok) return;
    chatMessages = data.messages || [];
    renderChatMessages();
  } catch (e) {
    console.error('chat history error', e);
  }
}

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = (input?.value || '').trim();
  if (!text) return;
  initLiveSocket().emit('chat_send', { text });
  input.value = '';
}

function sendCurrentMessage() {
  if (currentChatChannel === 'all') {
    sendChatMessage();
  } else {
    sendDmMessage(currentChatChannel);
  }
}

function sendDmMessage(targetIp) {
  const input = document.getElementById('chat-input');
  const text = (input?.value || '').trim();
  if (!text) return;
  initLiveSocket().emit('dm_send', { text, targetIp });
  input.value = '';
}

function renderOnlineUsers() {
  const listEl = document.getElementById('chat-user-list');
  const countEl = document.getElementById('chat-online-count');
  if (!listEl) return;
  if (countEl) countEl.textContent = `(${onlineUsers.length}人)`;

  listEl.innerHTML = onlineUsers
    .filter(u => u.ip !== window.__clientIp)
    .map(u => {
      const isActive = currentChatChannel === u.ip;
      const hasUnread = dmUnread[u.ip];
      return `<button class="chat-channel-tab${isActive ? ' active' : ''}" onclick="switchChatChannel('${escapeHtml(u.ip)}')" title="${escapeHtml(u.ip)}">
        <span class="chat-user-dot" style="background:${u.color};"></span>
        ${escapeHtml(u.ip)}
        <span class="dm-unread${hasUnread ? ' visible' : ''}"></span>
      </button>`;
    }).join('');
}

async function switchChatChannel(channel) {
  currentChatChannel = channel;
  const body = document.getElementById('chat-messages');
  const title = document.getElementById('chat-header-title');
  const input = document.getElementById('chat-input');
  const allTab = document.getElementById('chat-tab-all');

  // タブのアクティブ状態更新
  allTab.classList.toggle('active', channel === 'all');
  if (channel !== 'all') {
    dmUnread[channel] = false;
  }
  renderOnlineUsers();

  if (channel === 'all') {
    title.textContent = 'チームチャット';
    input.placeholder = 'メッセージを入力…';
    renderChatMessages();
  } else {
    title.textContent = `DM: ${channel}`;
    input.placeholder = `${channel} にメッセージ…`;
    // DM履歴を取得
    if (!dmMessages[channel] || dmMessages[channel].length === 0) {
      body.innerHTML = '<div class="chat-empty">読み込み中…</div>';
      try {
        const res = await fetch(`/api/dm/${encodeURIComponent(channel)}`);
        const data = await res.json();
        if (data.ok) {
          dmMessages[channel] = data.messages || [];
        }
      } catch (e) {
        console.error('DM history fetch error', e);
      }
    }
    renderDmMessages(channel);
  }
  input?.focus();
}

function renderDmMessages(peerIp) {
  const body = document.getElementById('chat-messages');
  if (!body) return;
  const messages = dmMessages[peerIp] || [];
  if (!messages.length) {
    body.innerHTML = '<div class="chat-empty">まだメッセージがありません</div>';
    return;
  }
  body.innerHTML = messages.map(m => `
    <div class="chat-message ${m.author === window.__clientIp ? 'self' : ''}">
      <div class="chat-meta">${escapeHtml(m.author)} <span>${escapeHtml(m.created_at || '')}</span></div>
      <div class="chat-text">${escapeHtml(m.text)}</div>
    </div>
  `).join('');
  body.scrollTop = body.scrollHeight;
}

function renderClipboardEntries() {
  const body = document.getElementById('clipboard-list');
  if (!body) return;
  if (!clipboardEntries.length) {
    body.innerHTML = '<div class="clipboard-empty">まだ共有テキストがありません</div>';
    return;
  }
  body.innerHTML = clipboardEntries.map((entry) => `
    <div class="clipboard-item">
      <div class="clipboard-item-head">
        <strong>${escapeHtml(entry.author || 'unknown')}</strong>
        <span>${escapeHtml(entry.created_at || '')}</span>
      </div>
      <pre>${escapeHtml(entry.text || '')}</pre>
      <div class="clipboard-item-actions">
        <button class="btn btn-sm" onclick="copyClipboardEntry('${entry.id}')">コピー</button>
        <button class="btn btn-sm btn-danger" onclick="removeClipboardEntry('${entry.id}')">削除</button>
      </div>
    </div>
  `).join('');
}

async function openClipboardModal() {
  document.getElementById('clipboard-backdrop').style.display = 'flex';
  try {
    const res = await fetch('/api/clipboard');
    const data = await res.json();
    if (res.ok && data.ok) {
      clipboardEntries = data.entries || [];
      renderClipboardEntries();
    }
  } catch (e) {
    console.error('clipboard fetch error', e);
  }
}

async function saveSharedClipboard() {
  const input = document.getElementById('clipboard-input');
  const text = (input?.value || '').trim();
  if (!text) return;
  try {
    const res = await fetch('/api/clipboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'clipboard error');
    clipboardEntries = data.entries || [];
    renderClipboardEntries();
    input.value = '';
    showToast('共有クリップボードに追加しました', 'success');
  } catch (e) {
    showToast(e.message || '保存に失敗しました', 'error');
  }
}

function copyClipboardEntry(id) {
  const entry = clipboardEntries.find(item => item.id === id);
  if (!entry) return;
  navigator.clipboard.writeText(entry.text || '').then(() => {
    showToast('コピーしました', 'success');
  }).catch(() => showToast('コピーに失敗しました', 'error'));
}

async function removeClipboardEntry(id) {
  try {
    const res = await fetch('/api/clipboard', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'delete error');
    clipboardEntries = data.entries || [];
    renderClipboardEntries();
  } catch (e) {
    showToast(e.message || '削除に失敗しました', 'error');
  }
}

function openCompareModal(prefillPath = '') {
  const selected = getSelectedPaths().filter(isTextFilePath);
  const left = document.getElementById('compare-left');
  const right = document.getElementById('compare-right');
  const datalist = document.getElementById('compare-files');
  const options = [...document.querySelectorAll('.file-entry[data-type="file"]')]
    .map(el => el.dataset.path)
    .filter(isTextFilePath);
  datalist.innerHTML = options.map(path => `<option value="${escapeHtml(path)}"></option>`).join('');

  if (selected.length >= 2) {
    left.value = selected[0];
    right.value = selected[1];
  } else {
    left.value = prefillPath || currentPreviewPath || '';
    right.value = '';
  }
  document.getElementById('compare-result').innerHTML = '<div style="padding:1rem;color:var(--text-secondary);">比較する2つのテキストファイルを指定してください</div>';
  document.getElementById('compare-backdrop').style.display = 'flex';
}

async function runCompare() {
  const leftPath = (document.getElementById('compare-left').value || '').trim();
  const rightPath = (document.getElementById('compare-right').value || '').trim();
  const result = document.getElementById('compare-result');
  if (!leftPath || !rightPath) {
    result.innerHTML = '<div style="padding:1rem;color:var(--danger);">2つのファイルを指定してください</div>';
    return;
  }
  result.innerHTML = '<div style="padding:1rem;color:var(--text-secondary);">比較中…</div>';

  try {
    const res = await fetch('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leftPath, rightPath }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'compare error');
    result.innerHTML = `
      <div class="diff-stats">
        <span>+${data.stats.added}</span>
        <span>-${data.stats.removed}</span>
        <span>~${data.stats.changed}</span>
      </div>
      <div class="diff-table-wrap">${data.html}</div>`;
  } catch (e) {
    result.innerHTML = `<div style="padding:1rem;color:var(--danger);">${escapeHtml(e.message || '比較に失敗しました')}</div>`;
  }
}

function openTerminalModal() {
  if (appSettings && appSettings.terminal_available === false) {
    showToast(appSettings.admin_mode_enabled ? 'ターミナルはこのPC上のブラウザからのみ利用できます' : 'ターミナルは管理者モードで有効化できます', 'info');
    return;
  }
  document.getElementById('terminal-backdrop').style.display = 'flex';
  document.getElementById('terminal-command').focus();
  document.getElementById('terminal-cwd').textContent = currentSubpath() || '(files root)';
}

function clearTerminalOutput() {
  document.getElementById('terminal-output').textContent = '';
}

async function runTerminalCommand() {
  const commandInput = document.getElementById('terminal-command');
  const output = document.getElementById('terminal-output');
  const scope = document.getElementById('terminal-scope').value;
  const timeout = parseInt(document.getElementById('terminal-timeout')?.value || '15', 10);
  const command = (commandInput.value || '').trim();
  if (!command) return;

  output.textContent += `\n> ${command}\n`;
  try {
    const res = await fetch('/api/terminal/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command,
        cwd: currentSubpath(),
        scope,
        timeout,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      output.textContent += `${data.error || '実行エラー'}\n`;
      output.scrollTop = output.scrollHeight;
      return;
    }
    output.textContent += `[cwd] ${data.cwd}\n`;
    if (data.stdout) output.textContent += `${data.stdout}\n`;
    if (data.stderr) output.textContent += `${data.stderr}\n`;
    output.textContent += `[exit] ${data.code}\n`;
    output.scrollTop = output.scrollHeight;
  } catch (e) {
    output.textContent += `${e.message || '通信エラー'}\n`;
    output.scrollTop = output.scrollHeight;
  }
}

function getImageEditorCanvas() {
  return document.getElementById('image-editor-canvas');
}

function updateImageEditorSizeFields() {
  const canvas = getImageEditorCanvas();
  if (!canvas) return;
  document.getElementById('image-width').value = canvas.width;
  document.getElementById('image-height').value = canvas.height;
  document.getElementById('crop-width').value = canvas.width;
  document.getElementById('crop-height').value = canvas.height;
}

function redrawImageEditorFromSource() {
  if (!imageEditorState?.image) return;
  const canvas = getImageEditorCanvas();
  const ctx = canvas.getContext('2d');
  canvas.width = imageEditorState.image.naturalWidth;
  canvas.height = imageEditorState.image.naturalHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(imageEditorState.image, 0, 0);
  document.getElementById('crop-x').value = 0;
  document.getElementById('crop-y').value = 0;
  updateImageEditorSizeFields();
}

function openImageEditor(path) {
  document.getElementById('image-editor-title').textContent = `画像編集: ${path}`;
  document.getElementById('image-editor-backdrop').style.display = 'flex';
  const image = new Image();
  image.onload = () => {
    imageEditorState = { path, image };
    redrawImageEditorFromSource();
  };
  image.onerror = () => {
    closeModal('image-editor-backdrop');
    showToast('画像の読み込みに失敗しました', 'error');
  };
  image.src = `/raw/${encodeURIComponent(path)}?t=${Date.now()}`;
}

function resizeEditedImage() {
  const canvas = getImageEditorCanvas();
  const nextWidth = Number(document.getElementById('image-width').value || canvas.width);
  const nextHeight = Number(document.getElementById('image-height').value || canvas.height);
  if (!nextWidth || !nextHeight) return;
  const temp = document.createElement('canvas');
  temp.width = nextWidth;
  temp.height = nextHeight;
  temp.getContext('2d').drawImage(canvas, 0, 0, nextWidth, nextHeight);
  canvas.width = nextWidth;
  canvas.height = nextHeight;
  canvas.getContext('2d').drawImage(temp, 0, 0);
  updateImageEditorSizeFields();
}

function rotateEditedImage(direction) {
  const canvas = getImageEditorCanvas();
  const temp = document.createElement('canvas');
  const clockwise = direction === 'right';
  temp.width = canvas.height;
  temp.height = canvas.width;
  const ctx = temp.getContext('2d');
  ctx.translate(temp.width / 2, temp.height / 2);
  ctx.rotate((clockwise ? 90 : -90) * Math.PI / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  canvas.width = temp.width;
  canvas.height = temp.height;
  canvas.getContext('2d').drawImage(temp, 0, 0);
  updateImageEditorSizeFields();
}

function cropEditedImage() {
  const canvas = getImageEditorCanvas();
  const x = Number(document.getElementById('crop-x').value || 0);
  const y = Number(document.getElementById('crop-y').value || 0);
  const width = Number(document.getElementById('crop-width').value || canvas.width);
  const height = Number(document.getElementById('crop-height').value || canvas.height);
  if (!width || !height) return;

  const temp = document.createElement('canvas');
  temp.width = width;
  temp.height = height;
  temp.getContext('2d').drawImage(canvas, x, y, width, height, 0, 0, width, height);
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(temp, 0, 0);
  updateImageEditorSizeFields();
}

async function saveEditedImage() {
  if (!imageEditorState?.path) return;
  const canvas = getImageEditorCanvas();
  const targetPath = imageEditorState.path;
  try {
    const res = await fetch('/api/image/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subpath: targetPath,
        dataUrl: canvas.toDataURL(getCurrentImageMime(targetPath), 0.92),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'image save error');
    showToast('画像を保存しました', 'success');
    closeModal('image-editor-backdrop');
    previewFile(targetPath);
  } catch (e) {
    showToast(e.message || '画像保存に失敗しました', 'error');
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
    body.innerHTML = j.results.map(r => {
      const pe = encodedPathExpr(r.path);
      const ne = encodedPathExpr(r.name);
      const action = r.type === 'file'
        ? `previewFile(${pe}); addRecent(${pe},${ne})`
        : `location.href='/browse/'+encodeURIComponent(${pe})`;
      return `<div class="search-result">
        <div class="search-result-path" onclick="${action}">
          ${r.type === 'folder' ? '\uD83D\uDCC1' : '\uD83D\uDCC4'} ${escapeHtml(r.path)}
          ${r.nameMatch ? '<span class="search-badge">名前</span>' : ''}
          ${r.contentMatch ? '<span class="search-badge">内容</span>' : ''}
        </div>
        ${r.snippet ? `<div class="search-result-snippet">${escapeHtml(r.snippet)}</div>` : ''}
      </div>`;
    }).join('');
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
    if (j.ok) {
      _favsCache = j.favs || [];
      window.__clientIp = j.ip || window.__clientIp;
    }
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
  body.innerHTML = _favsCache.map(f => {
    const pe = encodedPathExpr(f.path);
    const ne = encodedPathExpr(f.name);
    const action = f.type === 'file'
      ? `previewFile(${pe}); addRecent(${pe},${ne})`
      : `location.href='/browse/'+encodeURIComponent(${pe})`;
    return `<div class="side-panel-item" onclick="${action}">
      ${f.type === 'folder' ? '\uD83D\uDCC1' : '\uD83D\uDCC4'} ${escapeHtml(f.name)}
    </div>`;
  }).join('');
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
    const pe = encodedPathExpr(r.path);
    return `
      <div class="side-panel-item" onclick="previewFile(${pe})">
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
function applyAppSettings(settings = appSettings) {
  appSettings = { ...appSettings, ...(settings || {}) };
  const title = document.getElementById('workspace-title');
  if (title) title.textContent = appSettings.workspace_name || 'LAN Drive Pro';
  document.title = appSettings.workspace_name || 'LAN Drive Pro';

  const status = document.getElementById('security-status');
  if (status) {
    status.classList.toggle('secure', !!appSettings.share_key_enabled);
    status.classList.toggle('warning', !appSettings.share_key_enabled);
    status.innerHTML = appSettings.share_key_enabled ? '&#9679; 共有キーON' : '&#9679; LAN専用';
  }
  const terminalItem = document.getElementById('terminal-tool-item');
  if (terminalItem) terminalItem.hidden = !appSettings.terminal_available;
}

function openInitialSetupIfNeeded() {
  applyAppSettings();
  if (!appSettings.setup_complete) {
    openSetupWizard(true);
  }
}

function setErrorText(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message || '';
  el.style.display = message ? 'block' : 'none';
}

async function openQR() {
  document.getElementById('qr-backdrop').style.display = 'flex';
  const urlEl = document.getElementById('qr-url-input');
  const canvas = document.getElementById('qr-canvas');
  const ipBadge = document.getElementById('qr-ip-badge');
  const keyBadge = document.getElementById('qr-key-badge');
  if (urlEl) urlEl.value = '取得中...';
  if (ipBadge) ipBadge.textContent = 'IP --';
  if (keyBadge) keyBadge.textContent = '共有キー確認中';

  try {
    const path = encodeURIComponent(location.pathname + location.search);
    const res = await fetch(`/server-info?path=${path}`);
    const j = await res.json();
    latestShareUrl = j.url;
    if (urlEl) urlEl.value = j.url;
    if (ipBadge) ipBadge.textContent = `IP ${j.ip}:${j.port}`;
    if (j.settings) {
      applyAppSettings(j.settings);
      if (keyBadge) keyBadge.textContent = j.settings.share_key_enabled ? '共有キーON' : '共有キーOFF';
    }
    drawQR(canvas, j.url);
  } catch (e) {
    if (urlEl) urlEl.value = 'エラー: サーバー情報を取得できません';
  }
}

function copyShareUrl() {
  const input = document.getElementById('qr-url-input');
  const value = latestShareUrl || input?.value || '';
  if (!value || value.startsWith('取得中') || value.startsWith('エラー')) {
    showToast('共有URLを取得できていません', 'error');
    return;
  }
  navigator.clipboard?.writeText(value).then(() => {
    showToast('共有URLをコピーしました', 'success');
  }).catch(() => {
    prompt('共有URL:', value);
  });
}

async function openReceiveMode() {
  document.getElementById('receive-backdrop').style.display = 'flex';
  const path = encodeURIComponent(`/receive?path=${encodeURIComponent(currentSubpath())}`);
  const urlEl = document.getElementById('receive-url-input');
  const canvas = document.getElementById('receive-qr-canvas');
  const ipBadge = document.getElementById('receive-ip-badge');
  const limitBadge = document.getElementById('receive-limit-badge');
  const keyBadge = document.getElementById('receive-key-badge');
  if (urlEl) urlEl.value = '取得中...';
  if (ipBadge) ipBadge.textContent = 'IP --';
  if (limitBadge) limitBadge.textContent = '上限確認中';
  if (keyBadge) keyBadge.textContent = '共有キー確認中';

  try {
    const res = await fetch(`/server-info?path=${path}`);
    const j = await res.json();
    latestReceiveUrl = j.url;
    if (urlEl) urlEl.value = j.url;
    if (ipBadge) ipBadge.textContent = `IP ${j.ip}:${j.port}`;
    if (j.settings) {
      applyAppSettings(j.settings);
      if (limitBadge) limitBadge.textContent = `上限 ${j.settings.upload_limit_mb}MB`;
      if (keyBadge) keyBadge.textContent = j.settings.share_key_enabled ? '共有キーON' : '共有キーOFF';
    }
    drawQR(canvas, j.url, 280);
  } catch (e) {
    if (urlEl) urlEl.value = 'エラー: 受け取りURLを取得できません';
  }
}

function copyReceiveUrl() {
  const input = document.getElementById('receive-url-input');
  const value = latestReceiveUrl || input?.value || '';
  if (!value || value.startsWith('取得中') || value.startsWith('エラー')) {
    showToast('受け取りURLを取得できていません', 'error');
    return;
  }
  navigator.clipboard.writeText(value).then(() => {
    showToast('受け取りURLをコピーしました', 'success');
  }).catch(() => {
    prompt('受け取りURL:', value);
  });
}

function openReceivePage() {
  const value = latestReceiveUrl || document.getElementById('receive-url-input')?.value || `/receive?path=${encodeURIComponent(currentSubpath())}`;
  window.open(value, '_blank', 'noopener');
}

function drawQR(canvas, text, size = 204) {
  const ctx = canvas.getContext('2d');
  canvas.width = size;
  canvas.height = size;

  if (window.qrcode) {
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const margin = 10;
    const cellSize = Math.floor((size - margin * 2) / count);
    const qrSize = cellSize * count;
    const offset = Math.floor((size - qrSize) / 2);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect(offset + c * cellSize, offset + r * cellSize, cellSize, cellSize);
        }
      }
    }
    return;
  }

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

/* ========= Setup & Share Settings ========= */
function openSetupWizard(required = false) {
  const backdrop = document.getElementById('setup-backdrop');
  const closeBtn = document.getElementById('setup-close-btn');
  if (!backdrop) return;
  const nameInput = document.getElementById('setup-workspace-name');
  const keyEnabled = document.getElementById('setup-share-key-enabled');
  const keyInput = document.getElementById('setup-share-key');
  if (nameInput) nameInput.value = appSettings.workspace_name || 'LAN Drive Pro';
  if (keyEnabled) keyEnabled.checked = true;
  if (keyInput) keyInput.value = '';
  setErrorText('setup-error', '');
  backdrop.dataset.required = required ? '1' : '0';
  if (closeBtn) closeBtn.style.display = required ? 'none' : '';
  toggleSetupKeyFields('setup');
  backdrop.style.display = 'flex';
}

function handleSetupBackdropClick(event) {
  const backdrop = document.getElementById('setup-backdrop');
  if (backdrop?.dataset.required === '1') return;
  if (event.target === backdrop) closeModal('setup-backdrop');
}

function toggleSetupKeyFields(scope) {
  const enabled = document.getElementById(`${scope}-share-key-enabled`)?.checked;
  const row = document.getElementById(`${scope}-share-key-row`);
  if (row) row.style.display = enabled ? 'grid' : 'none';
}

async function submitSetup(skipKey = false) {
  const name = document.getElementById('setup-workspace-name')?.value.trim() || 'LAN Drive Pro';
  const enabledEl = document.getElementById('setup-share-key-enabled');
  const keyEl = document.getElementById('setup-share-key');
  const shareKeyEnabled = skipKey ? false : !!enabledEl?.checked;
  const shareKey = keyEl?.value.trim() || '';
  setErrorText('setup-error', '');

  try {
    const res = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceName: name,
        shareKeyEnabled,
        shareKey,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || '設定を保存できませんでした');
    applyAppSettings(data.settings);
    closeModal('setup-backdrop');
    showToast('初回セットアップを保存しました', 'success');
    setTimeout(() => openQR(), 350);
  } catch (error) {
    setErrorText('setup-error', error.message || '設定を保存できませんでした');
  }
}

function openSettingsModal() {
  const nameInput = document.getElementById('settings-workspace-name');
  const keyEnabled = document.getElementById('settings-share-key-enabled');
  const keyInput = document.getElementById('settings-share-key');
  const advancedPanel = document.getElementById('advanced-settings-panel');
  if (nameInput) nameInput.value = appSettings.workspace_name || 'LAN Drive Pro';
  if (keyEnabled) keyEnabled.checked = !!appSettings.share_key_enabled;
  if (keyInput) keyInput.value = '';
  const portInput = document.getElementById('settings-port');
  const storageInput = document.getElementById('settings-storage-path');
  const uploadLimitInput = document.getElementById('settings-upload-limit-mb');
  const shareExpireInput = document.getElementById('settings-share-expire-hours');
  const adminModeInput = document.getElementById('settings-admin-mode-enabled');
  const terminalAdminOnlyInput = document.getElementById('settings-terminal-admin-only');
  const canManageAdvanced = !!appSettings.admin_controls_available;
  if (advancedPanel) advancedPanel.style.display = canManageAdvanced ? 'grid' : 'none';
  if (portInput) portInput.value = appSettings.server_port || 5000;
  if (storageInput) storageInput.value = appSettings.storage_path || '';
  if (uploadLimitInput) uploadLimitInput.value = appSettings.upload_limit_mb || 2048;
  if (shareExpireInput) shareExpireInput.value = appSettings.share_link_expire_hours || 72;
  if (adminModeInput) adminModeInput.checked = !!appSettings.admin_mode_enabled;
  if (terminalAdminOnlyInput) terminalAdminOnlyInput.checked = appSettings.terminal_admin_only !== false;
  setErrorText('settings-error', '');
  toggleSetupKeyFields('settings');
  document.getElementById('settings-backdrop').style.display = 'flex';
}

async function submitSettings() {
  const name = document.getElementById('settings-workspace-name')?.value.trim() || 'LAN Drive Pro';
  const shareKeyEnabled = !!document.getElementById('settings-share-key-enabled')?.checked;
  const shareKey = document.getElementById('settings-share-key')?.value.trim() || '';
  const payload = {
    workspaceName: name,
    shareKeyEnabled,
    shareKey,
  };
  if (appSettings.admin_controls_available) {
    payload.serverPort = document.getElementById('settings-port')?.value || appSettings.server_port || 5000;
    payload.storagePath = document.getElementById('settings-storage-path')?.value || appSettings.storage_path || '';
    payload.uploadLimitMb = document.getElementById('settings-upload-limit-mb')?.value || appSettings.upload_limit_mb || 2048;
    payload.shareLinkExpireHours = document.getElementById('settings-share-expire-hours')?.value || appSettings.share_link_expire_hours || 72;
    payload.adminModeEnabled = !!document.getElementById('settings-admin-mode-enabled')?.checked;
    payload.terminalAdminOnly = document.getElementById('settings-terminal-admin-only')?.checked !== false;
  }
  setErrorText('settings-error', '');

  try {
    const res = await fetch('/api/app-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || '設定を保存できませんでした');
    applyAppSettings(data.settings);
    closeModal('settings-backdrop');
    showToast('共有設定を保存しました', 'success');
  } catch (error) {
    setErrorText('settings-error', error.message || '設定を保存できませんでした');
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

function compactPathLabel(path) {
  if (!path) return 'files';
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 2) return `files/${parts.join('/')}`;
  return `files/.../${parts.slice(-2).join('/')}`;
}

function getVisibleFileEntries() {
  return [...document.querySelectorAll('.file-entry')]
    .filter(entry => entry.style.display !== 'none');
}

function getPreviewActionCapabilities(path = currentPreviewPath) {
  if (!path) return { canEdit: false, canCompare: false, editKind: '' };
  const name = (path.split('/').pop() || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  const imageEditable = IMAGE_EDITABLE_EXTENSIONS.includes(ext);
  const textEditable = isTextFilePath(path);
  return {
    canEdit: imageEditable || textEditable,
    canCompare: textEditable,
    editKind: imageEditable ? 'image' : textEditable ? 'text' : '',
  };
}

function runPreviewEditAction() {
  const path = currentPreviewPath;
  const caps = getPreviewActionCapabilities(path);
  if (!path || !caps.canEdit) {
    showToast('編集できるファイルを選択してください', 'info');
    return;
  }
  if (caps.editKind === 'image') {
    openImageEditor(path);
  } else {
    editFile(path);
  }
}

function runPreviewCompareAction() {
  const path = currentPreviewPath;
  const caps = getPreviewActionCapabilities(path);
  if (!path || !caps.canCompare) {
    showToast('比較できるテキストファイルを選択してください', 'info');
    return;
  }
  openCompareModal(path);
}

function fileBadgeLabel(file) {
  const ext = (file.extension || (file.name || '').split('.').pop() || '').toLowerCase();
  return ext && ext !== file.name?.toLowerCase() ? ext.slice(0, 4) : 'file';
}

function renderInboxItems(files, options = {}) {
  const items = (files || []).slice(0, options.limit || (files || []).length);
  if (!items.length) {
    return `<div class="inbox-empty">${escapeHtml(options.emptyText || 'まだ受付ファイルがありません')}</div>`;
  }
  return items.map(file => {
    const pe = encodedPathExpr(file.path);
    const ne = encodedPathExpr(file.name || file.path);
    const ext = (file.extension || '').toLowerCase();
    const safeExt = ext.replace(/[^a-z0-9_-]/g, '');
    const iconClass = safeExt ? `ext-${safeExt}` : 'ext-default';
    const label = escapeHtml(fileBadgeLabel(file));
    const meta = `${file.size || ''}${file.path ? ' / ' + file.path : ''}`;
    return `<button class="dashboard-inbox-item" onclick="previewFile(${pe}); addRecent(${pe}, ${ne});">
      <span class="file-icon ${iconClass}">${label}</span>
      <span class="dashboard-inbox-file">
        <strong>${escapeHtml(file.name || file.path)}</strong>
        <span>${escapeHtml(meta)}</span>
      </span>
      <span class="dashboard-inbox-time">${escapeHtml(file.mtime || '')}</span>
    </button>`;
  }).join('');
}

function updateDashboardFromServer(data) {
  dashboardState = { ...dashboardState, ...(data || {}) };
  const todayEl = document.getElementById('deck-today');
  const todayDetailEl = document.getElementById('deck-today-detail');
  const sharesEl = document.getElementById('deck-shares');
  const sharesDetailEl = document.getElementById('deck-shares-detail');
  const inboxEl = document.getElementById('dashboard-inbox-list');
  const inboxSummaryEl = document.getElementById('dashboard-inbox-summary');

  if (todayEl) todayEl.textContent = `${dashboardState.today_files || 0}件`;
  if (todayDetailEl) todayDetailEl.textContent = `${dashboardState.today_size_h || '0 B'} / 本日追加`;
  if (sharesEl) sharesEl.textContent = `${dashboardState.active_share_links || 0}件`;
  if (sharesDetailEl) {
    sharesDetailEl.textContent = `${dashboardState.share_link_expire_hours || appSettings.share_link_expire_hours || 72}時間で自動期限切れ`;
  }
  if (inboxEl) {
    inboxEl.innerHTML = renderInboxItems(dashboardState.recent_files || [], {
      emptyText: '受付QRから届いたファイルがここに並びます',
      limit: 2,
    });
  }
  if (inboxSummaryEl) {
    const count = Math.min(dashboardState.recent_files?.length || 0, 2);
    inboxSummaryEl.textContent = count ? `直近${count}件を表示` : '直近の受付ファイル';
  }
}

async function fetchDashboardInfo(limit = 2) {
  try {
    const res = await fetch(`/api/dashboard?limit=${encodeURIComponent(limit)}`);
    const data = await res.json();
    if (!res.ok || !data.ok) return;
    updateDashboardFromServer(data.dashboard || {});
  } catch (e) {
    console.error('dashboard info error', e);
  }
}

async function openInboxPanel() {
  const panel = document.getElementById('side-panel');
  const body = document.getElementById('side-panel-body');
  const title = document.getElementById('side-panel-title');
  if (!panel || !body || !title) return;
  title.textContent = '\uD83D\uDCE5 受信トレイ';
  body.innerHTML = '<div style="padding:1rem;color:var(--text-secondary);">受信トレイを読み込み中...</div>';
  panel.classList.add('active');

  try {
    const res = await fetch('/api/dashboard?limit=40');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error('dashboard error');
    const files = data.dashboard?.recent_files || [];
    updateDashboardFromServer(data.dashboard || {});
    body.innerHTML = files.length
      ? renderInboxItems(files, { emptyText: '受付ファイルがありません' })
      : '<div style="padding:1rem;color:var(--text-secondary);">受付ファイルがありません</div>';
  } catch (e) {
    console.error(e);
    body.innerHTML = '<div style="padding:1rem;color:var(--danger);">受信トレイを読み込めませんでした</div>';
  }
}

function updatePreviewHeader(path = currentPreviewPath) {
  const title = document.getElementById('preview-pane-title');
  const subtitle = document.getElementById('preview-pane-subtitle');
  const editBtn = document.getElementById('preview-edit-btn');
  const compareBtn = document.getElementById('preview-compare-btn');
  const infoBtn = document.getElementById('preview-info-btn');
  const copyBtn = document.getElementById('preview-copy-btn');
  const hasPath = Boolean(path);
  const caps = getPreviewActionCapabilities(path);

  if (title) title.textContent = hasPath ? (path.split('/').pop() || path) : 'プレビュー';
  if (subtitle) subtitle.textContent = hasPath ? path : 'ファイルを選択すると内容を表示します';
  if (editBtn) {
    editBtn.hidden = !caps.canEdit;
    editBtn.innerHTML = caps.editKind === 'image' ? '&#x1F5BC; 画像編集' : '&#x270F;&#xFE0F; 編集';
    editBtn.title = caps.editKind === 'image' ? '画像編集' : '編集';
  }
  if (compareBtn) compareBtn.hidden = !caps.canCompare;
  if (infoBtn) infoBtn.disabled = !hasPath;
  if (copyBtn) copyBtn.disabled = !hasPath;
}

function updateProDashboard() {
  const entries = getVisibleFileEntries();
  const folderCount = entries.filter(entry => entry.dataset.type === 'folder').length;
  const fileCount = entries.filter(entry => entry.dataset.type === 'file').length;
  const selectedCount = document.querySelectorAll('.entry-cb:checked').length;
  const totalBytes = entries
    .filter(entry => entry.dataset.type === 'file')
    .reduce((sum, entry) => sum + Number(entry.dataset.sizeBytes || 0), 0);

  const locationLabel = compactPathLabel(currentSubpath());
  const locationEl = document.getElementById('deck-location');
  const visibleEl = document.getElementById('deck-visible');
  const visibleDetailEl = document.getElementById('deck-visible-detail');
  const selectedEl = document.getElementById('deck-selected');
  const previewEl = document.getElementById('deck-preview');
  const paneSubtitle = document.getElementById('file-pane-subtitle');

  if (locationEl) locationEl.textContent = locationLabel;
  if (visibleEl) visibleEl.textContent = `${entries.length}件`;
  if (visibleDetailEl) {
    const sizeLabel = totalBytes > 0 ? ` / ${formatBytesCompact(totalBytes)}` : '';
    visibleDetailEl.textContent = `${folderCount}フォルダ / ${fileCount}ファイル${sizeLabel}`;
  }
  const previewLabel = currentPreviewPath ? (currentPreviewPath.split('/').pop() || currentPreviewPath) : '未選択';
  if (selectedEl) {
    selectedEl.textContent = `${selectedCount}件`;
    selectedEl.setAttribute('data-preview', previewLabel);
  }
  if (previewEl) previewEl.textContent = previewLabel;
  if (paneSubtitle) paneSubtitle.textContent = `${locationLabel}  ${folderCount}フォルダ / ${fileCount}ファイル`;
  updatePreviewHeader();
}

function formatBytesCompact(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  const digits = unit === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[unit]}`;
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
      fileList.style.flex = '0 0 ' + newWidth + 'px';
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
      toggleChatDrawer(false);
      ['readme-backdrop', 'input-backdrop', 'qr-backdrop', 'receive-backdrop', 'setup-backdrop', 'settings-backdrop', 'diff-backdrop', 'history-backdrop', 'compare-backdrop', 'terminal-backdrop', 'clipboard-backdrop', 'image-editor-backdrop'].forEach(id => {
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
  applyCommandDeckVisibility();

  // ソート順の復元
  const savedSort = localStorage.getItem('sortOrder');
  const sortSel = document.getElementById('sort-select');
  if (savedSort && sortSel) {
    sortSel.value = savedSort;
    sortEntries();
  }

  initMoveDragAndDrop();
  initResizer();
  initKeyboardShortcuts();
  initLiveSocket();
  fetchChatHistory();
  fetchFavs().then(() => refreshStars());
  fetchStorageInfo();
  fetchDashboardInfo();
  updateProDashboard();
  updatePreviewHeader();
  applyAppSettings();
  openInitialSetupIfNeeded();

  document.getElementById('chat-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendCurrentMessage();
    }
  });
  document.getElementById('terminal-command')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runTerminalCommand();
    }
  });

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

  const allEntries = [...formData.entries()];
  const fileCount = allEntries.length;
  if (fileCount === 0) {
    showToast('アップロード対象がありません', 'error'); return;
  }
  const totalUploadBytes = allEntries.reduce((sum, entry) => sum + Number(entry[1]?.size || 0), 0);
  const uploadLimitMb = Number(appSettings.upload_limit_mb || 0);
  const uploadLimitBytes = uploadLimitMb * 1024 * 1024;
  if (uploadLimitMb > 0 && totalUploadBytes > uploadLimitBytes) {
    showToast(`アップロード上限を超えています（上限 ${uploadLimitMb}MB / 選択 ${formatBytesCompact(totalUploadBytes)}）`, 'error');
    return;
  }

  const progressEl = document.getElementById('upload-progress');
  const barEl = document.getElementById('upload-bar');
  const pctEl = document.getElementById('upload-pct');
  const sizeEl = document.getElementById('upload-size-info');
  const speedEl = document.getElementById('upload-speed');
  const etaEl = document.getElementById('upload-eta');

  progressEl.style.display = 'block';
  barEl.style.width = '0%';
  pctEl.textContent = '0%';
  sizeEl.textContent = `${fileCount}件`;
  speedEl.textContent = '';
  etaEl.textContent = '';

  function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
    if (b < 1024*1024*1024) return (b/1024/1024).toFixed(1) + ' MB';
    return (b/1024/1024/1024).toFixed(2) + ' GB';
  }
  function formatTime(sec) {
    if (sec < 1) return '< 1秒';
    if (sec < 60) return Math.ceil(sec) + '秒';
    const m = Math.floor(sec / 60), s = Math.ceil(sec % 60);
    return `${m}分${s}秒`;
  }

  showToast(`${fileCount}件をアップロード中…`, 'info', 120000);
  const startTime = Date.now();

  try {
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/upload/${encodeURIComponent(currentPath)}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          barEl.style.width = pct + '%';
          pctEl.textContent = pct + '%';
          sizeEl.textContent = `${formatBytes(e.loaded)} / ${formatBytes(e.total)} (${fileCount}件)`;

          const elapsed = (Date.now() - startTime) / 1000;
          if (elapsed > 0.5 && e.loaded > 0) {
            const speed = e.loaded / elapsed;
            speedEl.textContent = formatBytes(speed) + '/s';
            const remaining = (e.total - e.loaded) / speed;
            etaEl.textContent = '残り ' + formatTime(remaining);
          }
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`${xhr.status} ${xhr.statusText}`));
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(formData);
    });

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    barEl.style.width = '100%';
    pctEl.textContent = '100%';
    etaEl.textContent = `完了 (${totalTime}秒)`;
    speedEl.textContent = '';
    // Remove pending toast
    document.querySelectorAll('.toast').forEach(t => t.remove());
    showToast(`${fileCount}件のアップロード完了 (${totalTime}秒)`, 'success');
    setTimeout(() => {
      progressEl.style.display = 'none';
      refreshFileList();
      fetchDashboardInfo();
      fetchStorageInfo();
    }, 1500);
  } catch (e) {
    console.error(e);
    document.querySelectorAll('.toast').forEach(t => t.remove());
    if (e.message && e.message.includes('413')) {
      showToast(`ファイルサイズが上限(${appSettings.upload_limit_mb || 2048}MB)を超えています`, 'error');
    } else {
      showToast('アップロード失敗', 'error');
    }
    setTimeout(() => { progressEl.style.display = 'none'; }, 3000);
  }
}

/* ========= パスをクリップボードにコピー ========= */
function copyPathToClipboard(path) {
  if (!path) {
    showToast('ファイルを選択してください', 'info');
    return;
  }
  navigator.clipboard.writeText(path).then(() => {
    showToast('パスをコピーしました: ' + path, 'success');
  }).catch(() => {
    prompt('パス:', path);
  });
}

/* ========= ファイル詳細情報 ========= */
async function openFileInfo(path) {
  if (!path) {
    showToast('ファイルを選択してください', 'info');
    return;
  }
  const el = document.getElementById('preview');
  el.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);">読み込み中...</div>';

  try {
    const res = await fetch(`/api/file-info/${encodeURIComponent(path)}`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'error');
    const info = data.info;

    let html = `<div style="padding:1.25rem;">
      <h3 style="margin:0 0 1rem;font-size:1.05rem;">&#8505; 詳細情報: ${escapeHtml(info.name)}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:.88rem;">`;

    const rows = [
      ['名前', info.name],
      ['パス', info.path],
      ['種類', info.type === 'file' ? 'ファイル' : 'フォルダ'],
      ['サイズ', info.size_h + ` (${info.size.toLocaleString()} bytes)`],
      ['作成日時', info.created],
      ['更新日時', info.modified],
      ['最終アクセス', info.accessed],
    ];
    if (info.mime) rows.push(['MIMEタイプ', info.mime]);
    if (info.extension) rows.push(['拡張子', info.extension]);
    if (info.file_count !== undefined) rows.push(['ファイル数', info.file_count + ' 個']);
    if (info.dir_count !== undefined) rows.push(['フォルダ数', info.dir_count + ' 個']);

    for (const [label, value] of rows) {
      html += `<tr>
        <td style="padding:.55rem .75rem;border-bottom:1px solid var(--border);font-weight:600;white-space:nowrap;color:var(--text-secondary);width:120px;">${escapeHtml(label)}</td>
        <td style="padding:.55rem .75rem;border-bottom:1px solid var(--border);word-break:break-all;">${escapeHtml(String(value))}</td>
      </tr>`;
    }
    html += `</table>
      <div style="margin-top:1rem;display:flex;gap:.5rem;flex-wrap:wrap;">
        <button class="btn btn-sm" onclick="copyPathToClipboard('${escapeHtml(info.path)}')">&#128203; パスコピー</button>
        <a class="btn btn-sm" href="/download/${encodeURIComponent(info.path)}" download>&#128190; ダウンロード</a>
      </div>
    </div>`;
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--danger);">${escapeHtml(e.message || '情報の取得に失敗しました')}</div>`;
  }
}

/* ========= ストレージ使用量 ========= */
async function fetchStorageInfo() {
  try {
    const res = await fetch('/api/storage');
    const data = await res.json();
    if (!res.ok || !data.ok) return;
    const el = document.getElementById('storage-info');
    if (el) {
      el.innerHTML = `<span class="storage-bar-bg"><span class="storage-bar-fill" style="width:${Math.min(data.percent, 100)}%"></span></span>
        <span class="storage-text">${data.files_size_h} / ${data.free_h} 空き</span>`;
      el.title = `ディスク: ${data.used_h} 使用 / ${data.total_h} 全体\nfiles/: ${data.files_size_h}`;
    }
    const capacityEl = document.getElementById('deck-capacity');
    const capacityDetailEl = document.getElementById('deck-capacity-detail');
    if (capacityEl) capacityEl.textContent = data.files_size_h || '--';
    if (capacityDetailEl) capacityDetailEl.textContent = `${Math.round(data.percent || 0)}% 使用 / 空き ${data.free_h}`;
  } catch (e) {
    console.error('storage info error', e);
  }
}

/* ========= 一括移動 ========= */
async function batchMove() {
  const paths = getSelectedPaths();
  if (!paths.length) return;

  showInputModal('一括移動', '移動先フォルダパス（空欄=ルート）', '', async (targetDir) => {
    try {
      const res = await fetch('/move-multi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths, targetDir })
      });
      const j = await res.json();
      if (!j.ok && !j.moved?.length) {
        showToast('移動エラー: ' + (j.error || ''), 'error');
        return;
      }
      const movedCount = j.moved?.length || paths.length;
      showToast(`${movedCount}件を移動しました`, 'success');
      if (j.error) showToast('一部エラー: ' + j.error, 'error');
      clearSelection();
      setTimeout(() => refreshFileList(), 600);
    } catch (e) {
      console.error(e);
      showToast('通信エラー', 'error');
    }
  });
}

/* ========= キーボードショートカット一覧 ========= */
function openShortcutsHelp() {
  const el = document.getElementById('preview');
  const shortcuts = [
    ['Ctrl + S', 'ファイルを保存（エディタ内）'],
    ['Ctrl + F', 'クイックフィルタにフォーカス'],
    ['Ctrl + H', '検索/置換バーの表示切替（エディタ内）'],
    ['Tab', 'スペース2つ挿入（エディタ内）'],
    ['Enter', '全文検索を実行 / コマンド実行'],
    ['Escape', 'モーダル・パネルを閉じる'],
    ['右クリック', 'コンテキストメニュー'],
    ['ドラッグ&ドロップ', 'ファイル移動 / アップロード'],
  ];

  let html = `<div style="padding:1.25rem;">
    <h3 style="margin:0 0 1rem;font-size:1.05rem;">&#9000; キーボードショートカット</h3>
    <table style="width:100%;border-collapse:collapse;font-size:.88rem;">`;
  for (const [key, desc] of shortcuts) {
    html += `<tr>
      <td style="padding:.55rem .75rem;border-bottom:1px solid var(--border);width:160px;">
        <span class="kbd">${escapeHtml(key)}</span>
      </td>
      <td style="padding:.55rem .75rem;border-bottom:1px solid var(--border);">${escapeHtml(desc)}</td>
    </tr>`;
  }
  html += `</table></div>`;
  el.innerHTML = html;
}

/* ========= ゴミ箱 ========= */
async function openTrash() {
  const el = document.getElementById('preview');
  el.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);">ゴミ箱を読み込み中...</div>';

  try {
    const res = await fetch('/api/trash');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'error');
    const items = data.items || [];

    let html = `<div style="padding:1.25rem;">
      <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1rem;flex-wrap:wrap;">
        <h3 style="margin:0;font-size:1.05rem;">&#128465; ゴミ箱</h3>
        <span style="font-size:.82rem;color:var(--text-secondary);">${items.length}件</span>
        ${items.length > 0 ? '<button class="btn btn-sm btn-danger" onclick="emptyTrash()">ゴミ箱を空にする</button>' : ''}
      </div>`;

    if (!items.length) {
      html += '<div style="text-align:center;padding:2rem;color:var(--text-muted);">ゴミ箱は空です</div>';
    } else {
      html += '<div class="activity-log-list">';
      for (const item of items) {
        const icon = item.type === 'folder' ? '&#128193;' : '&#128196;';
        html += `<div class="activity-log-item" style="justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:.5rem;flex:1;min-width:0;">
            <span>${icon}</span>
            <div style="min-width:0;">
              <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(item.name)}</div>
              <div style="font-size:.75rem;color:var(--text-muted);">元: ${escapeHtml(item.original_path)} | ${escapeHtml(item.deleted_at)} | ${escapeHtml(item.size_h || '')}</div>
            </div>
          </div>
          <div style="display:flex;gap:.35rem;flex-shrink:0;">
            <button class="btn btn-sm" onclick="restoreTrashItem('${escapeHtml(item.id)}')">復元</button>
            <button class="btn btn-sm btn-danger" onclick="deleteTrashItem('${escapeHtml(item.id)}')">完全削除</button>
          </div>
        </div>`;
      }
      html += '</div>';
    }
    html += '</div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--danger);">${escapeHtml(e.message || 'ゴミ箱の読み込みに失敗しました')}</div>`;
  }
}

async function restoreTrashItem(id) {
  try {
    const res = await fetch('/api/trash/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const j = await res.json();
    if (!res.ok || !j.ok) { showToast(j.error || '復元に失敗', 'error'); return; }
    showToast('復元しました', 'success');
    openTrash();
    setTimeout(() => refreshFileList(), 600);
  } catch (e) { showToast('通信エラー', 'error'); }
}

async function deleteTrashItem(id) {
  if (!confirm('完全に削除しますか？ 元に戻せません。')) return;
  try {
    const res = await fetch('/api/trash/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const j = await res.json();
    if (!res.ok || !j.ok) { showToast(j.error || '削除に失敗', 'error'); return; }
    showToast('完全に削除しました', 'success');
    openTrash();
  } catch (e) { showToast('通信エラー', 'error'); }
}

async function emptyTrash() {
  if (!confirm('ゴミ箱を空にしますか？ すべてのファイルが完全に削除されます。')) return;
  try {
    const res = await fetch('/api/trash/empty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const j = await res.json();
    if (!res.ok || !j.ok) { showToast(j.error || 'エラー', 'error'); return; }
    showToast('ゴミ箱を空にしました', 'success');
    openTrash();
  } catch (e) { showToast('通信エラー', 'error'); }
}

/* ========= 共有リンク生成 ========= */
async function createShareLink(subpath) {
  try {
    const res = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subpath })
    });
    const j = await res.json();
    if (!j.ok) { showToast(j.error || 'エラー', 'error'); return; }
    const fullUrl = location.origin + j.url;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(fullUrl);
      showToast('共有リンクをコピーしました', 'success');
    } else {
      prompt('共有リンク:', fullUrl);
    }
    fetchDashboardInfo();
  } catch (e) {
    console.error(e);
    showToast('共有リンク生成に失敗', 'error');
  }
}

/* ========= アクティビティログ ========= */
async function openActivityLog() {
  const preview = document.getElementById('preview');
  preview.innerHTML = '<div style="padding:1em"><p>読み込み中...</p></div>';
  try {
    const res = await fetch('/api/activity-log?limit=100');
    const j = await res.json();
    if (!j.ok) { preview.innerHTML = '<p>読み込みエラー</p>'; return; }
    const logs = j.logs || [];
    if (!logs.length) {
      preview.innerHTML = '<div style="padding:1em"><p>アクティビティはまだありません</p></div>';
      return;
    }
    const actionIcons = {
      'upload': '\uD83D\uDCE4', 'delete': '\uD83D\uDDD1', 'save': '\uD83D\uDCBE',
      'rename': '\u270F\uFE0F', 'move': '\uD83D\uDCE6', 'mkdir': '\uD83D\uDCC1',
      'mkfile': '\uD83D\uDCC4', 'copy': '\uD83D\uDCCB', 'restore': '\u23EA',
      'delete-multi': '\uD83D\uDDD1', 'image-save': '\uD83D\uDDBC',
    };
    let html = '<div style="padding:1em"><h3 style="margin:0 0 .8em">\uD83D\uDCCA アクティビティログ</h3>';
    html += '<div class="activity-log-list">';
    for (const log of logs) {
      const icon = actionIcons[log.action] || '\uD83D\uDD35';
      const pathPart = log.path ? ` <span class="activity-path">${escapeHtml(log.path)}</span>` : '';
      html += `<div class="activity-log-item">
        <span class="activity-icon">${icon}</span>
        <span class="activity-message">${escapeHtml(log.message)}${pathPart}</span>
        <span class="activity-meta">${escapeHtml(log.actor)} | ${escapeHtml(log.timestamp)}</span>
      </div>`;
    }
    html += '</div></div>';
    preview.innerHTML = html;
  } catch (e) {
    console.error(e);
    preview.innerHTML = '<p>読み込みエラー</p>';
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
