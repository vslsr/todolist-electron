'use strict';

const STORE_KEY = 'todos';
let todos = [];
let currentFilter = 'all';
let sortOrder = null; // null | 'asc' | 'desc'
let dragId = null;

const PRIORITY_WEIGHT = { high: 0, normal: 1, low: 2 };
const SORT_STATES = [null, 'asc', 'desc'];
const SORT_LABELS = { null: '优先级 ↕', asc: '高 → 低 ↓', desc: '低 → 高 ↑' };

// ── Recursive helpers ──────────────────────────────────────────────────────

function findById(id, list = todos) {
  for (const t of list) {
    if (t.id === id) return t;
    const found = findById(id, t.children);
    if (found) return found;
  }
  return null;
}

// Returns [removedItem, newList] without mutating
function removeById(id, list) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      return [list[i], [...list.slice(0, i), ...list.slice(i + 1)]];
    }
    const [found, newChildren] = removeById(id, list[i].children);
    if (found) {
      const updated = { ...list[i], children: newChildren };
      return [found, [...list.slice(0, i), updated, ...list.slice(i + 1)]];
    }
  }
  return [null, list];
}

// Insert item relative to targetId: 'before' | 'after' | 'inside'
function insertAt(item, targetId, where, list) {
  return list.flatMap(t => {
    if (t.id === targetId) {
      if (where === 'before') return [item, t];
      if (where === 'after')  return [t, item];
      return [{ ...t, children: [...t.children, item], collapsed: false }];
    }
    return [{ ...t, children: insertAt(item, targetId, where, t.children) }];
  });
}

// True if childId exists anywhere inside parentId's subtree
function isDescendant(parentId, childId) {
  const parent = findById(parentId);
  return parent ? !!findById(childId, parent.children) : false;
}

const PRIORITY_OPTIONS = [['normal', '普通'], ['high', '重要'], ['low', '低优']];

function countActive(list) {
  return list.reduce((n, t) => n + (t.completed ? 0 : 1) + countActive(t.children), 0);
}

// ── Migrate / create ───────────────────────────────────────────────────────

function migrate(t) {
  return {
    ...t,
    children:  (t.children  || []).map(migrate),
    collapsed: t.collapsed ?? false,
  };
}

function createTodo(text = '', priority = 'normal') {
  return {
    id:        `${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    text:      text.trim(),
    completed: false,
    priority,
    createdAt: new Date().toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
    children:  [],
    collapsed: false,
  };
}

// ── Persistence ────────────────────────────────────────────────────────────

async function loadTodos() {
  const saved = await window.electronAPI.store.get(STORE_KEY);
  todos = (saved || []).map(migrate);
  render();
}

async function saveTodos() {
  await window.electronAPI.store.set(STORE_KEY, todos);
}

// ── CRUD ───────────────────────────────────────────────────────────────────

function addTodo() {
  const input = document.getElementById('new-task-input');
  const sel   = document.getElementById('priority-select');
  const text  = input.value.trim();
  if (!text) return;
  todos.unshift(createTodo(text, sel.value));
  input.value = '';
  saveTodos(); render();
}

function toggleTodo(id) {
  const t = findById(id);
  if (t) { t.completed = !t.completed; saveTodos(); render(); }
}

function deleteTodoInplace(id, list) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) { list.splice(i, 1); return true; }
    if (deleteTodoInplace(id, list[i].children)) return true;
  }
  return false;
}

function deleteTodo(id) {
  deleteTodoInplace(id, todos);
  saveTodos(); render();
}

function addChildTodo(parentId) {
  const parent = findById(parentId);
  if (!parent) return;
  const child = createTodo('', parent.priority);
  parent.children.push(child);
  parent.collapsed = false;
  saveTodos();
  render();
  // Focus the new child's text so user can type immediately
  const el = document.querySelector(`[data-id="${child.id}"] .task-text`);
  if (el) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }
}

function updateTodoText(id, newText) {
  const t = findById(id);
  if (t && newText.trim()) { t.text = newText.trim(); saveTodos(); }
}

function toggleCollapsed(id) {
  const t = findById(id);
  if (t) { t.collapsed = !t.collapsed; saveTodos(); render(); }
}

function clearCompleted() {
  function clean(list) {
    return list
      .filter(t => !t.completed)
      .map(t => ({ ...t, children: clean(t.children) }));
  }
  todos = clean(todos);
  saveTodos(); render();
}

function getFiltered() {
  let result =
    currentFilter === 'active'    ? todos.filter(t => !t.completed) :
    currentFilter === 'completed' ? todos.filter(t => t.completed)  : [...todos];

  if (sortOrder) {
    result = result.slice().sort((a, b) => {
      const diff = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
      return sortOrder === 'asc' ? diff : -diff;
    });
  }
  return result;
}

// ── Drag helpers ───────────────────────────────────────────────────────────

function clearIndicators() {
  document.querySelectorAll('.task-item').forEach(el =>
    el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-inside'));
}

// Split row into 3 zones: top 28% → before, bottom 28% → after, middle → inside
function getZone(e, rowEl) {
  const r     = rowEl.getBoundingClientRect();
  const ratio = (e.clientY - r.top) / r.height;
  if (ratio < 0.28) return 'before';
  if (ratio > 0.72) return 'after';
  return 'inside';
}

// ── Render ─────────────────────────────────────────────────────────────────

function render() {
  const list  = document.getElementById('task-list');
  const empty = document.getElementById('empty-state');
  const stats = document.getElementById('stats-text');

  const active = countActive(todos);
  stats.textContent = active === 0 ? '全部完成 ✓' : `${active} 项待完成`;

  list.innerHTML = '';
  const filtered = getFiltered();

  if (filtered.length === 0) {
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    filtered.forEach(t => list.appendChild(createTaskEl(t)));
  }
}

function createTaskEl(todo) {
  const li = document.createElement('li');
  li.className = `task-item priority-${todo.priority}${todo.completed ? ' completed' : ''}`;
  li.dataset.id = todo.id;
  li.draggable  = true;

  li.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    dragId = todo.id;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => li.classList.add('dragging'), 0);
  });
  li.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    clearIndicators();
    dragId = null;
  });

  // ── Row ───────────────────────────────────────────────────
  const row = document.createElement('div');
  row.className = 'task-row';

  // Drag target on row only — stops bubbling so parent/child don't interfere
  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragId || dragId === todo.id || isDescendant(dragId, todo.id)) return;
    const zone = getZone(e, row);
    clearIndicators();
    li.classList.add(
      zone === 'before' ? 'drag-over-top'    :
      zone === 'after'  ? 'drag-over-bottom' : 'drag-over-inside'
    );
  });
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragId || dragId === todo.id || isDescendant(dragId, todo.id)) return;
    const zone = getZone(e, row);
    const [dragged, next] = removeById(dragId, todos);
    if (dragged) { todos = insertAt(dragged, todo.id, zone, next); saveTodos(); render(); }
  });

  // Drag handle
  const handle = document.createElement('div');
  handle.className = 'drag-handle';
  handle.innerHTML = '⠿';
  handle.title     = '拖动排序 / 拖入分组';

  // Collapse toggle — invisible placeholder when no children
  const hasChildren = todo.children.length > 0;
  const toggle = document.createElement('div');
  toggle.className = `task-toggle${hasChildren ? '' : ' task-toggle--hidden'}`;
  toggle.innerHTML  = todo.collapsed ? '▶' : '▼';
  if (hasChildren) {
    toggle.title = todo.collapsed ? '展开' : '折叠';
    toggle.addEventListener('click', (e) => { e.stopPropagation(); toggleCollapsed(todo.id); });
  }

  // Priority dropdown
  const badge = document.createElement('select');
  badge.className = `priority-inline priority-inline--${todo.priority}`;
  PRIORITY_OPTIONS.forEach(([val, label]) => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    if (val === todo.priority) opt.selected = true;
    badge.appendChild(opt);
  });
  badge.addEventListener('mousedown', (e) => e.stopPropagation());
  badge.addEventListener('change', (e) => {
    e.stopPropagation();
    const t = findById(todo.id);
    if (t) { t.priority = e.target.value; saveTodos(); render(); }
  });

  // Checkbox
  const checkbox = document.createElement('div');
  checkbox.className = `task-checkbox${todo.completed ? ' checked' : ''}`;
  checkbox.addEventListener('click', (e) => { e.stopPropagation(); toggleTodo(todo.id); });

  // Text (inline-editable)
  const textEl = document.createElement('span');
  textEl.className       = 'task-text';
  textEl.textContent     = todo.text;
  textEl.contentEditable = 'true';
  textEl.spellcheck      = false;
  textEl.addEventListener('blur', () => {
    const typed = textEl.textContent.trim();
    if (!typed && todo.text === '') {
      deleteTodo(todo.id); // auto-inserted empty child left blank → remove
    } else {
      updateTodoText(todo.id, textEl.textContent);
    }
  });
  textEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); textEl.blur(); }
    if (e.key === 'Escape') { textEl.textContent = todo.text; textEl.blur(); }
  });

  // Date badge
  const meta = document.createElement('span');
  meta.className   = 'task-meta';
  meta.textContent = todo.createdAt;

  // Add child button
  const addChild = document.createElement('button');
  addChild.className = 'task-add-child';
  addChild.innerHTML = '+';
  addChild.title     = '添加子任务';
  addChild.addEventListener('click', (e) => { e.stopPropagation(); addChildTodo(todo.id); });

  // Delete button
  const del = document.createElement('button');
  del.className = 'task-delete';
  del.innerHTML = '×';
  del.title     = '删除';
  del.addEventListener('click', (e) => { e.stopPropagation(); deleteTodo(todo.id); });

  row.append(handle, toggle, badge, checkbox, textEl, meta, addChild, del);
  li.appendChild(row);

  // ── Collapsed preview ─────────────────────────────────────
  if (hasChildren && todo.collapsed) {
    const preview = document.createElement('div');
    preview.className = 'children-preview';
    const shown = todo.children.slice(0, 3);
    const extra = todo.children.length - shown.length;
    preview.textContent =
      shown.map(c => c.text).join(' · ') + (extra > 0 ? `  +${extra} 项` : '');
    li.appendChild(preview);
  }

  // ── Expanded child list ───────────────────────────────────
  if (hasChildren && !todo.collapsed) {
    const childList = document.createElement('ul');
    childList.className = 'task-children';
    todo.children.forEach(c => childList.appendChild(createTaskEl(c)));
    li.appendChild(childList);
  }

  return li;
}

// ── Event bindings ─────────────────────────────────────────────────────────

document.getElementById('add-btn').addEventListener('click', addTodo);

document.getElementById('new-task-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') addTodo();
});

document.getElementById('clear-completed-btn').addEventListener('click', clearCompleted);

document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    render();
  });
});

const sortBtn = document.getElementById('sort-btn');
sortBtn.addEventListener('click', () => {
  const idx = SORT_STATES.indexOf(sortOrder);
  sortOrder = SORT_STATES[(idx + 1) % SORT_STATES.length];
  sortBtn.textContent = SORT_LABELS[sortOrder];
  sortBtn.classList.toggle('sort-active', sortOrder !== null);
  render();
});

document.getElementById('export-btn').addEventListener('click', async () => {
  if (todos.length === 0) { showToast('没有可导出的任务'); return; }
  const result = await window.electronAPI.exportJson(JSON.stringify(todos, null, 2));
  if (result.success) showToast(`已导出 ${todos.length} 条任务`);
});

document.getElementById('import-btn').addEventListener('click', async () => {
  const result = await window.electronAPI.importJson();
  if (!result.success) return;
  try {
    const imported = JSON.parse(result.data);
    if (!Array.isArray(imported)) throw new Error();
    todos = imported.map(migrate);
    saveTodos(); render();
    showToast(`已导入 ${imported.length} 条任务`);
  } catch {
    showToast('导入失败：文件格式不正确', true);
  }
});

let toastTimer = null;
function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast${isError ? ' toast-error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}

loadTodos();
