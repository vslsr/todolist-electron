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

// ── Migrate / create ───────────────────────────────────────────────────────

function migrate(t) {
  return {
    ...t,
    status:         t.status || (t.completed ? 'completed' : 'pending'),
    children:       (t.children || []).map(migrate),
    collapsed:      t.collapsed ?? false,
    steps:          (t.steps || []).map(s => ({ id: s.id, text: s.text || '', createdAt: s.createdAt || '' })),
    stepsCollapsed: t.stepsCollapsed ?? false,
  };
}

function createTodo(text = '', priority = 'normal') {
  return {
    id:             `${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    text:           text.trim(),
    status:         'pending',
    priority,
    createdAt:      new Date().toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
    children:       [],
    collapsed:      false,
    steps:          [],
    stepsCollapsed: false,
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

function updateTodoText(id, newText) {
  const t = findById(id);
  if (t && newText.trim()) { t.text = newText.trim(); saveTodos(); }
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

function clearCompleted() {
  function clean(list) {
    return list
      .filter(t => t.status !== 'completed')
      .map(t => ({ ...t, children: clean(t.children) }));
  }
  todos = clean(todos);
  saveTodos(); render();
}

function getFiltered() {
  let result =
    currentFilter === 'active'      ? todos.filter(t => t.status !== 'completed') :
    currentFilter === 'in-progress' ? todos.filter(t => t.status === 'in-progress') :
    currentFilter === 'completed'   ? todos.filter(t => t.status === 'completed')  : [...todos];

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

    if (t.steps && t.steps.length > 0) {
      t.steps.forEach((s, i) => {
        if (s.text) lines.push(`${pad}    步骤 ${i + 1}. ${s.text}`);
      });
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

  if (viewMode === 'text') {
    mainEl.classList.add('hidden');
    textEl.classList.remove('hidden');
    document.getElementById('export-textarea').value = generateExportText(todos);
    return;
  }

  mainEl.classList.remove('hidden');
  textEl.classList.add('hidden');

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
  li.className = `task-item priority-${todo.priority}${todo.status === 'completed' ? ' completed' : todo.status === 'in-progress' ? ' in-progress' : ''}`;
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
  checkbox.className = `task-checkbox${todo.status === 'completed' ? ' checked' : todo.status === 'in-progress' ? ' in-progress' : ''}`;
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

  // Ring progress
  const ring = createRingEl(calcProgress(todo));

  // Add step button
  const addStepBtn = document.createElement('button');
  addStepBtn.className = 'task-add-step';
  addStepBtn.innerHTML = '≡';
  addStepBtn.title     = '添加工作步骤';
  addStepBtn.addEventListener('click', (e) => { e.stopPropagation(); addStep(todo.id); });

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

  row.append(handle, toggle, badge, checkbox, textEl, meta, ring, addStepBtn, addChild, del);
  li.appendChild(row);

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
    stepsLbl.textContent = `工作步骤 (${todo.steps.length})`;
    stepsLbl.addEventListener('click', () => toggleStepsCollapsed(todo.id));

    const stepsAddBtn = document.createElement('button');
    stepsAddBtn.className = 'steps-add-btn';
    stepsAddBtn.innerHTML = '+';
    stepsAddBtn.title     = '添加步骤';
    stepsAddBtn.addEventListener('click', (e) => { e.stopPropagation(); addStep(todo.id); });

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
        stepText.contentEditable = 'true';
        stepText.spellcheck      = false;
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

        const stepMeta = document.createElement('span');
        stepMeta.className   = 'step-meta';
        stepMeta.textContent = step.createdAt;

        const stepDel = document.createElement('button');
        stepDel.className = 'step-del';
        stepDel.innerHTML = '×';
        stepDel.title     = '删除步骤';
        stepDel.addEventListener('click', (e) => { e.stopPropagation(); deleteStep(todo.id, step.id); });

        stepItem.append(stepNum, stepText, stepMeta, stepDel);
        stepsList.appendChild(stepItem);
      });

      stepsSection.appendChild(stepsList);
    }

    li.appendChild(stepsSection);
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

document.getElementById('new-task-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') addTodo();
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
  display: () => document.getElementById('r-display'),
  time:    () => document.getElementById('r-time'),
  phase:   () => document.getElementById('r-phase'),
  track:   () => document.getElementById('r-track'),
  fill:    () => document.getElementById('r-fill'),
};

let rSettings = { workMin: 25, breakMin: 5, loop: true };
let rState    = { running: false, phase: 'work', remaining: 0, total: 0, timer: null };

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

function rNotify(title, body) {
  if (!window.Notification) return;
  const send = () => new Notification(title, { body, silent: false });
  Notification.permission === 'granted'
    ? send()
    : Notification.requestPermission().then(p => p === 'granted' && send());
}

function rUpdateUI() {
  const { running, phase, remaining, total } = rState;
  const btn = rEl.toggle();

  if (running) {
    btn.textContent = '■ 停止';
    btn.classList.add('r-btn--running');
    rEl.display().classList.remove('hidden');
    rEl.track().classList.remove('hidden');

    rEl.time().textContent = rFmt(remaining);

    const isWork = phase === 'work';
    rEl.phase().textContent = isWork ? '工作中' : '休息中';
    rEl.phase().className   = `r-phase ${isWork ? 'r-phase--work' : 'r-phase--break'}`;
    rEl.fill().className    = `r-fill ${isWork ? 'r-fill--work' : 'r-fill--break'}`;
    rEl.fill().style.width  = `${((total - remaining) / total) * 100}%`;

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
      rNotify('休息一下 ☕', `专注结束，休息 ${rSettings.breakMin} 分钟`);
      if (rSettings.loop) {
        rState.phase     = 'break';
        rState.remaining = rState.total = rSettings.breakMin * 60;
      } else { rStop(); return; }
    } else {
      rNotify('继续工作 💪', `休息结束，开始专注 ${rSettings.workMin} 分钟`);
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

function rStop() {
  clearInterval(rState.timer);
  rState.running = false;
  rUpdateUI();
}

rEl.toggle().addEventListener('click', () => rState.running ? rStop() : rStart());

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
}

function saveReminderPresets() {
  window.electronAPI.store.set('reminderPresets', rPresets);
}

// If a preset is selected and the user edits inputs → update that preset in-place
function rSyncSelectedPreset() {
  const sel = document.getElementById('r-preset-sel');
  const idx = parseInt(sel.value);
  if (isNaN(idx) || !rPresets[idx]) return;
  rPresets[idx].workMin  = Math.max(1, parseInt(rEl.work().value) || 25);
  rPresets[idx].breakMin = Math.max(1, parseInt(rEl.brk().value)  || 5);
  rPresets[idx].loop     = rEl.mode().value === 'loop';
  saveReminderPresets();
  rRenderPresets(idx); // refresh label to show updated values
}

rEl.work().addEventListener('change', rSyncSelectedPreset);
rEl.brk().addEventListener('change',  rSyncSelectedPreset);
rEl.mode().addEventListener('change', rSyncSelectedPreset);

// Apply preset to inputs
document.getElementById('r-preset-sel').addEventListener('change', e => {
  const idx = parseInt(e.target.value);
  if (isNaN(idx) || !rPresets[idx]) return;
  const p = rPresets[idx];
  rEl.work().value = p.workMin;
  rEl.brk().value  = p.breakMin;
  rEl.mode().value = p.loop ? 'loop' : 'once';
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
  saveReminderPresets();
  rRenderPresets();
});

loadReminderSettings();
loadReminderPresets();
loadTodos();
