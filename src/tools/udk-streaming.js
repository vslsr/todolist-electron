'use strict';

// ── UDK Streaming 生成工具 ──────────────────────────────────────────────────
// 1. 读取指定目录下的所有 .udk 文件
// 2. 用正则筛选，展示带 checkbox 的文件列表
// 3. 生成 SeqAct_MultiLevelStreaming T3D 对象块（含 Levels 列表）
// ──────────────────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

// ── State ─────────────────────────────────────────────────────────────────────
let allFiles     = [];   // all .udk filenames from the scanned directory
let matchedFiles = [];   // filenames matching the current regex

// ── Helpers ───────────────────────────────────────────────────────────────────

function setStatus(msg, kind = '') {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

// Strip the .udk extension for use as a LevelName value
function levelName(filename) {
  return filename.replace(/\.udk$/i, '');
}

// ── Scan ──────────────────────────────────────────────────────────────────────

async function scan() {
  const dir = $('folder-path').value.trim();
  if (!dir) { setStatus('请先输入或浏览选择文件夹路径。', 'err'); return; }

  const result = await window.electronAPI.listUdk(dir);
  if (!result.success) {
    setStatus(`读取文件夹失败：${result.error}`, 'err');
    allFiles = [];
    renderFileList([]);
    return;
  }

  allFiles = result.files;
  applyFilter();
}

function applyFilter() {
  const raw = $('filter-regex').value.trim();
  let re;
  try {
    re = raw ? new RegExp(raw, 'i') : null;
  } catch (e) {
    setStatus(`正则无效：${e.message}`, 'err');
    return;
  }

  matchedFiles = re ? allFiles.filter(f => re.test(f)) : [...allFiles];
  renderFileList(matchedFiles);

  const total = allFiles.length;
  const hit   = matchedFiles.length;
  $('match-count').textContent = `${hit} / ${total}`;
  setStatus(
    total === 0
      ? '文件夹中没有 .udk 文件。'
      : `共 ${total} 个 .udk 文件，正则匹配 ${hit} 个。`,
    hit > 0 ? 'ok' : ''
  );
}

// ── Render file list ──────────────────────────────────────────────────────────

function renderFileList(files) {
  const list = $('file-list');
  if (files.length === 0) {
    list.innerHTML = '<div class="list-empty">没有匹配的文件。<br>调整正则后重新扫描。</div>';
    return;
  }

  const raw = $('filter-regex').value.trim();
  let re;
  try { re = raw ? new RegExp(raw, 'i') : null; } catch { re = null; }

  list.innerHTML = '';
  files.forEach(fname => {
    const item = document.createElement('div');
    item.className = 'file-item matched';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.file = fname;

    const label = document.createElement('span');
    label.className = 'fname';

    // Highlight the matched portion
    if (re) {
      const m = re.exec(fname);
      if (m) {
        const idx = m.index;
        const end = idx + m[0].length;
        label.innerHTML =
          escHtml(fname.slice(0, idx)) +
          `<mark>${escHtml(fname.slice(idx, end))}</mark>` +
          escHtml(fname.slice(end));
      } else {
        label.textContent = fname;
      }
    } else {
      label.textContent = fname;
    }

    item.appendChild(cb);
    item.appendChild(label);
    list.appendChild(item);
  });
}

function getCheckedFiles() {
  return [...$('file-list').querySelectorAll('input[type=checkbox]:checked')]
    .map(cb => cb.dataset.file);
}

// ── Generate T3D ──────────────────────────────────────────────────────────────

function generate() {
  const checked = getCheckedFiles();
  if (checked.length === 0) {
    setStatus('没有勾选任何文件，请先扫描并勾选要包含的关卡。', 'err');
    return;
  }

  const objName   = $('obj-name').value.trim()   || 'SeqAct_MultiLevelStreaming_0';
  const parentSeq = $('parent-seq').value.trim() || 'Main_Sequence';
  const posX      = parseInt($('pos-x').value)   || 1336;
  const posY      = parseInt($('pos-y').value)   || 808;
  const drawYBase = parseInt($('drawy-start').value) || 845;

  // Build Levels(N)=(LevelName="...") lines
  const levelLines = checked.map(
    (f, i) => `   Levels(${i})=(LevelName="${levelName(f)}")`
  );

  // InputLinks: two entries with incrementing DrawY
  const inputLinks = [
    `   InputLinks(0)=(DrawY=${drawYBase})`,
    `   InputLinks(1)=(DrawY=${drawYBase + 21})`,
  ];

  // DrawHeight scales roughly with level count (minimum 71)
  const drawHeight = Math.max(71, 40 + checked.length * 4);

  const lines = [
    `Begin Object Class=SeqAct_MultiLevelStreaming Name=${objName}`,
    ...levelLines,
    `   bShouldBlockOnLoad=True`,
    ...inputLinks,
    `   OutputLinks(0)=(DrawY=${drawYBase + 10})`,
    `   ObjInstanceVersion=1`,
    `   ParentSequence=Sequence'${parentSeq}'`,
    `   ObjPosX=${posX}`,
    `   ObjPosY=${posY}`,
    `   DrawWidth=127`,
    `   DrawHeight=${drawHeight}`,
    `   Name="${objName}"`,
    `   ObjectArchetype=SeqAct_MultiLevelStreaming'Engine.Default__SeqAct_MultiLevelStreaming'`,
    `End Object`,
  ];

  const result = lines.join('\n');
  $('output').value = result;
  $('out-count').textContent = `${checked.length} 个关卡`;
  setStatus(`已生成 T3D，包含 ${checked.length} 个关卡。`, 'ok');
}

// ── Copy ──────────────────────────────────────────────────────────────────────

function copyOutput() {
  const val = $('output').value;
  if (!val) { setStatus('没有可复制的结果。', 'err'); return; }
  navigator.clipboard.writeText(val)
    .then(() => setStatus('已复制到剪贴板。', 'ok'))
    .catch(() => {
      $('output').select();
      document.execCommand('copy');
      setStatus('已复制到剪贴板。', 'ok');
    });
}

// ── Clear ─────────────────────────────────────────────────────────────────────

function clearAll() {
  $('folder-path').value = '';
  $('output').value = '';
  $('out-count').textContent = '';
  $('match-count').textContent = '—';
  $('file-list').innerHTML = '<div class="list-empty">先选择文件夹并扫描</div>';
  allFiles = [];
  matchedFiles = [];
  setStatus('已清空。');
}

// ── Util ──────────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Event bindings ────────────────────────────────────────────────────────────

$('browse-btn').addEventListener('click', async () => {
  const result = await window.electronAPI.pickFolder();
  if (result.success) {
    $('folder-path').value = result.dir;
    scan();
  }
});

$('scan-btn').addEventListener('click', scan);

// Re-apply filter live as the user types the regex
$('filter-regex').addEventListener('input', () => {
  if (allFiles.length > 0) applyFilter();
});

$('folder-path').addEventListener('keydown', e => {
  if (e.key === 'Enter') scan();
});

$('gen-btn').addEventListener('click', generate);
$('copy-btn').addEventListener('click', copyOutput);
$('clear-btn').addEventListener('click', clearAll);
