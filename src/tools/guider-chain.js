// guider-chain.js — 引导点链生成器
// 纯 Vanilla JS，无外部依赖。node --check 可通过语法校验。

const $ = (id) => document.getElementById(id);

const outputEl   = $('output');
const statusEl   = $('status');
const previewEl  = $('preview');

// ─── 状态栏 ───────────────────────────────────────────────────────────────────

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function numVal(id, fallback) {
  var v = Number($(id).value);
  return Number.isFinite(v) ? v : (fallback !== undefined ? fallback : 0);
}

function intVal(id, fallback) {
  return Math.trunc(numVal(id, fallback !== undefined ? fallback : 0));
}

function boolVal(id) {
  return $(id).checked;
}

// 浮点统一 6 位
function fmt(v) {
  var n = (Math.abs(v) < 5e-7) ? 0 : v;
  return n.toFixed(6);
}

// ─── 形状点生成 ───────────────────────────────────────────────────────────────

// 沿折线等弧长采样 count 个点；closed=true 则折线首尾封闭（但采样结果不含重复端点）。
function samplePolyline(verts, count, closed) {
  if (count === 1) {
    return [{ x: verts[0].x, y: verts[0].y }];
  }
  var segments = [];
  var segCount = closed ? verts.length : verts.length - 1;
  var total = 0;
  for (var i = 0; i < segCount; i++) {
    var from = verts[i];
    var to   = verts[(i + 1) % verts.length];
    var len  = Math.hypot(to.x - from.x, to.y - from.y);
    segments.push({ from: from, to: to, start: total, length: len });
    total += len;
  }
  return Array.from({ length: count }, function(_, idx) {
    // 开链几何：等弧长，首点在 dist=0，末点在 dist=total
    // 闭合几何（用于生成封闭轮廓上的点）：等弧长，末点不与首点重叠
    var dist = closed
      ? idx * total / count
      : (count === 1 ? 0 : idx * total / (count - 1));
    // 找对应线段
    var seg = segments[segments.length - 1];
    for (var k = 0; k < segments.length; k++) {
      if (dist <= segments[k].start + segments[k].length) {
        seg = segments[k];
        break;
      }
    }
    var t = seg.length > 0 ? (dist - seg.start) / seg.length : 0;
    return {
      x: seg.from.x + (seg.to.x - seg.from.x) * t,
      y: seg.from.y + (seg.to.y - seg.from.y) * t,
    };
  });
}

// 正三角形顶点（等边，顶点朝上 = -Y 轴）
function triangleVerts(r) {
  return Array.from({ length: 3 }, function(_, i) {
    var angle = -Math.PI / 2 + i * Math.PI * 2 / 3;
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
  });
}

function createOffsets(shape, count, size) {
  if (shape === 'circle') {
    // 圆形：等角度
    return Array.from({ length: count }, function(_, i) {
      var angle = -Math.PI / 2 + i * Math.PI * 2 / count;
      return { x: Math.cos(angle) * size, y: Math.sin(angle) * size };
    });
  }
  if (shape === 'square') {
    return samplePolyline([
      { x: -size, y: -size },
      { x:  size, y: -size },
      { x:  size, y:  size },
      { x: -size, y:  size },
    ], count, true);
  }
  // triangle
  return samplePolyline(triangleVerts(size), count, true);
}

// ─── T3D 构建 ─────────────────────────────────────────────────────────────────

function actorName(startIdx, seq) {
  return 'TGADBaseActorGuider_' + (startIdx + seq);
}

function buildActor(offset, seq, cfg) {
  var name      = actorName(cfg.actorStart, seq);
  var guiderID  = cfg.guiderStart + seq;
  var prevName  = (seq > 0)              ? actorName(cfg.actorStart, seq - 1)      : null;
  var nextName  = (seq < cfg.count - 1)  ? actorName(cfg.actorStart, seq + 1)      : null;
  var isLast    = seq === cfg.count - 1;

  var wx = cfg.centerX + offset.x;
  var wy = cfg.centerY + offset.y;
  var wz = cfg.centerZ;

  var lines = [
    '      Begin Actor Class=TGADBaseActorGuider Name=' + name +
      " Archetype=TGADBaseActorGuider'TGADBase.Default__TGADBaseActorGuider'",
    '         GuiderID=' + guiderID,
  ];

  if (prevName !== null) {
    lines.push("         PreGuider=TGADBaseActorGuider'" + prevName + "'");
  }
  if (nextName !== null) {
    lines.push("         NextGuider=TGADBaseActorGuider'" + nextName + "'");
  }

  lines.push('         MinGuideDist=' + fmt(cfg.minGuideDist));
  lines.push('         MaxGuideDist=' + fmt(cfg.maxGuideDist));

  if (cfg.bAutoTurnOff) {
    lines.push('         bAutoTurnOffWhenInMinRange=True');
  }
  if (cfg.bInitGuide) {
    lines.push('         bInitGuideSelf=True');
  }
  // bTurnOnNextWhenInMinRange：仅非末点输出（末点默认 false，不写）
  if (!isLast && cfg.bTurnOnNext) {
    lines.push('         bTurnOnNextWhenInMinRange=True');
  }

  lines.push(
    '         Location=(X=' + fmt(wx) + ',Y=' + fmt(wy) + ',Z=' + fmt(wz) + ')'
  );
  lines.push('         Tag="TGADBaseActorGuider"');
  lines.push('         Name="' + name + '"');
  lines.push("         ObjectArchetype=TGADBaseActorGuider'TGADBase.Default__TGADBaseActorGuider'");
  lines.push('      End Actor');

  return lines.join('\n');
}

function buildT3D(offsets, cfg) {
  var actors = offsets.map(function(off, i) { return buildActor(off, i, cfg); });
  return [
    'Begin Map',
    '   Begin Level',
  ].concat(actors).concat([
    '   End Level',
    'Begin Surface',
    'End Surface',
    'End Map',
  ]).join('\n');
}

// ─── 预览 ─────────────────────────────────────────────────────────────────────

function drawPreview(offsets, cfg) {
  var rect  = previewEl.getBoundingClientRect();
  var ratio = window.devicePixelRatio || 1;
  previewEl.width  = Math.max(1, Math.round(rect.width  * ratio));
  previewEl.height = Math.max(1, Math.round(rect.height * ratio));

  var ctx = previewEl.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, rect.width, rect.height);

  if (offsets.length === 0) return;

  var pad   = 32;
  var maxR  = Math.max(cfg.size, 1);
  var scale = Math.min(
    (rect.width  - pad * 2) / (maxR * 2),
    (rect.height - pad * 2) / (maxR * 2)
  );
  var cx = rect.width  / 2;
  var cy = rect.height / 2;

  var px = function(off) { return cx + off.x * scale; };
  var py = function(off) { return cy + off.y * scale; };

  // 十字参考线
  ctx.strokeStyle = '#e3e6f2';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, cy); ctx.lineTo(rect.width - pad, cy);
  ctx.moveTo(cx, pad); ctx.lineTo(cx, rect.height - pad);
  ctx.stroke();

  // 连线（开链，不 closePath）
  if (offsets.length > 1) {
    ctx.strokeStyle = '#b0b8d8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    offsets.forEach(function(off, i) {
      if (i === 0) ctx.moveTo(px(off), py(off));
      else         ctx.lineTo(px(off), py(off));
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 方向箭头（每段中点）
  if (offsets.length > 1) {
    ctx.fillStyle = '#667eea';
    for (var i = 0; i < offsets.length - 1; i++) {
      var a = offsets[i], b = offsets[i + 1];
      var mx     = (px(a) + px(b)) / 2;
      var my_    = (py(a) + py(b)) / 2;
      var angle  = Math.atan2(py(b) - py(a), px(b) - px(a));
      var aLen   = 7;
      var spread = 0.42;
      ctx.beginPath();
      ctx.moveTo(mx, my_);
      ctx.lineTo(mx - Math.cos(angle - spread) * aLen, my_ - Math.sin(angle - spread) * aLen);
      ctx.lineTo(mx - Math.cos(angle + spread) * aLen, my_ - Math.sin(angle + spread) * aLen);
      ctx.closePath();
      ctx.fill();
    }
  }

  // 节点
  offsets.forEach(function(off, i) {
    var x      = px(off);
    var y      = py(off);
    var isFirst = i === 0;
    var isLast  = i === offsets.length - 1;

    ctx.fillStyle = isFirst ? '#2ecc71' : isLast ? '#e74c3c' : '#667eea';
    ctx.beginPath();
    ctx.arc(x, y, isFirst || isLast ? 6 : 4.5, 0, Math.PI * 2);
    ctx.fill();

    // 序号 / Tail / Head 标签
    var label = isFirst ? 'Tail' : isLast ? 'Head' : String(i);
    ctx.fillStyle = '#2c2f3a';
    ctx.font = (isFirst || isLast ? 'bold ' : '') + '10px "Segoe UI", sans-serif';
    ctx.fillText(label, x + 8, y - 5);
    if (!isFirst && !isLast) {
      ctx.fillStyle = '#888';
      ctx.font = '9px "Segoe UI", sans-serif';
    }
  });
}

// ─── 配置读取与校验 ───────────────────────────────────────────────────────────

function readConfig() {
  var shape         = document.querySelector('input[name="shape"]:checked').value;
  var count         = intVal('count', 8);
  var size          = numVal('size', 600);
  var actorStart    = intVal('actor-start', 0);
  var guiderStart   = intVal('guider-start', 1);
  var minGuideDist  = numVal('min-guide-dist', -1);
  var maxGuideDist  = numVal('max-guide-dist', -1);
  var centerX       = numVal('center-x', 0);
  var centerY       = numVal('center-y', 0);
  var centerZ       = numVal('center-z', 0);
  var bAutoTurnOff  = boolVal('b-auto-turn-off');
  var bInitGuide    = boolVal('b-init-guide');
  var bTurnOnNext   = boolVal('b-turn-on-next');

  if (!Number.isInteger(count) || count < 1 || count > 256) {
    throw new Error('点数量必须在 1 到 256 之间。');
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('半径 / 半边长必须大于 0 且为有限数。');
  }
  if (!Number.isFinite(minGuideDist)) {
    throw new Error('MinGuideDist 必须是有效数值。');
  }
  if (!Number.isFinite(maxGuideDist)) {
    throw new Error('MaxGuideDist 必须是有效数值。');
  }
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || !Number.isFinite(centerZ)) {
    throw new Error('中心坐标必须是有效数值。');
  }
  if (!Number.isInteger(guiderStart) || guiderStart <= 0) {
    throw new Error('GuiderID 起始值必须是大于 0 的整数。');
  }
  if (!Number.isInteger(actorStart) || actorStart < 0) {
    throw new Error('Actor 起始序号必须是非负整数。');
  }

  return {
    shape, count, size,
    actorStart, guiderStart,
    minGuideDist, maxGuideDist,
    centerX, centerY, centerZ,
    bAutoTurnOff, bInitGuide, bTurnOnNext,
  };
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────

function generate(showSuccess) {
  try {
    var cfg     = readConfig();
    var offsets = createOffsets(cfg.shape, cfg.count, cfg.size);
    var t3d     = buildT3D(offsets, cfg);

    outputEl.value = t3d;
    $('output-count').textContent  = cfg.count + ' 个 Actor';
    $('preview-label').textContent = cfg.count + ' 个引导点';

    drawPreview(offsets, cfg);

    if (showSuccess) {
      setStatus(
        '已生成 ' + cfg.count + ' 个 TGADBaseActorGuider' +
        '（GuiderID ' + cfg.guiderStart + '–' + (cfg.guiderStart + cfg.count - 1) + '）' +
        '，开链 Tail→Head。',
        'ok'
      );
    }
  } catch (err) {
    outputEl.value = '';
    $('output-count').textContent  = '0 个 Actor';
    setStatus(err.message, 'err');
  }
}

function copyOutput() {
  if (!outputEl.value) {
    setStatus('没有可复制的 T3D。', 'err');
    return;
  }
  navigator.clipboard.writeText(outputEl.value)
    .then(function() { setStatus('T3D 已复制到剪贴板。', 'ok'); })
    .catch(function() {
      outputEl.select();
      document.execCommand('copy');
      setStatus('T3D 已复制到剪贴板。', 'ok');
    });
}

function saveOutput() {
  if (!outputEl.value) {
    setStatus('没有可保存的 T3D。', 'err');
    return;
  }
  var shape = document.querySelector('input[name="shape"]:checked').value;
  var count = intVal('count', 0);
  var blob  = new Blob([outputEl.value], { type: 'text/plain;charset=utf-8' });
  var url   = URL.createObjectURL(blob);
  var link  = document.createElement('a');
  link.href     = url;
  link.download = 'TGADBaseActorGuider_' + shape + '_' + count + '.t3d';
  link.click();
  URL.revokeObjectURL(url);
  setStatus('T3D 文件已保存。', 'ok');
}

// ─── 事件绑定 ─────────────────────────────────────────────────────────────────

document.querySelectorAll('input[name="shape"]').forEach(function(el) {
  el.addEventListener('change', function() { generate(false); });
});

document.querySelectorAll('.controls input[type="number"]').forEach(function(el) {
  el.addEventListener('input', function() { generate(false); });
});

document.querySelectorAll('.controls input[type="checkbox"]').forEach(function(el) {
  el.addEventListener('change', function() { generate(false); });
});

$('generate-btn').addEventListener('click', function() { generate(true); });
$('copy-btn').addEventListener('click', copyOutput);
$('save-btn').addEventListener('click', saveOutput);
window.addEventListener('resize', function() { generate(false); });

// 初始渲染
generate(false);
