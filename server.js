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
// 같은 코드를 v1/v2/v3처럼 여러 개 독립 배포할 때, 화면에서 어느 버전인지
// 구분할 수 있도록 표시하는 이름 (예: "V1"). 비워두면 아무것도 표시하지 않는다.
const INSTANCE_NAME = process.env.INSTANCE_NAME || '';

if (!ADMIN_PASSWORD || !TABLET_TOKEN) {
  console.error('ADMIN_PASSWORD / TABLET_TOKEN 이 설정되지 않았습니다. .env 파일을 확인하세요 (.env.example 참고).');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, 'data', 'signatures');
fs.mkdirSync(DATA_DIR, { recursive: true });

// 태블릿 서명 화면에 깔리는 배경 이미지(브랜딩 프레임). 인스턴스당 1장만 유지한다.
const BG_FILE = path.join(__dirname, 'data', 'background.bin');
const BG_META_FILE = path.join(__dirname, 'data', 'background.json');
let backgroundBuffer = null;
let backgroundMime = null;
let backgroundVersion = 0;

// 서버 재시작 후에도(디스크가 남아있다면) 배경 이미지를 복원한다.
try {
  if (fs.existsSync(BG_FILE) && fs.existsSync(BG_META_FILE)) {
    backgroundBuffer = fs.readFileSync(BG_FILE);
    const meta = JSON.parse(fs.readFileSync(BG_META_FILE, 'utf8'));
    backgroundMime = meta.mime || 'image/png';
    backgroundVersion = meta.version || 1;
  }
} catch {
  backgroundBuffer = null;
}

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
// 배경 이미지 업로드용. 이미지를 data URL(문자열)로 받으므로 넉넉한 상한을 둔다.
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({ tabletCount: TABLET_COUNT, instanceName: INSTANCE_NAME });
});

// /links.html에서 태블릿/모니터 QR코드를 만들 때 사용.
// 브라우저가 실제로 접속한 주소(로컬 IP든, 클라우드 도메인이든)를 그대로 base로 사용해
// 로컬 네트워크 배포와 클라우드 배포 모두에서 올바른 QR코드가 만들어지도록 한다.
app.get('/api/host-info', (req, res) => {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol;
  const host = req.get('host');
  res.json({ base: `${protocol}://${host}`, tabletCount: TABLET_COUNT, tabletToken: TABLET_TOKEN, instanceName: INSTANCE_NAME });
});

const SIGNATURE_FILENAME_RE = /^tablet-(\d+)_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.png$/;

function checkAdminPw(req) {
  return timingSafeEqual(req.query.pw || '', ADMIN_PASSWORD);
}

function parseSignatureFilename(filename) {
  const m = filename.match(SIGNATURE_FILENAME_RE);
  if (!m) return { tabletId: null, timestamp: null };
  // 저장 시 콜론/마침표를 하이픈으로 바꿔둔 걸 다시 ISO 형식으로 복원한다.
  const [, tabletId, encoded] = m;
  const iso = encoded.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z');
  return { tabletId: parseInt(tabletId, 10), timestamp: iso };
}

// 관리자 페이지(admin.html) 전용: 저장된 서명 목록. 비밀번호(pw) 없이는 접근할 수 없다.
app.get('/api/signatures', (req, res) => {
  if (!checkAdminPw(req)) return res.status(401).json({ error: 'unauthorized' });
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.png'))
    .sort()
    .reverse()
    .slice(0, 300);
  res.json(files.map((filename) => ({ filename, ...parseSignatureFilename(filename) })));
});

// 저장된 서명 이미지 다운로드. 이 역시 비밀번호 없이는 접근할 수 없다.
app.get('/api/signature-file/:filename', (req, res) => {
  if (!checkAdminPw(req)) return res.status(401).send('unauthorized');
  const { filename } = req.params;
  if (!SIGNATURE_FILENAME_RE.test(filename)) return res.status(400).send('bad filename');
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('not found');
  res.sendFile(filePath);
});

// 현재 배경 이미지. 태블릿이 표시해야 하므로 비밀번호 없이 접근 가능하다.
// version 쿼리는 브라우저 캐시를 우회하기 위한 용도이며 값 자체는 사용하지 않는다.
app.get('/api/background', (req, res) => {
  if (!backgroundBuffer) return res.status(404).end();
  res.set('Content-Type', backgroundMime || 'image/png');
  res.set('Cache-Control', 'no-cache');
  res.send(backgroundBuffer);
});

// 배경 이미지 정보(존재 여부/버전). 태블릿·관리자 화면이 상태 파악에 사용한다.
app.get('/api/background-info', (req, res) => {
  res.json({ hasBackground: !!backgroundBuffer, version: backgroundVersion });
});

// 배경 이미지 업로드(교체). 관리자 비밀번호 필요.
app.post('/api/background', (req, res) => {
  if (!checkAdminPw(req)) return res.status(401).json({ error: 'unauthorized' });
  const dataUrl = String((req.body && req.body.dataUrl) || '');
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/);
  if (!match) return res.status(400).json({ error: 'png/jpeg/webp/gif 이미지만 업로드할 수 있습니다.' });
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 12 * 1024 * 1024) return res.status(413).json({ error: '이미지가 너무 큽니다(최대 12MB).' });

  backgroundBuffer = buffer;
  backgroundMime = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  backgroundVersion += 1;
  try {
    fs.writeFileSync(BG_FILE, buffer);
    fs.writeFileSync(BG_META_FILE, JSON.stringify({ mime: backgroundMime, version: backgroundVersion }));
  } catch {
    // 디스크 저장에 실패해도 메모리에는 남아있으므로 계속 서비스한다.
  }
  broadcastToTablets({ type: 'background', hasBackground: true, version: backgroundVersion });
  res.json({ ok: true, version: backgroundVersion });
});

// 배경 이미지 삭제. 관리자 비밀번호 필요.
app.delete('/api/background', (req, res) => {
  if (!checkAdminPw(req)) return res.status(401).json({ error: 'unauthorized' });
  backgroundBuffer = null;
  backgroundMime = null;
  backgroundVersion += 1;
  try {
    if (fs.existsSync(BG_FILE)) fs.unlinkSync(BG_FILE);
    if (fs.existsSync(BG_META_FILE)) fs.unlinkSync(BG_META_FILE);
  } catch {
    // 무시
  }
  broadcastToTablets({ type: 'background', hasBackground: false, version: backgroundVersion });
  res.json({ ok: true, version: backgroundVersion });
});

const server = app.listen(PORT, () => {
  const linksUrl = `http://localhost:${PORT}/links.html`;
  console.log(`Tablet signature monitor${INSTANCE_NAME ? ` [${INSTANCE_NAME}]` : ''} listening on http://localhost:${PORT}`);
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

// tabletId -> { ws, connectedAt, aspect }
const tablets = new Map();
// Set of monitor sockets
const monitors = new Set();

// 태블릿마다 실제 화면 비율이 다를 수 있어, 모니터링 화면이 그 비율을 그대로
// 따라가야 서명이 늘어나거나 찌그러지지 않는다. 비정상적인 값은 무시한다.
function sanitizeAspect(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0.2 && n < 5 ? n : null;
}

function tabletStatusList() {
  const list = [];
  for (let id = 1; id <= TABLET_COUNT; id++) {
    const t = tablets.get(id);
    list.push({ id, online: !!t, aspect: t ? t.aspect : null });
  }
  return list;
}

function broadcastToMonitors(payload) {
  const data = JSON.stringify(payload);
  for (const ws of monitors) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

// 배경 이미지 변경 등을 모든 태블릿에 실시간으로 알린다.
function broadcastToTablets(payload) {
  const data = JSON.stringify(payload);
  for (const t of tablets.values()) {
    if (t.ws.readyState === t.ws.OPEN) t.ws.send(data);
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
        tablets.set(id, { ws, connectedAt: Date.now(), aspect: sanitizeAspect(msg.aspect) });
        ws.send(JSON.stringify({ type: 'auth_ok' }));
        // 접속 직후 현재 배경 이미지 상태를 알려줘 바로 표시하게 한다.
        ws.send(JSON.stringify({ type: 'background', hasBackground: !!backgroundBuffer, version: backgroundVersion }));
        broadcastStatus();
        return;
      }
      return;
    }

    // 태블릿에서 온 드로잉/저장 이벤트만 처리
    if (ws.role !== 'tablet' || ws.tabletId == null) return;
    const id = ws.tabletId;

    if (msg.type === 'aspect') {
      const current = tablets.get(id);
      if (current) {
        current.aspect = sanitizeAspect(msg.aspect);
        broadcastStatus();
      }
      return;
    }

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
      const now = new Date();
      const filename = `tablet-${id}_${now.toISOString().replace(/[:.]/g, '-')}.png`;
      fs.writeFileSync(path.join(DATA_DIR, filename), buffer);
      broadcastToMonitors({ type: 'saved', id, filename, timestamp: now.toISOString() });
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
