'use strict';

// Switch Windows console to UTF-8 before any output
if (process.platform === 'win32') {
  try { require('child_process').execSync('chcp 65001', { shell: true, stdio: 'pipe' }); } catch {}
}

const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = Number(process.argv[2]) || 8765;

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('TODOList Group Server is running\n');
});

const wss = new WebSocketServer({ server: httpServer });

// Map: socketKey -> { ws, id, name, status }
const clients = new Map();
let nextKey = 1;

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function broadcastList() {
  const list = [];
  for (const c of clients.values()) {
    list.push({
      id:        c.id,
      name:      c.name,
      running:   c.status.running,
      paused:    c.status.paused,
      phase:     c.status.phase,
      remaining: c.status.remaining,
      workMin:   c.status.workMin,
    });
  }
  const msg = JSON.stringify({ type: 'users', list });
  for (const c of clients.values()) {
    if (c.ws.readyState === 1 /* OPEN */) c.ws.send(msg);
  }
}

wss.on('connection', (ws, req) => {
  const key = String(nextKey++);
  const id  = makeId();
  const ip  = req.socket.remoteAddress;

  clients.set(key, {
    ws,
    id,
    name: '未命名',
    status: { running: false, paused: false, phase: 'work', remaining: 0, workMin: 25 },
    todos: [],
  });

  console.log(`[+] ${id}  ${ip}  (共 ${clients.size} 人)`);

  // Tell the client its own server-assigned ID
  ws.send(JSON.stringify({ type: 'welcome', id }));
  broadcastList();

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const c   = clients.get(key);
      if (!c) return;

      if (msg.type === 'join') {
        c.name = String(msg.name || '未命名').trim().slice(0, 20) || '未命名';
        console.log(`[~] ${id} 设置名称: ${c.name}`);
        broadcastList();
      } else if (msg.type === 'status') {
        const { type, ...rest } = msg;
        c.status = { ...c.status, ...rest };
        broadcastList();
      } else if (msg.type === 'todos') {
        c.todos = Array.isArray(msg.todos) ? msg.todos : [];
        // no broadcast needed — todos are fetched on demand
      } else if (msg.type === 'requestTodos') {
        // Find the target client by id and send their todos only to the requester
        const target = [...clients.values()].find(v => v.id === msg.targetId);
        if (target) {
          ws.send(JSON.stringify({
            type:  'userTodos',
            userId: target.id,
            name:  target.name,
            todos: target.todos || [],
          }));
        }
      }
    } catch { /* ignore bad JSON */ }
  });

  ws.on('close', () => {
    clients.delete(key);
    console.log(`[-] ${id}  (剩余 ${clients.size} 人)`);
    broadcastList();
  });

  ws.on('error', (err) => {
    console.error(`[!] ${id} error: ${err.message}`);
    clients.delete(key);
    broadcastList();
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  const ips = [];
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  console.log(`\n✅ TODOList 工作组服务器已启动`);
  console.log(`   端口: ${PORT}`);
  ips.forEach(ip => console.log(`   地址: ws://${ip}:${PORT}`));
  console.log(`\n客户端填写上面的地址即可连接。\n`);
});
