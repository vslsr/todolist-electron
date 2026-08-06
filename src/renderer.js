'use strict';

const STORE_KEY = 'todos';
let todos = [];
let currentFilter = 'all';
let sortOrder = null; // null | 'asc' | 'desc'
let dragId = null;
let viewMode = 'list'; // 'list' | 'text'

const PRIORITY_WEIGHT = { high: 0, normal: 1, low: 2 };
const SORT_STATES = [null, 'asc', 'desc'];
const SORT_LABELS = { null: '优先级 ↕', asc: '高 → 低 ↓', desc: '低 → 高 ↑' };
const STATUS_STATES = ['pending', 'in-progress', 'completed'];

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

// Returns ancestor path from root to direct parent of todoId.
// Each entry carries the full node snapshot (uuid, text, priority, status, steps,
// createdAt, transferHistory…) but NOT children, to avoid sending the whole subtree.
// Returns null if todoId is not found anywhere.
function getAncestorPath(todoId, list = todos, path = []) {
  for (const t of list) {
    if (t.id === todoId) return path;
    const result = getAncestorPath(
      todoId,
      t.children,
      [...path, {
        uuid:            t.uuid,
        text:            t.text,
        priority:        t.priority,
        status:          t.status,
        steps:           t.steps,
        stack:           t.stack,
        createdAt:       t.createdAt,
        stepsCollapsed:  t.stepsCollapsed,
        transferHistory: t.transferHistory,
        transferredTo:   t.transferredTo,
        transferredFrom: t.transferredFrom,
      }]
    );
    if (result !== null) return result;
  }
  return null;
}

// Walk/create the ancestor chain, return the children array where the item
// should be inserted.
// Strategy: match each ancestor by uuid first (anywhere in the full tree);
// fall back to creating a new node at the current list level using the full
// ancestor data that was shipped with the transfer.
function ensureAncestorPath(ancestors, list) {
  if (!ancestors || ancestors.length === 0) return list;
  const [head, ...tail] = ancestors;

  // 1. UUID match — the ancestor may already exist anywhere in the tree
  let node = head.uuid ? findByUuid(head.uuid) : null;

  // 2. Not found — create it at this level using the full shipped data
  if (!node) {
    node = migrate({
      ...head,
      id:       `${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      children: [],
    });
    list.push(node);
  }

  return ensureAncestorPath(tail, node.children);
}

// Stable UUID — survives transfers unchanged (used for cross-user matching)
function makeUuid() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

// Recursively assign fresh local IDs to a todo subtree (avoids ID collision on receive).
// uuid is intentionally NOT reassigned — it stays the same for cross-user matching.
function reIdSubtree(t) {
  return {
    ...t,
    id:       `${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    // uuid preserved via ...t spread
    children: (t.children || []).map(reIdSubtree),
  };
}

// Search the full tree for a node by its stable uuid
function findByUuid(uuid, list = todos) {
  for (const t of list) {
    if (t.uuid === uuid) return t;
    const found = findByUuid(uuid, t.children);
    if (found) return found;
  }
  return null;
}

const PRIORITY_OPTIONS = [['normal', '普通'], ['high', '重要'], ['low', '低优']];

function countActive(list) {
  return list.reduce((n, t) => n + (t.status === 'completed' ? 0 : 1) + countActive(t.children), 0);
}

function calcProgress(todo) {
  if (!todo.children || todo.children.length === 0) {
    return todo.status === 'completed' ? 100 : todo.status === 'in-progress' ? 50 : 0;
  }
  const sum = todo.children.reduce((acc, c) => acc + calcProgress(c), 0);
  return Math.round(sum / todo.children.length);
}

// ── Due-date helpers ───────────────────────────────────────────────────────

function todayMidnight() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}
function parseDue(dueDate) { return new Date(dueDate + 'T00:00:00'); }

function isOverdue(todo) {
  if (!todo.dueDate || todo.status === 'completed') return false;
  return parseDue(todo.dueDate) < todayMidnight();
}
function isDueSoon(todo) {   // due within 3 days (not overdue)
  if (!todo.dueDate || todo.status === 'completed') return false;
  const diff = (parseDue(todo.dueDate) - todayMidnight()) / 864e5;
  return diff >= 0 && diff <= 3;
}
function formatDueDate(dueDate) {
  const due  = parseDue(dueDate);
  const diff = Math.round((due - todayMidnight()) / 864e5);
  if (diff < -1)  return `逾期 ${-diff} 天`;
  if (diff === -1) return '昨天到期';
  if (diff === 0)  return '今天到期';
  if (diff === 1)  return '明天到期';
  if (diff <= 7)   return `${diff} 天后`;
  return `${due.getMonth() + 1}月${due.getDate()}日`;
}

// ── Migrate / create ───────────────────────────────────────────────────────

const VALID_STATUS = new Set(['pending', 'in-progress', 'completed']);

function normalizeStatus(t) {
  const s = t.status;
  if (VALID_STATUS.has(s))           return s;             // already correct
  if (s === 'done')                  return 'completed';   // old alias
  if (s === 'doing')                 return 'in-progress'; // old alias
  if (s === 'todo')                  return 'pending';     // old alias
  // Fall back to the legacy boolean field
  return t.completed ? 'completed' : 'pending';
}

function migrate(t) {
  return {
    ...t,
    uuid:            t.uuid || makeUuid(),          // backfill for pre-uuid data
    status:          normalizeStatus(t),
    children:        (t.children || []).map(migrate),
    collapsed:       t.collapsed ?? false,
    steps:           (t.steps || []).map(s => ({ id: s.id, text: s.text || '', createdAt: s.createdAt || '' })),
    stepsCollapsed:  t.stepsCollapsed  ?? false,
    stack:           (t.stack || []).map(s => ({ id: s.id, text: s.text || '', createdAt: s.createdAt || '' })), // LIFO 工作栈，末尾为栈顶
    stackCollapsed:  t.stackCollapsed  ?? false,
    stackOpen:       t.stackOpen       ?? false,  // keep an empty panel open once user opens it
    transferHistory: t.transferHistory || [],
    transferredTo:   t.transferredTo   || null,   // { name, time } when sent out
    transferredFrom: t.transferredFrom || null,   // name string when received
    dueDate:         t.dueDate         || null,   // "YYYY-MM-DD" or null
  };
}

function createTodo(text = '', priority = 'normal') {
  return {
    id:              `${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    uuid:            makeUuid(),   // stable cross-user identifier, never reassigned
    text:            text.trim(),
    status:          'pending',
    priority,
    createdAt:       new Date().toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
    children:        [],
    collapsed:       false,
    steps:           [],
    stepsCollapsed:  false,
    stack:           [],          // LIFO 工作栈：末尾为栈顶（当前工作）
    stackCollapsed:  false,
    stackOpen:       false,
    transferHistory: [],
    transferredTo:   null,
    transferredFrom: null,
    dueDate:         null,        // "YYYY-MM-DD" string, or null
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
  wsSendTodos();   // push latest list to group server
}

// ── CRUD ───────────────────────────────────────────────────────────────────

// Split pasted/typed text into one entry per non-empty line.
// Returns [] when nothing usable is left.
function splitLines(text) {
  return String(text == null ? '' : text)
    .split(/\r\n|[\r\n\u2028\u2029]/)
    .map(line => line.trim())
    .filter(Boolean);
}

function addTodo() {
  const input = document.getElementById('new-task-input');
  const sel   = document.getElementById('priority-select');
  const lines = splitLines(input.value);
  if (lines.length === 0) return;
  // Unshift in reverse so the first line ends up on top, matching read order.
  for (let i = lines.length - 1; i >= 0; i--) {
    todos.unshift(createTodo(lines[i], sel.value));
  }
  input.value = '';
  autoGrowInput(input);
  saveTodos(); render();
}

// Keep the new-task textarea just tall enough for its content (CSS caps the height).
function autoGrowInput(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function toggleTodo(id) {
  const t = findById(id);
  if (!t) return;
  t.status =
    t.status === 'pending'     ? 'in-progress' :
    t.status === 'in-progress' ? 'completed'   :
    'pending';
  saveTodos(); render();
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

// Commit inline-edited text. Multi-line input becomes one node per line:
// the edited node takes line 1, the rest are inserted after it as siblings.
// Returns true when extra siblings were created (caller must re-render).
function updateTodoText(id, newText) {
  const lines = splitLines(newText);
  if (lines.length === 0) return false;

  const t = findById(id);
  if (!t) return false;
  t.text = lines[0];

  if (lines.length > 1) {
    const siblings = findSiblingList(id);
    const at = siblings.findIndex(s => s.id === id);
    const extras = lines.slice(1).map(line => createTodo(line, t.priority));
    siblings.splice(at + 1, 0, ...extras);
  }

  saveTodos();
  return lines.length > 1;
}

// The array that directly holds `id` (the root list, or some node's children).
function findSiblingList(id, list = todos) {
  if (list.some(t => t.id === id)) return list;
  for (const t of list) {
    const found = findSiblingList(id, t.children);
    if (found) return found;
  }
  return null;
}

function toggleCollapsed(id) {
  const t = findById(id);
  if (t) { t.collapsed = !t.collapsed; saveTodos(); render(); }
}

function addStep(todoId) {
  const t = findById(todoId);
  if (!t) return;
  const step = {
    id:        `s${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
    text:      '',
    createdAt: new Date().toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
  };
  t.steps.push(step);
  t.stepsCollapsed = false;
  saveTodos();
  render();
  const el = document.querySelector(`[data-step-id="${step.id}"] .step-text`);
  if (el) {
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(r);
  }
}

function deleteStep(todoId, stepId) {
  const t = findById(todoId);
  if (!t) return;
  t.steps = t.steps.filter(s => s.id !== stepId);
  saveTodos();
  render();
}

function updateStep(todoId, stepId, text) {
  const t = findById(todoId);
  if (!t) return;
  const s = t.steps.find(s => s.id === stepId);
  if (s) { s.text = text.trim(); saveTodos(); }
}

function toggleStepsCollapsed(todoId) {
  const t = findById(todoId);
  if (t) { t.stepsCollapsed = !t.stepsCollapsed; saveTodos(); render(); }
}

// ── Stack / 堆栈器 (per-item LIFO work stack) ────────────────────────────────
// Each todo carries a stack of work items. The TOP (last element) is the
// current focus — "栈顶表示当前要完成的工作". Push adds a new top; pop removes
// the completed top and the next item down becomes the current focus.

function focusStackInput(todoId) {
  const el = document.querySelector(`[data-id="${todoId}"] .stack-input`);
  if (el) el.focus();
}

function openStack(todoId) {
  const t = findById(todoId);
  if (!t) return;
  t.stackOpen = true;
  t.stackCollapsed = false;
  saveTodos();
  render();
  focusStackInput(todoId);
}

function closeStack(todoId) {
  const t = findById(todoId);
  if (!t) return;
  t.stackOpen = false;
  saveTodos();
  render();
}

function toggleStackCollapsed(todoId) {
  const t = findById(todoId);
  if (t) { t.stackCollapsed = !t.stackCollapsed; saveTodos(); render(); }
}

function pushStack(todoId, text) {
  const t = findById(todoId);
  if (!t) return;
  const clean = (text || '').trim();
  if (!clean) return;
  const item = {
    id:        `k${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
    text:      clean,
    createdAt: new Date().toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
  };
  t.stack = [...(t.stack || []), item];   // append → new top (current work)
  t.stackOpen = true;
  t.stackCollapsed = false;
  saveTodos();
  render();
  focusStackInput(todoId);   // keep focus for rapid entry
}

function popStack(todoId) {
  const t = findById(todoId);
  if (!t || !t.stack || t.stack.length === 0) return;
  t.stack = t.stack.slice(0, -1);   // remove the top (completed) item
  saveTodos();
  render();
}

function clearCompleted() {
  function clean(list) {
    return list
      .filter(t => t.status !== 'completed')
      .map(t => ({ ...t, children: clean(t.children) }));
  }
  todos = clean(todos);
  saveTodos(); render();
}

// Recursively keep a node if it or any descendant satisfies predicate.
// Returns a shallow-copied node with filtered children, or null if nothing matches.
// Matched paths are auto-expanded so the matching children are always visible.
function filterTree(todo, predicate) {
  const filteredChildren = (todo.children || [])
    .map(c => filterTree(c, predicate))
    .filter(Boolean);

  if (predicate(todo) || filteredChildren.length > 0) {
    return {
      ...todo,
      children:  filteredChildren,
      collapsed: filteredChildren.length > 0 ? false : todo.collapsed,
    };
  }
  return null;
}

function getFiltered() {
  let result;
  if (currentFilter === 'all') {
    result = [...todos];
  } else {
    const predicate =
      currentFilter === 'active'      ? t => t.status !== 'completed'   :
      currentFilter === 'in-progress' ? t => t.status === 'in-progress' :
      currentFilter === 'completed'   ? t => t.status === 'completed'   : null;

    result = predicate
      ? todos.map(t => filterTree(t, predicate)).filter(Boolean)
      : [...todos];
  }

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

// ── Text export ────────────────────────────────────────────────────────────

const STATUS_SYM  = { pending: '[ ]', 'in-progress': '[→]', completed: '[✓]' };
const PRIORITY_CN = { high: '重要', normal: '普通', low: '低优' };

function generateExportText(list, depth = 0) {
  if (!list || list.length === 0) return '';
  const pad = '    '.repeat(depth);
  return list.map(t => {
    const sym  = STATUS_SYM[t.status]    ?? '[ ]';
    const pri  = PRIORITY_CN[t.priority] ?? t.priority;
    const pct  = calcProgress(t);
    const lines = [`${pad}${sym} ${t.text} (${pri}) ${pct}%`];

    if (t.transferHistory && t.transferHistory.length > 0) {
      t.transferHistory.forEach(h => {
        const arrow = h.direction === 'out' ? '→' : '←';
        const label = h.direction === 'out' ? '发给' : '来自';
        lines.push(`${pad}    流转 ${arrow} ${label} ${h.name}`);
      });
    }
    if (t.steps && t.steps.length > 0) {
      t.steps.forEach((s, i) => {
        if (s.text) lines.push(`${pad}    备注 ${i + 1}. ${s.text}`);
      });
    }
    if (t.stack && t.stack.length > 0) {
      lines.push(`${pad}    ▤ 工作栈 (${t.stack.length}):`);
      for (let i = t.stack.length - 1; i >= 0; i--) {
        const marker = i === t.stack.length - 1 ? '⌖ 当前' : `  ↑${(t.stack.length - 1) - i}`;
        lines.push(`${pad}      ${marker} ${t.stack[i].text}`);
      }
    }
    if (t.children && t.children.length > 0) {
      const child = generateExportText(t.children, depth + 1);
      if (child) lines.push(child);
    }
    return lines.join('\n');
  }).join('\n');
}

// ── Render ─────────────────────────────────────────────────────────────────

function render() {
  const stats = document.getElementById('stats-text');
  const active = countActive(todos);
  stats.textContent = active === 0 ? '全部完成 ✓' : `${active} 项待完成`;

  const mainEl  = document.getElementById('task-list-main');
  const textEl  = document.getElementById('text-export-panel');

  if (viewMode === 'text' && mainEl && textEl) {
    mainEl.classList.add('hidden');
    textEl.classList.remove('hidden');
    const ta = document.getElementById('export-textarea');
    if (ta) ta.value = generateExportText(todos);
    return;
  }

  if (mainEl) mainEl.classList.remove('hidden');
  if (textEl) textEl.classList.add('hidden');

  const list  = document.getElementById('task-list');
  const empty = document.getElementById('empty-state');
  list.innerHTML = '';
  const filtered = getFiltered();

  if (filtered.length === 0) {
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    filtered.forEach(t => list.appendChild(createTaskEl(t)));
  }
}

const RING_SIZE = 28, RING_R = 10, RING_SW = 3;
const RING_CIRC = 2 * Math.PI * RING_R;

function createRingEl(pct) {
  const c = RING_SIZE / 2;
  const offset = RING_CIRC * (1 - pct / 100);
  const color  = pct === 100 ? '#5a9e35' : '#667eea';
  const ns     = 'http://www.w3.org/2000/svg';

  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width',   RING_SIZE);
  svg.setAttribute('height',  RING_SIZE);
  svg.setAttribute('viewBox', `0 0 ${RING_SIZE} ${RING_SIZE}`);
  svg.classList.add('task-ring');

  const bg = document.createElementNS(ns, 'circle');
  bg.setAttribute('cx', c); bg.setAttribute('cy', c); bg.setAttribute('r', RING_R);
  bg.setAttribute('fill', 'none');
  bg.setAttribute('stroke', '#eef0f4');
  bg.setAttribute('stroke-width', RING_SW);

  const fg = document.createElementNS(ns, 'circle');
  fg.setAttribute('cx', c); fg.setAttribute('cy', c); fg.setAttribute('r', RING_R);
  fg.setAttribute('fill', 'none');
  fg.setAttribute('stroke', pct === 0 ? 'none' : color);
  fg.setAttribute('stroke-width', RING_SW);
  fg.setAttribute('stroke-dasharray', RING_CIRC.toFixed(2));
  fg.setAttribute('stroke-dashoffset', offset.toFixed(2));
  fg.setAttribute('stroke-linecap', 'round');
  fg.setAttribute('transform', `rotate(-90 ${c} ${c})`);

  const txt = document.createElementNS(ns, 'text');
  txt.setAttribute('x', c);
  txt.setAttribute('y', c + 2.5);
  txt.setAttribute('text-anchor', 'middle');
  txt.setAttribute('dominant-baseline', 'middle');
  txt.setAttribute('font-size', '7');
  txt.setAttribute('font-weight', '600');
  txt.setAttribute('font-family', 'Segoe UI, system-ui, sans-serif');
  txt.setAttribute('fill', pct === 0 ? '#ccc' : color);
  txt.textContent = `${pct}%`;

  svg.append(bg, fg, txt);
  return svg;
}

function createTaskEl(todo) {
  const li = document.createElement('li');
  li.className = [
    `task-item priority-${todo.priority}`,
    todo.status === 'completed'   ? 'completed'            : '',
    todo.status === 'in-progress' ? 'in-progress'          : '',
    todo.transferredTo            ? 'task-item--transferred': '',
    todo.transferredFrom          ? 'task-item--received'   : '',
  ].filter(Boolean).join(' ');
  li.dataset.id = todo.id;
  li.draggable = false;   // only enable while pressing the handle
  const isTransferred = !!todo.transferredTo;   // read-only lock for transferred-out items

  li.addEventListener('dragstart', (e) => {
    if (!li.draggable) { e.preventDefault(); return; }
    e.stopPropagation();
    dragId = todo.id;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => li.classList.add('dragging'), 0);
  });
  li.addEventListener('dragend', () => {
    li.draggable = false;
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

  // Drag handle — only pressing this dot activates drag
  const handle = document.createElement('div');
  handle.className = 'drag-handle';
  handle.innerHTML = '⠿';
  handle.title     = '拖动排序 / 拖入分组';
  handle.addEventListener('mousedown', () => { li.draggable = true; });
  handle.addEventListener('mouseup',   () => { li.draggable = false; });
  // also cancel if mouse leaves handle before drag starts
  handle.addEventListener('mouseleave', () => { if (!dragId) li.draggable = false; });

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
    if (isTransferred) return;
    const t = findById(todo.id);
    if (t) { t.priority = e.target.value; saveTodos(); render(); }
  });
  if (isTransferred) badge.disabled = true;

  // Checkbox
  const checkbox = document.createElement('div');
  checkbox.className = `task-checkbox${todo.status === 'completed' ? ' checked' : todo.status === 'in-progress' ? ' in-progress' : ''}`;
  checkbox.addEventListener('click', (e) => { e.stopPropagation(); if (!isTransferred) toggleTodo(todo.id); });

  // Text (inline-editable, locked for transferred-out items)
  const textEl = document.createElement('span');
  textEl.className       = 'task-text';
  textEl.textContent     = todo.text;
  textEl.contentEditable = isTransferred ? 'false' : 'true';
  textEl.spellcheck      = false;
  if (!isTransferred) {
    // innerText (not textContent) so pasted/Shift+Enter line breaks survive as \n
    const readText = () => textEl.innerText;
    let committed = false;   // set once a re-render has taken over this element

    const commit = () => {
      if (committed) return;
      committed = true;
      const raw = readText();
      if (!raw.trim() && todo.text === '') {
        deleteTodo(todo.id); // auto-inserted empty child left blank → remove
      } else if (updateTodoText(todo.id, raw)) {
        render();            // extra lines became sibling nodes
      }
    };

    textEl.addEventListener('blur', commit);
    textEl.addEventListener('keydown', (e) => {
      // Shift+Enter inserts a line break → becomes another node on commit
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); textEl.blur(); }
      if (e.key === 'Escape') { committed = true; textEl.textContent = todo.text; textEl.blur(); }
    });
    // Paste as plain text; a multi-line paste commits immediately as multiple nodes
    textEl.addEventListener('paste', (e) => {
      const pasted = (e.clipboardData || window.clipboardData).getData('text/plain');
      if (!pasted) return;
      e.preventDefault();
      document.execCommand('insertText', false, pasted);
      if (splitLines(readText()).length > 1) commit();
    });
  }

  // Date badge
  const meta = document.createElement('span');
  meta.className   = 'task-meta';
  meta.textContent = todo.createdAt;

  // Ring progress
  const ring = createRingEl(calcProgress(todo));

  // Add step button
  const addStepBtn = document.createElement('button');
  addStepBtn.className = 'task-add-step';
  addStepBtn.innerHTML = '≡';
  addStepBtn.title     = '添加工作备注';
  addStepBtn.addEventListener('click', (e) => { e.stopPropagation(); addStep(todo.id); });

  // Stack (堆栈器) button — opens the item's work stack
  const stackHasItems = !!(todo.stack && todo.stack.length > 0);
  const stackBtn = document.createElement('button');
  stackBtn.className = `task-stack-btn${stackHasItems ? ' task-stack-btn--active' : ''}`;
  stackBtn.innerHTML = '▤';
  stackBtn.title     = '工作栈（堆栈器）· 栈顶为当前工作';
  stackBtn.addEventListener('click', (e) => { e.stopPropagation(); openStack(todo.id); });

  // Transfer (paper-plane) button
  const transferBtn = document.createElement('button');
  transferBtn.className = 'task-transfer-btn';
  transferBtn.innerHTML = '✈';
  transferBtn.title     = '流转给成员';
  transferBtn.addEventListener('click', (e) => { e.stopPropagation(); showTransferDropdown(transferBtn, todo.id); });

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

  // ── Due date widget ────────────────────────────────────────────────────
  const dueDateWrap = document.createElement('span');
  dueDateWrap.className = 'task-due-wrap';

  // Hidden native date input — showPicker() opens the calendar
  const dueDateInput = document.createElement('input');
  dueDateInput.type      = 'date';
  dueDateInput.className = 'task-due-input';
  if (todo.dueDate) dueDateInput.value = todo.dueDate;
  dueDateInput.addEventListener('change', (e) => {
    e.stopPropagation();
    const t = findById(todo.id);
    if (t) { t.dueDate = dueDateInput.value || null; saveTodos(); render(); }
  });

  // Visible badge
  const dueDateBadge = document.createElement('span');
  dueDateBadge.className = 'task-due-badge';

  if (todo.dueDate) {
    const overdue = isOverdue(todo);
    const soon    = !overdue && isDueSoon(todo);
    dueDateBadge.classList.add(
      overdue ? 'task-due-badge--overdue' :
      soon    ? 'task-due-badge--soon'    : 'task-due-badge--set'
    );
    const dateText = document.createElement('span');
    dateText.textContent = formatDueDate(todo.dueDate);
    const clearBtn = document.createElement('span');
    clearBtn.className   = 'task-due-clear';
    clearBtn.textContent = '×';
    clearBtn.title       = '清除到期日';
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = findById(todo.id);
      if (t) { t.dueDate = null; saveTodos(); render(); }
    });
    dueDateBadge.append(dateText, clearBtn);
  } else {
    dueDateBadge.classList.add('task-due-badge--empty');
    dueDateBadge.textContent = '🗓';
    dueDateBadge.title = '设置到期日';
  }

  // Click on wrap → open picker (unless clear-btn was clicked)
  if (!isTransferred) {
    dueDateWrap.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.classList.contains('task-due-clear')) return;
      try { dueDateInput.showPicker(); } catch { dueDateInput.click(); }
    });
  } else if (!todo.dueDate) {
    dueDateBadge.style.display = 'none';   // hide empty badge on locked items
  }

  dueDateWrap.append(dueDateInput, dueDateBadge);
  // ──────────────────────────────────────────────────────────────────────

  // Hide editing actions on transferred-out items (preview + delete only)
  if (isTransferred) {
    addStepBtn.style.display = 'none';
    stackBtn.style.display   = 'none';
    transferBtn.style.display = 'none';
    addChild.style.display   = 'none';
  }

  // Transfer status badge (inline after text)
  const rowItems = [handle, toggle, badge, checkbox, textEl];
  if (todo.transferredTo) {
    const tb = document.createElement('span');
    tb.className   = 'transfer-status-badge transfer-status-badge--out';
    tb.textContent = `✈ 已流转给 ${todo.transferredTo.name}`;
    rowItems.push(tb);
  } else if (todo.transferredFrom) {
    const tb = document.createElement('span');
    tb.className   = 'transfer-status-badge transfer-status-badge--in';
    tb.textContent = `← 来自 ${todo.transferredFrom}`;
    rowItems.push(tb);
  }

  // Current stack-top chip — surfaces "当前要完成的工作" at a glance
  if (stackHasItems) {
    const topEntry = todo.stack[todo.stack.length - 1];
    const topChip  = document.createElement('span');
    topChip.className = 'stack-top-chip';
    topChip.title     = `工作栈栈顶（当前工作）· 共 ${todo.stack.length} 项 — 点击展开`;

    const chipIcon = document.createElement('span');
    chipIcon.className   = 'stack-top-chip-icon';
    chipIcon.textContent = '⌖';

    const chipText = document.createElement('span');
    chipText.className   = 'stack-top-chip-text';
    chipText.textContent = topEntry.text;

    const chipCount = document.createElement('span');
    chipCount.className   = 'stack-top-chip-count';
    chipCount.textContent = todo.stack.length;

    topChip.append(chipIcon, chipText, chipCount);
    topChip.addEventListener('click', (e) => { e.stopPropagation(); openStack(todo.id); });
    rowItems.push(topChip);
  }

  rowItems.push(dueDateWrap, meta, ring, stackBtn, addStepBtn, transferBtn, addChild, del);
  row.append(...rowItems);
  li.appendChild(row);

  // ── Transfer history section ──────────────────────────────
  if (todo.transferHistory && todo.transferHistory.length > 0) {
    const thSection = document.createElement('div');
    thSection.className = 'task-steps task-transfer-history';

    const thHeader = document.createElement('div');
    thHeader.className = 'steps-header';

    const thTgl = document.createElement('span');
    thTgl.className   = 'steps-toggle';
    thTgl.textContent = '▼';

    const thLbl = document.createElement('span');
    thLbl.className   = 'steps-label transfer-history-label';
    thLbl.textContent = `流转历史 (${todo.transferHistory.length})`;

    let thCollapsed = false;
    const thList = document.createElement('ol');
    thList.className = 'steps-list';

    todo.transferHistory.forEach((h, idx) => {
      const item = document.createElement('li');
      item.className = 'step-item';

      const num = document.createElement('span');
      num.className   = 'step-num';
      num.textContent = `${idx + 1}.`;

      const txt = document.createElement('span');
      txt.className   = `step-text transfer-history-text transfer-history-text--${h.direction}`;
      txt.textContent = `${h.direction === 'out' ? '→ 发给' : '← 来自'} ${h.name}`;

      const timeMeta = document.createElement('span');
      timeMeta.className   = 'step-meta';
      timeMeta.textContent = new Date(h.time).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      item.append(num, txt, timeMeta);
      thList.appendChild(item);
    });

    const toggleTH = () => {
      thCollapsed = !thCollapsed;
      thTgl.textContent = thCollapsed ? '▶' : '▼';
      thList.style.display = thCollapsed ? 'none' : '';
    };
    thTgl.addEventListener('click', toggleTH);
    thLbl.addEventListener('click', toggleTH);

    thHeader.append(thTgl, thLbl);
    thSection.append(thHeader, thList);
    li.appendChild(thSection);
  }

  // ── Steps section ─────────────────────────────────────────
  if (todo.steps && todo.steps.length > 0) {
    const stepsSection = document.createElement('div');
    stepsSection.className = 'task-steps';

    const stepsHeader = document.createElement('div');
    stepsHeader.className = 'steps-header';

    const stepsTgl = document.createElement('span');
    stepsTgl.className   = 'steps-toggle';
    stepsTgl.textContent = todo.stepsCollapsed ? '▶' : '▼';
    stepsTgl.addEventListener('click', () => toggleStepsCollapsed(todo.id));

    const stepsLbl = document.createElement('span');
    stepsLbl.className   = 'steps-label';
    stepsLbl.textContent = `工作备注 (${todo.steps.length})`;
    stepsLbl.addEventListener('click', () => toggleStepsCollapsed(todo.id));

    const stepsAddBtn = document.createElement('button');
    stepsAddBtn.className = 'steps-add-btn';
    stepsAddBtn.innerHTML = '+';
    stepsAddBtn.title     = '添加备注';
    stepsAddBtn.addEventListener('click', (e) => { e.stopPropagation(); addStep(todo.id); });
    if (isTransferred) stepsAddBtn.style.display = 'none';

    stepsHeader.append(stepsTgl, stepsLbl, stepsAddBtn);
    stepsSection.appendChild(stepsHeader);

    if (!todo.stepsCollapsed) {
      const stepsList = document.createElement('ol');
      stepsList.className = 'steps-list';

      todo.steps.forEach((step, idx) => {
        const stepItem = document.createElement('li');
        stepItem.className    = 'step-item';
        stepItem.dataset.stepId = step.id;

        const stepNum = document.createElement('span');
        stepNum.className   = 'step-num';
        stepNum.textContent = `${idx + 1}.`;

        const stepText = document.createElement('span');
        stepText.className       = 'step-text';
        stepText.textContent     = step.text;
        stepText.contentEditable = isTransferred ? 'false' : 'true';
        stepText.spellcheck      = false;
        if (!isTransferred) {
          stepText.addEventListener('blur', () => {
            const typed = stepText.textContent.trim();
            if (!typed && step.text === '') {
              deleteStep(todo.id, step.id);
            } else {
              updateStep(todo.id, step.id, stepText.textContent);
            }
          });
          stepText.addEventListener('keydown', (e) => {
            if (e.key === 'Enter')  { e.preventDefault(); stepText.blur(); }
            if (e.key === 'Escape') { stepText.textContent = step.text; stepText.blur(); }
          });
        }

        const stepMeta = document.createElement('span');
        stepMeta.className   = 'step-meta';
        stepMeta.textContent = step.createdAt;

        const stepDel = document.createElement('button');
        stepDel.className = 'step-del';
        stepDel.innerHTML = '×';
        stepDel.title     = '删除备注';
        stepDel.addEventListener('click', (e) => { e.stopPropagation(); deleteStep(todo.id, step.id); });
        if (isTransferred) stepDel.style.display = 'none';

        stepItem.append(stepNum, stepText, stepMeta, stepDel);
        stepsList.appendChild(stepItem);
      });

      stepsSection.appendChild(stepsList);
    }

    li.appendChild(stepsSection);
  }

  // ── Stack section (堆栈器 / 工作栈) ────────────────────────
  const stackCount   = todo.stack ? todo.stack.length : 0;
  const stackVisible = stackCount > 0 || todo.stackOpen;
  if (stackVisible) {
    const stackSection = document.createElement('div');
    stackSection.className = 'task-stack';

    // Header
    const sHeader = document.createElement('div');
    sHeader.className = 'stack-header';

    const sTgl = document.createElement('span');
    sTgl.className   = 'stack-toggle';
    sTgl.textContent = todo.stackCollapsed ? '▶' : '▼';
    sTgl.addEventListener('click', (e) => { e.stopPropagation(); toggleStackCollapsed(todo.id); });

    const sLbl = document.createElement('span');
    sLbl.className   = 'stack-label';
    sLbl.textContent = '▤ 工作栈';
    sLbl.addEventListener('click', (e) => { e.stopPropagation(); toggleStackCollapsed(todo.id); });

    const sCount = document.createElement('span');
    sCount.className   = 'stack-count';
    sCount.textContent = `(${stackCount})`;

    const sHint = document.createElement('span');
    sHint.className   = 'stack-hint';
    sHint.textContent = stackCount > 0 ? '栈顶 = 当前工作' : '压入第一项工作开始';

    const sSpacer = document.createElement('span');
    sSpacer.className = 'stack-spacer';

    sHeader.append(sTgl, sLbl, sCount, sHint, sSpacer);

    // Close (dismiss) button — only meaningful for an empty, opened panel
    if (stackCount === 0 && !isTransferred) {
      const sClose = document.createElement('button');
      sClose.className = 'stack-close';
      sClose.innerHTML = '✕';
      sClose.title     = '关闭工作栈';
      sClose.addEventListener('click', (e) => { e.stopPropagation(); closeStack(todo.id); });
      sHeader.appendChild(sClose);
    }

    stackSection.appendChild(sHeader);

    if (!todo.stackCollapsed) {
      const sBody = document.createElement('div');
      sBody.className = 'stack-body';

      // Push input row (hidden on transferred/locked items)
      if (!isTransferred) {
        const pushRow = document.createElement('div');
        pushRow.className = 'stack-push-row';

        const input = document.createElement('input');
        input.type        = 'text';
        input.className    = 'stack-input';
        input.placeholder  = '压入一项要先完成的工作…';
        input.maxLength    = 200;
        input.addEventListener('mousedown', (e) => e.stopPropagation());

        const pushBtn = document.createElement('button');
        pushBtn.className = 'stack-push-btn';
        pushBtn.innerHTML = '压入 ↧';
        pushBtn.title     = '压入栈顶，成为当前工作 (push)';

        const doPush = () => { const v = input.value; input.value = ''; pushStack(todo.id, v); };
        pushBtn.addEventListener('click', (e) => { e.stopPropagation(); doPush(); });
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); doPush(); }
        });

        pushRow.append(input, pushBtn);
        sBody.appendChild(pushRow);
      }

      if (stackCount > 0) {
        const cards = document.createElement('div');
        cards.className = 'stack-cards';

        // Render from top (last element) down to bottom (first)
        for (let i = todo.stack.length - 1; i >= 0; i--) {
          const entry        = todo.stack[i];
          const isTop        = i === todo.stack.length - 1;
          const depthFromTop = (todo.stack.length - 1) - i;

          const card = document.createElement('div');
          card.className        = `stack-card${isTop ? ' stack-card--top' : ' stack-card--buried'}`;
          card.dataset.stackId  = entry.id;

          const cBadge = document.createElement('span');
          cBadge.className   = 'stack-card-badge';
          cBadge.textContent = isTop ? '当前' : `↑${depthFromTop}`;

          const cText = document.createElement('span');
          cText.className   = 'stack-card-text';
          cText.textContent = entry.text;

          const cMeta = document.createElement('span');
          cMeta.className   = 'stack-card-meta';
          cMeta.textContent = entry.createdAt;

          card.append(cBadge, cText, cMeta);

          // Pop button only on the top card (true LIFO) — hidden when locked
          if (isTop && !isTransferred) {
            const popBtn = document.createElement('button');
            popBtn.className = 'stack-pop-btn';
            popBtn.innerHTML = '✓ 弹出';
            popBtn.title     = '完成并弹出栈顶 (pop)';
            popBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              popBtn.disabled = true;
              card.classList.add('stack-card--popping');   // play pop animation…
              setTimeout(() => popStack(todo.id), 200);     // …then mutate + re-render
            });
            card.appendChild(popBtn);
          }

          cards.appendChild(card);
        }
        sBody.appendChild(cards);
      } else {
        const empty = document.createElement('div');
        empty.className   = 'stack-empty';
        empty.textContent = '栈为空 — 压入一项工作，它将成为当前要完成的内容';
        sBody.appendChild(empty);
      }

      stackSection.appendChild(sBody);
    } else if (stackCount > 0) {
      // Collapsed: still surface the current top
      const preview = document.createElement('div');
      preview.className   = 'stack-collapsed-preview';
      preview.textContent = `⌖ 当前：${todo.stack[todo.stack.length - 1].text}`;
      stackSection.appendChild(preview);
    }

    li.appendChild(stackSection);
  }

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

const newTaskInput = document.getElementById('new-task-input');

newTaskInput.addEventListener('keydown', e => {
  // Enter confirms; Shift+Enter adds a line, and each line becomes its own task.
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addTodo(); }
});
newTaskInput.addEventListener('input', () => autoGrowInput(newTaskInput));
newTaskInput.addEventListener('paste', () => {
  setTimeout(() => autoGrowInput(newTaskInput), 0);
});

document.getElementById('clear-completed-btn').addEventListener('click', clearCompleted);

document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
    document.getElementById('text-tab-btn').classList.remove('active');
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    viewMode = 'list';
    render();
  });
});

// Text export tab
document.getElementById('text-tab-btn').addEventListener('click', () => {
  document.querySelectorAll('.filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
  document.getElementById('text-tab-btn').classList.add('active');
  viewMode = 'text';
  render();
});

// Copy text export
document.getElementById('copy-text-btn').addEventListener('click', () => {
  const ta = document.getElementById('export-textarea');
  navigator.clipboard.writeText(ta.value)
    .then(() => showToast('已复制到剪贴板'))
    .catch(() => { ta.select(); document.execCommand('copy'); showToast('已复制到剪贴板'); });
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

// ── Reminder ───────────────────────────────────────────────────────────────

const rEl = {
  work:    () => document.getElementById('r-work'),
  brk:     () => document.getElementById('r-break'),
  mode:    () => document.getElementById('r-mode'),
  toggle:  () => document.getElementById('r-toggle'),
  pause:   () => document.getElementById('r-pause'),
  display: () => document.getElementById('r-display'),
  time:    () => document.getElementById('r-time'),
  phase:   () => document.getElementById('r-phase'),
  track:   () => document.getElementById('r-track'),
  fill:    () => document.getElementById('r-fill'),
};

let rSettings = { workMin: 25, breakMin: 5, loop: true, selectedPreset: null };
let rState    = { running: false, paused: false, phase: 'work', remaining: 0, total: 0, timer: null };

async function loadReminderSettings() {
  const saved = await window.electronAPI.store.get('reminderSettings');
  if (saved) {
    rSettings = { ...rSettings, ...saved };
    rEl.work().value  = rSettings.workMin;
    rEl.brk().value   = rSettings.breakMin;
    rEl.mode().value  = rSettings.loop ? 'loop' : 'once';
  }
}

function saveReminderSettings() {
  window.electronAPI.store.set('reminderSettings', rSettings);
}

function rFmt(sec) {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

function rNotify(title, body, phase) {
  // 系统通知
  if (window.Notification) {
    const send = () => new Notification(title, { body, silent: false });
    Notification.permission === 'granted'
      ? send()
      : Notification.requestPermission().then(p => p === 'granted' && send());
  }
  // 置顶强提醒窗口（覆盖所有应用最上层）
  if (window.electronAPI && window.electronAPI.showReminderAlert) {
    window.electronAPI.showReminderAlert({ title, body, phase });
  }
}

function rUpdateUI() {
  const { running, paused, phase, remaining, total } = rState;
  const btn      = rEl.toggle();
  const pauseBtn = rEl.pause();

  if (running) {
    btn.textContent = '■ 停止';
    btn.classList.add('r-btn--running');
    rEl.display().classList.remove('hidden');
    rEl.track().classList.remove('hidden');

    rEl.time().textContent = rFmt(remaining);

    const isWork = phase === 'work';
    rEl.phase().textContent = isWork
      ? (paused ? '工作中 · 已暂停' : '工作中')
      : (paused ? '休息中 · 已暂停' : '休息中');
    rEl.phase().className   = `r-phase ${isWork ? 'r-phase--work' : 'r-phase--break'}${paused ? ' r-phase--paused' : ''}`;
    rEl.fill().className    = `r-fill ${isWork ? 'r-fill--work' : 'r-fill--break'}`;
    rEl.fill().style.width  = `${((total - remaining) / total) * 100}%`;

    // Pause / resume button
    pauseBtn.classList.remove('hidden');
    if (paused) {
      pauseBtn.textContent = '▶ 继续';
      pauseBtn.classList.add('r-btn--resume');
      pauseBtn.classList.remove('r-btn--pause');
    } else {
      pauseBtn.textContent = '⏸ 暂停';
      pauseBtn.classList.remove('r-btn--resume');
      pauseBtn.classList.add('r-btn--pause');
    }

    // Lock inputs while running
    rEl.work().disabled = rEl.brk().disabled = rEl.mode().disabled = true;
    document.getElementById('r-preset-sel').disabled = true;
    document.getElementById('r-preset-add').disabled = true;
    document.getElementById('r-preset-del').disabled = true;
  } else {
    btn.textContent = '▶ 开始';
    btn.classList.remove('r-btn--running');
    rEl.display().classList.add('hidden');
    rEl.track().classList.add('hidden');
    pauseBtn.classList.add('hidden');
    pauseBtn.classList.remove('r-btn--pause', 'r-btn--resume');
    rEl.work().disabled = rEl.brk().disabled = rEl.mode().disabled = false;
    document.getElementById('r-preset-sel').disabled = false;
    document.getElementById('r-preset-add').disabled = false;
    const hasSel = !!document.getElementById('r-preset-sel').value;
    document.getElementById('r-preset-del').disabled = !hasSel;
  }
}

function rTick() {
  rState.remaining--;
  if (rState.remaining <= 0) {
    if (rState.phase === 'work') {
      rNotify('休息一下 ☕', `专注结束，休息 ${rSettings.breakMin} 分钟`, 'break');
      if (rSettings.loop) {
        rState.phase     = 'break';
        rState.remaining = rState.total = rSettings.breakMin * 60;
      } else { rStop(); return; }
    } else {
      rNotify('继续工作 💪', `休息结束，开始专注 ${rSettings.workMin} 分钟`, 'work');
      if (rSettings.loop) {
        rState.phase     = 'work';
        rState.remaining = rState.total = rSettings.workMin * 60;
      } else { rStop(); return; }
    }
  }
  rUpdateUI();
}

function rStart() {
  rSettings.workMin  = Math.max(1, parseInt(rEl.work().value)  || 25);
  rSettings.breakMin = Math.max(1, parseInt(rEl.brk().value)   || 5);
  rSettings.loop     = rEl.mode().value === 'loop';
  saveReminderSettings();

  rState.running   = true;
  rState.phase     = 'work';
  rState.remaining = rState.total = rSettings.workMin * 60;
  rState.timer     = setInterval(rTick, 1000);
  rUpdateUI();
}

function rPause() {
  clearInterval(rState.timer);
  rState.timer  = null;
  rState.paused = true;
  rUpdateUI();
}

function rResume() {
  rState.paused = false;
  rState.timer  = setInterval(rTick, 1000);
  rUpdateUI();
}

function rStop() {
  clearInterval(rState.timer);
  rState.running = false;
  rState.paused  = false;
  rUpdateUI();
}

rEl.toggle().addEventListener('click', () => rState.running ? rStop() : rStart());
rEl.pause().addEventListener('click',  () => rState.paused  ? rResume() : rPause());

// ── Reminder presets ────────────────────────────────────────────────────────

let rPresets = [];

function rRenderPresets(selectIndex = null) {
  const sel = document.getElementById('r-preset-sel');
  const prevVal = selectIndex !== null ? String(selectIndex) : sel.value;
  sel.innerHTML = '<option value="" disabled>选择预设…</option>';
  rPresets.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${p.name}  (工${p.workMin}/休${p.breakMin}分 ${p.loop ? '循环' : '单次'})`;
    sel.appendChild(opt);
  });
  if (prevVal !== '' && rPresets[parseInt(prevVal)]) sel.value = prevVal;
  document.getElementById('r-preset-del').disabled = !sel.value;
}

async function loadReminderPresets() {
  const saved = await window.electronAPI.store.get('reminderPresets');
  rPresets = saved || [];
  rRenderPresets();
  // Restore previously selected preset and apply its times to inputs
  const idx = rSettings.selectedPreset;
  if (idx !== null && idx !== undefined && rPresets[idx]) {
    const sel = document.getElementById('r-preset-sel');
    sel.value = String(idx);
    document.getElementById('r-preset-del').disabled = false;
    const p = rPresets[idx];
    rEl.work().value = p.workMin;
    rEl.brk().value  = p.breakMin;
    rEl.mode().value = p.loop ? 'loop' : 'once';
  }
}

function saveReminderPresets() {
  window.electronAPI.store.set('reminderPresets', rPresets);
}

// If a preset is selected and the user edits inputs → update that preset in-place
function rSyncSelectedPreset() {
  const sel = document.getElementById('r-preset-sel');
  const idx = parseInt(sel.value);
  // Always persist current input values to rSettings
  rSettings.workMin  = Math.max(1, parseInt(rEl.work().value) || 25);
  rSettings.breakMin = Math.max(1, parseInt(rEl.brk().value)  || 5);
  rSettings.loop     = rEl.mode().value === 'loop';
  if (!isNaN(idx) && rPresets[idx]) {
    // Also update the linked preset in-place
    rPresets[idx].workMin  = rSettings.workMin;
    rPresets[idx].breakMin = rSettings.breakMin;
    rPresets[idx].loop     = rSettings.loop;
    rSettings.selectedPreset = idx;
    saveReminderPresets();
    rRenderPresets(idx);
  }
  saveReminderSettings();
}

rEl.work().addEventListener('change', rSyncSelectedPreset);
rEl.brk().addEventListener('change',  rSyncSelectedPreset);
rEl.mode().addEventListener('change', rSyncSelectedPreset);

// Apply preset to inputs and persist selection
document.getElementById('r-preset-sel').addEventListener('change', e => {
  const idx = parseInt(e.target.value);
  if (isNaN(idx) || !rPresets[idx]) {
    rSettings.selectedPreset = null;
    saveReminderSettings();
    return;
  }
  const p = rPresets[idx];
  rEl.work().value = p.workMin;
  rEl.brk().value  = p.breakMin;
  rEl.mode().value = p.loop ? 'loop' : 'once';
  rSettings.workMin  = p.workMin;
  rSettings.breakMin = p.breakMin;
  rSettings.loop     = p.loop;
  rSettings.selectedPreset = idx;
  saveReminderSettings();
  document.getElementById('r-preset-del').disabled = false;
});

// Show name input
document.getElementById('r-preset-add').addEventListener('click', () => {
  const wrap = document.getElementById('r-name-wrap');
  wrap.classList.remove('hidden');
  const input = document.getElementById('r-preset-name');
  input.value = '';
  input.focus();
});

// Confirm save
function rConfirmSave() {
  const name = document.getElementById('r-preset-name').value.trim();
  if (!name) { document.getElementById('r-preset-name').focus(); return; }
  rPresets.push({
    name,
    workMin:  Math.max(1, parseInt(rEl.work().value) || 25),
    breakMin: Math.max(1, parseInt(rEl.brk().value)  || 5),
    loop:     rEl.mode().value === 'loop',
  });
  saveReminderPresets();
  rRenderPresets(rPresets.length - 1);
  document.getElementById('r-name-wrap').classList.add('hidden');
}

document.getElementById('r-name-ok').addEventListener('click', rConfirmSave);
document.getElementById('r-preset-name').addEventListener('keydown', e => {
  if (e.key === 'Enter')  rConfirmSave();
  if (e.key === 'Escape') document.getElementById('r-name-wrap').classList.add('hidden');
});

// Cancel
document.getElementById('r-name-cancel').addEventListener('click', () => {
  document.getElementById('r-name-wrap').classList.add('hidden');
});

// Delete selected preset
document.getElementById('r-preset-del').addEventListener('click', () => {
  const sel = document.getElementById('r-preset-sel');
  const idx = parseInt(sel.value);
  if (isNaN(idx) || !rPresets[idx]) return;
  rPresets.splice(idx, 1);
  rSettings.selectedPreset = null;
  saveReminderSettings();
  saveReminderPresets();
  rRenderPresets();
});

loadReminderSettings().then(() => loadReminderPresets());
loadTodos();

// ── Transfer (流转) ────────────────────────────────────────────────────────

let _transferDropdown = null;

function showTransferDropdown(anchorBtn, todoId) {
  // close existing
  if (_transferDropdown) { _transferDropdown.remove(); _transferDropdown = null; }

  if (!wsConnected) { showToast('请先连接工作组服务器'); return; }
  const members = (groupUsers || []).filter(u => u.id !== wsMyId);
  if (members.length === 0) { showToast('当前没有其他在线成员'); return; }

  const dropdown = document.createElement('div');
  dropdown.className = 'transfer-dropdown';

  const titleEl = document.createElement('div');
  titleEl.className   = 'transfer-dropdown-title';
  titleEl.textContent = '流转给…';
  dropdown.appendChild(titleEl);

  members.forEach(m => {
    const item = document.createElement('div');
    item.className   = 'transfer-dropdown-item';
    item.textContent = m.name;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      transferTodo(todoId, m.id, m.name);
      dropdown.remove();
      _transferDropdown = null;
    });
    dropdown.appendChild(item);
  });

  const rect = anchorBtn.getBoundingClientRect();
  dropdown.style.cssText = `position:fixed;top:${rect.bottom + 4}px;left:${rect.left}px;z-index:500`;
  document.body.appendChild(dropdown);
  _transferDropdown = dropdown;

  setTimeout(() => {
    document.addEventListener('click', function _close() {
      dropdown.remove();
      _transferDropdown = null;
      document.removeEventListener('click', _close);
    });
  }, 0);
}

function transferTodo(todoId, toUserId, toUserName) {
  const todo = findById(todoId);
  if (!todo) return;

  const timeNow = Date.now();
  todo.transferHistory = [...(todo.transferHistory || []),
    { direction: 'out', name: toUserName, time: timeNow }];
  todo.transferredTo = { name: toUserName, time: timeNow };

  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    const ancestors = getAncestorPath(todoId) || [];  // [] = top-level item
    wsClient.send(JSON.stringify({ type: 'transfer', todo, ancestors, toUserId, toUserName }));
  }
  saveTodos();
  render();
  showToast(`✈ 已流转给 ${toUserName}`);
}

// ── Group / WebSocket client ────────────────────────────────────────────────

let wsClient      = null;
let wsMyId        = null;
let wsConnected   = false;
let groupUsers    = [];
let groupVisible  = false;
let viewingUserId = null;   // id of user whose todos overlay is open

const gEl = {
  panel:      () => document.getElementById('group-panel'),
  name:       () => document.getElementById('g-name'),
  url:        () => document.getElementById('g-url'),
  connectBtn: () => document.getElementById('g-connect'),
  statusDot:  () => document.getElementById('g-status-dot'),
  statusText: () => document.getElementById('g-status-text'),
  userList:   () => document.getElementById('g-user-list'),
  userCount:  () => document.getElementById('g-user-count'),
};

// -- Send helpers -----------------------------------------------------

// Send todo list to server (called from saveTodos & on connect)
function wsSendTodos() {
  if (!wsClient || wsClient.readyState !== WebSocket.OPEN) return;
  wsClient.send(JSON.stringify({ type: 'todos', todos }));
}

// Send current reminder state to server ----------------------------

function wsSendStatus() {
  if (!wsClient || wsClient.readyState !== WebSocket.OPEN) return;
  wsClient.send(JSON.stringify({
    type:      'status',
    running:   rState.running,
    paused:    rState.paused,
    phase:     rState.phase,
    remaining: rState.remaining,
    workMin:   rSettings.workMin,
  }));
}

// Periodic broadcast every 5 s so peers see live countdown
setInterval(() => { if (rState.running && !rState.paused) wsSendStatus(); }, 5000);

// -- Wrap rStart/rStop/rPause/rResume to auto-notify on state change ---
// (button handlers do dynamic name lookup, so patching the names is enough)

const _gOrigStart  = rStart;
const _gOrigStop   = rStop;
const _gOrigPause  = rPause;
const _gOrigResume = rResume;
rStart  = function rStart()  { _gOrigStart();  wsSendStatus(); };
rStop   = function rStop()   { _gOrigStop();   wsSendStatus(); };
rPause  = function rPause()  { _gOrigPause();  wsSendStatus(); };
rResume = function rResume() { _gOrigResume(); wsSendStatus(); };

// -- Connection status indicator --------------------------------------

function gSetStatus(state, text) {
  gEl.statusDot().className = `g-status-dot g-status-dot--${state}`;
  gEl.statusText().textContent = text;
}

// -- Connect to server ------------------------------------------------

function gConnect() {
  const url  = gEl.url().value.trim();
  const name = gEl.name().value.trim() || '匿名';
  if (!url) { gSetStatus('err', '请填写地址'); return; }

  if (wsClient) { wsClient.close(); wsClient = null; }
  gSetStatus('connecting', '连接中…');
  gEl.connectBtn().disabled = true;

  let ws;
  try { ws = new WebSocket(url); }
  catch {
    gSetStatus('err', '地址格式错误');
    gEl.connectBtn().disabled = false;
    return;
  }
  wsClient = ws;

  ws.addEventListener('open', () => {
    wsConnected = true;
    gSetStatus('on', '已连接');
    gEl.connectBtn().textContent = '断开';
    gEl.connectBtn().classList.add('g-connect-btn--disconnect');
    gEl.connectBtn().disabled = false;
    ws.send(JSON.stringify({ type: 'join', name }));
    wsSendStatus();
    wsSendTodos();
    saveGroupSettings();
  });

  ws.addEventListener('message', (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'welcome')              { wsMyId = msg.id; }
      else if (msg.type === 'users')           { groupUsers = msg.list; renderGroupUsers(); }
      else if (msg.type === 'userTodos')       { showUserTodosOverlay(msg.userId, msg.name, msg.todos); }
      else if (msg.type === 'userTodosUpdated') {
        if (viewingUserId === msg.userId) showUserTodosOverlay(msg.userId, msg.name, msg.todos);
      }
      else if (msg.type === 'transferred') {
        const timeNow  = Date.now();
        const newHistory = [
          ...(msg.todo.transferHistory || []),
          { direction: 'in', name: msg.fromName, time: timeNow },
        ];

        // ── Match by stable uuid (cross-user, cross-session) ─────────────
        const existing = msg.todo.uuid ? findByUuid(msg.todo.uuid) : null;

        if (existing) {
          // UPDATE in-place — keep local id, uuid, children, createdAt
          existing.text            = msg.todo.text;
          existing.status          = msg.todo.status;
          existing.priority        = msg.todo.priority;
          existing.dueDate         = msg.todo.dueDate ?? null;
          existing.steps           = (msg.todo.steps || []).map(s => ({ id: s.id, text: s.text || '', createdAt: s.createdAt || '' }));
          existing.stack           = (msg.todo.stack || []).map(s => ({ id: s.id, text: s.text || '', createdAt: s.createdAt || '' }));
          existing.transferredTo   = null;
          existing.transferredFrom = msg.fromName;
          existing.transferHistory = newHistory;
          saveTodos();
          render();
          showToast(`🔄 已更新来自 ${msg.fromName} 的流转：${msg.todo.text}`);
        } else {
          // CREATE — uuid not seen before; use ancestor path to place correctly
          const targetList = ensureAncestorPath(msg.ancestors || [], todos);
          const received   = migrate(reIdSubtree({
            ...msg.todo,
            transferredTo:   null,
            transferredFrom: msg.fromName,
            transferHistory: newHistory,
          }));
          targetList.push(received);
          saveTodos();
          render();
          showToast(`📨 收到来自 ${msg.fromName} 的流转：${msg.todo.text}`);
        }
      }
      else if (msg.type === 'transferFailed') {
        showToast(`流转失败：${msg.reason || '对方不在线'}`, true);
      }
    } catch { /* ignore bad JSON */ }
  });

  ws.addEventListener('close', () => {
    wsConnected = false;
    wsMyId      = null;
    groupUsers  = [];
    wsClient    = null;
    gSetStatus('off', '已断开');
    gEl.connectBtn().textContent = '连接';
    gEl.connectBtn().classList.remove('g-connect-btn--disconnect');
    gEl.connectBtn().disabled = false;
    renderGroupUsers();
  });

  ws.addEventListener('error', () => {
    gSetStatus('err', '连接失败');
    gEl.connectBtn().disabled = false;
  });
}

function gDisconnect() {
  if (wsClient) { wsClient.close(); }
}

// -- Render user list -------------------------------------------------

function gEsc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderGroupUsers() {
  const ul = gEl.userList();
  gEl.userCount().textContent = groupUsers.length;

  if (groupUsers.length === 0) {
    ul.innerHTML = '<li class="g-empty">暂无成员</li>';
    return;
  }

  ul.innerHTML = '';
  groupUsers.forEach(u => {
    const isMe = u.id === wsMyId;

    const stateKey   = !u.running ? 'idle'   : u.paused ? 'paused' : u.phase === 'break' ? 'break' : 'work';
    const stateLabel = !u.running ? '未开始' : u.paused ? '已暂停' : u.phase === 'break' ? '休息中' : '工作中';
    const timeLabel  = (u.running && !u.paused) ? rFmt(u.remaining) : '——';

    const li = document.createElement('li');
    li.className = `g-user-item${isMe ? ' g-user-item--me' : ''}`;
    li.innerHTML = `
      <span class="g-user-dot g-user-dot--${stateKey}"></span>
      <span class="g-user-name">${gEsc(u.name)}${isMe ? '<span class="g-me-tag">我</span>' : ''}</span>
      <span class="g-user-state g-user-state--${stateKey}">${stateLabel}</span>
      <span class="g-user-time">${timeLabel}</span>
      ${!isMe ? `<button class="g-view-btn" title="查看 Todo 列表">👁</button>` : '<span class="g-view-btn-ph"></span>'}`;

    if (!isMe) {
      li.querySelector('.g-view-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (wsClient && wsClient.readyState === WebSocket.OPEN) {
          wsClient.send(JSON.stringify({ type: 'requestTodos', targetId: u.id }));
        }
      });
    }
    ul.appendChild(li);
  });
}

// -- Read-only Todo overlay -------------------------------------------

const STATUS_SYM_RO = { pending: '○', 'in-progress': '◑', completed: '●' };
const PRIORITY_CN_RO = { high: '重要', normal: '普通', low: '低优' };

function renderTodoTreeRO(list, depth) {
  if (!list || list.length === 0) return '';
  return list.map(t => {
    const pct  = calcProgress(t);
    const sym  = STATUS_SYM_RO[t.status] || '○';
    const pri  = PRIORITY_CN_RO[t.priority] || '';
    const indent = depth * 20;
    const children = renderTodoTreeRO(t.children, depth + 1);
    const steps = (t.steps || []).map(s =>
      `<div class="ro-step" style="padding-left:${indent + 32}px">· ${gEsc(s.text)}</div>`
    ).join('');
    const stackTop = (t.stack && t.stack.length) ? t.stack[t.stack.length - 1] : null;
    const stackLine = stackTop
      ? `<div class="ro-step ro-stack-top" style="padding-left:${indent + 32}px">⌖ 当前：${gEsc(stackTop.text)}${t.stack.length > 1 ? `　(栈 ${t.stack.length} 项)` : ''}</div>`
      : '';

    // Transfer status badge (mirrors main list)
    let transferBadge = '';
    let extraClass = '';
    if (t.transferredTo) {
      transferBadge = `<span class="transfer-status-badge transfer-status-badge--out">✈ 已流转给 ${gEsc(t.transferredTo.name)}</span>`;
      extraClass = ' ro-item--transferred';
    } else if (t.transferredFrom) {
      transferBadge = `<span class="transfer-status-badge transfer-status-badge--in">← 来自 ${gEsc(t.transferredFrom)}</span>`;
      extraClass = ' ro-item--received';
    }

    return `
      <div class="ro-item ro-depth-${Math.min(depth, 3)}${extraClass}" style="padding-left:${indent + 8}px">
        <span class="ro-sym ro-sym--${t.status}">${sym}</span>
        <span class="ro-title${t.status === 'completed' ? ' ro-done' : ''}">${gEsc(t.text)}</span>
        ${transferBadge}
        <span class="ro-meta">${pri}</span>
        <span class="ro-pct">${Math.round(pct)}%</span>
      </div>
      ${stackLine}${steps}${children}`;
  }).join('');
}

function showUserTodosOverlay(userId, name, todoList) {
  viewingUserId = userId;
  const overlay = document.getElementById('user-todos-overlay');
  document.getElementById('user-todos-name').textContent = name + ' 的 Todo 列表';
  const content = document.getElementById('user-todos-content');
  // Remember scroll position when live-refreshing
  const prevScroll = content.scrollTop;

  if (!todoList || todoList.length === 0) {
    content.innerHTML = '<div class="ro-empty">暂无任务</div>';
  } else {
    const migrated = todoList.map(migrate);
    content.innerHTML = renderTodoTreeRO(migrated, 0);
  }
  overlay.classList.remove('hidden');
  content.scrollTop = prevScroll;   // restore scroll after refresh
}

function hideUserTodosOverlay() {
  viewingUserId = null;
  document.getElementById('user-todos-overlay').classList.add('hidden');
}

// ══ Toolbox switch panel (切换板小工具) ═══════════════════════════════════
// Registry of available tools. Add new tools here — each `id` maps to
// src/tools/<id>.html, opened in its own window via the main process.
const TOOLS = [
  { id: 'test-tool', name: '测试工具', icon: '🧪', title: '测试工具', width: 420, height: 400 },
  { id: 'objlist-merge', name: '对象列表合并', icon: '🧩', title: '对象列表合并 · SeqVar_ObjectList', width: 900, height: 680 },
  { id: 'teleport-chain', name: 'Teleport链生成', icon: '🌀', title: 'Teleport 链生成 · SeqAct_Teleport', width: 940, height: 700 },
  { id: 'spawn-checker', name: '刷怪Checker生成', icon: '👾', title: '刷怪 Checker + Volume 生成 · 完整波次配置', width: 1200, height: 820 },
  { id: 'player-start-creator', name: '创建出生点', icon: '🚩', title: '创建出生点 · UTTeamPlayerStart 形状排列', width: 1120, height: 780 },
  { id: 'prop-list', name: '属性列表生成', icon: '📋', title: '属性列表生成 · 属性面板字符串', width: 900, height: 640 },
  { id: 'remote-event', name: '远程事件生成', icon: '📡', title: '远程事件生成 · SeqEvent_RemoteEvent', width: 940, height: 640 },
  { id: 'quiz', name: '题库测验', icon: '📝', title: '题库测验 · 检验掌握程度', width: 760, height: 760 },
  { id: 'music-arranger', name: '电子编曲', icon: '🎹', title: '电子音乐编曲器 · 五层编曲 (Tone.js + smplr)', width: 1180, height: 820 },
  { id: 'svn-demo', name: 'SVN 演示', icon: '🗂️', title: 'SVN 演示动画 · 六课看懂日常工作流', width: 1180, height: 830 },
  { id: 'guider-chain', name: '引导点链生成', icon: '🧭', title: '引导点链生成 · TGADBaseActorGuider 开链', width: 1120, height: 800 },
  { id: 'supply-point', name: '补给点生成', icon: '🛒', title: '补给点生成 · PVEVendingMachineVolume 商店/加血/加子弹', width: 1160, height: 840 },
  { id: 'udk-streaming', name: 'UDK Streaming生成', icon: '📦', title: 'UDK Streaming 生成 · SeqAct_MultiLevelStreaming', width: 1060, height: 720 },
];

let toolsVisible = false;

function renderToolsGrid() {
  const grid = document.getElementById('tools-grid');
  if (!grid || grid.childElementCount) return; // build once
  TOOLS.forEach(tool => {
    const item = document.createElement('button');
    item.className = 'tool-item';
    item.title = tool.name;
    item.innerHTML =
      `<span class="tool-icon">${tool.icon}</span>` +
      `<span class="tool-name">${tool.name}</span>`;
    item.addEventListener('click', () => {
      window.electronAPI.openTool(tool);
    });
    grid.appendChild(item);
  });
}

document.getElementById('tools-tab-btn').addEventListener('click', () => {
  toolsVisible = !toolsVisible;
  renderToolsGrid();
  document.getElementById('tools-panel').classList.toggle('hidden', !toolsVisible);
  document.getElementById('tools-tab-btn').classList.toggle('active', toolsVisible);
});

// -- Event bindings ---------------------------------------------------

document.getElementById('group-tab-btn').addEventListener('click', () => {
  groupVisible = !groupVisible;
  gEl.panel().classList.toggle('hidden', !groupVisible);
  document.getElementById('group-tab-btn').classList.toggle('active', groupVisible);
});

gEl.connectBtn().addEventListener('click', () => {
  if (wsConnected) gDisconnect(); else gConnect();
});

gEl.name().addEventListener('change', () => {
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    wsClient.send(JSON.stringify({ type: 'join', name: gEl.name().value.trim() || '匿名' }));
  }
  saveGroupSettings();
});

gEl.url().addEventListener('change', saveGroupSettings);

// -- Persist settings -------------------------------------------------

async function loadGroupSettings() {
  const saved = await window.electronAPI.store.get('groupSettings');
  if (saved) {
    if (saved.name) gEl.name().value = saved.name;
    if (saved.url)  gEl.url().value  = saved.url;
  }
}

function saveGroupSettings() {
  window.electronAPI.store.set('groupSettings', {
    name: gEl.name().value.trim(),
    url:  gEl.url().value.trim(),
  });
}

document.getElementById('user-todos-back').addEventListener('click', hideUserTodosOverlay);

loadGroupSettings();
