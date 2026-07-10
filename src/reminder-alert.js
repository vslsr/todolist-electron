// 久坐提醒 · 置顶强提醒窗口逻辑

const params = new URLSearchParams(location.search);
const title = params.get('title') || '久坐提醒';
const body  = params.get('body')  || '';
const phase = params.get('phase') || 'work';

document.body.classList.add(phase === 'break' ? 'break' : 'work');
document.getElementById('emoji').textContent = phase === 'break' ? '☕' : '💪';
document.getElementById('title').textContent = title;
document.getElementById('body').textContent  = body;

// 提示音：连续几声短促蜂鸣，加强提醒
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const times = [0, 0.28, 0.56];
    times.forEach((t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.24);
    });
  } catch (e) { /* 忽略音频错误 */ }
}
beep();

function close() { window.close(); }

document.getElementById('ok-btn').addEventListener('click', close);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'Enter') close();
});
