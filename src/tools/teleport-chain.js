// Teleport 链生成 —— 为每个对象生成一个 SeqAct_Teleport 与一个 PVESeqVar_Player，
// 按输入顺序串成链，最后一个连向可配置终点。
//
// 支持两种输入：
//   1) SeqVar_Object 列表 —— 直接使用，并在末尾附带原始块。
//   2) 地图 Actor（Begin Actor Class=… Name=…）—— 为每个 Actor 自动新建 SeqVar_Object
//      （ObjValue=Class'Name'，系统化排布），再生成链。

const $ = (id) => document.getElementById(id);
const inputEl  = $('input');
const outputEl = $('output');
const statusEl = $('status');

// 系统化布局常量（相对每个 SeqVar_Object 的位置推导）
const TELE_DX = -104;   // Teleport.X = SeqVar.X + TELE_DX
const TELE_Y  = 704;    // Teleport 所在行 Y
const PLAYER_DX = -120; // Player.X = SeqVar.X + PLAYER_DX
const PLAYER_Y  = 784;  // Player 所在行 Y
const VX0_OFF = 42;     // VariableLinks(0) DrawX = Teleport.X + 42
const VX1_OFF = 128;    // VariableLinks(1) DrawX = Teleport.X + 128
const DRAWY_OFF = 34;   // InputLinks/OutputLinks DrawY = Teleport.Y + 34
const SEQVAR_Y = 880;   // Actor 模式下新建 SeqVar_Object 的行 Y

// 解析所有 SeqVar_Object 块
function parseSeqVars(text) {
  const re = /Begin\s+Object\s+Class=SeqVar_Object\s+Name=(\S+)([\s\S]*?)End\s+Object/gi;
  const items = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    const body = m[2];
    const grab = (key) => {
      const r = new RegExp('^[ \\t]*' + key + '=(.+)$', 'm').exec(body);
      return r ? r[1].trim() : null;
    };
    const x = parseInt(grab('ObjPosX') || '0', 10);
    const y = parseInt(grab('ObjPosY') || '0', 10);
    let parent = grab('ParentSequence');       // e.g. Sequence'Main_Sequence'
    if (parent) {
      const pm = /'([^']+)'/.exec(parent);
      parent = pm ? pm[1] : parent;
    }
    items.push({ name, x, y, parent, block: m[0] });
  }
  return items;
}

// 解析地图中的顶层 Actor（跳过内部 Begin Object）
function parseActors(text) {
  const re = /^[ \t]*Begin\s+Actor\s+Class=([^\s]+)\s+Name=([^\s]+)/gim;
  const items = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    items.push({ cls: m[1], name: m[2] });
  }
  return items;
}

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

// 输入统计：SeqVar_Object 优先，否则回退到 Actor
function countInput() {
  const sv = parseSeqVars(inputEl.value).length;
  if (sv) return { n: sv, mode: 'SeqVar_Object' };
  const ac = parseActors(inputEl.value).length;
  return { n: ac, mode: ac ? 'Actor' : '' };
}

function updateInCount() {
  const c = countInput();
  $('in-count').textContent = c.mode ? `${c.n} 个${c.mode}` : '0 个对象';
}

function buildTeleport(o) {
  const dy = TELE_Y + DRAWY_OFF;
  const outLink = o.nextRef
    ? `(Links=((LinkedOp=${o.nextRef})),DrawY=${dy})`
    : `(DrawY=${dy})`;
  return [
    `Begin Object Class=SeqAct_Teleport Name=SeqAct_Teleport_${o.teleId}`,
    `   InputLinks(0)=(DrawY=${dy})`,
    `   OutputLinks(0)=${outLink}`,
    `   VariableLinks(0)=(LinkedVariables=(PVESeqVar_Player'PVESeqVar_Player_${o.playerId}'),DrawX=${o.teleX + VX0_OFF})`,
    `   VariableLinks(1)=(LinkedVariables=(SeqVar_Object'${o.name}'),DrawX=${o.teleX + VX1_OFF})`,
    `   VariableLinks(2)=()`,
    `   ObjInstanceVersion=2`,
    `   ParentSequence=Sequence'${o.parent}'`,
    `   ObjPosX=${o.teleX}`,
    `   ObjPosY=${TELE_Y}`,
    `   DrawWidth=188`,
    `   DrawHeight=63`,
    `   Name="SeqAct_Teleport_${o.teleId}"`,
    `   ObjectArchetype=SeqAct_Teleport'Engine.Default__SeqAct_Teleport'`,
    `End Object`,
  ].join('\n');
}

function buildPlayer(o) {
  const lines = [
    `Begin Object Class=PVESeqVar_Player Name=PVESeqVar_Player_${o.playerId}`,
    `   bAllPlayers=False`,
    `   bExcludeSpectatingPlayers=True`,
  ];
  if (o.playerIdx > 0) lines.push(`   PlayerIdx=${o.playerIdx}`);
  lines.push(
    `   ObjInstanceVersion=1`,
    `   ParentSequence=Sequence'${o.parent}'`,
    `   ObjPosX=${o.playerX}`,
    `   ObjPosY=${PLAYER_Y}`,
    `   DrawWidth=32`,
    `   DrawHeight=32`,
    `   Name="PVESeqVar_Player_${o.playerId}"`,
    `   ObjectArchetype=PVESeqVar_Player'PVEGame.Default__PVESeqVar_Player'`,
    `End Object`,
  );
  return lines.join('\n');
}

// Actor 模式下新建 SeqVar_Object 块
function buildSeqVar(o) {
  return [
    `Begin Object Class=SeqVar_Object Name=${o.name}`,
    `   ObjValue=${o.objValue}`,
    `   ObjInstanceVersion=1`,
    `   ParentSequence=Sequence'${o.parent}'`,
    `   ObjPosX=${o.x}`,
    `   ObjPosY=${o.y}`,
    `   DrawWidth=32`,
    `   DrawHeight=32`,
    `   Name="${o.name}"`,
    `   ObjectArchetype=SeqVar_Object'Engine.Default__SeqVar_Object'`,
    `End Object`,
  ].join('\n');
}

function generate() {
  const text = inputEl.value;
  const parentField = $('parent-seq').value.trim();

  // 选择输入模式
  let items = parseSeqVars(text);
  let mode = 'seqvar';
  if (items.length === 0) {
    const actors = parseActors(text);
    if (actors.length === 0) {
      outputEl.value = '';
      $('out-count').textContent = '';
      setStatus('未找到 SeqVar_Object 块或 Actor。', 'err');
      return;
    }
    mode = 'actor';
    const parentSeq = parentField || 'Main_Sequence';
    const seqStartId = parseInt($('seqvar-start').value, 10) || 0;
    const seqStartX  = parseInt($('seqvar-x').value, 10) || 3696;
    const gap        = parseInt($('seqvar-gap').value, 10) || 272;
    items = actors.map((a, i) => ({
      name: `SeqVar_Object_${seqStartId + i}`,
      x: seqStartX + i * gap,
      y: SEQVAR_Y,
      parent: parentSeq,
      objValue: `${a.cls}'${a.name}'`,
    }));
  }

  const teleStart   = parseInt($('tele-start').value, 10)   || 0;
  const playerStart = parseInt($('player-start').value, 10) || 0;
  const terminal    = $('terminal').value.trim();
  const parentSeq   = parentField || items[0].parent || 'Main_Sequence';

  // 为每一项分配 ID、位置、链接
  const nodes = items.map((it, i) => ({
    name: it.name,
    parent: parentSeq,
    teleId: teleStart + i,
    playerId: playerStart + i,
    playerIdx: i,
    teleX: it.x + TELE_DX,
    playerX: it.x + PLAYER_DX,
  }));

  nodes.forEach((n, i) => {
    n.nextRef = (i < nodes.length - 1)
      ? `SeqAct_Teleport'SeqAct_Teleport_${nodes[i + 1].teleId}'`
      : (terminal || null);
  });

  const teleports = nodes.map(buildTeleport);
  const players   = nodes.map(buildPlayer);
  const seqvars   = (mode === 'actor')
    ? items.map(buildSeqVar)          // 新建的 SeqVar_Object
    : items.map(it => it.block.trim()); // 原样附带

  outputEl.value = [...teleports, ...players, ...seqvars].join('\n');
  $('out-count').textContent = `${nodes.length}×2 + ${seqvars.length} 项`;

  const src = mode === 'actor' ? `${nodes.length} 个 Actor（已新建 SeqVar_Object）` : `${nodes.length} 个 SeqVar_Object`;
  setStatus(`已从 ${src} 生成链（链尾${terminal ? '→ ' + terminal : '不连出'}）。`, 'ok');
}

$('gen-btn').addEventListener('click', generate);

$('copy-btn').addEventListener('click', () => {
  if (!outputEl.value) { setStatus('没有可复制的结果。', 'err'); return; }
  navigator.clipboard.writeText(outputEl.value)
    .then(() => setStatus('已复制到剪贴板。', 'ok'))
    .catch(() => { outputEl.select(); document.execCommand('copy'); setStatus('已复制到剪贴板。', 'ok'); });
});

$('clear-btn').addEventListener('click', () => {
  inputEl.value = '';
  outputEl.value = '';
  $('out-count').textContent = '';
  updateInCount();
  setStatus('已清空。', '');
  inputEl.focus();
});

inputEl.addEventListener('input', updateInCount);
