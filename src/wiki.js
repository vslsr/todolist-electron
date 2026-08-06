'use strict';

(function () {

  // ── Constants ───────────────────────────────────────────────────────────────
  const WIKI_KEY = 'wiki';

  // ── State ───────────────────────────────────────────────────────────────────
  let wikiDocs      = [];   // flat array of doc objects
  let wikiActiveId  = null; // currently open doc id
  let wikiEditor    = null; // Editor.js instance
  let wikiVisible   = false;
  let wikiSaveTimer = null;
  let wikiSearchQ   = '';

  // Drag state
  let dragId        = null; // id of the doc being dragged
  let dragOverId    = null; // id of the doc currently hovered
  let dragZone      = null; // 'before' | 'inside' | 'after'

  // Image GC: filenames referenced by the last saved version of the active doc.
  // On each save we diff against the new set; orphaned filenames are deleted after a delay.
  let savedImageFilenames = new Set(); // filenames present in the last persisted content

  // ── Data helpers ─────────────────────────────────────────────────────────────

  function makeId() {
    return `w${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  }

  function createDoc(title = '新文档', parentId = null) {
    return {
      id:        makeId(),
      title:     title.trim() || '新文档',
      parentId,
      content:   null,   // Editor.js saved data (object)
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      collapsed: false,
    };
  }

  // Build child map: parentId → [doc, ...]
  function buildChildMap() {
    const map = {};
    for (const d of wikiDocs) {
      const p = d.parentId ?? '__root__';
      if (!map[p]) map[p] = [];
      map[p].push(d);
    }
    return map;
  }

  function findDoc(id) {
    return wikiDocs.find(d => d.id === id) || null;
  }

  // All descendant ids (inclusive of self)
  function subtreeIds(id) {
    const result = [id];
    const childMap = buildChildMap();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop();
      for (const c of (childMap[cur] || [])) {
        result.push(c.id);
        stack.push(c.id);
      }
    }
    return result;
  }

  // Ancestor id list from root down to doc (not including doc itself)
  function ancestorIds(id) {
    const path = [];
    let cur = findDoc(id);
    while (cur && cur.parentId) {
      path.unshift(cur.parentId);
      cur = findDoc(cur.parentId);
    }
    return path;
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  async function wikiLoad() {
    const saved = await window.electronAPI.store.get(WIKI_KEY);
    wikiDocs = Array.isArray(saved) ? saved : [];
  }

  async function wikiSave() {
    await window.electronAPI.store.set(WIKI_KEY, wikiDocs);
  }

  function scheduleSave() {
    clearTimeout(wikiSaveTimer);
    wikiSaveTimer = setTimeout(wikiSave, 800);
  }

  // ── Wiki Image Tool (custom Editor.js block) ──────────────────────────────────

  class WikiImageTool {
    static get toolbox() {
      return { title: '图片', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="15" viewBox="0 0 336 276"><path d="M291 150V79c0-19-15-34-34-34H79c-19 0-34 15-34 34v42l67-44 81 72 56-29 42 30zm0 52l-43-30-56 30-81-72-67 44v32c0 19 15 34 34 34h178c17 0 31-13 34-29zM79 0h178c44 0 79 35 79 79v118c0 44-35 79-79 79H79c-44 0-79-35-79-79V79C0 35 35 0 79 0z"/></svg>' };
    }

    static get isReadOnlySupported() { return true; }

    constructor({ data }) {
      // data: { filename, url, caption }
      this._data = data || {};
    }

    render() {
      this._wrap = document.createElement('div');
      this._wrap.className = 'wiki-image-block';
      this._renderContent();
      return this._wrap;
    }

    _renderContent() {
      this._wrap.innerHTML = '';
      if (this._data.url) {
        const img = document.createElement('img');
        img.src = this._data.url;
        img.className = 'wiki-image-img';
        img.alt = this._data.caption || '';
        this._wrap.appendChild(img);

        const cap = document.createElement('input');
        cap.type = 'text';
        cap.placeholder = '添加图片说明…';
        cap.value = this._data.caption || '';
        cap.className = 'wiki-image-caption';
        cap.addEventListener('input', () => { this._data.caption = cap.value; });
        this._wrap.appendChild(cap);
      } else {
        const msg = document.createElement('div');
        msg.className = 'wiki-image-placeholder';
        msg.textContent = '图片加载失败';
        this._wrap.appendChild(msg);
      }
    }

    save() {
      return {
        filename: this._data.filename || null,
        url:      this._data.url      || null,
        caption:  this._data.caption  || '',
      };
    }

    static validate(data) {
      return !!data.filename;
    }
  }

  // ── Paste image handler ───────────────────────────────────────────────────────

  // Read an image ClipboardItem as base64 and save it via IPC.
  async function saveClipboardImage(item) {
    const mimeType = item.types.find(t => t.startsWith('image/'));
    if (!mimeType) return null;
    const blob       = await item.getType(mimeType);
    const arrayBuf   = await blob.arrayBuffer();
    const base64     = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)));
    return window.electronAPI.wiki.saveImageData(base64, mimeType);
  }

  function initPasteImage() {
    // Attach to the editor area so it fires regardless of which block is focused.
    const area = document.getElementById('wiki-editor-area');
    if (!area) return;

    area.addEventListener('paste', async (e) => {
      if (!wikiEditor || !wikiActiveId) return;
      const items = Array.from(e.clipboardData?.items || []);
      const imageItem = items.find(i => i.kind === 'file' && i.type.startsWith('image/'));
      if (!imageItem) return;

      // Prevent default paste (avoids dumping raw data into editor)
      e.preventDefault();
      e.stopPropagation();

      // Read file from clipboard
      const file   = imageItem.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      const base64 = await new Promise(resolve => {
        reader.onload = ev => {
          // ev.target.result is "data:image/png;base64,XXXX"
          resolve(ev.target.result.split(',')[1]);
        };
        reader.readAsDataURL(file);
      });

      const res = await window.electronAPI.wiki.saveImageData(base64, file.type);
      if (!res || !res.success) { showWikiToast('图片保存失败', true); return; }

      // Insert image block at current cursor position
      wikiEditor.blocks.insert('image', {
        filename: res.filename,
        url:      res.url,
        caption:  '',
      });
    }, true); // capture phase so we get it before Editor.js
  }

  // ── Image GC helpers ──────────────────────────────────────────────────────────

  // Collect all image filenames referenced in a saved Editor.js content object.
  function imageFilenamesInContent(content) {
    if (!content || !Array.isArray(content.blocks)) return new Set();
    const names = new Set();
    for (const b of content.blocks) {
      if (b.type === 'image' && b.data?.filename) names.add(b.data.filename);
    }
    return names;
  }

  // Called after content is persisted. Schedules deletion of filenames that
  // were in the previous save but are no longer present (user deleted the block
  // and the editor has since been saved/switched away from).
  function gcImages(prevFilenames, nextFilenames) {
    const orphans = [...prevFilenames].filter(f => !nextFilenames.has(f));
    if (orphans.length > 0) {
      window.electronAPI.wiki.deleteImages(orphans);
    }
  }

  // ── Editor.js init ────────────────────────────────────────────────────────────

  async function initEditor(data) {
    if (wikiEditor) {
      try { await wikiEditor.destroy(); } catch (_) {}
      wikiEditor = null;
    }

    const holder = document.getElementById('wiki-editor-holder');
    if (!holder) return;
    holder.innerHTML = '';

    // Snapshot of initial data passed to EditorJS — needed by editorjs-undo
    // so that Ctrl+Z past the first change doesn't clear the document.
    const initialData = data || {};

    wikiEditor = new EditorJS({
      holder:    'wiki-editor-holder',
      data:      initialData,
      autofocus: true,
      placeholder: '开始编写文档...',
      tools: {
        header: {
          class: Header,
          config: { levels: [1, 2, 3], defaultLevel: 2 },
        },
        list: {
          class: EditorjsList,
          inlineToolbar: true,
          config: { defaultStyle: 'unordered' },
        },
        checklist: {
          class: Checklist,
          inlineToolbar: true,
        },
        code: CodeTool,
        image: WikiImageTool,
      },
      onReady: () => {
        // editorjs-undo must be initialized inside onReady, after the editor is
        // fully mounted. initialData prevents undo from wiping the document when
        // the user reaches the bottom of the history stack.
        new Undo({ editor: wikiEditor, maxLength: 50, initialData });
        // Record which images exist at load time; GC runs only when leaving the doc.
        savedImageFilenames = imageFilenamesInContent(initialData);
      },
      onChange: () => {
        if (!wikiActiveId) return;
        scheduleSave();
        wikiEditor.save().then(saved => {
          const doc = findDoc(wikiActiveId);
          if (!doc) return;
          // Do NOT gc here — the user can still undo block deletions at this point.
          doc.content   = saved;
          doc.updatedAt = new Date().toISOString();
        });
      },
    });
  }

  // ── Tree rendering ────────────────────────────────────────────────────────────

  function matchesSearch(doc) {
    if (!wikiSearchQ) return true;
    const q = wikiSearchQ.toLowerCase();
    if (doc.title.toLowerCase().includes(q)) return true;
    // Search inside content blocks
    if (doc.content && Array.isArray(doc.content.blocks)) {
      for (const block of doc.content.blocks) {
        const text = extractBlockText(block).toLowerCase();
        if (text.includes(q)) return true;
      }
    }
    return false;
  }

  function hasMatchingDescendant(id, childMap) {
    for (const c of (childMap[id] || [])) {
      if (matchesSearch(c) || hasMatchingDescendant(c.id, childMap)) return true;
    }
    return false;
  }

  function renderTree() {
    const container = document.getElementById('wiki-tree');
    if (!container) return;
    const childMap = buildChildMap();
    container.innerHTML = '';
    renderTreeLevel(container, '__root__', childMap, 0);
  }

  function renderTreeLevel(container, parentKey, childMap, depth) {
    const children = childMap[parentKey] || [];
    for (const doc of children) {
      const show = !wikiSearchQ || matchesSearch(doc) || hasMatchingDescendant(doc.id, childMap);
      if (!show) continue;

      const hasChildren = (childMap[doc.id] || []).length > 0;
      const isActive    = doc.id === wikiActiveId;

      const item = document.createElement('div');
      item.className = `wiki-tree-item${isActive ? ' active' : ''}`;
      item.dataset.id = doc.id;
      item.style.paddingLeft = `${12 + depth * 16}px`;
      item.draggable = true;

      // Toggle arrow
      const arrow = document.createElement('span');
      arrow.className = `wiki-tree-arrow${hasChildren ? '' : ' invisible'}`;
      arrow.textContent = doc.collapsed ? '▶' : '▼';
      arrow.addEventListener('click', e => {
        e.stopPropagation();
        doc.collapsed = !doc.collapsed;
        scheduleSave();
        renderTree();
      });

      // Doc icon
      const icon = document.createElement('span');
      icon.className = 'wiki-tree-icon';
      icon.textContent = hasChildren ? '📁' : '📄';

      // Title
      const titleEl = document.createElement('span');
      titleEl.className = 'wiki-tree-title';
      // Highlight search match
      if (wikiSearchQ && doc.title.toLowerCase().includes(wikiSearchQ.toLowerCase())) {
        const idx = doc.title.toLowerCase().indexOf(wikiSearchQ.toLowerCase());
        titleEl.innerHTML =
          escHtml(doc.title.slice(0, idx)) +
          `<mark>${escHtml(doc.title.slice(idx, idx + wikiSearchQ.length))}</mark>` +
          escHtml(doc.title.slice(idx + wikiSearchQ.length));
      } else {
        titleEl.textContent = doc.title;
      }

      item.appendChild(arrow);
      item.appendChild(icon);
      item.appendChild(titleEl);

      // Click to open
      item.addEventListener('click', () => openDoc(doc.id));

      // Right-click context menu
      item.addEventListener('contextmenu', e => {
        e.preventDefault();
        showTreeContextMenu(e.clientX, e.clientY, doc.id);
      });

      container.appendChild(item);

      // Render children if not collapsed
      if (!doc.collapsed) {
        renderTreeLevel(container, doc.id, childMap, depth + 1);
      }
    }
  }

  // ── Open document ─────────────────────────────────────────────────────────────

  async function openDoc(id) {
    // Save current doc before switching
    if (wikiEditor && wikiActiveId && wikiActiveId !== id) {
      try {
        const saved = await wikiEditor.save();
        const prev = findDoc(wikiActiveId);
        if (prev) { prev.content = saved; prev.updatedAt = new Date().toISOString(); }
        // GC images that were deleted while editing the previous doc
        const nextFilenames = imageFilenamesInContent(saved);
        gcImages(savedImageFilenames, nextFilenames);
        savedImageFilenames = nextFilenames;
        await wikiSave();
      } catch (_) {}
    }

    wikiActiveId = id;
    const doc = findDoc(id);
    if (!doc) return;

    // Title — only overwrite if the element isn't currently being edited
    const titleEl = document.getElementById('wiki-doc-title');
    if (titleEl && titleEl.dataset.id !== id) {
      titleEl.textContent = doc.title;
      titleEl.dataset.id  = id;
    } else if (titleEl) {
      // Same doc re-opened (e.g. tree click while editing title): just update the id
      titleEl.dataset.id = id;
    }

    // Breadcrumb
    renderBreadcrumb(id);

    // Editor
    await initEditor(doc.content || {});

    // Highlight tree selection
    renderTree();

    // Show editor area
    document.getElementById('wiki-editor-area').classList.remove('hidden');
    document.getElementById('wiki-empty-state').classList.add('hidden');
  }

  // ── Breadcrumb ────────────────────────────────────────────────────────────────

  function renderBreadcrumb(id) {
    const bc = document.getElementById('wiki-breadcrumb');
    if (!bc) return;
    const ids   = [...ancestorIds(id), id];
    const parts = ids.map(i => {
      const d = findDoc(i);
      return d ? `<span class="wiki-bc-item" data-id="${i}">${escHtml(d.title)}</span>` : '';
    });
    bc.innerHTML = parts.join('<span class="wiki-bc-sep">›</span>');
    bc.querySelectorAll('.wiki-bc-item').forEach(el => {
      el.addEventListener('click', () => openDoc(el.dataset.id));
    });
  }

  // ── Context menu ──────────────────────────────────────────────────────────────

  function showTreeContextMenu(x, y, docId) {
    hideTreeContextMenu();
    const menu = document.getElementById('wiki-context-menu');
    if (!menu) return;
    menu.dataset.targetId = docId;
    menu.style.left = `${x}px`;
    menu.style.top  = `${y}px`;
    menu.classList.remove('hidden');
  }

  function hideTreeContextMenu() {
    const menu = document.getElementById('wiki-context-menu');
    if (menu) menu.classList.add('hidden');
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────────

  function newDoc(parentId = null) {
    const doc = createDoc('新文档', parentId);
    wikiDocs.push(doc);
    wikiSave();
    renderTree();
    openDoc(doc.id);
    // Auto-focus title for rename
    setTimeout(() => {
      const titleEl = document.getElementById('wiki-doc-title');
      if (titleEl) { titleEl.focus(); selectAllText(titleEl); }
    }, 150);
  }

  function deleteDoc(id) {
    const ids = subtreeIds(id);

    // Collect all image filenames from docs being deleted before removing them
    const orphanImages = [];
    for (const docId of ids) {
      const doc = findDoc(docId);
      if (doc) {
        for (const f of imageFilenamesInContent(doc.content)) orphanImages.push(f);
      }
    }

    wikiDocs = wikiDocs.filter(d => !ids.includes(d.id));
    if (ids.includes(wikiActiveId)) {
      wikiActiveId = null;
      savedImageFilenames = new Set();
      if (wikiEditor) { wikiEditor.destroy(); wikiEditor = null; }
      document.getElementById('wiki-editor-area').classList.add('hidden');
      document.getElementById('wiki-empty-state').classList.remove('hidden');
    }
    wikiSave();
    renderTree();

    if (orphanImages.length > 0) {
      window.electronAPI.wiki.deleteImages(orphanImages);
    }
  }

  function renameDoc(id) {
    if (id !== wikiActiveId) openDoc(id);
    setTimeout(() => {
      const titleEl = document.getElementById('wiki-doc-title');
      if (titleEl) { titleEl.focus(); selectAllText(titleEl); }
    }, 150);
  }

  // ── Markdown export ───────────────────────────────────────────────────────────

  function extractBlockText(block) {
    const raw = block.data?.text || block.data?.caption || '';
    return raw.replace(/<[^>]+>/g, '');
  }

  function blockToMd(block) {
    const data = block.data || {};

    switch (block.type) {
      case 'header': {
        const level = Math.min(Math.max(data.level || 2, 1), 6);
        const text  = stripHtml(data.text || '');
        return `${'#'.repeat(level)} ${text}`;
      }
      case 'paragraph': {
        return stripHtml(data.text || '');
      }
      case 'list': {
        const items = data.items || [];
        const style = data.style;
        return items.map((item, i) => {
          // Editor.js list v2 items can be objects or strings
          const text = typeof item === 'string'
            ? stripHtml(item)
            : stripHtml(item.content || item.text || '');
          return style === 'ordered' ? `${i + 1}. ${text}` : `- ${text}`;
        }).join('\n');
      }
      case 'checklist': {
        const items = data.items || [];
        return items.map(item => {
          const text    = stripHtml(item.text || '');
          const checked = item.checked ? 'x' : ' ';
          return `- [${checked}] ${text}`;
        }).join('\n');
      }
      case 'code': {
        return `\`\`\`\n${data.code || ''}\n\`\`\``;
      }
      case 'delimiter': {
        return '---';
      }
      case 'quote': {
        const text = stripHtml(data.text || '');
        return text.split('\n').map(l => `> ${l}`).join('\n');
      }
      default: {
        // Fallback: just extract any text
        const text = extractBlockText(block);
        return text || '';
      }
    }
  }

  function docToMarkdown(doc) {
    const lines = [`# ${doc.title}`, ''];
    if (doc.content && Array.isArray(doc.content.blocks)) {
      for (const block of doc.content.blocks) {
        const md = blockToMd(block);
        if (md) { lines.push(md); lines.push(''); }
      }
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  }

  async function exportDocMd(id) {
    const doc = id ? findDoc(id) : findDoc(wikiActiveId);
    if (!doc) return;

    // Flush latest editor content first
    if (wikiEditor && doc.id === wikiActiveId) {
      try {
        const saved = await wikiEditor.save();
        doc.content  = saved;
        doc.updatedAt = new Date().toISOString();
        await wikiSave();
      } catch (_) {}
    }

    const md       = docToMarkdown(doc);
    const filename = `${doc.title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
    const result   = await window.electronAPI.exportMd(md, filename);
    if (result && result.success) showWikiToast(`已导出 ${filename}`);
  }

  async function exportAllJson() {
    if (wikiDocs.length === 0) { showWikiToast('暂无文档可导出'); return; }
    const result = await window.electronAPI.exportWikiJson(JSON.stringify(wikiDocs, null, 2));
    if (result && result.success) showWikiToast(`已导出 ${wikiDocs.length} 篇文档`);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────────

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function stripHtml(str) {
    return String(str).replace(/<[^>]+>/g, '');
  }

  function selectAllText(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  let wikiToastTimer = null;
  function showWikiToast(msg, isError = false) {
    // Re-use the main app toast
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className   = `toast${isError ? ' toast-error' : ''}`;
    clearTimeout(wikiToastTimer);
    wikiToastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
  }

  // ── Tab toggle ────────────────────────────────────────────────────────────────

  function initWikiTab() {
    const btn        = document.getElementById('wiki-tab-btn');
    const board      = document.getElementById('wiki-board');
    const contentRow = document.querySelector('.content-row');
    const drawBoard  = document.getElementById('draw-board');

    btn.addEventListener('click', () => {
      wikiVisible = !wikiVisible;

      // Hide draw board if it was open (mirror draw.js pattern)
      if (wikiVisible && drawBoard && !drawBoard.classList.contains('hidden')) {
        drawBoard.classList.add('hidden');
        contentRow.classList.remove('hidden');
        document.getElementById('draw-tab-btn').classList.remove('active');
        // Notify draw module via custom event
        document.dispatchEvent(new CustomEvent('wiki:hideDraw'));
      }

      board.classList.toggle('hidden', !wikiVisible);
      contentRow.classList.toggle('hidden', wikiVisible);
      btn.classList.toggle('active', wikiVisible);
    });

    // When draw tab opens, close wiki
    document.addEventListener('draw:show', () => {
      if (!wikiVisible) return;
      wikiVisible = false;
      board.classList.add('hidden');
      contentRow.classList.remove('hidden');
      btn.classList.remove('active');
    });
  }

  // ── Drag & drop ──────────────────────────────────────────────────────────────

  // Returns true if candidateId is the same as or a descendant of ancId
  function isAncestorOrSelf(ancId, candidateId) {
    if (ancId === candidateId) return true;
    return subtreeIds(ancId).includes(candidateId);
  }

  function clearDragIndicators() {
    document.querySelectorAll('.wiki-tree-item').forEach(el => {
      el.classList.remove('drag-over-before', 'drag-over-inside', 'drag-over-after');
    });
  }

  // Determine drop zone from mouse Y relative to the item rect
  function getDropZone(e, el) {
    const rect = el.getBoundingClientRect();
    const relY  = e.clientY - rect.top;
    const h     = rect.height;
    if (relY < h * 0.25) return 'before';
    if (relY > h * 0.75) return 'after';
    return 'inside';
  }

  function applyDropIndicator(el, zone) {
    el.classList.remove('drag-over-before', 'drag-over-inside', 'drag-over-after');
    el.classList.add(`drag-over-${zone}`);
  }

  // Commit the drop: re-parent or re-order dragId relative to targetId
  function commitDrop(targetId, zone) {
    if (!dragId || dragId === targetId) return;
    // Prevent dropping onto own subtree
    if (isAncestorOrSelf(dragId, targetId)) return;

    const dragDoc   = findDoc(dragId);
    const targetDoc = findDoc(targetId);
    if (!dragDoc || !targetDoc) return;

    if (zone === 'inside') {
      // Make dragDoc a child of targetDoc
      dragDoc.parentId = targetId;
      // Expand target so the moved doc is visible
      targetDoc.collapsed = false;
    } else {
      // Place dragDoc as sibling of targetDoc (same parent), before or after
      dragDoc.parentId = targetDoc.parentId;

      // Re-order within wikiDocs array so the visual order is preserved.
      // Remove dragDoc from its current position, then splice it next to targetDoc.
      const withoutDrag = wikiDocs.filter(d => d.id !== dragId);
      const targetIdx   = withoutDrag.findIndex(d => d.id === targetId);
      const insertIdx   = zone === 'before' ? targetIdx : targetIdx + 1;
      withoutDrag.splice(insertIdx, 0, dragDoc);
      wikiDocs = withoutDrag;
    }

    wikiSave();
    renderTree();
  }

  function initTreeDragDrop() {
    const tree = document.getElementById('wiki-tree');
    if (!tree) return;

    // Delegate dragstart to tree container (re-registered each renderTree via item attrs)
    tree.addEventListener('dragstart', e => {
      const item = e.target.closest('.wiki-tree-item');
      if (!item) return;
      dragId = item.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      // Brief delay so the dragged element renders before ghost is captured
      setTimeout(() => item.classList.add('dragging'), 0);
    });

    tree.addEventListener('dragend', e => {
      const item = e.target.closest('.wiki-tree-item');
      if (item) item.classList.remove('dragging');
      clearDragIndicators();
      dragId = dragOverId = dragZone = null;
    });

    tree.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const item = e.target.closest('.wiki-tree-item');
      if (!item || !dragId) return;

      const targetId = item.dataset.id;
      // Don't show indicator when hovering self or own descendants
      if (isAncestorOrSelf(dragId, targetId)) {
        clearDragIndicators();
        dragOverId = dragZone = null;
        return;
      }

      const zone = getDropZone(e, item);
      if (targetId !== dragOverId || zone !== dragZone) {
        clearDragIndicators();
        applyDropIndicator(item, zone);
        dragOverId = targetId;
        dragZone   = zone;
      }
    });

    tree.addEventListener('dragleave', e => {
      // Only clear when leaving the tree entirely
      if (!tree.contains(e.relatedTarget)) {
        clearDragIndicators();
        dragOverId = dragZone = null;
      }
    });

    tree.addEventListener('drop', e => {
      e.preventDefault();
      const item = e.target.closest('.wiki-tree-item');
      clearDragIndicators();
      if (!item || !dragId) return;
      commitDrop(item.dataset.id, dragZone || 'inside');
      dragId = dragOverId = dragZone = null;
    });
  }

  // ── Search ────────────────────────────────────────────────────────────────────

  function initSearch() {
    const input = document.getElementById('wiki-search');
    if (!input) return;
    input.addEventListener('input', () => {
      wikiSearchQ = input.value.trim();
      renderTree();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { input.value = ''; wikiSearchQ = ''; renderTree(); }
    });
  }

  // ── Context menu bindings ─────────────────────────────────────────────────────

  function initContextMenu() {
    const menu = document.getElementById('wiki-context-menu');
    if (!menu) return;

    menu.querySelector('[data-action="new-child"]').addEventListener('click', () => {
      const pid = menu.dataset.targetId || null;
      hideTreeContextMenu();
      newDoc(pid);
    });

    menu.querySelector('[data-action="rename"]').addEventListener('click', () => {
      const id = menu.dataset.targetId;
      hideTreeContextMenu();
      renameDoc(id);
    });

    menu.querySelector('[data-action="export-md"]').addEventListener('click', () => {
      const id = menu.dataset.targetId;
      hideTreeContextMenu();
      exportDocMd(id);
    });

    menu.querySelector('[data-action="delete"]').addEventListener('click', () => {
      const id = menu.dataset.targetId;
      hideTreeContextMenu();
      const doc = findDoc(id);
      const childCount = subtreeIds(id).length - 1;
      const label = childCount > 0 ? `"${doc?.title}"及其 ${childCount} 个子文档` : `"${doc?.title}"`;
      if (confirm(`确定要删除 ${label} 吗？此操作不可恢复。`)) deleteDoc(id);
    });

    document.addEventListener('click', e => {
      if (menu && !menu.contains(e.target)) hideTreeContextMenu();
    });
  }

  // ── Title inline edit ─────────────────────────────────────────────────────────

  function initTitleEdit() {
    const titleEl = document.getElementById('wiki-doc-title');
    if (!titleEl) return;

    // Sync title to doc on every keystroke so no edit is lost
    titleEl.addEventListener('input', () => {
      const doc = findDoc(titleEl.dataset.id);
      if (!doc) return;
      const newTitle = titleEl.textContent.trim() || '未命名文档';
      doc.title     = newTitle;
      doc.updatedAt = new Date().toISOString();
      scheduleSave();
    });

    titleEl.addEventListener('blur', () => {
      const doc = findDoc(titleEl.dataset.id);
      if (!doc) return;
      // Normalise whitespace on focus-out; re-render tree to reflect new title
      const newTitle = titleEl.textContent.trim() || '未命名文档';
      titleEl.textContent = newTitle;
      doc.title     = newTitle;
      doc.updatedAt = new Date().toISOString();
      scheduleSave();
      // Defer tree re-render so the blur event fully completes first,
      // preventing the DOM teardown from stealing focus mid-edit.
      setTimeout(renderTree, 0);
    });

    titleEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
      if (e.key === 'Escape') {
        const doc = findDoc(titleEl.dataset.id);
        if (doc) titleEl.textContent = doc.title;
        titleEl.blur();
      }
    });
  }

  // ── Button bindings ───────────────────────────────────────────────────────────

  function initButtons() {
    document.getElementById('wiki-new-root-btn').addEventListener('click', () => newDoc(null));
    document.getElementById('wiki-empty-new-btn').addEventListener('click', () => newDoc(null));

    document.getElementById('wiki-new-child-btn').addEventListener('click', () => {
      newDoc(wikiActiveId || null);
    });

    document.getElementById('wiki-export-md-btn').addEventListener('click', () => {
      if (!wikiActiveId) { showWikiToast('请先打开一篇文档', true); return; }
      exportDocMd(wikiActiveId);
    });

    document.getElementById('wiki-export-json-btn').addEventListener('click', exportAllJson);
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────────

  async function initWiki() {
    await wikiLoad();
    initWikiTab();
    initSearch();
    initContextMenu();
    initTitleEdit();
    initButtons();
    initTreeDragDrop();
    initPasteImage();
    renderTree();
  }

  // Wait for DOM + EditorJS to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWiki);
  } else {
    initWiki();
  }

})();
