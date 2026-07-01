// 对象列表合并 —— 解析 T3D 地图文本中的所有 Actor，合并为一个 SeqVar_ObjectList。

const $ = (id) => document.getElementById(id);
const inputEl  = $('input');
const outputEl = $('output');
const statusEl = $('status');

// 提取顶层 Actor：Begin Actor Class=<Class> Name=<Name> ...
// 只匹配 "Begin Actor"（不匹配内部的 "Begin Object"），避免抓到子组件。
function parseActors(text) {
  const re = /^[ \t]*Begin\s+Actor\s+Class=([^\s]+)\s+Name=([^\s]+)/gim;
  const items = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    items.push({ cls: m[1], name: m[2] });
  }
  return items;
}

function buildOutput(items, varName, parentSeq) {
  const lines = [];
  lines.push(`Begin Object Class=SeqVar_ObjectList Name=${varName}`);
  items.forEach((it, i) => {
    lines.push(`   ObjList(${i})=${it.cls}'${it.name}'`);
  });
  lines.push(`   ObjInstanceVersion=1`);
  lines.push(`   ParentSequence=Sequence'${parentSeq}'`);
  lines.push(`   ObjPosX=1632`);
  lines.push(`   ObjPosY=1112`);
  lines.push(`   DrawWidth=32`);
  lines.push(`   DrawHeight=32`);
  lines.push(`   Name="${varName}"`);
  lines.push(`   ObjectArchetype=SeqVar_ObjectList'Engine.Default__SeqVar_ObjectList'`);
  lines.push(`End Object`);
  return lines.join('\n');
}

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

function updateInCount() {
  const n = parseActors(inputEl.value).length;
  $('in-count').textContent = `${n} 个对象`;
}

function generate() {
  const items = parseActors(inputEl.value);
  if (items.length === 0) {
    outputEl.value = '';
    $('out-count').textContent = '';
    setStatus('未找到任何 Actor（需要 "Begin Actor Class=… Name=…" 行）。', 'err');
    return;
  }

  const varName   = $('var-name').value.trim()  || 'SeqVar_ObjectList_0';
  const parentSeq = $('parent-seq').value.trim() || 'RoomA_Working';
  if ($('reverse').checked) items.reverse();

  outputEl.value = buildOutput(items, varName, parentSeq);
  $('out-count').textContent = `${items.length} 项`;
  setStatus(`已合并 ${items.length} 个对象为 ${varName}。`, 'ok');
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
