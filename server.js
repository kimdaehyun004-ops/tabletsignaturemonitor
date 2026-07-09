require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TABLET_TOKEN = process.env.TABLET_TOKEN || '';
const TABLET_COUNT = parseInt(process.env.TABLET_COUNT || '10', 10);

if (!ADMIN_PASSWORD || !TABLET_TOKEN) {
  console.error('ADMIN_PASSWORD / TABLET_TOKEN 이 설정되지 않았습니다. .env 파일을 확인하세요 (.env.example 참고).');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, 'data', 'signatures');
fs.mkdirSync(DATA_DIR, { recursive: true });

function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}
const LAN_IP = getLanIp();

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/signatures', express.static(DATA_DIR));

app.get('/api/config', (req, res) => {
  res.json({ tabletCount: TABLET_COUNT });
});

// /links.html에서 태블릿/모니터 QR코드를 만들 때 사용.
// 브라우저가 실제로 접속한 주소(로컬 IP든, 클라우드 도메인이든)를 그대로 base로 사용해
// 로컬 네트워크 배포와 클라우드 배포 모두에서 올바른 QR코드가 만들어지도록 한다.
app.get('/api/host-info', (req, res) => {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol;
  const host = req.get('host');
  res.json({ base: `${protocol}://${host}`, tabletCount: TABLET_COUNT, tabletToken: TABLET_TOKEN });
});

app.get('/api/signatures', (req, res) => {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.png'))
    .sort()
    .reverse()
    .slice(0, 100);
  res.json(files);
});

const server = app.listen(PORT, () => {
  const linksUrl = `http://localhost:${PORT}/links.html`;
  console.log(`Tablet signature monitor listening on http://localhost:${PORT}`);
  console.log(`이 PC의 네트워크 주소: http://${LAN_IP}:${PORT}`);
  console.log(`태블릿용 QR코드 페이지: ${linksUrl}`);

  const openCmd =
    process.platform === 'win32' ? `start "" "${linksUrl}"` : process.platform === 'darwin' ? `open "${linksUrl}"` : `xdg-open "${linksUrl}"`;
  exec(openCmd, () => {});
});

const wss = new WebSocketServer({ server });

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// tabletId -> { ws, name, connectedAt }
const tablets = new Map();
// Set of monitor sockets
const monitors = new Set();

function tabletStatusList() {
  const list = [];
  for (let id = 1; id <= TABLET_COUNT; id++) {
    list.push({ id, online: tablets.has(id) });
  }
  return list;
}

function broadcastToMonitors(payload) {
  const data = JSON.stringify(payload);
  for (const ws of monitors) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function broadcastStatus() {
  broadcastToMonitors({ type: 'status', tablets: tabletStatusList() });
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.role = null;
  ws.tabletId = null;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'hello') {
      if (msg.role === 'monitor') {
        if (!timingSafeEqual(msg.password || '', ADMIN_PASSWORD)) {
          ws.send(JSON.stringify({ type: 'auth_error', message: '비밀번호가 올바르지 않습니다.' }));
          ws.close();
          return;
        }
        ws.role = 'monitor';
        monitors.add(ws);
        ws.send(JSON.stringify({ type: 'auth_ok' }));
        ws.send(JSON.stringify({ type: 'status', tablets: tabletStatusList() }));
        return;
      }

      if (msg.role === 'tablet') {
        const id = parseInt(msg.id, 10);
        if (!Number.isInteger(id) || id < 1 || id > TABLET_COUNT) {
          ws.send(JSON.stringify({ type: 'auth_error', message: '잘못된 태블릿 번호입니다.' }));
          ws.close();
          return;
        }
        if (!timingSafeEqual(msg.token || '', TABLET_TOKEN)) {
          ws.send(JSON.stringify({ type: 'auth_error', message: '토큰이 올바르지 않습니다.' }));
          ws.close();
          return;
        }
        // 같은 id로 기존 연결이 있으면 종료 (한 태블릿에 하나의 연결만 허용)
        const existing = tablets.get(id);
        if (existing && existing.ws !== ws) {
          existing.ws.close();
        }
        ws.role = 'tablet';
        ws.tabletId = id;
        tablets.set(id, { ws, connectedAt: Date.now() });
        ws.send(JSON.stringify({ type: 'auth_ok' }));
        broadcastStatus();
        return;
      }
      return;
    }

    // 태블릿에서 온 드로잉/저장 이벤트만 처리
    if (ws.role !== 'tablet' || ws.tabletId == null) return;
    const id = ws.tabletId;

    if (msg.type === 'stroke') {
      // { type: 'stroke', points: [{type:'start'|'point'|'end', x, y}, ...] }
      broadcastToMonitors({ type: 'stroke', id, points: msg.points });
      return;
    }

    if (msg.type === 'clear') {
      broadcastToMonitors({ type: 'clear', id });
      return;
    }

    if (msg.type === 'save') {
      const dataUrl = String(msg.dataUrl || '');
      const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
      if (!match) return;
      const buffer = Buffer.from(match[1], 'base64');
      // 10MB 상한선으로 비정상적으로 큰 업로드 방지
      if (buffer.length > 10 * 1024 * 1024) return;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `tablet-${id}_${timestamp}.png`;
      fs.writeFileSync(path.join(DATA_DIR, filename), buffer);
      broadcastToMonitors({ type: 'saved', id, filename, timestamp });
      return;
    }
  });

  ws.on('close', () => {
    if (ws.role === 'tablet' && ws.tabletId != null) {
      const current = tablets.get(ws.tabletId);
      if (current && current.ws === ws) {
        tablets.delete(ws.tabletId);
        broadcastStatus();
      }
    }
    if (ws.role === 'monitor') {
      monitors.delete(ws);
    }
  });
});

// 연결 끊김 감지용 하트비트
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));
