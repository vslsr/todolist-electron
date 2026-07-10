// 题库测验 —— 读取 question-bank/*.json，渲染答题并按 schema 判分反馈。
// 判分规则镜像 .claude/skills/exam-question-authoring/references/schema.md 的 "Grading semantics"：
//   · single_choice：所选 key 的集合 == correct:true 的 key 的集合
//   · fill_blank：逐空 normalize 后与 accept 匹配
//     normalize = 去首尾空白 + 折叠内部空白 + 全角转半角 +（非大小写敏感则转小写）

const $ = (id) => document.getElementById(id);
const bankSel   = $('bank-select');
const quizEl    = $('quiz');
const statusEl  = $('status');
const scoreEl   = $('score');
const submitBtn = $('submit-btn');
const retryBtn  = $('retry-btn');

let currentBank = null;
let items = [];        // [{ q, card }]
let submitted = false;

const setStatus = (m) => { statusEl.textContent = m || ''; };

// ---------- normalize + 判分 ----------
function normalize(s, caseSensitive) {
  let t = String(s == null ? '' : s).replace(/　/g, ' ').trim().replace(/\s+/g, ' ');
  t = t.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)); // 全角→半角
  if (!caseSensitive) t = t.toLowerCase();
  return t;
}

const correctKeysOf = (q) => (q.options || []).filter((o) => o.correct).map((o) => o.key).sort();

function gradeSingle(q, key) {
  const want = correctKeysOf(q);
  const got = key ? [key] : [];
  const ok = want.length === got.length && want.every((k, i) => k === got[i]);
  return { ok, want };
}

function gradeBlanks(q, answers) {
  const perBlank = (q.blanks || []).map((b) => {
    const u = normalize(answers[b.id], b.caseSensitive);
    const ok = u !== '' && (b.accept || []).some((a) => normalize(a, b.caseSensitive) === u);
    return { id: b.id, ok };
  });
  return { ok: perBlank.length > 0 && perBlank.every((x) => x.ok), perBlank };
}

// ---------- DOM 辅助 ----------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const DIFF = { easy: '简单', medium: '中等', hard: '困难' };

function renderStemInto(container, q) {
  if (q.type === 'fill_blank') {
    String(q.stem).split(/(\{\{\d+\}\})/).forEach((part) => {
      const m = part.match(/^\{\{(\d+)\}\}$/);
      if (m) {
        const inp = el('input', 'blank-inp');
        inp.type = 'text';
        inp.dataset.bid = m[1];
        inp.autocomplete = 'off';
        inp.spellcheck = false;
        container.appendChild(inp);
      } else if (part) {
        container.appendChild(document.createTextNode(part));
      }
    });
  } else {
    container.textContent = q.stem;
  }
}

function renderQuestion(q, idx) {
  const card = el('div', 'q-card');

  const head = el('div', 'q-head');
  head.appendChild(el('span', 'q-idx', `${idx + 1}.`));
  const isChoice = q.type === 'single_choice';
  head.appendChild(el('span', 'tag ' + (isChoice ? 'choice' : 'blank'), isChoice ? '单选' : '填空'));
  if (q.difficulty) head.appendChild(el('span', 'tag diff', DIFF[q.difficulty] || q.difficulty));
  card.appendChild(head);

  const stem = el('div', 'q-stem');
  renderStemInto(stem, q);
  card.appendChild(stem);

  if (isChoice) {
    const opts = el('div', 'options');
    (q.options || []).forEach((o) => {
      const label = el('label', 'opt');
      label.dataset.key = o.key;
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'q_' + q.id;
      radio.value = o.key;
      label.appendChild(radio);
      label.appendChild(el('span', 'k', o.key + '.'));
      label.appendChild(el('span', null, o.text));
      opts.appendChild(label);
    });
    card.appendChild(opts);
  }

  card.appendChild(el('div', 'fb'));
  return card;
}

function renderBank(bank) {
  currentBank = bank;
  submitted = false;
  items = [];
  quizEl.innerHTML = '';
  scoreEl.textContent = '';

  if (!bank || !Array.isArray(bank.questions) || bank.questions.length === 0) {
    quizEl.appendChild(el('div', 'empty', '该题库没有题目。'));
    submitBtn.disabled = true;
    retryBtn.disabled = true;
    return;
  }

  bank.questions.forEach((q, i) => {
    const card = renderQuestion(q, i);
    items.push({ q, card });
    quizEl.appendChild(card);
  });
  submitBtn.disabled = false;
  retryBtn.disabled = true;
  setStatus(`${bank.title || bank.bankId || '题库'} · 共 ${bank.questions.length} 题`);
}

// ---------- 反馈 ----------
function feedbackChoice(fb, q, key, ok) {
  fb.className = 'fb show ' + (ok ? 'ok' : 'no');
  fb.textContent = '';
  fb.appendChild(el('div', 'lead', ok ? '✓ 回答正确' : (key ? '✗ 回答错误' : '✗ 未作答')));
  if (!ok && key) {
    const chosen = (q.options || []).find((o) => o.key === key);
    if (chosen && chosen.misconception) fb.appendChild(el('div', 'miss', '你的误区:' + chosen.misconception));
  }
  if (q.explanation) fb.appendChild(el('div', 'exp', '解析:' + q.explanation));
}

function feedbackBlank(fb, q, ok) {
  fb.className = 'fb show ' + (ok ? 'ok' : 'no');
  fb.textContent = '';
  fb.appendChild(el('div', 'lead', ok ? '✓ 回答正确' : '✗ 回答错误'));
  if (!ok) {
    const ref = (q.blanks || []).map((b) => `【${b.id}】${(b.accept || [])[0] || ''}`).join('   ');
    fb.appendChild(el('div', 'miss', '参考答案:' + ref));
  }
  if (q.explanation) fb.appendChild(el('div', 'exp', '解析:' + q.explanation));
}

// ---------- 交卷 ----------
function submit() {
  if (!currentBank || submitted) return;
  let correct = 0;

  items.forEach(({ q, card }) => {
    const fb = card.querySelector('.fb');
    if (q.type === 'single_choice') {
      const picked = card.querySelector('input[type="radio"]:checked');
      const key = picked ? picked.value : null;
      const { ok, want } = gradeSingle(q, key);
      if (ok) correct++;
      card.querySelectorAll('.opt').forEach((opt) => {
        const k = opt.dataset.key;
        if (want.indexOf(k) !== -1) opt.classList.add('correct');
        else if (k === key) opt.classList.add('wrong');
        const r = opt.querySelector('input');
        if (r) r.disabled = true;
      });
      feedbackChoice(fb, q, key, ok);
    } else {
      const answers = {};
      card.querySelectorAll('.blank-inp').forEach((inp) => { answers[inp.dataset.bid] = inp.value; });
      const { ok, perBlank } = gradeBlanks(q, answers);
      if (ok) correct++;
      const okMap = {};
      perBlank.forEach((b) => { okMap[b.id] = b.ok; });
      card.querySelectorAll('.blank-inp').forEach((inp) => {
        inp.classList.add(okMap[inp.dataset.bid] ? 'correct' : 'wrong');
        inp.disabled = true;
      });
      feedbackBlank(fb, q, ok);
    }
  });

  submitted = true;
  submitBtn.disabled = true;
  retryBtn.disabled = false;
  const total = items.length;
  const pct = total ? Math.round((correct / total) * 100) : 0;
  scoreEl.textContent = `${correct}/${total} · ${pct}%`;
  setStatus(`得分 ${correct}/${total}（${pct}%）。绿色为正确项，红色为答错处。`);
  quizEl.scrollTop = 0;
}

function retry() {
  if (currentBank) renderBank(currentBank);
}

// ---------- 题库加载 ----------
async function loadBankList() {
  setStatus('读取题库目录…');
  let res;
  try {
    res = await window.electronAPI.quiz.listBanks();
  } catch (e) {
    setStatus('无法读取题库:' + e.message);
    return;
  }
  bankSel.innerHTML = '';

  if (!res || !res.success || !res.banks || res.banks.length === 0) {
    const opt = el('option', null, '（无题库）');
    opt.value = '';
    bankSel.appendChild(opt);
    quizEl.innerHTML = '';
    const empty = el('div', 'empty');
    empty.appendChild(document.createTextNode('没有找到题库文件（*.json）。'));
    empty.appendChild(document.createElement('br'));
    empty.appendChild(document.createTextNode('目录:' + ((res && res.dir) || 'question-bank/')));
    quizEl.appendChild(empty);
    submitBtn.disabled = true;
    retryBtn.disabled = true;
    setStatus('question-bank/ 为空');
    return;
  }

  res.banks.forEach((b) => {
    const opt = el('option', null, `${b.title}（${b.count} 题）`);
    opt.value = b.file;
    bankSel.appendChild(opt);
  });
  await selectBank(res.banks[0].file);
}

async function selectBank(file) {
  if (!file) return;
  setStatus('加载题库…');
  let res;
  try {
    res = await window.electronAPI.quiz.loadBank(file);
  } catch (e) {
    setStatus('加载失败:' + e.message);
    return;
  }
  if (!res || !res.success) {
    setStatus('加载失败:' + ((res && res.error) || '未知错误'));
    return;
  }
  renderBank(res.bank);
}

bankSel.addEventListener('change', () => selectBank(bankSel.value));
$('reload-btn').addEventListener('click', loadBankList);
submitBtn.addEventListener('click', submit);
retryBtn.addEventListener('click', retry);

loadBankList();
