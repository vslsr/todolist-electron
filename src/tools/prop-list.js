// 属性列表生成 —— 提取地图中的所有 Actor，拼成属性面板可粘贴的字符串：
//   <属性> (类'关卡路径.名字',类'关卡路径.名字',…)

const $ = (id) => document.getElementById(id);
const inputEl  = $('input');
const outputEl = $('output');
const statusEl = $('status');

// 解析顶层 Actor（跳过内部 Begin Object）
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

function updateInCount() {
  $('in-count').textContent = `${parseActors(inputEl.value).length} 个对象`;
}

function generate() {
  const items = parseActors(inputEl.value);
  if (items.length === 0) {
    outputEl.value = '';
    $('out-count').textContent = '';
    setStatus('未找到任何 Actor（需要 "Begin Actor Class=… Name=…" 行）。', 'err');
    return;
  }

  const prop  = $('prop').value.trim();
  let   level = $('level').value.trim().replace(/\.$/, ''); // 去掉尾部多余的点

  const refs = items.map(it => `${it.cls}'${level}.${it.name}'`);
  outputEl.value = `${prop} (${refs.join(',')})`;
  $('out-count').textContent = `${items.length} 项`;
  setStatus(`已生成 ${items.length} 个对象引用。`, 'ok');
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
