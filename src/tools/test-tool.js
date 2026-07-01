let n = 0;
const counter = document.getElementById('counter');
document.getElementById('inc-btn').addEventListener('click', () => {
  n += 1;
  counter.textContent = n;
});
