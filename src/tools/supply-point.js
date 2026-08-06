// supply-point.js — 补给点（PVEVendingMachineVolume）T3D 生成器
// 纯 Vanilla JS，无外部依赖。node --check 可通过语法校验。

const $ = (id) => document.getElementById(id);

const outputEl  = $('output');
const statusEl  = $('status');
const previewEl = $('preview');

// ─── 补给点类型表 ─────────────────────────────────────────────────────────────
// MachineType 决定补给点的功能；Emitter 模板取自现网补给点导出。

const MACHINES = [
  {
    key: 'shop',
    label: '商店',
    machineType: 'MT_Custom2',
    color: '#e67e22',
    useId: 'use-shop',
    costId: 'cost-shop',
    rowId: 'row-shop',
    particle: "ParticleSystem'PZHUD.PZ_Tip.Effects.P_PZ_HUD_Tip_Trolley'",
  },
  {
    key: 'health',
    label: '加血',
    machineType: 'MT_Custom1',
    color: '#2ecc71',
    useId: 'use-health',
    costId: 'cost-health',
    rowId: 'row-health',
    particle: "ParticleSystem'IFHUD.IF_Tip.Effects.P_IF_Tip_017'",
  },
  {
    key: 'ammo',
    label: '加子弹',
    machineType: 'MT_Custom',
    color: '#667eea',
    useId: 'use-ammo',
    costId: 'cost-ammo',
    rowId: 'row-ammo',
    particle: "ParticleSystem'IFHUD.IF_Tip.Effects.P_IF_Tip_016'",
  },
];

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

// 属性值浮点：统一 6 位小数
function fmt(v) {
  var n = (Math.abs(v) < 5e-7) ? 0 : v;
  return n.toFixed(6);
}

// PolyList 浮点：符号 + 5 位整数（补零）+ 6 位小数，例 +00090.244904
function poly(v) {
  var n = (Math.abs(v) < 5e-7) ? 0 : v;
  var body = Math.abs(n).toFixed(6);
  while (body.length < 12) body = '0' + body;
  return (n < 0 ? '-' : '+') + body;
}

function vec(v) {
  return '(X=' + fmt(v.x) + ',Y=' + fmt(v.y) + ',Z=' + fmt(v.z) + ')';
}

// ─── 盒体几何 ─────────────────────────────────────────────────────────────────
// 轴对齐立方体，本地坐标以 Actor 原点为中心。
// 顶点序号固定，FaceTriData / PermutedVertexData 均依此序号生成。

function boxVerts(h) {
  return [
    { x: -h.x, y: -h.y, z: -h.z }, // 0
    { x:  h.x, y: -h.y, z: -h.z }, // 1
    { x:  h.x, y:  h.y, z: -h.z }, // 2
    { x: -h.x, y:  h.y, z: -h.z }, // 3
    { x: -h.x, y: -h.y, z:  h.z }, // 4
    { x:  h.x, y: -h.y, z:  h.z }, // 5
    { x:  h.x, y:  h.y, z:  h.z }, // 6
    { x: -h.x, y:  h.y, z:  h.z }, // 7
  ];
}

// 12 个三角形，绕序保证法线朝外
const FACE_TRI_DATA = [
  0, 3, 2, 0, 2, 1, // -Z
  4, 5, 6, 4, 6, 7, // +Z
  0, 1, 5, 0, 5, 4, // -Y
  1, 2, 6, 1, 6, 5, // +X
  2, 3, 7, 2, 7, 6, // +Y
  3, 0, 4, 3, 4, 7, // -X
];

// SIMD 打包：每 4 个顶点一组，每组 3 条（X/Y/Z 分量），字段序 W,X,Y,Z 对应第 4,1,2,3 个顶点
function permutedVertexData(verts) {
  var entries = [];
  for (var g = 0; g < verts.length; g += 4) {
    ['x', 'y', 'z'].forEach(function(axis) {
      var q = [verts[g], verts[g + 1], verts[g + 2], verts[g + 3]];
      entries.push(
        '(W=' + fmt(q[3][axis]) +
        ',X=' + fmt(q[0][axis]) +
        ',Y=' + fmt(q[1][axis]) +
        ',Z=' + fmt(q[2][axis]) + ')'
      );
    });
  }
  return entries.join(',');
}

function buildAggGeom(h) {
  var verts = boxVerts(h);

  var vertexData = verts.map(vec).join(',');

  var edgeDirections =
    '(X=1.000000,Y=0.000000,Z=0.000000),' +
    '(X=0.000000,Y=1.000000,Z=0.000000),' +
    '(X=0.000000,Y=0.000000,Z=1.000000)';

  var faceNormalDirections = edgeDirections;

  var facePlaneData = [
    '(W=' + fmt(h.x) + ',X=1.000000,Y=0.000000,Z=0.000000)',
    '(W=' + fmt(h.y) + ',X=0.000000,Y=1.000000,Z=0.000000)',
    '(W=' + fmt(h.z) + ',X=0.000000,Y=0.000000,Z=1.000000)',
    '(W=' + fmt(h.z) + ',X=0.000000,Y=0.000000,Z=-1.000000)',
    '(W=' + fmt(h.x) + ',X=-1.000000,Y=0.000000,Z=0.000000)',
    '(W=' + fmt(h.y) + ',X=0.000000,Y=-1.000000,Z=0.000000)',
  ].join(',');

  var elemBox =
    '(Min=(X=' + fmt(-h.x) + ',Y=' + fmt(-h.y) + ',Z=' + fmt(-h.z) + ')' +
    ',Max=(X=' + fmt(h.x) + ',Y=' + fmt(h.y) + ',Z=' + fmt(h.z) + ')' +
    ',IsValid=1)';

  return '(ConvexElems=((VertexData=(' + vertexData + ')' +
    ',PermutedVertexData=(' + permutedVertexData(verts) + ')' +
    ',FaceTriData=(' + FACE_TRI_DATA.join(',') + ')' +
    ',EdgeDirections=(' + edgeDirections + ')' +
    ',FaceNormalDirections=(' + faceNormalDirections + ')' +
    ',FacePlaneData=(' + facePlaneData + ')' +
    ',ElemBox=' + elemBox + ')))';
}

// Brush PolyList：6 个面。顶点绕序满足 (v1-v0)×(v2-v0) 与法线同向（UE3 约定）。
function buildPolyList(h) {
  var v = boxVerts(h);
  var faces = [
    { idx: [1, 5, 4, 0], n: { x: 0, y: -1, z: 0 }, u: { x: -1, y: 0, z: 0 }, w: { x: 0, y: 0, z: -1 } }, // -Y
    { idx: [0, 4, 7, 3], n: { x: -1, y: 0, z: 0 }, u: { x: 0, y: 1, z: 0 }, w: { x: 0, y: 0, z: -1 } }, // -X
    { idx: [3, 7, 6, 2], n: { x: 0, y: 1, z: 0 }, u: { x: 1, y: 0, z: 0 }, w: { x: 0, y: 0, z: -1 } }, // +Y
    { idx: [2, 6, 5, 1], n: { x: 1, y: 0, z: 0 }, u: { x: 0, y: -1, z: 0 }, w: { x: 0, y: 0, z: -1 } }, // +X
    { idx: [7, 4, 5, 6], n: { x: 0, y: 0, z: 1 }, u: { x: 1, y: 0, z: 0 }, w: { x: 0, y: 1, z: 0 } },   // +Z
    { idx: [2, 1, 0, 3], n: { x: 0, y: 0, z: -1 }, u: { x: -1, y: 0, z: 0 }, w: { x: 0, y: 1, z: 0 } }, // -Z
  ];

  var lines = [];
  faces.forEach(function(face, link) {
    var origin = v[face.idx[0]];
    lines.push('               Begin Polygon Flags=3584 Link=' + link);
    lines.push('                  Origin   ' + poly(origin.x) + ',' + poly(origin.y) + ',' + poly(origin.z));
    lines.push('                  Normal   ' + poly(face.n.x) + ',' + poly(face.n.y) + ',' + poly(face.n.z));
    lines.push('                  TextureU ' + poly(face.u.x) + ',' + poly(face.u.y) + ',' + poly(face.u.z));
    lines.push('                  TextureV ' + poly(face.w.x) + ',' + poly(face.w.y) + ',' + poly(face.w.z));
    face.idx.forEach(function(i) {
      lines.push('                  Vertex   ' + poly(v[i].x) + ',' + poly(v[i].y) + ',' + poly(v[i].z));
    });
    lines.push('               End Polygon');
  });
  return lines;
}

// ─── Actor 构建 ───────────────────────────────────────────────────────────────

function buildVolume(machine, cost, loc, h, seq, cfg) {
  var name      = 'PVEVendingMachineVolume_' + (cfg.volumeStart + seq);
  var brushName = 'BrushComponent_' + (cfg.volumeStart + seq);
  var modelName = 'Model_' + (cfg.volumeStart + seq);
  var archetype = "PVEVendingMachineVolume'PVEGame.Default__PVEVendingMachineVolume'";

  var lines = [
    '      Begin Actor Class=PVEVendingMachineVolume Name=' + name + ' Archetype=' + archetype,
    '         Begin Object Class=BrushComponent Name=BrushComponent0 ObjName=' + brushName +
      " Archetype=BrushComponent'PVEGame.Default__PVEVendingMachineVolume:BrushComponent0'",
    "            BRUSH=Model'" + modelName + "'",
    '            BrushAggGeom=' + buildAggGeom(h),
    '            ReplacementPrimitive=None',
    '            bAcceptsLights=True',
    '            CollideActors=True',
    '            BlockNonZeroExtent=True',
    '            bDisableAllRigidBody=True',
    '            AlwaysLoadOnClient=True',
    '            AlwaysLoadOnServer=True',
    '            LightingChannels=(bInitialized=True,Dynamic=True)',
    '            Name="' + brushName + '"',
    "            ObjectArchetype=BrushComponent'PVEGame.Default__PVEVendingMachineVolume:BrushComponent0'",
    '         End Object',
  ];

  if (cost > 0) {
    lines.push('         Cost=' + cost);
  }
  lines.push('         MachineType=' + machine.machineType);
  lines.push('         bNeedCheckFacing=False');

  lines.push('         Begin Brush Name=' + modelName);
  lines.push('            Begin PolyList');
  lines = lines.concat(buildPolyList(h));
  lines.push('            End PolyList');
  lines.push('         End Brush');

  lines.push("         BRUSH=Model'" + modelName + "'");
  lines.push("         BrushComponent=BrushComponent'" + brushName + "'");
  lines.push("         Components(0)=BrushComponent'" + brushName + "'");
  lines.push('         Location=' + vec(loc));
  lines.push('         Tag="PVEVendingMachineVolume"');
  lines.push("         CollisionComponent=BrushComponent'" + brushName + "'");
  lines.push('         Name="' + name + '"');
  lines.push('         ObjectArchetype=' + archetype);
  lines.push('      End Actor');

  return lines.join('\n');
}

function buildEmitter(machine, loc, seq, cfg) {
  var id       = cfg.emitterStart + seq;
  var name     = 'Emitter_' + id;
  var psName   = 'ParticleSystemComponent_' + id;
  var sprName  = 'SpriteComponent_' + id;
  var arrowNm  = 'ArrowComponent_' + id;
  var fxLoc    = { x: loc.x, y: loc.y, z: loc.z + cfg.fxOffsetZ };

  var lines = [
    '      Begin Actor Class=Emitter Name=' + name + " Archetype=Emitter'Engine.Default__Emitter'",
    '         Begin Object Class=ParticleSystemComponent Name=ParticleSystemComponent0 ObjName=' + psName +
      " Archetype=ParticleSystemComponent'Engine.Default__Emitter:ParticleSystemComponent0'",
    '            Template=' + machine.particle,
    '            bJustAttached=True',
    '            OldPosition=' + vec(fxLoc),
    '            ReplacementPrimitive=None',
    '            MaxDrawDistance=3600.000000',
    '            CachedMaxDrawDistance=3600.000000',
    '            LightingChannels=(bInitialized=True,Dynamic=True)',
    '            Scale=30.000000',
    '            Name="' + psName + '"',
    "            ObjectArchetype=ParticleSystemComponent'Engine.Default__Emitter:ParticleSystemComponent0'",
    '         End Object',
    '         Begin Object Class=SpriteComponent Name=Sprite ObjName=' + sprName +
      " Archetype=SpriteComponent'Engine.Default__Emitter:Sprite'",
    "            Sprite=Texture2D'EditorResources.S_Emitter'",
    '            bIsScreenSizeScaled=True',
    '            ScreenSize=0.002500',
    '            ReplacementPrimitive=None',
    '            HiddenGame=True',
    '            AlwaysLoadOnClient=False',
    '            AlwaysLoadOnServer=False',
    '            LightingChannels=(bInitialized=True,Dynamic=True)',
    '            Name="' + sprName + '"',
    "            ObjectArchetype=SpriteComponent'Engine.Default__Emitter:Sprite'",
    '         End Object',
    '         Begin Object Class=ArrowComponent Name=ArrowComponent0 ObjName=' + arrowNm +
      " Archetype=ArrowComponent'Engine.Default__Emitter:ArrowComponent0'",
    '            ArrowColor=(B=128,G=255,R=0,A=255)',
    '            ArrowSize=1.500000',
    '            bTreatAsASprite=True',
    '            ReplacementPrimitive=None',
    '            LightingChannels=(bInitialized=True,Dynamic=True)',
    '            Name="' + arrowNm + '"',
    "            ObjectArchetype=ArrowComponent'Engine.Default__Emitter:ArrowComponent0'",
    '         End Object',
    "         ParticleSystemComponent=ParticleSystemComponent'" + psName + "'",
    "         Components(0)=SpriteComponent'" + sprName + "'",
    "         Components(1)=ParticleSystemComponent'" + psName + "'",
    "         Components(2)=ArrowComponent'" + arrowNm + "'",
    '         Location=' + vec(fxLoc),
    '         Rotation=(Pitch=0,Yaw=' + cfg.fxYaw + ',Roll=32768)',
    '         DrawScale=0.700000',
    '         Tag="Emitter"',
  ];

  if (cfg.fxGroup) {
    lines.push('         Group="' + cfg.fxGroup + '"');
  }
  lines.push('         Name="' + name + '"');
  lines.push("         ObjectArchetype=Emitter'Engine.Default__Emitter'");
  lines.push('      End Actor');

  return lines.join('\n');
}

function buildPlacements(cfg) {
  var picked = MACHINES.filter(function(m) { return boolVal(m.useId); });
  return picked.map(function(m, i) {
    var loc = { x: cfg.baseX, y: cfg.baseY, z: cfg.baseZ };
    if (cfg.axis === 'x') loc.x += cfg.spacing * i;
    else                  loc.y += cfg.spacing * i;
    return { machine: m, cost: intVal(m.costId, 0), loc: loc };
  });
}

function buildT3D(placements, cfg) {
  var actors = [];
  placements.forEach(function(p, i) {
    actors.push(buildVolume(p.machine, p.cost, p.loc, cfg.half, i, cfg));
  });
  if (cfg.useEmitter) {
    placements.forEach(function(p, i) {
      actors.push(buildEmitter(p.machine, p.loc, i, cfg));
    });
  }
  return ['Begin Map', '   Begin Level']
    .concat(actors)
    .concat(['   End Level', 'Begin Surface', 'End Surface', 'End Map'])
    .join('\n');
}

// ─── 预览（俯视 XY） ──────────────────────────────────────────────────────────

function drawPreview(placements, cfg) {
  var rect  = previewEl.getBoundingClientRect();
  var ratio = window.devicePixelRatio || 1;
  previewEl.width  = Math.max(1, Math.round(rect.width  * ratio));
  previewEl.height = Math.max(1, Math.round(rect.height * ratio));

  var ctx = previewEl.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, rect.width, rect.height);

  if (placements.length === 0) return;

  // 相对基准坐标作图，避免世界坐标过大导致精度问题
  var offs = placements.map(function(p) {
    return { x: p.loc.x - cfg.baseX, y: p.loc.y - cfg.baseY };
  });

  var pad = 34;
  var spanX = Math.max.apply(null, offs.map(function(o) { return Math.abs(o.x) + cfg.half.x; }));
  var spanY = Math.max.apply(null, offs.map(function(o) { return Math.abs(o.y) + cfg.half.y; }));
  var span  = Math.max(spanX, spanY, 1);
  var scale = Math.min(
    (rect.width  - pad * 2) / (span * 2),
    (rect.height - pad * 2) / (span * 2)
  );
  var cx = rect.width / 2;
  var cy = rect.height / 2;

  // 十字参考线（基准坐标）
  ctx.strokeStyle = '#e3e6f2';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, cy); ctx.lineTo(rect.width - pad, cy);
  ctx.moveTo(cx, pad); ctx.lineTo(cx, rect.height - pad);
  ctx.stroke();

  placements.forEach(function(p, i) {
    var x = cx + offs[i].x * scale;
    var y = cy + offs[i].y * scale;
    var w = cfg.half.x * 2 * scale;
    var hgt = cfg.half.y * 2 * scale;

    ctx.fillStyle   = p.machine.color + '33';
    ctx.strokeStyle = p.machine.color;
    ctx.lineWidth = 1.5;
    ctx.fillRect(x - w / 2, y - hgt / 2, w, hgt);
    ctx.strokeRect(x - w / 2, y - hgt / 2, w, hgt);

    ctx.fillStyle = p.machine.color;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2c2f3a';
    ctx.font = 'bold 10px "Segoe UI", sans-serif';
    ctx.fillText(p.machine.label, x + 8, y - 6);
    ctx.fillStyle = '#888';
    ctx.font = '9px "Segoe UI", sans-serif';
    ctx.fillText(p.machine.machineType, x + 8, y + 6);
  });
}

// ─── 配置读取与校验 ───────────────────────────────────────────────────────────

function readConfig() {
  var cfg = {
    baseX:       numVal('base-x', 0),
    baseY:       numVal('base-y', 0),
    baseZ:       numVal('base-z', 0),
    spacing:     numVal('spacing', 300),
    axis:        $('spacing-axis').value,
    half: {
      x: numVal('half-x', 90),
      y: numVal('half-y', 90),
      z: numVal('half-z', 128),
    },
    useEmitter:  boolVal('use-emitter'),
    fxOffsetZ:   numVal('fx-offset-z', 0),
    fxYaw:       intVal('fx-yaw', 0),
    fxGroup:     $('fx-group').value.trim(),
    volumeStart: intVal('volume-start', 0),
    emitterStart: intVal('emitter-start', 0),
  };

  if (!Number.isFinite(cfg.baseX) || !Number.isFinite(cfg.baseY) || !Number.isFinite(cfg.baseZ)) {
    throw new Error('基准坐标必须是有效数值。');
  }
  if (!Number.isFinite(cfg.spacing)) {
    throw new Error('间距必须是有效数值。');
  }
  if (!(cfg.half.x > 0) || !(cfg.half.y > 0) || !(cfg.half.z > 0)) {
    throw new Error('触发盒半径必须全部大于 0。');
  }
  if (!Number.isInteger(cfg.volumeStart) || cfg.volumeStart < 0) {
    throw new Error('Volume 起始序号必须是非负整数。');
  }
  if (!Number.isInteger(cfg.emitterStart) || cfg.emitterStart < 0) {
    throw new Error('Emitter 起始序号必须是非负整数。');
  }
  if (!MACHINES.some(function(m) { return boolVal(m.useId); })) {
    throw new Error('至少勾选一种补给点类型。');
  }
  var bad = MACHINES.filter(function(m) { return boolVal(m.useId); })
    .find(function(m) { var c = numVal(m.costId, 0); return !Number.isFinite(c) || c < 0; });
  if (bad) {
    throw new Error(bad.label + ' 的 Cost 必须是不小于 0 的数值。');
  }

  return cfg;
}

// ─── 坐标粘贴解析 ─────────────────────────────────────────────────────────────
// 接受整段对象 T3D、单行 Location=(X=..,Y=..,Z=..)、(X=1,Y=2,Z=3)、x=1 y=2 z=3、1,2,3。

var NUM = '(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)';
var TRIPLE = '\\(\\s*X\\s*=\\s*' + NUM + '\\s*,\\s*Y\\s*=\\s*' + NUM + '\\s*,\\s*Z\\s*=\\s*' + NUM + '\\s*\\)';

function parseCoord(text) {
  if (!text) return null;

  // ① Actor 的 Location=(X=..,Y=..,Z=..)：整段 T3D 里唯一可靠的世界坐标
  //    （组件内的 OldPosition / Origin / Vertex 等都不叫 Location,不会误命中）。
  //    粘进多个 Actor 时取第一个。
  var m = new RegExp('\\bLocation\\s*=\\s*' + TRIPLE).exec(text);
  if (m) {
    return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
  }

  // ② 裸的 (X=..,Y=..,Z=..)
  m = new RegExp(TRIPLE).exec(text);
  if (m) {
    return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
  }

  // ③ 松散的 x= / y= / z=（各取第一个）
  var named = {};
  var re = new RegExp('\\b([xyz])\\s*=\\s*' + NUM, 'gi');
  while ((m = re.exec(text)) !== null) {
    var key = m[1].toLowerCase();
    if (named[key] === undefined) named[key] = Number(m[2]);
  }
  if (Number.isFinite(named.x) && Number.isFinite(named.y) && Number.isFinite(named.z)) {
    return named;
  }

  // ④ 纯三个数字
  var nums = text.match(new RegExp(NUM, 'g'));
  if (nums && nums.length >= 3) {
    return { x: Number(nums[0]), y: Number(nums[1]), z: Number(nums[2]) };
  }
  return null;
}

function coordText(c) {
  return '(X=' + c.x + ',Y=' + c.y + ',Z=' + c.z + ')';
}

// normalize=true（粘贴时）：解析成功后把输入框内容替换成纯坐标,丢掉 T3D 其余内容。
// normalize=false（逐字输入时）：只解析不改写,解析不出来就静默等下一个字符。
function applyPastedCoord(normalize) {
  var el  = $('paste-coord');
  var raw = el.value.trim();
  if (!raw) return;
  var c = parseCoord(raw);
  if (!c) {
    if (normalize) setStatus('无法从粘贴内容中提取出 X/Y/Z 坐标。', 'err');
    return;
  }
  $('base-x').value = c.x;
  $('base-y').value = c.y;
  $('base-z').value = c.z;

  var trimmed = false;
  if (normalize && raw !== coordText(c)) {
    el.value = coordText(c);
    trimmed = true;
  }

  generate(false);
  setStatus(
    '已提取坐标 (X=' + c.x + ', Y=' + c.y + ', Z=' + c.z + ')' +
    (trimmed ? '，已清除粘贴内容中的其余部分。' : '。'),
    'ok'
  );
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────

function syncRowHighlight() {
  MACHINES.forEach(function(m) {
    $(m.rowId).classList.toggle('on', boolVal(m.useId));
  });
}

function generate(showSuccess) {
  syncRowHighlight();
  try {
    var cfg        = readConfig();
    var placements = buildPlacements(cfg);
    var t3d        = buildT3D(placements, cfg);

    outputEl.value = t3d;

    var actorCount = placements.length * (cfg.useEmitter ? 2 : 1);
    $('output-count').textContent  = actorCount + ' 个 Actor';
    $('preview-label').textContent = placements.length + ' 个补给点';

    drawPreview(placements, cfg);

    if (showSuccess) {
      setStatus(
        '已生成 ' + placements.length + ' 个补给点（' +
        placements.map(function(p) { return p.machine.label; }).join('、') + '）' +
        (cfg.useEmitter ? ' + ' + placements.length + ' 个提示 Emitter' : '') + '。',
        'ok'
      );
    }
  } catch (err) {
    outputEl.value = '';
    $('output-count').textContent  = '0 个 Actor';
    $('preview-label').textContent = '俯视预览';
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
  var keys = MACHINES.filter(function(m) { return boolVal(m.useId); })
    .map(function(m) { return m.key; }).join('-');
  var blob = new Blob([outputEl.value], { type: 'text/plain;charset=utf-8' });
  var url  = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href     = url;
  link.download = 'PVEVendingMachineVolume_' + (keys || 'none') + '.t3d';
  link.click();
  URL.revokeObjectURL(url);
  setStatus('T3D 文件已保存。', 'ok');
}

// ─── 事件绑定 ─────────────────────────────────────────────────────────────────

document.querySelectorAll('.controls input[type="number"]').forEach(function(el) {
  el.addEventListener('input', function() { generate(false); });
});

document.querySelectorAll('.controls input[type="checkbox"]').forEach(function(el) {
  el.addEventListener('change', function() { generate(false); });
});

$('spacing-axis').addEventListener('change', function() { generate(false); });
$('fx-group').addEventListener('input', function() { generate(false); });

// 逐字输入时只解析不改写；粘贴 / 拖放 / 失焦时把输入框收敛成纯坐标。
$('paste-coord').addEventListener('input', function() { applyPastedCoord(false); });
$('paste-coord').addEventListener('paste', function() {
  setTimeout(function() { applyPastedCoord(true); }, 0);
});
$('paste-coord').addEventListener('drop', function() {
  setTimeout(function() { applyPastedCoord(true); }, 0);
});
$('paste-coord').addEventListener('blur', function() { applyPastedCoord(true); });

$('generate-btn').addEventListener('click', function() { generate(true); });
$('copy-btn').addEventListener('click', copyOutput);
$('save-btn').addEventListener('click', saveOutput);
window.addEventListener('resize', function() { generate(false); });

// 初始渲染
generate(false);
