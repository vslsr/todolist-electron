'use strict';

// Wrapped in an IIFE so none of this module's top-level identifiers leak into the
// global scope shared with renderer.js (avoids collisions like `dragId`, `isDescendant`).
(function () {

// ══════════════════════════════════════════════════════════════════════════════
//  Drawing board — self-contained module
//  Shapes: triangle · circle · square · node (relay) · empty (group / node container)
//
//  Unity-style scene graph:
//    • every object has a unique id and a parentId (null = root)
//    • children store LOCAL transforms (cx/cy/rotation relative to their parent)
//    • parent transforms compose down the tree (move/rotate a parent → children follow)
//    • empty nodes are pure containers (a dashed box, no body, no ports)
//    • Hierarchy panel (right): nested tree, click-to-select, drag-to-reparent, split
//    • context menu: 组合为节点 / 取消组合 + layer/reset/delete/activate
// ══════════════════════════════════════════════════════════════════════════════

const DRAW_KEY = 'drawBoard';
const NS       = 'http://www.w3.org/2000/svg';
const MIN_SZ   = 20;
const ROT_OFF  = 32;
const EMPTY_PAD  = 12;   // padding of the "节点组" selection box around a subtree
const EMPTY_MARK = 13;   // half-size of an empty node's small marker box

let drawShapes  = [];    // [{ id, type, parentId, cx, cy, w, h, rotation, fill }]  (cx/cy/rotation are LOCAL)
let drawArrows  = [];    // [{ id, fromId, fromPort, toId, toPort, active }]
let drawSels    = [];    // multi-select: array of selected shape IDs
let drawSel     = null;  // primary selected shape (shows handles); always ∈ drawSels when set
let drawAct     = null;  // active shape interaction (move/resize/rotate)
let tempArrow   = null;  // { fromId, fromPort, toX, toY, snapToId, snapToPort }
let marquee     = null;  // { x0, y0, x1, y1 } – box-select drag state
let ctxTarget   = null;  // shape ID that was right-clicked
let propsExpanded = {};  // { shapeId: bool } – expansion state of hierarchy tree nodes
let drawVisible = false;
let dsAnimId    = null;  // requestAnimationFrame handle for dot animation
let dragId      = null;  // hierarchy-tree drag source id
let dropMark    = null;  // { id, zone:'before'|'after'|'inside' } – current tree drop target
let drawClipboard = null; // internal clipboard for copied shapes, subtrees, and arrows

const DS_FILL = {
  triangle: '#667eea', circle: '#52a878', square: '#e8a020', node: '#667eea', empty: 'none',
};
const DS_ICON = {
  triangle: '△', circle: '○', square: '□', node: '⊙', empty: '⊡',
};
const DS_NAME = {
  triangle: '三角形', circle: '圆形', square: '正方形', node: '节点', empty: '空节点',
};

const PORT_DIRS = {
  top:    { x:  0, y: -1 },
  right:  { x:  1, y:  0 },
  bottom: { x:  0, y:  1 },
  left:   { x: -1, y:  0 },
};
const PORT_LOCAL = {
  top:    s => ({ x:  0,       y: -s.h / 2 }),
  right:  s => ({ x:  s.w / 2, y:  0        }),
  bottom: s => ({ x:  0,       y:  s.h / 2  }),
  left:   s => ({ x: -s.w / 2, y:  0        }),
};
const PORT_NAMES = Object.keys(PORT_DIRS);

// ── Tiny helpers ────────────────────────────────────────────────────────────────

const find  = id => drawShapes.find(s => s.id === id);
const newId = pfx => `${pfx}_${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
const SHAPE_HAS_TEXT = type => type === 'triangle' || type === 'square' || type === 'circle';
const escAttr = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function clearSel() { drawSels = []; drawSel = null; }

function selSyncPrimary() {
  if (!drawSels.length)            { drawSel = null; return; }
  if (!drawSels.includes(drawSel)) drawSel = drawSels[drawSels.length - 1];
}

// ── Hierarchy helpers ─────────────────────────────────────────────────────────

function getChildren(parentId) {
  return drawShapes.filter(s => s.parentId === parentId);   // array order = local z-order
}

function getDescendants(id) {
  return getChildren(id).flatMap(c => [c, ...getDescendants(c.id)]);
}

function getRootParent(id) {
  let s = find(id);
  while (s && s.parentId) {
    const p = find(s.parentId);
    if (!p) break;
    s = p;
  }
  return s || null;
}

// Is `nodeId` somewhere underneath `ancestorId` (or === it)?
function isDescendant(ancestorId, nodeId) {
  let n = find(nodeId);
  while (n) {
    if (n.id === ancestorId) return true;
    n = n.parentId ? find(n.parentId) : null;
  }
  return false;
}

// ── World-transform composition (the heart of the scene graph) ─────────────────
//  Each node's transform is translate(cx,cy)·rotate(rotation) in its parent's frame.
//  World = compose root→leaf.

function getWorldMatrix(s) {
  const chain = [];
  let n = s;
  while (n) { chain.unshift(n); n = n.parentId ? find(n.parentId) : null; }
  let m = new DOMMatrix();
  chain.forEach(o => { m = m.translate(o.cx, o.cy).rotate(o.rotation); });
  return m;
}

function getWorldRotation(s) {
  let r = 0, n = s;
  while (n) { r += n.rotation; n = n.parentId ? find(n.parentId) : null; }
  return r;
}

// local point (in s's own frame) → world coords
function worldPoint(s, lx, ly) {
  const p = getWorldMatrix(s).transformPoint({ x: lx, y: ly });
  return { x: p.x, y: p.y };
}

// world coords → s's local frame
function toLocal(gx, gy, s) {
  const p = getWorldMatrix(s).inverse().transformPoint({ x: gx, y: gy });
  return { x: p.x, y: p.y };
}

function getWorldCenter(s) { return worldPoint(s, 0, 0); }

// ── Group operations ───────────────────────────────────────────────────────────

// Group the selected nodes under a brand-new empty node (root).
function groupSelected() {
  const selSet = new Set(drawSels);
  // effective targets = selected nodes that don't have a selected ancestor
  const targets = drawSels.filter(id => {
    const s = find(id);
    if (!s) return false;
    let p = s.parentId ? find(s.parentId) : null;
    while (p) { if (selSet.has(p.id)) return false; p = p.parentId ? find(p.parentId) : null; }
    return true;
  });
  if (!targets.length) return;

  // World centroid → empty node origin (pivot)
  let sx = 0, sy = 0;
  targets.forEach(id => { const w = getWorldCenter(find(id)); sx += w.x; sy += w.y; });
  const cx = sx / targets.length, cy = sy / targets.length;

  const empty = {
    id: newId('ds'), type: 'empty', parentId: null,
    cx, cy, w: 0, h: 0, rotation: 0, fill: 'none',
  };

  // Insert the empty node just before the first target so it sits behind its children
  const idxs = targets.map(id => drawShapes.findIndex(s => s.id === id)).filter(i => i >= 0);
  const insertIdx = idxs.length ? Math.min(...idxs) : drawShapes.length;
  drawShapes.splice(insertIdx, 0, empty);

  // Reparent each target, converting world transform → local (empty rotation is 0)
  targets.forEach(id => {
    const c  = find(id);
    const w  = getWorldCenter(c);
    const wr = getWorldRotation(c);
    c.parentId = empty.id;
    c.cx = w.x - cx;
    c.cy = w.y - cy;
    c.rotation = wr;
  });

  drawSels = [empty.id]; drawSel = empty.id;
  dsRender(); dsSave();
}

// Dissolve a node: its children rejoin the node's own parent level.
function ungroupShape(groupId) {
  const E = find(groupId);
  if (!E) return;
  const kids = getChildren(groupId);
  if (!kids.length) return;
  const newParent = E.parentId || null;
  const pInv      = newParent ? getWorldMatrix(find(newParent)).inverse() : null;
  const pRot      = newParent ? getWorldRotation(find(newParent)) : 0;

  kids.forEach(c => {
    const w  = getWorldCenter(c);
    const wr = getWorldRotation(c);
    c.parentId = newParent;
    if (!newParent) {
      c.cx = w.x; c.cy = w.y; c.rotation = wr;
    } else {
      const p = pInv.transformPoint({ x: w.x, y: w.y });
      c.cx = p.x; c.cy = p.y; c.rotation = wr - pRot;
    }
  });

  // An empty node only exists to group → remove it; a real shape stays as a leaf.
  if (E.type === 'empty') {
    drawShapes = drawShapes.filter(s => s.id !== groupId);
    drawSels   = kids.map(c => c.id);
  } else {
    drawSels   = [E.id, ...kids.map(c => c.id)];
  }
  selSyncPrimary();
  dsRender(); dsSave();
}

// Move `childId` under `newParentId` (null = root), preserving its on-screen position.
function dsReparent(childId, newParentId) {
  const c = find(childId);
  if (!c) return;
  if (newParentId && isDescendant(childId, newParentId)) return;   // would create a cycle
  if (c.parentId === (newParentId || null)) return;                // no-op

  const w  = getWorldCenter(c);
  const wr = getWorldRotation(c);
  c.parentId = newParentId || null;
  if (!newParentId) {
    c.cx = w.x; c.cy = w.y; c.rotation = wr;
  } else {
    const P   = find(newParentId);
    const p   = getWorldMatrix(P).inverse().transformPoint({ x: w.x, y: w.y });
    c.cx = p.x; c.cy = p.y; c.rotation = wr - getWorldRotation(P);
  }
  drawSels = [c.id]; drawSel = c.id;
  dsRender(); dsSave();
}

// Drop from the hierarchy tree, honouring the insert zone:
//   'before' / 'after' → sibling of target (target's parent), positioned around it
//   'inside'           → last child of target
function dsDropNode(childId, targetId, zone) {
  const c = find(childId), t = find(targetId);
  if (!c || !t || childId === targetId) return;

  const newParentId = (zone === 'inside') ? targetId : (t.parentId || null);
  if (newParentId && isDescendant(childId, newParentId)) return;   // would create a cycle

  // 1) Reparent with world-position preservation
  const w  = getWorldCenter(c);
  const wr = getWorldRotation(c);
  c.parentId = newParentId || null;
  if (!newParentId) {
    c.cx = w.x; c.cy = w.y; c.rotation = wr;
  } else {
    const P = find(newParentId);
    const p = getWorldMatrix(P).inverse().transformPoint({ x: w.x, y: w.y });
    c.cx = p.x; c.cy = p.y; c.rotation = wr - getWorldRotation(P);
  }

  // 2) Reposition within drawShapes (array order = sibling z-order)
  const ci = drawShapes.findIndex(s => s.id === childId);
  const [node] = drawShapes.splice(ci, 1);

  let insertAt;
  if (zone === 'inside') {
    // Become the LAST child of target (rendered on top)
    const kidIdx = drawShapes
      .map((s, i) => (s.parentId === targetId ? i : -1))
      .filter(i => i >= 0);
    insertAt = kidIdx.length ? Math.max(...kidIdx) + 1 : drawShapes.findIndex(s => s.id === targetId) + 1;
  } else {
    const ti = drawShapes.findIndex(s => s.id === targetId);
    insertAt = zone === 'before' ? ti : ti + 1;
  }
  drawShapes.splice(insertAt, 0, node);

  drawSels = [node.id]; drawSel = node.id;
  dsRender(); dsSave();
}

// ── Data ──────────────────────────────────────────────────────────────────────

function dsNew(type, cx, cy) {
  const sz = type === 'node' ? 28 : type === 'empty' ? 0 : 80;
  const s = {
    id: newId('ds'),
    type, parentId: null,
    cx, cy, w: sz, h: sz, rotation: 0,
    fill: (DS_FILL[type] !== undefined ? DS_FILL[type] : '#667eea'),
  };
  if (SHAPE_HAS_TEXT(type)) Object.assign(s, { text: '', textColor: '#ffffff', textSize: 14, textAlign: 'center' });
  return s;
}

function copyDrawSelection() {
  const selectedSet = new Set(drawSels);
  const rootIds = drawSels.filter(id => {
    const shape = find(id);
    if (!shape) return false;
    let parent = shape.parentId ? find(shape.parentId) : null;
    while (parent) {
      if (selectedSet.has(parent.id)) return false;
      parent = parent.parentId ? find(parent.parentId) : null;
    }
    return true;
  });
  if (!rootIds.length) return false;

  const copiedIds = new Set();
  rootIds.forEach(id => {
    copiedIds.add(id);
    getDescendants(id).forEach(shape => copiedIds.add(shape.id));
  });

  const rootWorld = {};
  rootIds.forEach(id => {
    const shape = find(id);
    const center = getWorldCenter(shape);
    rootWorld[id] = { cx: center.x, cy: center.y, rotation: getWorldRotation(shape) };
  });

  drawClipboard = {
    shapes: drawShapes.filter(shape => copiedIds.has(shape.id)).map(shape => ({ ...shape })),
    arrows: drawArrows
      .filter(arrow => copiedIds.has(arrow.fromId) && copiedIds.has(arrow.toId))
      .map(arrow => ({ ...arrow })),
    rootIds,
    rootWorld,
    pasteCount: 0,
  };
  return true;
}

function pasteDrawClipboard() {
  if (!drawClipboard?.shapes.length) return false;

  drawClipboard.pasteCount += 1;
  const offset = drawClipboard.pasteCount * 24;
  const reservedIds = new Set([
    ...drawShapes.map(shape => shape.id),
    ...drawArrows.map(arrow => arrow.id),
  ]);
  const freshId = prefix => {
    let id;
    do { id = newId(prefix); } while (reservedIds.has(id));
    reservedIds.add(id);
    return id;
  };

  const idMap = new Map();
  drawClipboard.shapes.forEach(shape => idMap.set(shape.id, freshId('ds')));

  const pastedShapes = drawClipboard.shapes.map(source => {
    const shape = { ...source, id: idMap.get(source.id) };
    if (source.parentId && idMap.has(source.parentId)) {
      shape.parentId = idMap.get(source.parentId);
    } else {
      const world = drawClipboard.rootWorld[source.id] || {
        cx: source.cx,
        cy: source.cy,
        rotation: source.rotation,
      };
      shape.parentId = null;
      shape.cx = world.cx + offset;
      shape.cy = world.cy + offset;
      shape.rotation = world.rotation;
    }
    return shape;
  });

  const pastedArrows = drawClipboard.arrows.map(source => ({
    ...source,
    id: freshId('arr'),
    fromId: idMap.get(source.fromId),
    toId: idMap.get(source.toId),
  }));

  drawShapes.push(...pastedShapes);
  drawArrows.push(...pastedArrows);
  drawSels = drawClipboard.rootIds.map(id => idMap.get(id)).filter(Boolean);
  selSyncPrimary();
  dsRender();
  dsSave();
  return true;
}

function dsSave() {
  window.electronAPI.store.set(DRAW_KEY, { shapes: drawShapes, arrows: drawArrows });
}

async function dsLoad() {
  const raw = await window.electronAPI.store.get(DRAW_KEY);
  if (Array.isArray(raw)) {
    drawShapes = raw; drawArrows = [];
  } else if (raw && typeof raw === 'object') {
    drawShapes = Array.isArray(raw.shapes) ? raw.shapes : [];
    drawArrows = Array.isArray(raw.arrows) ? raw.arrows : [];
  } else {
    const legacy = await window.electronAPI.store.get('drawShapes');
    drawShapes = Array.isArray(legacy) ? legacy : [];
    drawArrows = [];
  }
  drawShapes.forEach(s => { if (s.parentId === undefined) s.parentId = null; });
  dsRender();
}

// ── Coordinate helpers ────────────────────────────────────────────────────────

function getSVGPt(e) {
  const svg = document.getElementById('draw-canvas');
  const pt  = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function getPortGlobalPos(s, port) {
  if (port === 'center') return getWorldCenter(s);
  const lp = PORT_LOCAL[port](s);
  return worldPoint(s, lp.x, lp.y);
}

// Full bounding box of a node's whole subtree (itself + all descendants), expressed
// in the node's OWN local frame. Drives the "节点组" selection box.
function getSubtreeLocalBBox(s) {
  let minX, maxX, minY, maxY;
  if (s.type === 'empty') { minX = -EMPTY_MARK; maxX = EMPTY_MARK; minY = -EMPTY_MARK; maxY = EMPTY_MARK; }
  else                    { minX = -s.w / 2;    maxX = s.w / 2;    minY = -s.h / 2;    maxY = s.h / 2; }
  getChildren(s.id).forEach(c => {
    const cbb = getSubtreeLocalBBox(c);
    const rad = c.rotation * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    [[cbb.minX, cbb.minY], [cbb.maxX, cbb.minY], [cbb.maxX, cbb.maxY], [cbb.minX, cbb.maxY]]
      .forEach(([x, y]) => {
        const wx = c.cx + x * cos - y * sin;
        const wy = c.cy + x * sin + y * cos;
        minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
        minY = Math.min(minY, wy); maxY = Math.max(maxY, wy);
      });
  });
  return { minX, maxX, minY, maxY };
}

function boxFromBB(bb, pad) {
  return { x: bb.minX - pad, y: bb.minY - pad, w: (bb.maxX - bb.minX) + 2 * pad, h: (bb.maxY - bb.minY) + 2 * pad };
}

// Hit-test for arrow targeting (empties excluded by callers).
function findShapeAtPoint(gx, gy) {
  const selSet = new Set(drawSels);
  const ordered = [
    ...drawShapes.filter(s =>  selSet.has(s.id) && s.type !== 'empty'),
    ...drawShapes.filter(s => !selSet.has(s.id) && s.type !== 'empty'),
  ];
  for (const s of ordered) {
    const lo = toLocal(gx, gy, s);
    const hw = s.w / 2, hh = s.h / 2;
    if (s.type === 'node') {
      if (Math.hypot(lo.x, lo.y) <= hw + 4) return s;
    } else if (s.type === 'circle') {
      if ((lo.x / hw) ** 2 + (lo.y / hh) ** 2 <= 1.1) return s;
    } else {
      if (Math.abs(lo.x) <= hw + 4 && Math.abs(lo.y) <= hh + 4) return s;
    }
  }
  return null;
}

function getNearestPort(s, gx, gy) {
  if (s.type === 'node') return 'center';
  let nearest = 'top', minDist = Infinity;
  PORT_NAMES.forEach(port => {
    const pos = getPortGlobalPos(s, port);
    const d   = Math.hypot(pos.x - gx, pos.y - gy);
    if (d < minDist) { minDist = d; nearest = port; }
  });
  return nearest;
}

// ── SVG element factory ───────────────────────────────────────────────────────

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// ── Shape body ────────────────────────────────────────────────────────────────

function dsBody(s) {
  const hw = s.w / 2, hh = s.h / 2;
  const base = { fill: s.fill, stroke: 'rgba(0,0,0,0.12)', 'stroke-width': 1.5 };
  switch (s.type) {
    case 'square':  return svgEl('rect',    { ...base, x: -hw, y: -hh, width: s.w, height: s.h, rx: 4 });
    case 'circle':  return svgEl('ellipse', { ...base, cx: 0, cy: 0, rx: hw, ry: hh });
    case 'node': {
      const r = Math.min(hw, hh);
      const g = svgEl('g');
      g.appendChild(svgEl('circle', {
        cx: 0, cy: 0, r,
        fill: 'rgba(255,255,255,0.92)', stroke: s.fill, 'stroke-width': 2.5,
      }));
      return g;
    }
    default:        return svgEl('polygon', { ...base, points: `0,${-hh} ${hw},${hh} ${-hw},${hh}` });
  }
}

// Optional text label centred (vertically) inside a shape, left/centre/right aligned.
function dsText(s) {
  if (!SHAPE_HAS_TEXT(s.type) || !s.text) return null;
  const align = s.textAlign || 'center';
  const pad   = 6;
  let x, anchor;
  if      (align === 'left')  { x = -s.w / 2 + pad; anchor = 'start';  }
  else if (align === 'right') { x =  s.w / 2 - pad; anchor = 'end';    }
  else                        { x = 0;              anchor = 'middle'; }
  // Triangle's visual mass sits below the bbox centre — nudge text down a touch.
  const y = s.type === 'triangle' ? s.h * 0.16 : 0;
  const t = svgEl('text', {
    x, y, 'text-anchor': anchor, 'dominant-baseline': 'central',
    fill: s.textColor || '#ffffff',
    'font-size': s.textSize || 14, 'font-family': 'system-ui, -apple-system, sans-serif',
    'font-weight': 600, 'pointer-events': 'none',
  });
  t.textContent = s.text;
  return t;
}

// ── Handles ───────────────────────────────────────────────────────────────────

const HANDLE_DEFS = [
  ['nw', s => -s.w/2, s => -s.h/2, 'nw-resize', -1, -1],
  ['n',  s =>      0, s => -s.h/2, 'n-resize',   0, -1],
  ['ne', s =>  s.w/2, s => -s.h/2, 'ne-resize',  1, -1],
  ['e',  s =>  s.w/2, s =>      0, 'e-resize',   1,  0],
  ['se', s =>  s.w/2, s =>  s.h/2, 'se-resize',  1,  1],
  ['s',  s =>      0, s =>  s.h/2, 's-resize',   0,  1],
  ['sw', s => -s.w/2, s =>  s.h/2, 'sw-resize', -1,  1],
  ['w',  s => -s.w/2, s =>      0, 'w-resize',  -1,  0],
];

function dsHandles(s) {
  const g = svgEl('g', { class: 'ds-handles' });
  const hw = s.w / 2, hh = s.h / 2;
  g.appendChild(svgEl('rect', {
    x: -hw - 2, y: -hh - 2, width: s.w + 4, height: s.h + 4, rx: 3,
    fill: 'none', stroke: '#667eea', 'stroke-width': 1.5, 'stroke-dasharray': '5 3',
  }));
  g.appendChild(svgEl('line', {
    x1: 0, y1: -hh - 2, x2: 0, y2: -hh - ROT_OFF,
    stroke: '#667eea', 'stroke-width': 1.5,
  }));
  const rh = svgEl('circle', {
    cx: 0, cy: -hh - ROT_OFF, r: 6, fill: '#fff', stroke: '#667eea', 'stroke-width': 1.5,
  });
  rh.style.cursor = 'crosshair';
  rh.addEventListener('mousedown', e => { e.stopPropagation(); dsStartRotate(e, s.id); });
  g.appendChild(rh);
  HANDLE_DEFS.forEach(([, xFn, yFn, cur, sx, sy]) => {
    const h = svgEl('rect', {
      x: xFn(s) - 5, y: yFn(s) - 5, width: 10, height: 10, rx: 2,
      fill: '#fff', stroke: '#667eea', 'stroke-width': 1.5,
    });
    h.style.cursor = cur;
    h.addEventListener('mousedown', e => { e.stopPropagation(); dsStartResize(e, s.id, sx, sy); });
    g.appendChild(h);
  });
  return g;
}

// Dashed "节点组" box around a node's whole subtree — a selection-time indicator only.
function dsGroupBox(s, primary) {
  const b = boxFromBB(getSubtreeLocalBBox(s), EMPTY_PAD);
  const g = svgEl('g');
  g.style.pointerEvents = 'none';
  g.appendChild(svgEl('rect', {
    x: b.x, y: b.y, width: b.w, height: b.h, rx: 6,
    fill: primary ? 'rgba(102,126,234,0.05)' : 'rgba(120,130,170,0.03)',
    stroke: primary ? '#667eea' : '#9aa3c2',
    'stroke-width': primary ? 1.8 : 1.4, 'stroke-dasharray': '9 4',
  }));
  const TAG_W = 44, TAG_H = 15;
  g.appendChild(svgEl('rect', {
    x: b.x + 4, y: b.y - TAG_H, width: TAG_W, height: TAG_H, rx: 3,
    fill: primary ? '#667eea' : '#9aa3c2', opacity: '0.9',
  }));
  const t = svgEl('text', {
    x: b.x + 4 + TAG_W / 2, y: b.y - 3, 'text-anchor': 'middle', fill: '#fff',
    'font-size': '9', 'font-family': 'system-ui, sans-serif',
  });
  t.textContent = '节点组';
  g.appendChild(t);
  return g;
}

// Rotate handle + corner dots around a given local bbox (empty-node selection).
function dsGroupRotate(s, bb) {
  const b = boxFromBB(bb, EMPTY_PAD);
  const g = svgEl('g', { class: 'ds-handles' });
  [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].forEach(([cx, cy]) => {
    g.appendChild(svgEl('circle', { cx, cy, r: 4, fill: '#fff', stroke: '#667eea', 'stroke-width': 1.5, 'pointer-events': 'none' }));
  });
  const midX = b.x + b.w / 2;
  g.appendChild(svgEl('line', { x1: midX, y1: b.y, x2: midX, y2: b.y - ROT_OFF, stroke: '#667eea', 'stroke-width': 1.5 }));
  const rh = svgEl('circle', { cx: midX, cy: b.y - ROT_OFF, r: 6, fill: '#fff', stroke: '#667eea', 'stroke-width': 1.5 });
  rh.style.cursor = 'crosshair';
  rh.addEventListener('mousedown', e => { e.stopPropagation(); dsStartRotate(e, s.id); });
  g.appendChild(rh);
  return g;
}

function dsSelHighlight(s) {
  const hw = s.w / 2, hh = s.h / 2;
  return svgEl('rect', {
    x: -hw - 3, y: -hh - 3, width: s.w + 6, height: s.h + 6, rx: 4,
    fill: 'none', stroke: '#667eea', 'stroke-width': 1.5, 'stroke-dasharray': '5 3', opacity: 0.55,
  });
}

// ── Connection ports ──────────────────────────────────────────────────────────

function dsPorts(s) {
  if (s.type === 'node') {
    const r = Math.min(s.w, s.h) / 2;
    const g = svgEl('g', { class: 'ds-ports ds-ports--node' });
    g.appendChild(svgEl('circle', {
      cx: 0, cy: 0, r: Math.max(3, r * 0.28), fill: s.fill, 'pointer-events': 'none',
    }));
    const hit = svgEl('circle', { cx: 0, cy: 0, r: Math.max(7, r * 0.55), fill: 'transparent', class: 'ds-port' });
    hit.style.cursor = 'crosshair';
    hit.addEventListener('mousedown', e => { e.stopPropagation(); dsStartArrow(e, s.id, 'center'); });
    g.appendChild(hit);
    return g;
  }

  const g = svgEl('g', { class: 'ds-ports' });
  PORT_NAMES.forEach(port => {
    const lp = PORT_LOCAL[port](s);
    const c  = svgEl('circle', {
      cx: lp.x, cy: lp.y, r: 6, fill: '#fff', stroke: '#667eea', 'stroke-width': 2, class: 'ds-port',
    });
    c.style.cursor = 'crosshair';
    c.addEventListener('mousedown', e => { e.stopPropagation(); dsStartArrow(e, s.id, port); });
    g.appendChild(c);
  });
  return g;
}

// ── Arrow rendering ───────────────────────────────────────────────────────────

function portDir(port, p, other) {
  if (port !== 'center') return PORT_DIRS[port] || { x: 1, y: 0 };
  const dx = other.x - p.x, dy = other.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

function dsArrowPathD(p1, fromPort, p2, toPort) {
  const d1    = portDir(fromPort, p1, p2);
  const d2raw = portDir(toPort, p2, p1);
  const d2    = toPort === 'center' ? d2raw : PORT_DIRS[toPort] || { x: -1, y: 0 };
  const dist  = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const t     = Math.max(dist * 0.38, 50);
  return `M ${p1.x} ${p1.y} C ${p1.x + d1.x * t} ${p1.y + d1.y * t}, ${p2.x + d2.x * t} ${p2.y + d2.y * t}, ${p2.x} ${p2.y}`;
}

function dsTempPathD(p1, fromPort, p2) {
  const d1 = portDir(fromPort, p1, p2);
  const t  = Math.max(Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.38, 50);
  return `M ${p1.x} ${p1.y} Q ${p1.x + d1.x * t} ${p1.y + d1.y * t} ${p2.x} ${p2.y}`;
}

function dsRenderArrows() {
  const layer = document.getElementById('draw-arrows-layer');
  if (!layer) return;
  layer.innerHTML = '';

  drawArrows.forEach(arr => {
    const from = find(arr.fromId);
    const to   = find(arr.toId);
    if (!from || !to) return;
    const p1     = getPortGlobalPos(from, arr.fromPort);
    const p2     = getPortGlobalPos(to,   arr.toPort);
    const d      = dsArrowPathD(p1, arr.fromPort, p2, arr.toPort);
    const lineId = `arr-path-${arr.id}`;

    const hit = svgEl('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 14 });
    hit.style.cursor = 'pointer';
    hit.addEventListener('click', () => {
      drawArrows = drawArrows.filter(a => a.id !== arr.id);
      dsRenderArrows(); dsSave();
    });

    const line = svgEl('path', {
      id: lineId, d, fill: 'none',
      stroke: arr.active ? '#4a5ce8' : '#667eea',
      'stroke-width': arr.active ? 2.5 : 2,
      'marker-end': 'url(#ds-arrowhead)',
    });

    layer.append(hit, line);

    if (arr.active) {
      for (let i = 0; i < 3; i++) {
        const dot = svgEl('circle', { id: `arr-dot-${arr.id}-${i}`, r: 4, fill: '#4a5ce8', opacity: 0, cx: p1.x, cy: p1.y });
        dot.style.pointerEvents = 'none';
        layer.appendChild(dot);
      }
    }
  });

  if (tempArrow) {
    const from = find(tempArrow.fromId);
    if (from) {
      const p1 = getPortGlobalPos(from, tempArrow.fromPort);
      let pathD;
      if (tempArrow.snapToId && tempArrow.snapToPort) {
        const toShape = find(tempArrow.snapToId);
        if (toShape) {
          const p2 = getPortGlobalPos(toShape, tempArrow.snapToPort);
          pathD = dsArrowPathD(p1, tempArrow.fromPort, p2, tempArrow.snapToPort);
        }
      }
      if (!pathD) pathD = dsTempPathD(p1, tempArrow.fromPort, { x: tempArrow.toX, y: tempArrow.toY });
      layer.appendChild(svgEl('path', {
        d: pathD, fill: 'none', stroke: '#667eea', 'stroke-width': 2,
        'stroke-dasharray': '7 4', opacity: 0.75, 'marker-end': 'url(#ds-arrowhead)',
      }));
    }
  }

  if (drawArrows.some(a => a.active)) dsStartAnim();
  else                                dsStopAnim();
}

// ── Dot animation (requestAnimationFrame) ────────────────────────────────────

const DS_ANIM_DUR  = 1.4;
const DS_ANIM_DOTS = 3;

function dsStartAnim() { if (dsAnimId === null) dsAnimId = requestAnimationFrame(dsAnimTick); }
function dsStopAnim()  { if (dsAnimId !== null) { cancelAnimationFrame(dsAnimId); dsAnimId = null; } }

function dsAnimTick(ts) {
  const active = drawArrows.filter(a => a.active);
  if (!active.length) { dsAnimId = null; return; }
  active.forEach(arr => {
    const pathEl = document.getElementById(`arr-path-${arr.id}`);
    if (!pathEl) return;
    const len = pathEl.getTotalLength();
    if (!len) return;
    for (let i = 0; i < DS_ANIM_DOTS; i++) {
      const frac = ((ts / 1000 / DS_ANIM_DUR) + i / DS_ANIM_DOTS) % 1;
      const pt   = pathEl.getPointAtLength(frac * len);
      const dot  = document.getElementById(`arr-dot-${arr.id}-${i}`);
      if (!dot) continue;
      dot.setAttribute('cx', pt.x.toFixed(2));
      dot.setAttribute('cy', pt.y.toFixed(2));
      const fade = Math.min(frac * 12, 1, (1 - frac) * 12);
      dot.setAttribute('opacity', fade.toFixed(2));
    }
  });
  dsAnimId = requestAnimationFrame(dsAnimTick);
}

// ── Marquee rendering ─────────────────────────────────────────────────────────

function dsRenderMarquee() {
  const old = document.getElementById('ds-marquee');
  if (old) old.remove();
  if (!marquee) return;
  const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1);
  const w = Math.abs(marquee.x1 - marquee.x0), h = Math.abs(marquee.y1 - marquee.y0);
  const rect = svgEl('rect', {
    id: 'ds-marquee', x, y, width: w, height: h,
    fill: 'rgba(102,126,234,0.07)', stroke: '#667eea', 'stroke-width': 1, 'stroke-dasharray': '5 3',
  });
  rect.style.pointerEvents = 'none';
  document.getElementById('draw-canvas').appendChild(rect);
}

// ── Canvas render (SVG, nested scene graph) ───────────────────────────────────

function dsRenderCanvas() {
  const layer = document.getElementById('draw-shapes-layer');
  if (!layer) return;
  layer.innerHTML = '';
  drawShapes.filter(s => !s.parentId).forEach(s => layer.appendChild(dsRenderNode(s)));
  dsRenderArrows();
  dsRenderMarquee();
}

// Recursively build one node's <g> (children nested inside → transforms compose).
function dsRenderNode(s) {
  const sel = drawSels.includes(s.id);
  const pri = s.id === drawSel;
  const g   = svgEl('g', {
    class: 'ds-shape-g', 'data-id': s.id,
    transform: `translate(${s.cx},${s.cy}) rotate(${s.rotation})`,
  });

  if (s.type === 'empty') {
    // Empty node = a functionless node (like a Unity empty GameObject):
    // a small dashed marker at its pivot. It does NOT box its children.
    const m = EMPTY_MARK;
    const rect = svgEl('rect', {
      x: -m, y: -m, width: 2 * m, height: 2 * m, rx: 3,
      fill: sel ? 'rgba(102,126,234,0.10)' : 'rgba(120,130,170,0.05)',
      stroke: sel ? '#667eea' : '#9aa3c2', 'stroke-width': 1.5, 'stroke-dasharray': '4 3',
    });
    rect.style.cursor = 'move';
    rect.addEventListener('mousedown',   e => { e.stopPropagation(); dsStartMove(e, s.id); });
    rect.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); dsShowContextMenu(e, s.id); });
    g.appendChild(rect);
    g.appendChild(svgEl('circle', { cx: 0, cy: 0, r: 2.5, fill: sel ? '#667eea' : '#9aa3c2', 'pointer-events': 'none' }));
  } else {
    const body = dsBody(s);
    body.style.cursor = 'move';
    body.addEventListener('mousedown',   e => { e.stopPropagation(); dsStartMove(e, s.id); });
    body.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); dsShowContextMenu(e, s.id); });
    g.appendChild(body);
    const txt = dsText(s);
    if (txt) g.appendChild(txt);
    g.appendChild(dsPorts(s));
  }

  // Children render INSIDE this node's group (local frame → world via composition)
  getChildren(s.id).forEach(c => g.appendChild(dsRenderNode(c)));

  // ── Selection overlays (on top of children) ──
  const hasKids = getChildren(s.id).length > 0;

  // "节点组" dashed box around the whole subtree — only while a parent is selected
  if ((pri || sel) && hasKids) g.appendChild(dsGroupBox(s, pri));

  if (pri) {
    if (s.type === 'empty') {
      const bb = hasKids
        ? getSubtreeLocalBBox(s)
        : { minX: -EMPTY_MARK, maxX: EMPTY_MARK, minY: -EMPTY_MARK, maxY: EMPTY_MARK };
      g.appendChild(dsGroupRotate(s, bb));
    } else {
      g.appendChild(dsHandles(s));   // resize + rotate for the node's own body
    }
  } else if (sel && s.type !== 'empty') {
    g.appendChild(dsSelHighlight(s));
  }

  return g;
}

// ── Hierarchy tree (props panel) ──────────────────────────────────────────────

function dsTreeRow(s, depth) {
  const kids = getChildren(s.id);
  const has  = kids.length > 0;
  if (propsExpanded[s.id] === undefined) propsExpanded[s.id] = true;
  const exp  = propsExpanded[s.id];
  const icon = DS_ICON[s.type] || '■';
  const name = DS_NAME[s.type] || s.type;
  const selCls = drawSels.includes(s.id) ? ' ds-tree-row--sel' : '';

  let row = `<div class="ds-tree-row${selCls}" data-id="${s.id}" draggable="true" style="padding-left:${6 + depth * 14}px">`;
  row += has
    ? `<span class="ds-tree-tw" data-tw="${s.id}">${exp ? '▾' : '▸'}</span>`
    : `<span class="ds-tree-tw ds-tree-tw--leaf"></span>`;
  row += `<span class="ds-tree-ico">${icon}</span>`;
  row += `<span class="ds-tree-lbl">${name}</span>`;
  row += `<span class="ds-tree-id">${s.id.slice(-4)}</span>`;
  if (s.type === 'empty') row += `<button class="ds-tree-act" data-ungroup="${s.id}" title="解组（拆散为同级）">⊟</button>`;
  if (s.parentId)         row += `<button class="ds-tree-act" data-eject="${s.id}" title="拆分为独立对象">⏏</button>`;
  row += `</div>`;

  if (has && exp) kids.forEach(k => { row += dsTreeRow(k, depth + 1); });
  return row;
}

// ── Props panel render ────────────────────────────────────────────────────────

function dsRenderProps() {
  const panel = document.getElementById('ds-props-panel');
  if (!panel) return;

  let html = '';

  // ── Hierarchy section ──
  html += '<div class="ds-props-header">层级</div>';
  html += '<div class="ds-tree" id="ds-tree">';
  const roots = drawShapes.filter(s => !s.parentId);
  if (roots.length) roots.forEach(r => { html += dsTreeRow(r, 0); });
  else              html += '<div class="ds-tree-empty">画板为空</div>';
  html += '</div>';

  // ── Properties section ──
  html += '<div class="ds-props-header">属性</div>';
  if (!drawSels.length) {
    html += '<div class="ds-props-empty">未选中任何对象</div>';
  } else {
    drawSels.forEach(id => {
      const s = find(id);
      if (!s) return;
      const icon = DS_ICON[s.type] || '■';
      const name = DS_NAME[s.type] || s.type;
      const isEmpty = s.type === 'empty';

      html += `
      <div class="ds-prop-item">
        <div class="ds-prop-hdr2">
          <span class="ds-prop-icon">${icon}</span>
          <span class="ds-prop-name">${name}</span>
          <span class="ds-prop-idbadge" title="${s.id}">${s.id.slice(-6)}</span>
        </div>
        <div class="ds-prop-body">`;

      if (s.parentId) {
        html += `
          <div class="ds-prop-parent-row">
            <span class="ds-prop-parent-label">${DS_ICON.empty} 已归组</span>
            <button class="ds-prop-eject" data-eject="${s.id}" title="拆分为独立对象">⏏ 拆分</button>
          </div>`;
      }

      if (!isEmpty) {
        html += `
          <div class="ds-prop-row">
            <label>填充</label>
            <input type="color" data-sid="${s.id}" data-prop="fill" value="${s.fill}">
          </div>
          <div class="ds-prop-row">
            <label>宽</label>
            <input type="number" id="ds-pw-${s.id}" data-sid="${s.id}" data-prop="w" value="${Math.round(s.w)}" min="20" step="1">
            <span class="ds-prop-unit">px</span>
          </div>
          <div class="ds-prop-row">
            <label>高</label>
            <input type="number" id="ds-ph-${s.id}" data-sid="${s.id}" data-prop="h" value="${Math.round(s.h)}" min="20" step="1">
            <span class="ds-prop-unit">px</span>
          </div>`;
      }

      html += `
          <div class="ds-prop-row">
            <label>旋转</label>
            <input type="number" id="ds-pr-${s.id}" data-sid="${s.id}" data-prop="rotation" value="${Math.round(s.rotation)}" step="1">
            <span class="ds-prop-unit">°</span>
          </div>`;

      if (SHAPE_HAS_TEXT(s.type)) {
        const ta = s.textAlign || 'center';
        html += `
          <div class="ds-prop-divider"></div>
          <div class="ds-prop-row">
            <label>文本</label>
            <input type="text" data-sid="${s.id}" data-prop="text" value="${escAttr(s.text || '')}" placeholder="输入文字…">
          </div>
          <div class="ds-prop-row">
            <label>文字色</label>
            <input type="color" data-sid="${s.id}" data-prop="textColor" value="${s.textColor || '#ffffff'}">
          </div>
          <div class="ds-prop-row">
            <label>字号</label>
            <input type="number" data-sid="${s.id}" data-prop="textSize" value="${Math.round(s.textSize || 14)}" min="6" step="1">
            <span class="ds-prop-unit">px</span>
          </div>
          <div class="ds-prop-row">
            <label>位置</label>
            <select data-sid="${s.id}" data-prop="textAlign">
              <option value="left"${ta === 'left' ? ' selected' : ''}>左侧</option>
              <option value="center"${ta === 'center' ? ' selected' : ''}>居中</option>
              <option value="right"${ta === 'right' ? ' selected' : ''}>右侧</option>
            </select>
          </div>`;
      }

      const kidCount = getChildren(s.id).length;
      if (kidCount > 0) {
        html += `
          <div class="ds-prop-meta">节点组 · 包含 ${kidCount} 个子对象</div>
          <button class="ds-prop-ungroup-btn" data-ungroup="${s.id}">⊟ 取消组合</button>`;
      }

      html += `
        </div>
      </div>`;
    });
  }

  panel.innerHTML = html;
}

// Live-update numeric inputs during drag (avoids full panel rebuild / focus loss).
function dsUpdatePropsLive() {
  drawSels.forEach(id => {
    const s = find(id);
    if (!s) return;
    const wEl = document.getElementById(`ds-pw-${id}`);
    const hEl = document.getElementById(`ds-ph-${id}`);
    const rEl = document.getElementById(`ds-pr-${id}`);
    if (wEl) wEl.value = Math.round(s.w);
    if (hEl) hEl.value = Math.round(s.h);
    if (rEl) rEl.value = Math.round(s.rotation);
  });
}

// ── Full render ───────────────────────────────────────────────────────────────

function dsRender() {
  dsRenderCanvas();
  dsRenderProps();
}

// ── Shape interactions ────────────────────────────────────────────────────────

function dsSetInteracting(on) {
  document.getElementById('draw-canvas')?.classList.toggle('ds-interacting', on);
}

function dsActivate(act) {
  drawAct = act;
  dsSetInteracting(true);
  window.addEventListener('mousemove', dsMouseMove);
  window.addEventListener('mouseup',   dsMouseUp);
}

function dsStartMove(e, id) {
  const root = getRootParent(id);
  // Clicking the canvas moves the whole root group, UNLESS this exact node is the
  // current primary selection (i.e. it was picked individually from the tree).
  const useId = (drawSel === id && root && root.id !== id) ? id : (root ? root.id : id);

  const pt = getSVGPt(e);
  const s  = find(useId);
  if (!s) return;

  if (e.shiftKey) {
    if (drawSels.includes(useId)) drawSels = drawSels.filter(x => x !== useId);
    else                          drawSels.push(useId);
    selSyncPrimary();
    dsRender();
    return;
  }

  if (!drawSels.includes(useId)) drawSels = [useId];
  drawSel = useId;

  // Effective move set = selected nodes without a selected ancestor (avoid double-move)
  const selSet  = new Set(drawSels);
  const moveIds = drawSels.filter(mid => {
    let p = find(mid)?.parentId ? find(find(mid).parentId) : null;
    while (p) { if (selSet.has(p.id)) return false; p = p.parentId ? find(p.parentId) : null; }
    return true;
  });

  const init = {};
  moveIds.forEach(mid => {
    const sh     = find(mid);
    const parent = sh.parentId ? find(sh.parentId) : null;
    const prot   = parent ? getWorldRotation(parent) : 0;
    init[mid] = { cx0: sh.cx, cy0: sh.cy, prot };
  });

  dsActivate({ type: 'move', id: useId, mx0: pt.x, my0: pt.y, init, moveIds });
  dsRender();
}

function dsStartResize(e, id, signX, signY) {
  const pt = getSVGPt(e);
  const s  = find(id);
  if (!s) return;
  const lo = toLocal(pt.x, pt.y, s);
  dsActivate({ type: 'resize', id, signX, signY, lx0: lo.x, ly0: lo.y, w0: s.w, h0: s.h });
}

function dsStartRotate(e, id) {
  const s = find(id);
  if (!s) return;
  const wc     = getWorldCenter(s);
  const parent = s.parentId ? find(s.parentId) : null;
  const parentRot = parent ? getWorldRotation(parent) : 0;
  dsActivate({ type: 'rotate', id, wcx: wc.x, wcy: wc.y, parentRot });
}

function dsMouseMove(e) {
  if (!drawAct) return;
  const pt = getSVGPt(e);
  const s  = find(drawAct.id);
  if (!s) return;

  if (drawAct.type === 'move') {
    const dx = pt.x - drawAct.mx0, dy = pt.y - drawAct.my0;
    Object.entries(drawAct.init).forEach(([mid, o]) => {
      const sh = find(mid);
      if (!sh) return;
      // Convert the world drag delta into this node's parent frame
      const th = -o.prot * Math.PI / 180, c = Math.cos(th), si = Math.sin(th);
      sh.cx = o.cx0 + (dx * c - dy * si);
      sh.cy = o.cy0 + (dx * si + dy * c);
    });
  } else if (drawAct.type === 'resize') {
    const lo  = toLocal(pt.x, pt.y, s);
    const dlx = lo.x - drawAct.lx0, dly = lo.y - drawAct.ly0;
    if (drawAct.signX !== 0) s.w = Math.max(MIN_SZ, drawAct.w0 + drawAct.signX * dlx * 2);
    if (drawAct.signY !== 0) s.h = Math.max(MIN_SZ, drawAct.h0 + drawAct.signY * dly * 2);
  } else if (drawAct.type === 'rotate') {
    const worldRot = Math.atan2(pt.x - drawAct.wcx, -(pt.y - drawAct.wcy)) * 180 / Math.PI;
    s.rotation = Math.round(worldRot - drawAct.parentRot);
  }

  dsRenderCanvas();
  dsUpdatePropsLive();
}

function dsMouseUp() {
  window.removeEventListener('mousemove', dsMouseMove);
  window.removeEventListener('mouseup',   dsMouseUp);
  dsSetInteracting(false);
  if (drawAct) {
    dsSave();
    drawAct = null;
    dsRender();
  }
}

// ── Arrow interactions ────────────────────────────────────────────────────────

function dsStartArrow(e, fromId, fromPort) {
  const pt = getSVGPt(e);
  tempArrow = { fromId, fromPort, toX: pt.x, toY: pt.y, snapToId: null, snapToPort: null };
  document.getElementById('draw-canvas')?.classList.add('drawing-arrow');
  window.addEventListener('mousemove', dsArrowMove);
  window.addEventListener('mouseup',   dsArrowUp);
}

function dsArrowMove(e) {
  if (!tempArrow) return;
  const pt     = getSVGPt(e);
  const target = findShapeAtPoint(pt.x, pt.y);
  if (target && target.id !== tempArrow.fromId && target.type !== 'empty') {
    const port = getNearestPort(target, pt.x, pt.y);
    const pos  = getPortGlobalPos(target, port);
    Object.assign(tempArrow, { toX: pos.x, toY: pos.y, snapToId: target.id, snapToPort: port });
  } else {
    Object.assign(tempArrow, { toX: pt.x, toY: pt.y, snapToId: null, snapToPort: null });
  }
  dsRenderArrows();
}

function dsArrowUp(e) {
  window.removeEventListener('mousemove', dsArrowMove);
  window.removeEventListener('mouseup',   dsArrowUp);
  document.getElementById('draw-canvas')?.classList.remove('drawing-arrow');
  if (tempArrow) {
    let toId = tempArrow.snapToId, toPort = tempArrow.snapToPort;
    if (!toId) {
      const pt = getSVGPt(e), target = findShapeAtPoint(pt.x, pt.y);
      if (target && target.id !== tempArrow.fromId && target.type !== 'empty') {
        toId = target.id; toPort = getNearestPort(target, pt.x, pt.y);
      }
    }
    if (toId && toPort) {
      drawArrows.push({
        id: newId('arr'),
        fromId: tempArrow.fromId, fromPort: tempArrow.fromPort,
        toId, toPort, active: false,
      });
      dsSave();
    }
    tempArrow = null;
    dsRender();
  }
}

// ── Marquee interactions ──────────────────────────────────────────────────────

function dsMarqueeMove(e) {
  if (!marquee) return;
  const pt = getSVGPt(e);
  marquee.x1 = pt.x; marquee.y1 = pt.y;
  dsRenderMarquee();
}

function dsMarqueeUp(e) {
  window.removeEventListener('mousemove', dsMarqueeMove);
  window.removeEventListener('mouseup',   dsMarqueeUp);
  document.getElementById('draw-canvas')?.classList.remove('ds-selecting');
  if (!marquee) return;

  const dist = Math.hypot(marquee.x1 - marquee.x0, marquee.y1 - marquee.y0);
  if (dist > 4) {
    const minX = Math.min(marquee.x0, marquee.x1), maxX = Math.max(marquee.x0, marquee.x1);
    const minY = Math.min(marquee.y0, marquee.y1), maxY = Math.max(marquee.y0, marquee.y1);

    const hitSet = new Set();
    drawShapes.forEach(s => {
      const w = getWorldCenter(s);
      if (w.x >= minX && w.x <= maxX && w.y >= minY && w.y <= maxY) {
        const root = getRootParent(s.id);
        hitSet.add(root ? root.id : s.id);
      }
    });

    const hitIds = [...hitSet];
    if (e.shiftKey) hitIds.forEach(id => { if (!drawSels.includes(id)) drawSels.push(id); });
    else            drawSels = hitIds;
    selSyncPrimary();
  }
  marquee = null;
  dsRender();
}

// ── Context menu ──────────────────────────────────────────────────────────────

function dsShowContextMenu(e, shapeId) {
  const root  = getRootParent(shapeId);
  const useId = root ? root.id : shapeId;
  ctxTarget   = useId;

  if (!drawSels.includes(useId)) {
    drawSels = [useId]; drawSel = useId;
    dsRender();
  } else {
    drawSel = useId;
    dsRenderCanvas();
    dsRenderProps();
  }

  const s           = find(useId);
  const isEmptyNode = s?.type === 'empty';

  // Activate / deactivate arrows (group → all descendants' outgoing arrows)
  const activateBtn = document.getElementById('ds-ctx-activate');
  if (activateBtn) {
    const ids = isEmptyNode
      ? new Set([useId, ...getDescendants(useId).map(d => d.id)])
      : new Set([useId]);
    const outgoing = drawArrows.filter(a => ids.has(a.fromId));
    if (!outgoing.length) {
      activateBtn.disabled = true;  activateBtn.style.opacity = '0.38';
      activateBtn.textContent = '⚡ 激活外联连线';
    } else {
      activateBtn.disabled = false; activateBtn.style.opacity = '1';
      const allActive = outgoing.every(a => a.active);
      activateBtn.textContent = allActive ? '⏸ 取消激活连线' : '⚡ 激活外联连线';
    }
  }

  const resetBtn = document.querySelector('[data-action="reset"]');
  if (resetBtn) { resetBtn.disabled = isEmptyNode; resetBtn.style.opacity = isEmptyNode ? '0.38' : '1'; }

  const groupBtn = document.getElementById('ds-ctx-group');
  if (groupBtn) {
    const canGroup = drawSels.length >= 1;
    groupBtn.disabled = !canGroup; groupBtn.style.opacity = canGroup ? '1' : '0.38';
  }

  const hasKids = getChildren(useId).length > 0;
  const ungroupBtn = document.getElementById('ds-ctx-ungroup');
  if (ungroupBtn) { ungroupBtn.disabled = !hasKids; ungroupBtn.style.opacity = hasKids ? '1' : '0.38'; }

  const menu = document.getElementById('ds-context-menu');
  menu.classList.remove('hidden');
  const mw = 188, mh = 252;
  let mx = e.clientX, my = e.clientY;
  if (mx + mw > window.innerWidth)  mx = window.innerWidth  - mw - 6;
  if (my + mh > window.innerHeight) my = window.innerHeight - mh - 6;
  menu.style.left = mx + 'px';
  menu.style.top  = my + 'px';
}

function dsHideContextMenu() {
  document.getElementById('ds-context-menu')?.classList.add('hidden');
  ctxTarget = null;
}

function initContextMenu() {
  const menu = document.getElementById('ds-context-menu');
  if (!menu) return;

  menu.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !ctxTarget) return;
    const action = btn.dataset.action;
    const s = find(ctxTarget);

    if (action === 'reset' && s) {
      if (s.type === 'empty') { dsHideContextMenu(); return; }
      const defSz = s.type === 'node' ? 28 : 80;
      s.w = defSz; s.h = defSz; s.rotation = 0;
      dsRender(); dsSave();

    } else if (action === 'delete') {
      const del = new Set([ctxTarget]);
      getDescendants(ctxTarget).forEach(d => del.add(d.id));
      drawArrows = drawArrows.filter(a => !del.has(a.fromId) && !del.has(a.toId));
      drawShapes = drawShapes.filter(x => !del.has(x.id));
      drawSels   = drawSels.filter(x => !del.has(x));
      selSyncPrimary();
      dsRender(); dsSave();

    } else if (action === 'layer-up') {
      layerMove(ctxTarget, +1);

    } else if (action === 'layer-down') {
      layerMove(ctxTarget, -1);

    } else if (action === 'activate-connections') {
      const ids = s?.type === 'empty'
        ? new Set([ctxTarget, ...getDescendants(ctxTarget).map(d => d.id)])
        : new Set([ctxTarget]);
      const outgoing = drawArrows.filter(a => ids.has(a.fromId));
      if (outgoing.length) {
        const allActive = outgoing.every(a => a.active);
        outgoing.forEach(a => { a.active = !allActive; });
        dsRenderArrows(); dsSave();
      }

    } else if (action === 'group') {
      groupSelected();

    } else if (action === 'ungroup') {
      ungroupShape(ctxTarget);
    }
    dsHideContextMenu();
  });

  window.addEventListener('click', e => {
    if (!menu.classList.contains('hidden') && !menu.contains(e.target)) dsHideContextMenu();
  });
}

// Swap a node with its nearest sibling in the given direction (local z-order).
function layerMove(id, dir) {
  const s = find(id);
  if (!s) return;
  const sibs = drawShapes.map((x, i) => ({ x, i })).filter(o => o.x.parentId === s.parentId);
  const pos  = sibs.findIndex(o => o.x.id === id);
  const swap = dir > 0 ? sibs[pos + 1] : sibs[pos - 1];
  if (!swap) return;
  const i = sibs[pos].i, j = swap.i;
  [drawShapes[i], drawShapes[j]] = [drawShapes[j], drawShapes[i]];
  dsRender(); dsSave();
}

// ── Props panel: clicks, edits, drag-to-reparent (wired once) ─────────────────

function initPropsPanel() {
  const panel = document.getElementById('ds-props-panel');
  if (!panel) return;

  // ── Clicks ──
  panel.addEventListener('click', e => {
    const ung = e.target.closest('[data-ungroup]');
    if (ung) { ungroupShape(ung.dataset.ungroup); return; }

    const ej = e.target.closest('[data-eject]');
    if (ej) { dsReparent(ej.dataset.eject, null); return; }

    const tw = e.target.closest('[data-tw]');
    if (tw) {
      const id = tw.dataset.tw;
      propsExpanded[id] = !propsExpanded[id];
      dsRenderProps();
      return;
    }

    const row = e.target.closest('.ds-tree-row');
    if (row) {
      const id = row.dataset.id;
      if (!e.shiftKey)                 drawSels = [id];
      else if (!drawSels.includes(id)) drawSels.push(id);
      drawSel = id;
      dsRender();
      return;
    }
  });

  // ── Live property editing ──
  panel.addEventListener('input', e => {
    const input = e.target;
    const id    = input.dataset.sid;
    const prop  = input.dataset.prop;
    if (!id || !prop) return;
    const s = find(id);
    if (!s) return;
    switch (prop) {
      case 'fill':      s.fill      = input.value; break;
      case 'w':         s.w         = Math.max(MIN_SZ, parseFloat(input.value) || MIN_SZ); break;
      case 'h':         s.h         = Math.max(MIN_SZ, parseFloat(input.value) || MIN_SZ); break;
      case 'rotation':  s.rotation  = parseFloat(input.value) || 0; break;
      case 'text':      s.text      = input.value; break;
      case 'textColor': s.textColor = input.value; break;
      case 'textSize':  s.textSize  = Math.max(6, parseFloat(input.value) || 14); break;
      case 'textAlign': s.textAlign = input.value; break;
    }
    dsRenderCanvas();
  });

  panel.addEventListener('change', e => { if (e.target.dataset.sid) dsSave(); });

  // ── Drag-to-reparent in the hierarchy tree ──
  panel.addEventListener('dragstart', e => {
    const row = e.target.closest('.ds-tree-row');
    if (!row) return;
    dragId = row.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    row.classList.add('ds-tree-row--drag');
  });

  const clearDropMarks = () =>
    panel.querySelectorAll('.ds-tree-row--drag, .ds-tree-row--over, .ds-tree-row--before, .ds-tree-row--after')
      .forEach(el => el.classList.remove('ds-tree-row--drag', 'ds-tree-row--over', 'ds-tree-row--before', 'ds-tree-row--after'));

  panel.addEventListener('dragend', () => { dragId = null; dropMark = null; clearDropMarks(); });

  panel.addEventListener('dragover', e => {
    if (!dragId) return;
    const tree = e.target.closest('#ds-tree');
    if (!tree) return;
    e.preventDefault();
    panel.querySelectorAll('.ds-tree-row--over, .ds-tree-row--before, .ds-tree-row--after')
      .forEach(el => el.classList.remove('ds-tree-row--over', 'ds-tree-row--before', 'ds-tree-row--after'));

    const row = e.target.closest('.ds-tree-row');
    if (!row || row.dataset.id === dragId) { dropMark = null; return; }   // empty area → root drop

    // Zone by cursor position within the row: top 30% / bottom 30% / middle 40%
    const rect = row.getBoundingClientRect();
    const off  = e.clientY - rect.top;
    const zone = off < rect.height * 0.30 ? 'before'
               : off > rect.height * 0.70 ? 'after'
               : 'inside';

    const id        = row.dataset.id;
    const newParent = zone === 'inside' ? id : (find(id) ? find(id).parentId : null);
    if (newParent && isDescendant(dragId, newParent)) { dropMark = null; return; }   // cycle

    dropMark = { id, zone };
    row.classList.add(zone === 'inside' ? 'ds-tree-row--over'
                    : zone === 'before' ? 'ds-tree-row--before'
                    : 'ds-tree-row--after');
  });

  panel.addEventListener('drop', e => {
    if (!dragId) return;
    const tree = e.target.closest('#ds-tree');
    if (!tree) return;
    e.preventDefault();
    if (dropMark)                                  dsDropNode(dragId, dropMark.id, dropMark.zone);
    else if (!e.target.closest('.ds-tree-row'))    dsReparent(dragId, null);   // empty area → root
    dragId = null; dropMark = null;
  });
}

// ── Palette drag-and-drop ─────────────────────────────────────────────────────

function initPalette() {
  document.querySelectorAll('.ds-palette-item').forEach(item => {
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      const type   = item.dataset.shape;
      const canvas = document.getElementById('draw-canvas');

      const ghost = document.createElement('div');
      ghost.innerHTML     = item.querySelector('svg').outerHTML;
      ghost.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;opacity:0.82;transform:translate(-50%,-50%);width:52px;height:46px;';
      ghost.style.left = e.clientX + 'px';
      ghost.style.top  = e.clientY + 'px';
      document.body.appendChild(ghost);

      const onMove = mv => { ghost.style.left = mv.clientX + 'px'; ghost.style.top = mv.clientY + 'px'; };
      const onUp   = uv => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
        ghost.remove();
        const r = canvas.getBoundingClientRect();
        if (uv.clientX >= r.left && uv.clientX <= r.right && uv.clientY >= r.top && uv.clientY <= r.bottom) {
          const pt = canvas.createSVGPoint();
          pt.x = uv.clientX; pt.y = uv.clientY;
          const sp = pt.matrixTransform(canvas.getScreenCTM().inverse());
          const s  = dsNew(type, sp.x, sp.y);
          drawShapes.push(s);
          drawSels = [s.id]; drawSel = s.id;
          dsRender(); dsSave();
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  });
}

// ── Tab toggle ────────────────────────────────────────────────────────────────

function initDrawTab() {
  const btn        = document.getElementById('draw-tab-btn');
  const board      = document.getElementById('draw-board');
  const contentRow = document.querySelector('.content-row');

  btn.addEventListener('click', () => {
    drawVisible = !drawVisible;
    // If opening draw, close wiki board first
    if (drawVisible) document.dispatchEvent(new CustomEvent('draw:show'));
    board.classList.toggle('hidden',      !drawVisible);
    contentRow.classList.toggle('hidden',  drawVisible);
    btn.classList.toggle('active',         drawVisible);
    if (drawVisible) dsRender();
  });

  // When wiki tab forces draw closed
  document.addEventListener('wiki:hideDraw', () => {
    drawVisible = false;
  });
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function initDrawKeys() {
  document.addEventListener('keydown', e => {
    if (!drawVisible) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;

    const commandKey = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (commandKey && !e.altKey && key === 'c') {
      if (copyDrawSelection()) e.preventDefault();
      return;
    }
    if (commandKey && !e.altKey && key === 'v') {
      if (pasteDrawClipboard()) e.preventDefault();
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && drawSels.length > 0) {
      const del = new Set(drawSels);
      drawSels.forEach(id => getDescendants(id).forEach(d => del.add(d.id)));
      drawArrows = drawArrows.filter(a => !del.has(a.fromId) && !del.has(a.toId));
      drawShapes = drawShapes.filter(s => !del.has(s.id));
      clearSel(); dsRender(); dsSave();
    }
    if (e.key === 'Escape') { dsHideContextMenu(); clearSel(); dsRender(); }

    // Ctrl/Cmd+G → group, Ctrl/Cmd+Shift+G → ungroup
    if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      if (e.shiftKey) {
        const emptySel = drawSels.map(find).find(s => s && s.type === 'empty');
        if (emptySel) ungroupShape(emptySel.id);
      } else if (drawSels.length) {
        groupSelected();
      }
    }
  });
}

// ── Canvas background: deselect + marquee ────────────────────────────────────

function initCanvasClick() {
  document.getElementById('draw-canvas').addEventListener('mousedown', e => {
    if (e.target.id !== 'draw-canvas' && e.target.id !== 'draw-grid-rect') return;
    const pt = getSVGPt(e);
    if (!e.shiftKey) clearSel();
    marquee = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
    document.getElementById('draw-canvas').classList.add('ds-selecting');
    window.addEventListener('mousemove', dsMarqueeMove);
    window.addEventListener('mouseup',   dsMarqueeUp);
    dsRender();
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

initPalette();
initDrawTab();
initDrawKeys();
initCanvasClick();
initContextMenu();
initPropsPanel();
dsLoad();

})();
