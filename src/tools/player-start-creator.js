const $ = (id) => document.getElementById(id);

const outputEl = $('output');
const statusEl = $('status');
const previewEl = $('preview');

function setStatus(message, kind = '') {
  statusEl.textContent = message;
  statusEl.className = `status${kind ? ` ${kind}` : ''}`;
}

function selectedShape() {
  const primary = document.querySelector('input[name="shape"]:checked').value;
  return primary === 'other' ? $('other-shape').value : primary;
}

function numberValue(id, fallback = 0) {
  const value = Number($(id).value);
  return Number.isFinite(value) ? value : fallback;
}

function integerValue(id, fallback = 0) {
  return Math.trunc(numberValue(id, fallback));
}

function regularPolygonVertices(sides, radius, startAngle = -Math.PI / 2) {
  return Array.from({ length: sides }, (_, index) => {
    const angle = startAngle + index * Math.PI * 2 / sides;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

function samplePolyline(vertices, count, closed) {
  if (count === 1) return [{ x: vertices[0].x, y: vertices[0].y }];

  const segments = [];
  const segmentCount = closed ? vertices.length : vertices.length - 1;
  let totalLength = 0;

  for (let index = 0; index < segmentCount; index += 1) {
    const from = vertices[index];
    const to = vertices[(index + 1) % vertices.length];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    segments.push({ from, to, start: totalLength, length });
    totalLength += length;
  }

  return Array.from({ length: count }, (_, index) => {
    const distance = closed
      ? index * totalLength / count
      : index * totalLength / (count - 1);
    const segment = segments.find((item) => distance <= item.start + item.length) || segments[segments.length - 1];
    const progress = segment.length ? (distance - segment.start) / segment.length : 0;
    return {
      x: segment.from.x + (segment.to.x - segment.from.x) * progress,
      y: segment.from.y + (segment.to.y - segment.from.y) * progress,
    };
  });
}

function createOffsets(shape, count, size, polygonSides) {
  if (shape === 'circle') {
    return Array.from({ length: count }, (_, index) => {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
      return { x: Math.cos(angle) * size, y: Math.sin(angle) * size };
    });
  }

  if (shape === 'line') {
    if (count === 1) return [{ x: 0, y: 0 }];
    return Array.from({ length: count }, (_, index) => ({
      x: -size + index * size * 2 / (count - 1),
      y: 0,
    }));
  }

  if (shape === 'square') {
    return samplePolyline([
      { x: -size, y: -size },
      { x: size, y: -size },
      { x: size, y: size },
      { x: -size, y: size },
    ], count, true);
  }

  const sides = shape === 'triangle' ? 3 : polygonSides;
  return samplePolyline(regularPolygonVertices(sides, size), count, true);
}

function normalizeYaw(value) {
  let normalized = Math.round(value) % 65536;
  if (normalized > 32767) normalized -= 65536;
  if (normalized < -32768) normalized += 65536;
  return normalized;
}

function calculateYaw(point, mode, fixedYaw, offset) {
  if (mode === 'fixed') return normalizeYaw(fixedYaw + offset);

  let angle = Math.atan2(point.y, point.x);
  if (mode === 'inward') angle += Math.PI;
  if (mode === 'tangent') angle += Math.PI / 2;
  return normalizeYaw(angle * 65536 / (Math.PI * 2) + offset);
}

function formatCoordinate(value) {
  const normalized = Math.abs(value) < 0.0000005 ? 0 : value;
  return normalized.toFixed(6);
}

function navGuid(actorId, x, y) {
  let seed = (actorId ^ Math.round(x * 10) ^ Math.imul(Math.round(y * 10), 31)) | 0;
  if (seed === 0) seed = 0x6d2b79f5;
  return Array.from({ length: 4 }, () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed |= 0;
    return seed;
  });
}

function buildActor(actor, nextActorName) {
  const suffix = actor.id;
  const collisionName = `CylinderComponent_${suffix}`;
  const spriteName = `SpriteComponent_${suffix * 2}`;
  const sprite2Name = `SpriteComponent_${suffix * 2 + 1}`;
  const arrowName = `ArrowComponent_${suffix}`;
  const pathName = `PathRenderingComponent_${suffix}`;
  const guid = navGuid(actor.id, actor.x, actor.y);
  const nextLine = nextActorName
    ? `         nextNavigationPoint=UTTeamPlayerStart'${nextActorName}'`
    : null;

  return [
    `      Begin Actor Class=UTTeamPlayerStart Name=${actor.name} Archetype=UTTeamPlayerStart'UTGame.Default__UTTeamPlayerStart'`,
    `         Begin Object Class=CylinderComponent Name=CollisionCylinder ObjName=${collisionName} Archetype=CylinderComponent'UTGame.Default__UTTeamPlayerStart:CollisionCylinder'`,
    '            CollisionHeight=48.000000',
    '            CollisionRadius=40.000000',
    '            ReplacementPrimitive=None',
    '            LightingChannels=(bInitialized=True,Dynamic=True)',
    `            Name="${collisionName}"`,
    "            ObjectArchetype=CylinderComponent'UTGame.Default__UTTeamPlayerStart:CollisionCylinder'",
    '         End Object',
    `         Begin Object Class=SpriteComponent Name=Sprite ObjName=${spriteName} Archetype=SpriteComponent'UTGame.Default__UTTeamPlayerStart:Sprite'`,
    '            SpriteCategoryName="Navigation"',
    "            Sprite=Texture2D'EditorResources.S_Player'",
    '            ReplacementPrimitive=None',
    '            HiddenGame=True',
    '            AlwaysLoadOnClient=False',
    '            AlwaysLoadOnServer=False',
    '            LightingChannels=(bInitialized=True,Dynamic=True)',
    `            Name="${spriteName}"`,
    "            ObjectArchetype=SpriteComponent'UTGame.Default__UTTeamPlayerStart:Sprite'",
    '         End Object',
    `         Begin Object Class=SpriteComponent Name=Sprite2 ObjName=${sprite2Name} Archetype=SpriteComponent'UTGame.Default__UTTeamPlayerStart:Sprite2'`,
    '            SpriteCategoryName="Navigation"',
    "            Sprite=Texture2D'EditorResources.Bad'",
    '            ReplacementPrimitive=None',
    '            HiddenGame=True',
    '            HiddenEditor=True',
    '            AlwaysLoadOnClient=False',
    '            AlwaysLoadOnServer=False',
    '            LightingChannels=(bInitialized=True,Dynamic=True)',
    '            Scale=0.250000',
    `            Name="${sprite2Name}"`,
    "            ObjectArchetype=SpriteComponent'UTGame.Default__UTTeamPlayerStart:Sprite2'",
    '         End Object',
    `         Begin Object Class=ArrowComponent Name=Arrow ObjName=${arrowName} Archetype=ArrowComponent'UTGame.Default__UTTeamPlayerStart:Arrow'`,
    '            ArrowColor=(B=255,G=200,R=150,A=255)',
    '            ArrowSize=0.500000',
    '            bTreatAsASprite=True',
    '            SpriteCategoryName="Navigation"',
    '            ReplacementPrimitive=None',
    '            LightingChannels=(bInitialized=True,Dynamic=True)',
    `            Name="${arrowName}"`,
    "            ObjectArchetype=ArrowComponent'UTGame.Default__UTTeamPlayerStart:Arrow'",
    '         End Object',
    `         Begin Object Class=PathRenderingComponent Name=PathRenderer ObjName=${pathName} Archetype=PathRenderingComponent'UTGame.Default__UTTeamPlayerStart:PathRenderer'`,
    '            ReplacementPrimitive=None',
    '            LightingChannels=(bInitialized=True,Dynamic=True)',
    `            Name="${pathName}"`,
    "            ObjectArchetype=PathRenderingComponent'UTGame.Default__UTTeamPlayerStart:PathRenderer'",
    '         End Object',
    '         bPathsChanged=True',
    '         visitedWeight=10000000',
    nextLine,
    `         CylinderComponent=CylinderComponent'${collisionName}'`,
    '         MaxPathSize=(Radius=260.000000,Height=100.000000)',
    `         NavGuid=(A=${guid[0]},B=${guid[1]},C=${guid[2]},D=${guid[3]})`,
    `         Components(0)=SpriteComponent'${spriteName}'`,
    `         Components(1)=SpriteComponent'${sprite2Name}'`,
    `         Components(2)=ArrowComponent'${arrowName}'`,
    `         Components(3)=CylinderComponent'${collisionName}'`,
    `         Components(4)=PathRenderingComponent'${pathName}'`,
    `         Location=(X=${formatCoordinate(actor.x)},Y=${formatCoordinate(actor.y)},Z=${formatCoordinate(actor.z)})`,
    `         Rotation=(Pitch=0,Yaw=${actor.yaw},Roll=0)`,
    '         Tag="UTTeamPlayerStart"',
    `         CollisionComponent=CylinderComponent'${collisionName}'`,
    `         Name="${actor.name}"`,
    "         ObjectArchetype=UTTeamPlayerStart'UTGame.Default__UTTeamPlayerStart'",
    '      End Actor',
  ].filter(Boolean).join('\n');
}

function currentConfiguration() {
  const count = integerValue('count', 8);
  const size = numberValue('size', 600);
  const polygonSides = integerValue('polygon-sides', 5);
  const startId = integerValue('start-id', 0);

  if (count < 1 || count > 256) throw new Error('出生点数量必须在 1 到 256 之间。');
  if (size <= 0) throw new Error('范围半径 / 半边长必须大于 0。');
  if (polygonSides < 3 || polygonSides > 32) throw new Error('正多边形边数必须在 3 到 32 之间。');
  if (startId < 0) throw new Error('Actor 起始 ID 不能小于 0。');

  return {
    shape: selectedShape(),
    count,
    size,
    polygonSides,
    startId,
    centerX: numberValue('center-x'),
    centerY: numberValue('center-y'),
    centerZ: numberValue('center-z'),
    rotationMode: $('rotation-mode').value,
    fixedYaw: integerValue('fixed-yaw', -4096),
    yawOffset: integerValue('yaw-offset', 0),
  };
}

function createActors(config) {
  return createOffsets(config.shape, config.count, config.size, config.polygonSides)
    .map((offset, index) => ({
      id: config.startId + index,
      name: `UTTeamPlayerStart_${config.startId + index}`,
      x: config.centerX + offset.x,
      y: config.centerY + offset.y,
      z: config.centerZ,
      yaw: calculateYaw(offset, config.rotationMode, config.fixedYaw, config.yawOffset),
      offset,
    }));
}

function buildT3d(actors) {
  const blocks = actors.map((actor, index) => buildActor(actor, actors[index + 1]?.name));
  return [
    'Begin Map',
    '   Begin Level',
    ...blocks,
    '   End Level',
    'Begin Surface',
    'End Surface',
    'End Map',
  ].join('\n');
}

function drawArrow(context, x, y, angle, length) {
  const endX = x + Math.cos(angle) * length;
  const endY = y + Math.sin(angle) * length;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(endX, endY);
  context.stroke();
  context.beginPath();
  context.moveTo(endX, endY);
  context.lineTo(endX - Math.cos(angle - 0.55) * 5, endY - Math.sin(angle - 0.55) * 5);
  context.lineTo(endX - Math.cos(angle + 0.55) * 5, endY - Math.sin(angle + 0.55) * 5);
  context.closePath();
  context.fill();
}

function drawPreview(actors, config) {
  const rect = previewEl.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  previewEl.width = Math.max(1, Math.round(rect.width * ratio));
  previewEl.height = Math.max(1, Math.round(rect.height * ratio));
  const context = previewEl.getContext('2d');
  context.scale(ratio, ratio);
  context.clearRect(0, 0, rect.width, rect.height);

  const padding = 24;
  const maxOffset = Math.max(config.size, 1);
  const scale = Math.min((rect.width - padding * 2) / (maxOffset * 2), (rect.height - padding * 2) / (maxOffset * 2));
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;

  context.strokeStyle = '#e3e6f2';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(padding, centerY);
  context.lineTo(rect.width - padding, centerY);
  context.moveTo(centerX, padding);
  context.lineTo(centerX, rect.height - padding);
  context.stroke();

  if (actors.length > 1) {
    context.strokeStyle = '#aab1d2';
    context.setLineDash([4, 4]);
    context.beginPath();
    actors.forEach((actor, index) => {
      const x = centerX + actor.offset.x * scale;
      const y = centerY + actor.offset.y * scale;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    if (config.shape !== 'line') context.closePath();
    context.stroke();
    context.setLineDash([]);
  }

  actors.forEach((actor) => {
    const x = centerX + actor.offset.x * scale;
    const y = centerY + actor.offset.y * scale;
    context.fillStyle = '#667eea';
    context.beginPath();
    context.arc(x, y, 4, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#4a55aa';
    const yawAngle = actor.yaw * Math.PI * 2 / 65536;
    drawArrow(context, x, y, yawAngle, 14);
  });

  context.fillStyle = '#e15d5d';
  context.beginPath();
  context.arc(centerX, centerY, 3, 0, Math.PI * 2);
  context.fill();
}

function updateShapeFields() {
  const primary = document.querySelector('input[name="shape"]:checked').value;
  $('other-shape-field').classList.toggle('hidden', primary !== 'other');
  $('polygon-sides-field').classList.toggle('hidden', selectedShape() !== 'polygon');
}

function updateRotationFields() {
  $('fixed-yaw-field').classList.toggle('hidden', $('rotation-mode').value !== 'fixed');
}

function generate(showSuccess = true) {
  try {
    const config = currentConfiguration();
    const actors = createActors(config);
    outputEl.value = buildT3d(actors);
    $('output-count').textContent = `${actors.length} 个 Actor`;
    $('preview-label').textContent = `${actors.length} 个出生点`;
    drawPreview(actors, config);
    if (showSuccess) setStatus(`已生成 ${actors.length} 个 UTTeamPlayerStart。`, 'ok');
  } catch (error) {
    outputEl.value = '';
    $('output-count').textContent = '0 个 Actor';
    setStatus(error.message, 'err');
  }
}

function copyOutput() {
  if (!outputEl.value) {
    setStatus('没有可复制的 T3D。', 'err');
    return;
  }
  navigator.clipboard.writeText(outputEl.value)
    .then(() => setStatus('T3D 已复制到剪贴板。', 'ok'))
    .catch(() => {
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
  const blob = new Blob([outputEl.value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `UTTeamPlayerStart_${selectedShape()}_${integerValue('count', 0)}.t3d`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus('T3D 文件已保存。', 'ok');
}

document.querySelectorAll('input[name="shape"]').forEach((input) => {
  input.addEventListener('change', () => {
    updateShapeFields();
    generate(false);
  });
});

document.querySelectorAll('.controls input, .controls select').forEach((input) => {
  if (input.name === 'shape') return;
  input.addEventListener('input', () => {
    updateShapeFields();
    updateRotationFields();
    generate(false);
  });
});

$('generate-btn').addEventListener('click', () => generate(true));
$('copy-btn').addEventListener('click', copyOutput);
$('save-btn').addEventListener('click', saveOutput);
window.addEventListener('resize', () => generate(false));

updateShapeFields();
updateRotationFields();
generate(false);
