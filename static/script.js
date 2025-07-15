function previewFile(path) {
  fetch(`/preview/${encodeURIComponent(path)}`)
    .then(res => res.json())
    .then(data => {
      document.getElementById('preview').textContent = data.content;
    })
    .catch(err => {
      console.error("Fetch error:", err);
      document.getElementById('preview').textContent = '読み込みエラー（JS側）';
    });
}

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

    const currentPath = window.location.pathname.replace('/browse/', '');
    const formData = new FormData();
    const items = [...e.dataTransfer.items];

    if (items.length === 0) {
      alert('アップロードできる項目がありません');
      return;
    }

    let hasEntries = false;

    for (const item of items) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) {
        hasEntries = true;
        await traverseEntry(entry, '', formData);
      }
    }

    if (!hasEntries) {
      alert('このブラウザはフォルダのアップロードに対応していません');
      return;
    }

    if ([...formData.entries()].length === 0) {
      alert('空のフォルダのみが含まれている可能性があります');
      return;
    }

    fetch(`/upload/${encodeURIComponent(currentPath)}`, {
      method: 'POST',
      body: formData
    })
      .then(res => res.ok ? location.reload() : alert('アップロード失敗'))
      .catch(() => alert('アップロードエラー'));
  });

  async function traverseEntry(entry, path, formData) {
    return new Promise((resolve) => {
      if (entry.isFile) {
        entry.file(file => {
          const fullPath = path ? `${path}/${file.name}` : file.name;
          formData.append('file', file, fullPath);
          resolve();
        });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        reader.readEntries(async entries => {
          for (const child of entries) {
            await traverseEntry(child, `${path}/${entry.name}`, formData);
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
});
