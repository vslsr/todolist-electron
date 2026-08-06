// 远程事件生成 —— 为每个 EventName 生成一对 Kismet 对象：
//   1) SeqAct_ActivateRemoteEvent —— 发送方，激活同名远程事件。
//   2) SeqEvent_RemoteEvent       —— 接收方，监听同名事件并连向可配置目标。
//
// 输入每行一个 EventName（支持批量），ID 自起始值递增，坐标系统化排布。
// 使用默认参数 + 单个 EventName 时，输出与参考模板完全一致。

const $ = (id) => document.getElementById(id);
const inputEl  = $('input');
const outputEl = $('output');
const statusEl = $('status');

// 由模板反推的布局偏移（DrawX/DrawY 相对 ObjPos 的固定量）
const EVT_DX = -16;     // Event.X  = Activate.X + EVT_DX
const EVT_DY = -160;    // Event.Y  = Activate.Y + EVT_DY
const ACT_LINK_DY = 34; // Activate 的 Input/Output DrawY = Activate.Y + 34
const ACT_VAR_DX  = 186;// Activate 的 VariableLinks DrawX = Activate.X + 186
const EVT_LINK_DY = 66; // Event 的 OutputLinks DrawY = Event.Y + 66
const EVT_VAR_DX  = 151;// Event 的 VariableLinks DrawX = Event.X + 151

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

// 解析输入：每行一个 EventName，去空白、剥掉包裹的引号、忽略空行
function parseEvents(text) {
  return text.split(/\r?\n/)
    .map(s => s.trim().replace(/^"(.*)"$/, '$1').trim())
    .filter(Boolean);
}

function updateInCount() {
  $('in-count').textContent = `${parseEvents(inputEl.value).length} 个事件`;
}

function buildActivate(o) {
  const dy = o.actY + ACT_LINK_DY;
  return [
    `Begin Object Class=SeqAct_ActivateRemoteEvent Name=SeqAct_ActivateRemoteEvent_${o.actId}`,
    `   EventName="${o.event}"`,
    `   InputLinks(0)=(DrawY=${dy})`,
    `   OutputLinks(0)=(DrawY=${dy})`,
    `   VariableLinks(0)=(DrawX=${o.actX + ACT_VAR_DX})`,
    `   ObjInstanceVersion=3`,
    `   ParentSequence=Sequence'${o.parent}'`,
    `   ObjPosX=${o.actX}`,
    `   ObjPosY=${o.actY}`,
    `   DrawWidth=373`,
    `   DrawHeight=63`,
    `   Name="SeqAct_ActivateRemoteEvent_${o.actId}"`,
    `   ObjectArchetype=SeqAct_ActivateRemoteEvent'Engine.Default__SeqAct_ActivateRemoteEvent'`,
    `End Object`,
  ].join('\n');
}

function buildEvent(o) {
  const dy = o.evtY + EVT_LINK_DY;
  const outLink = o.target
    ? `(Links=((LinkedOp=${o.target})),DrawY=${dy})`
    : `(DrawY=${dy})`;
  return [
    `Begin Object Class=SeqEvent_RemoteEvent Name=SeqEvent_RemoteEvent_${o.evtId}`,
    `   EventName="${o.event}"`,
    `   MaxWidth=303`,
    `   OutputLinks(0)=${outLink}`,
    `   VariableLinks(0)=(DrawX=${o.evtX + EVT_VAR_DX})`,
    `   ObjInstanceVersion=2`,
    `   ParentSequence=Sequence'${o.parent}'`,
    `   ObjPosX=${o.evtX}`,
    `   ObjPosY=${o.evtY}`,
    `   DrawWidth=173`,
    `   DrawHeight=130`,
    `   Name="SeqEvent_RemoteEvent_${o.evtId}"`,
    `   ObjectArchetype=SeqEvent_RemoteEvent'Engine.Default__SeqEvent_RemoteEvent'`,
    `End Object`,
  ].join('\n');
}

function generate() {
  const events = parseEvents(inputEl.value);
  if (events.length === 0) {
    outputEl.value = '';
    $('out-count').textContent = '';
    setStatus('请输入至少一个 EventName（每行一个）。', '');
    return;
  }

  const actStart = parseInt($('act-start').value, 10) || 0;
  const evtStart = parseInt($('evt-start').value, 10) || 0;
  const parent   = $('parent-seq').value.trim() || 'Main_Sequence';
  const posX     = parseInt($('pos-x').value, 10) || 0;
  const posY     = parseInt($('pos-y').value, 10) || 0;
  const gap      = parseInt($('gap').value, 10) || 0;
  const target   = $('target').value.trim();

  const blocks = [];
  events.forEach((event, i) => {
    const actX = posX;
    const actY = posY + i * gap;
    const o = {
      event,
      parent,
      target,
      actId: actStart + i,
      evtId: evtStart + i,
      actX,
      actY,
      evtX: actX + EVT_DX,
      evtY: actY + EVT_DY,
    };
    blocks.push(buildActivate(o), buildEvent(o));
  });

  outputEl.value = blocks.join('\n');
  $('out-count').textContent = `${events.length} 对 · ${blocks.length} 个对象`;
  setStatus(`已为 ${events.length} 个事件生成配对（Event ${target ? '→ ' + target : '不连出'}）。`, 'ok');
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

// 输入或参数变化时实时重算，保持输出同步
inputEl.addEventListener('input', () => { updateInCount(); generate(); });
['act-start', 'evt-start', 'parent-seq', 'pos-x', 'pos-y', 'gap', 'target']
  .forEach(id => $(id).addEventListener('input', generate));
