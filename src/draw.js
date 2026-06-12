'use strict';

// ══════════════════════════════════════════════════════════════════════════════
//  Drawing board — self-contained module
//  Shapes: triangle · circle · square
//  Interactions: drag-to-place · move (multi) · resize · rotate
//                marquee box-select · Shift+click toggle
//                connection-port arrows · right-click context menu
//                properties panel (right sidebar)
// ══════════════════════════════════════════════════════════════════════════════

const DRAW_KEY = 'drawBoard';
const NS       = 'http://www.w3.org/2000/svg';
const MIN_SZ   = 20;
const ROT_OFF  = 32;

let drawShapes  = [];    // [{ id, type, cx, cy, w, h, rotation, fill }]
let drawArrows  = [];    // [{ id, fromId, fromPort, toId, toPort }]
let drawSels    = [];    // multi-select: array of selected shape IDs
let drawSel     = null;  // primary selected shape (shows handles); always ∈ drawSels when set
let drawAct     = null;  // active shape interaction (move/resize/rotate)
let tempArrow   = null;  // { fromId, fromPort, toX, toY, snapToId, snapToPort }
let marquee     = null;  // { x0, y0, x1, y1 } – box-select drag state
let ctxTarget   = null;  // shape ID that was right-clicked
let propsExpanded = {};  // { shapeId: bool } – expansion state of props panel items
let drawVisible = false;
let dsAnimId    = null;  // requestAnimationFrame handle for dot animation

const DS_FILL = { triangle: '#667eea', circle: '#52a878', square: '#e8a020', node: '#667eea' };
const DS_ICON = { triangle: '△', circle: '○', square: '□', node: '⊙' };
const DS_NAME = { triangle: '三角形', circle: '圆形', square: '正方形', node: '节点' };

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

// ── Selection helpers ─────────────────────────────────────────────────────────

function clearSel() { drawSels = []; drawSel = null; }

function selSyncPrimary() {
  if (!drawSels.length)          { drawSel = null; return; }
  if (!drawSels.includes(drawSel)) drawSel = drawSels[drawSels.length - 1];
}

// ── Data ──────────────────────────────────────────────────────────────────────

function dsNew(type, cx, cy) {
  const sz = type === 'node' ? 28 : 80;
  return {
    id: `ds_${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
    type, cx, cy, w: sz, h: sz, rotation: 0,
    fill: DS_FILL[type] || '#667eea',
  };
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
  dsRender();
}

// ── Coordinate helpers ────────────────────────────────────────────────────────

function getSVGPt(e) {
  const svg = document.getElementById('draw-canvas');
  const pt  = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function toLocal(gx, gy, s) {
  const rad = s.rotation * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx  = gx - s.cx, dy  = gy - s.cy;
  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
}

function getPortGlobalPos(s, port) {
  if (port === 'center') return { x: s.cx, y: s.cy };
  const lp  = PORT_LOCAL[port](s);
  const rad = s.rotation * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return {
    x: s.cx + lp.x * cos - lp.y * sin,
    y: s.cy + lp.x * sin + lp.y * cos,
  };
}

function getShapeAABB(s) {
  const hw = s.w / 2, hh = s.h / 2;
  const rad = s.rotation * Math.PI / 180;
  const ac = Math.abs(Math.cos(rad)), as = Math.abs(Math.sin(rad));
  const ex = hw * ac + hh * as, ey = hw * as + hh * ac;
  return { minX: s.cx - ex, maxX: s.cx + ex, minY: s.cy - ey, maxY: s.cy + ey };
}

function findShapeAtPoint(gx, gy) {
  const selSet = new Set(drawSels);
  const ordered = [
    ...drawShapes.filter(s =>  selSet.has(s.id)),
    ...drawShapes.filter(s => !selSet.has(s.id)),
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
      // Hollow relay node — outer ring (move handle), no inner dot here (port handles it)
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
  const rh = svgEl('circle', { cx: 0, cy: -hh - ROT_OFF, r: 6, fill: '#fff', stroke: '#667eea', 'stroke-width': 1.5 });
  rh.style.cursor = 'crosshair';
  rh.addEventListener('mousedown', e => { e.stopPropagation(); dsStartRotate(e, s.id); });
  g.appendChild(rh);
  HANDLE_DEFS.forEach(([, xFn, yFn, cur, sx, sy]) => {
    const h = svgEl('rect', { x: xFn(s) - 5, y: yFn(s) - 5, width: 10, height: 10, rx: 2, fill: '#fff', stroke: '#667eea', 'stroke-width': 1.5 });
    h.style.cursor = cur;
    h.addEventListener('mousedown', e => { e.stopPropagation(); dsStartResize(e, s.id, sx, sy); });
    g.appendChild(h);
  });
  return g;
}

// Lightweight selection highlight for non-primary shapes in drawSels
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
    // Relay node: single always-visible center port
    const r = Math.min(s.w, s.h) / 2;
    const g = svgEl('g', { class: 'ds-ports ds-ports--node' });
    // Visual dot (not interactive)
    g.appendChild(svgEl('circle', {
      cx: 0, cy: 0, r: Math.max(3, r * 0.28),
      fill: s.fill, 'pointer-events': 'none',
    }));
    // Transparent hit circle (crosshair → drag to connect)
    const hit = svgEl('circle', {
      cx: 0, cy: 0, r: Math.max(7, r * 0.55),
      fill: 'transparent', class: 'ds-port',
    });
    hit.style.cursor = 'crosshair';
    hit.addEventListener('mousedown', e => { e.stopPropagation(); dsStartArrow(e, s.id, 'center'); });
    g.appendChild(hit);
    return g;
  }

  // Normal shapes: four edge ports
  const g = svgEl('g', { class: 'ds-ports' });
  PORT_NAMES.forEach(port => {
    const lp = PORT_LOCAL[port](s);
    const c  = svgEl('circle', { cx: lp.x, cy: lp.y, r: 6, fill: '#fff', stroke: '#667eea', 'stroke-width': 2, class: 'ds-port' });
    c.style.cursor = 'crosshair';
    c.addEventListener('mousedown', e => { e.stopPropagation(); dsStartArrow(e, s.id, port); });
    g.appendChild(c);
  });
  return g;
}

// ── Arrow rendering ───────────────────────────────────────────────────────────

// Compute outward direction for a port, handling the center port dynamically
function portDir(port, p, other) {
  if (port !== 'center') return PORT_DIRS[port] || { x: 1, y: 0 };
  const dx = other.x - p.x, dy = other.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

function dsArrowPathD(p1, fromPort, p2, toPort) {
  const d1   = portDir(fromPort, p1, p2);
  // For entry into toPort we want the outward direction (away from target)
  const d2raw = portDir(toPort, p2, p1);
  const d2   = toPort === 'center' ? d2raw : PORT_DIRS[toPort] || { x: -1, y: 0 };
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const t    = Math.max(dist * 0.38, 50);
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

  // ── Permanent arrows ──
  drawArrows.forEach(arr => {
    const from = drawShapes.find(s => s.id === arr.fromId);
    const to   = drawShapes.find(s => s.id === arr.toId);
    if (!from || !to) return;
    const p1     = getPortGlobalPos(from, arr.fromPort);
    const p2     = getPortGlobalPos(to,   arr.toPort);
    const d      = dsArrowPathD(p1, arr.fromPort, p2, arr.toPort);
    const lineId = `arr-path-${arr.id}`;

    // Wide transparent hit area (easier clicking)
    const hit = svgEl('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 14 });
    hit.style.cursor = 'pointer';
    hit.addEventListener('click', () => {
      drawArrows = drawArrows.filter(a => a.id !== arr.id);
      dsRenderArrows(); dsSave();
    });

    // Visual line — slightly thicker & brighter when active
    const line = svgEl('path', {
      id: lineId, d, fill: 'none',
      stroke: arr.active ? '#4a5ce8' : '#667eea',
      'stroke-width': arr.active ? 2.5 : 2,
      'marker-end': 'url(#ds-arrowhead)',
    });

    layer.append(hit, line);

    // Three dot placeholders that the rAF loop will animate
    if (arr.active) {
      for (let i = 0; i < 3; i++) {
        const dot = svgEl('circle', {
          id: `arr-dot-${arr.id}-${i}`,
          r: 4, fill: '#4a5ce8', opacity: 0,
          cx: p1.x, cy: p1.y,
        });
        dot.style.pointerEvents = 'none';
        layer.appendChild(dot);
      }
    }
  });

  // ── Temp arrow while dragging ──
  if (tempArrow) {
    const from = drawShapes.find(s => s.id === tempArrow.fromId);
    if (from) {
      const p1 = getPortGlobalPos(from, tempArrow.fromPort);
      let pathD;
      if (tempArrow.snapToId && tempArrow.snapToPort) {
        const toShape = drawShapes.find(s => s.id === tempArrow.snapToId);
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

  // ── Start / stop dot animation loop ──
  if (drawArrows.some(a => a.active)) dsStartAnim();
  else                                dsStopAnim();
}

// ── Dot animation (requestAnimationFrame) ────────────────────────────────────

const DS_ANIM_DUR  = 1.4;   // seconds per full cycle
const DS_ANIM_DOTS = 3;

function dsStartAnim() {
  if (dsAnimId !== null) return;   // already running
  dsAnimId = requestAnimationFrame(dsAnimTick);
}

function dsStopAnim() {
  if (dsAnimId !== null) { cancelAnimationFrame(dsAnimId); dsAnimId = null; }
}

function dsAnimTick(ts) {
  const active = drawArrows.filter(a => a.active);
  if (!active.length) { dsAnimId = null; return; }

  active.forEach(arr => {
    const pathEl = document.getElementById(`arr-path-${arr.id}`);
    if (!pathEl) return;
    const len = pathEl.getTotalLength();
    if (!len) return;

    for (let i = 0; i < DS_ANIM_DOTS; i++) {
      // Each dot is offset by 1/DOTS of the cycle
      const frac = ((ts / 1000 / DS_ANIM_DUR) + i / DS_ANIM_DOTS) % 1;
      const pt   = pathEl.getPointAtLength(frac * len);
      const dot  = document.getElementById(`arr-dot-${arr.id}-${i}`);
      if (!dot) continue;
      dot.setAttribute('cx', pt.x.toFixed(2));
      dot.setAttribute('cy', pt.y.toFixed(2));
      // Fade in near source, fade out near target
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
  const rect = svgEl('rect', { id: 'ds-marquee', x, y, width: w, height: h, fill: 'rgba(102,126,234,0.07)', stroke: '#667eea', 'stroke-width': 1, 'stroke-dasharray': '5 3' });
  rect.style.pointerEvents = 'none';
  document.getElementById('draw-canvas').appendChild(rect);
}

// ── Canvas render (SVG only) ──────────────────────────────────────────────────

function dsRenderCanvas() {
  const layer = document.getElementById('draw-shapes-layer');
  if (!layer) return;
  layer.innerHTML = '';

  const selSet = new Set(drawSels);
  const ordered = [
    ...drawShapes.filter(s => !selSet.has(s.id)),
    ...drawShapes.filter(s =>  selSet.has(s.id)),
  ];

  ordered.forEach(s => {
    const g = svgEl('g', { class: 'ds-shape-g', transform: `translate(${s.cx},${s.cy}) rotate(${s.rotation})` });
    const body = dsBody(s);
    body.style.cursor = 'move';
    body.addEventListener('mousedown', e => { e.stopPropagation(); dsStartMove(e, s.id); });
    g.appendChild(body);
    g.appendChild(dsPorts(s));
    if (s.id === drawSel) {
      g.appendChild(dsHandles(s));
    } else if (selSet.has(s.id)) {
      g.appendChild(dsSelHighlight(s));
    }
    // Right-click context menu
    g.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); dsShowContextMenu(e, s.id); });
    layer.appendChild(g);
  });

  dsRenderArrows();
  dsRenderMarquee();
}

// ── Props panel render ────────────────────────────────────────────────────────

function dsRenderProps() {
  const panel = document.getElementById('ds-props-panel');
  if (!panel) return;

  if (!drawSels.length) {
    panel.innerHTML =
      '<div class="ds-props-header">属性</div>' +
      '<div class="ds-props-empty">未选中任何对象</div>';
    return;
  }

  let html = '<div class="ds-props-header">属性</div>';
  drawSels.forEach(id => {
    const s = drawShapes.find(x => x.id === id);
    if (!s) return;
    if (propsExpanded[id] === undefined) propsExpanded[id] = true;
    const exp  = propsExpanded[id];
    const icon = DS_ICON[s.type] || '■';
    const name = DS_NAME[s.type] || s.type;
    html += `
    <div class="ds-prop-item">
      <div class="ds-prop-hdr" data-id="${s.id}">
        <span class="ds-prop-icon">${icon}</span>
        <span class="ds-prop-name">${name}</span>
        <button class="ds-prop-toggle" data-id="${s.id}">${exp ? '▲' : '▼'}</button>
      </div>
      <div class="ds-prop-body${exp ? '' : ' ds-prop-body--collapsed'}" data-id="${s.id}">
        <div class="ds-prop-row">
          <label>填充</label>
          <input type="color" data-sid="${s.id}" data-prop="fill" value="${s.fill}">
        </div>
        <div class="ds-prop-row">
          <label>宽</label>
          <input type="number" id="ds-pw-${s.id}" data-sid="${s.id}" data-prop="w"
                 value="${Math.round(s.w)}" min="20" step="1">
          <span class="ds-prop-unit">px</span>
        </div>
        <div class="ds-prop-row">
          <label>高</label>
          <input type="number" id="ds-ph-${s.id}" data-sid="${s.id}" data-prop="h"
                 value="${Math.round(s.h)}" min="20" step="1">
          <span class="ds-prop-unit">px</span>
        </div>
        <div class="ds-prop-row">
          <label>旋转</label>
          <input type="number" id="ds-pr-${s.id}" data-sid="${s.id}" data-prop="rotation"
                 value="${Math.round(s.rotation)}" step="1">
          <span class="ds-prop-unit">°</span>
        </div>
      </div>
    </div>`;
  });

  panel.innerHTML = html;
}

// Update only the numeric inputs during drag (avoids full panel rebuild / focus loss)
function dsUpdatePropsLive() {
  drawSels.forEach(id => {
    const s = drawShapes.find(x => x.id === id);
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
  const pt = getSVGPt(e);
  const s  = drawShapes.find(x => x.id === id);
  if (!s) return;

  if (e.shiftKey) {
    if (drawSels.includes(id)) {
      drawSels = drawSels.filter(x => x !== id);
    } else {
      drawSels.push(id);
    }
    selSyncPrimary();
    dsRender();
    return;
  }

  if (!drawSels.includes(id)) drawSels = [id];
  drawSel = id;

  const initPositions = {};
  drawSels.forEach(selId => {
    const sh = drawShapes.find(x => x.id === selId);
    if (sh) initPositions[selId] = { cx: sh.cx, cy: sh.cy };
  });

  dsActivate({ type: 'move', id, mx0: pt.x, my0: pt.y, initPositions });
  dsRender();
}

function dsStartResize(e, id, signX, signY) {
  const pt = getSVGPt(e);
  const s  = drawShapes.find(x => x.id === id);
  if (!s) return;
  const lo = toLocal(pt.x, pt.y, s);
  dsActivate({ type: 'resize', id, signX, signY, lx0: lo.x, ly0: lo.y, w0: s.w, h0: s.h });
}

function dsStartRotate(e, id) {
  const s = drawShapes.find(x => x.id === id);
  if (!s) return;
  dsActivate({ type: 'rotate', id, cx: s.cx, cy: s.cy });
}

function dsMouseMove(e) {
  if (!drawAct) return;
  const pt = getSVGPt(e);
  const s  = drawShapes.find(x => x.id === drawAct.id);
  if (!s) return;

  if (drawAct.type === 'move') {
    const dx = pt.x - drawAct.mx0, dy = pt.y - drawAct.my0;
    drawSels.forEach(selId => {
      const sh   = drawShapes.find(x => x.id === selId);
      const init = drawAct.initPositions?.[selId];
      if (sh && init) { sh.cx = init.cx + dx; sh.cy = init.cy + dy; }
    });
  } else if (drawAct.type === 'resize') {
    const lo  = toLocal(pt.x, pt.y, s);
    const dlx = lo.x - drawAct.lx0, dly = lo.y - drawAct.ly0;
    if (drawAct.signX !== 0) s.w = Math.max(MIN_SZ, drawAct.w0 + drawAct.signX * dlx * 2);
    if (drawAct.signY !== 0) s.h = Math.max(MIN_SZ, drawAct.h0 + drawAct.signY * dly * 2);
  } else if (drawAct.type === 'rotate') {
    s.rotation = Math.round(Math.atan2(pt.x - drawAct.cx, -(pt.y - drawAct.cy)) * 180 / Math.PI);
  }

  dsRenderCanvas();
  dsUpdatePropsLive();   // live-update inputs without rebuilding props panel
}

function dsMouseUp() {
  window.removeEventListener('mousemove', dsMouseMove);
  window.removeEventListener('mouseup',   dsMouseUp);
  dsSetInteracting(false);
  if (drawAct) {
    if (drawAct.type === 'move') {
      // Bring all moved shapes to top of z-order
      const movedSet = new Set(drawSels);
      const moved    = drawShapes.filter(s =>  movedSet.has(s.id));
      drawShapes     = [...drawShapes.filter(s => !movedSet.has(s.id)), ...moved];
    }
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
  if (target && target.id !== tempArrow.fromId) {
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
      if (target && target.id !== tempArrow.fromId) {
        toId = target.id; toPort = getNearestPort(target, pt.x, pt.y);
      }
    }
    if (toId && toPort) {
      drawArrows.push({
        id: `arr_${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
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
    const hit  = drawShapes.filter(s => s.cx >= minX && s.cx <= maxX && s.cy >= minY && s.cy <= maxY);
    if (e.shiftKey) {
      hit.forEach(s => { if (!drawSels.includes(s.id)) drawSels.push(s.id); });
    } else {
      drawSels = hit.map(s => s.id);
    }
    selSyncPrimary();
  }
  marquee = null;
  dsRender();
}

// ── Context menu ──────────────────────────────────────────────────────────────

function dsShowContextMenu(e, shapeId) {
  ctxTarget = shapeId;
  // Ensure the right-clicked shape is at least in the selection
  if (!drawSels.includes(shapeId)) {
    drawSels = [shapeId]; drawSel = shapeId;
    dsRender();
  } else {
    drawSel = shapeId;
    dsRenderCanvas();
    dsRenderProps();
  }

  // Dynamically label the activate button based on current state
  const outgoing    = drawArrows.filter(a => a.fromId === shapeId);
  const activateBtn = document.getElementById('ds-ctx-activate');
  if (activateBtn) {
    if (!outgoing.length) {
      activateBtn.disabled = true;
      activateBtn.style.opacity = '0.38';
      activateBtn.textContent   = '⚡ 激活外联连线';
    } else {
      activateBtn.disabled = false;
      activateBtn.style.opacity = '1';
      const allActive = outgoing.every(a => a.active);
      activateBtn.textContent = allActive ? '⏸ 取消激活连线' : '⚡ 激活外联连线';
    }
  }

  const menu = document.getElementById('ds-context-menu');
  menu.classList.remove('hidden');
  // Boundary-aware positioning
  const mw = 172, mh = 190;
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
    const s = drawShapes.find(x => x.id === ctxTarget);

    if (action === 'reset' && s) {
      const defSz = s.type === 'node' ? 28 : 80;
      s.w = defSz; s.h = defSz; s.rotation = 0;
      dsRender(); dsSave();

    } else if (action === 'delete') {
      drawArrows = drawArrows.filter(a => a.fromId !== ctxTarget && a.toId !== ctxTarget);
      drawShapes = drawShapes.filter(x => x.id !== ctxTarget);
      drawSels   = drawSels.filter(x => x !== ctxTarget);
      selSyncPrimary();
      dsRender(); dsSave();

    } else if (action === 'layer-up') {
      // Move one step toward the end of the array (higher z-order)
      // Note: only menu can move layers; drag auto-brings to top separately
      const idx = drawShapes.findIndex(x => x.id === ctxTarget);
      if (idx < drawShapes.length - 1) {
        [drawShapes[idx], drawShapes[idx + 1]] = [drawShapes[idx + 1], drawShapes[idx]];
        dsRender(); dsSave();
      }

    } else if (action === 'layer-down') {
      // Move one step toward the start of the array (lower z-order)
      const idx = drawShapes.findIndex(x => x.id === ctxTarget);
      if (idx > 0) {
        [drawShapes[idx], drawShapes[idx - 1]] = [drawShapes[idx - 1], drawShapes[idx]];
        dsRender(); dsSave();
      }

    } else if (action === 'activate-connections') {
      // Toggle active state for all outgoing arrows from ctxTarget
      const outgoing = drawArrows.filter(a => a.fromId === ctxTarget);
      if (outgoing.length) {
        const allActive = outgoing.every(a => a.active);
        outgoing.forEach(a => { a.active = !allActive; });
        dsRenderArrows();   // only arrows layer; shapes unchanged
        dsSave();
      }
    }
    dsHideContextMenu();
  });

  // Dismiss on outside click
  window.addEventListener('click', e => {
    if (!menu.classList.contains('hidden') && !menu.contains(e.target)) {
      dsHideContextMenu();
    }
  });
}

// ── Props panel event delegation (wired once at init) ─────────────────────────

function initPropsPanel() {
  const panel = document.getElementById('ds-props-panel');
  if (!panel) return;

  // Toggle expand/collapse
  panel.addEventListener('click', e => {
    const hdr = e.target.closest('.ds-prop-hdr[data-id]');
    if (!hdr) return;
    const id   = hdr.dataset.id;
    propsExpanded[id] = !propsExpanded[id];
    const body   = panel.querySelector(`.ds-prop-body[data-id="${id}"]`);
    const toggle = panel.querySelector(`.ds-prop-toggle[data-id="${id}"]`);
    if (body)   body.classList.toggle('ds-prop-body--collapsed', !propsExpanded[id]);
    if (toggle) toggle.textContent = propsExpanded[id] ? '▲' : '▼';
  });

  // Live property editing
  panel.addEventListener('input', e => {
    const input = e.target;
    const id    = input.dataset.sid;
    const prop  = input.dataset.prop;
    if (!id || !prop) return;
    const s = drawShapes.find(x => x.id === id);
    if (!s) return;
    switch (prop) {
      case 'fill':     s.fill     = input.value; break;
      case 'w':        s.w        = Math.max(MIN_SZ, parseFloat(input.value) || MIN_SZ); break;
      case 'h':        s.h        = Math.max(MIN_SZ, parseFloat(input.value) || MIN_SZ); break;
      case 'rotation': s.rotation = parseFloat(input.value) || 0; break;
    }
    dsRenderCanvas();   // update SVG only; props panel stays intact (no focus loss)
  });

  // Save on commit
  panel.addEventListener('change', e => {
    if (e.target.dataset.sid) dsSave();
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
    board.classList.toggle('hidden',       !drawVisible);
    contentRow.classList.toggle('hidden',  drawVisible);
    btn.classList.toggle('active',         drawVisible);
    if (drawVisible) dsRender();
  });
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function initDrawKeys() {
  document.addEventListener('keydown', e => {
    if (!drawVisible) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;

    if ((e.key === 'Delete' || e.key === 'Backspace') && drawSels.length > 0) {
      const del = new Set(drawSels);
      drawArrows = drawArrows.filter(a => !del.has(a.fromId) && !del.has(a.toId));
      drawShapes = drawShapes.filter(s => !del.has(s.id));
      clearSel(); dsRender(); dsSave();
    }
    if (e.key === 'Escape') {
      dsHideContextMenu(); clearSel(); dsRender();
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
