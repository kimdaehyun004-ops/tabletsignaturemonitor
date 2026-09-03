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

// 게스트(임시) 비밀번호: 관리자가 접속 기간을 정해 발급한다. 이 비번으로는
// 실시간 모니터링만 볼 수 있고, 다운로드/관리 기능은 관리자 전용이다.
const GUESTS_FILE = path.join(__dirname, 'data', 'guests.json');
const MAX_GUESTS = 5;
let guests = []; // [{ code, label, expiresAt }]
try {
  if (fs.existsSync(GUESTS_FILE)) {
    const arr = JSON.parse(fs.readFileSync(GUESTS_FILE, 'utf8'));
    if (Array.isArray(arr)) guests = arr;
  }
} catch {
  guests = [];
}
function pruneGuests() {
  const now = Date.now();
  const before = guests.length;
  guests = guests.filter((g) => g.expiresAt > now);
  if (guests.length !== before) saveGuests();
}
function saveGuests() {
  try {
    fs.writeFileSync(GUESTS_FILE, JSON.stringify(guests));
  } catch {
    // 디스크 저장 실패해도 메모리에는 남아있으므로 계속 동작한다.
  }
}
function generateGuestCode() {
  // 입력하기 쉬운 6자리 숫자 코드. 관리자 비번/기존 게스트와 겹치지 않게 한다.
  for (let i = 0; i < 50; i++) {
    const code = String(crypto.randomInt(100000, 1000000));
    if (code !== ADMIN_PASSWORD && !guests.some((g) => g.code === code)) return code;
  }
  return String(Date.now()).slice(-6);
}
// 모니터링을 볼 수 있는 비밀번호인지 (관리자 또는 유효한 게스트).
function isValidViewer(password) {
  if (timingSafeEqual(password || '', ADMIN_PASSWORD)) return true;
  pruneGuests();
  return guests.some((g) => timingSafeEqual(password || '', g.code));
}
// 배경 이미지를 바꿀 수 있는 비밀번호인지 (관리자 또는 "배경 변경 허용" 게스트).
function isBackgroundEditor(password) {
  if (timingSafeEqual(password || '', ADMIN_PASSWORD)) return true;
  pruneGuests();
  return guests.some((g) => g.canBackground && timingSafeEqual(password || '', g.code));
}

// 태블릿 서명 화면에 깔리는 배경 이미지(브랜딩 프레임). 태블릿마다 서로 다른
// 배경을 둘 수 있도록 태블릿 번호별로 저장한다.
const BG_DIR = path.join(__dirname, 'data', 'backgrounds');
fs.mkdirSync(BG_DIR, { recursive: true });
const backgrounds = new Map(); // id -> { buffer, mime, version }

function bgBinPath(id) {
  return path.join(BG_DIR, `bg-${id}.bin`);
}
function bgMetaPath(id) {
  return path.join(BG_DIR, `bg-${id}.json`);
}

// 서버 재시작 후에도(디스크가 남아있다면) 각 태블릿 배경을 복원한다.
for (let id = 1; id <= 200; id++) {
  try {
    if (fs.existsSync(bgBinPath(id)) && fs.existsSync(bgMetaPath(id))) {
      const buffer = fs.readFileSync(bgBinPath(id));
      const meta = JSON.parse(fs.readFileSync(bgMetaPath(id), 'utf8'));
      backgrounds.set(id, { buffer, mime: meta.mime || 'image/png', version: meta.version || 1 });
    }
  } catch {
    // 개별 파일 손상은 무시하고 계속.
  }
}

function bgVersion(id) {
  const b = backgrounds.get(id);
  return b ? b.version : 0;
}
function hasBg(id) {
  return backgrounds.has(id);
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

// 통합 대시보드(dashboard.html)에서 여러 버전의 접속 현황을 한 화면에 모으기 위한 API.
// 다른 버전(다른 도메인)에서도 조회할 수 있도록 CORS를 허용하고, 비밀번호로 보호한다.
app.get('/api/status', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (!checkAdminPw(req)) return res.status(401).json({ error: 'unauthorized' });
  const onlineIds = [...tablets.keys()].sort((a, b) => a - b);
  res.json({
    instanceName: INSTANCE_NAME,
    tabletCount: TABLET_COUNT,
    online: onlineIds.length,
    onlineIds,
  });
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

function parseBgId(req) {
  const id = parseInt(req.query.id, 10);
  return Number.isInteger(id) && id >= 1 && id <= TABLET_COUNT ? id : null;
}

// 특정 태블릿의 배경 이미지. 태블릿이 표시해야 하므로 비밀번호 없이 접근 가능하다.
app.get('/api/background', (req, res) => {
  const id = parseBgId(req);
  const b = id ? backgrounds.get(id) : null;
  if (!b) return res.status(404).end();
  res.set('Content-Type', b.mime || 'image/png');
  res.set('Cache-Control', 'no-cache');
  res.send(b.buffer);
});

// 특정 태블릿 배경 정보(존재 여부/버전).
app.get('/api/background-info', (req, res) => {
  const id = parseBgId(req);
  res.json({ hasBackground: id ? hasBg(id) : false, version: id ? bgVersion(id) : 0 });
});

// 모든 태블릿의 배경 정보를 한번에 (관리자 화면에서 슬롯을 그릴 때 사용). 비밀번호 필요.
app.get('/api/backgrounds-info', (req, res) => {
  if (!isBackgroundEditor(req.query.pw || "")) return res.status(401).json({ error: 'unauthorized' });
  const list = [];
  for (let id = 1; id <= TABLET_COUNT; id++) {
    list.push({ id, hasBackground: hasBg(id), version: bgVersion(id) });
  }
  res.json({ tabletCount: TABLET_COUNT, backgrounds: list });
});

// 배경을 특정 태블릿에 반영하는 공통 처리. tablet 하나에 저장하고 그 태블릿에 알린다.
function setBackgroundForId(id, buffer, mime) {
  const version = bgVersion(id) + 1;
  backgrounds.set(id, { buffer, mime, version });
  try {
    fs.writeFileSync(bgBinPath(id), buffer);
    fs.writeFileSync(bgMetaPath(id), JSON.stringify({ mime, version }));
  } catch {
    // 디스크 저장 실패해도 메모리에는 남아있으므로 계속 서비스한다.
  }
  notifyTabletBackground(id);
}
function clearBackgroundForId(id) {
  backgrounds.delete(id);
  try {
    if (fs.existsSync(bgBinPath(id))) fs.unlinkSync(bgBinPath(id));
    if (fs.existsSync(bgMetaPath(id))) fs.unlinkSync(bgMetaPath(id));
  } catch {
    // 무시
  }
  notifyTabletBackground(id);
}

// 배경 업로드/교체. id=숫자면 그 태블릿, id=all이면 모든 태블릿에 같은 이미지를 적용. 비밀번호 필요.
app.post('/api/background', (req, res) => {
  if (!isBackgroundEditor(req.query.pw || "")) return res.status(401).json({ error: 'unauthorized' });
  const dataUrl = String((req.body && req.body.dataUrl) || '');
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/);
  if (!match) return res.status(400).json({ error: 'png/jpeg/webp/gif 이미지만 업로드할 수 있습니다.' });
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 12 * 1024 * 1024) return res.status(413).json({ error: '이미지가 너무 큽니다(최대 12MB).' });
  const mime = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];

  if (req.query.id === 'all') {
    for (let id = 1; id <= TABLET_COUNT; id++) setBackgroundForId(id, buffer, mime);
    return res.json({ ok: true, applied: 'all' });
  }
  const id = parseBgId(req);
  if (!id) return res.status(400).json({ error: '잘못된 태블릿 번호입니다.' });
  setBackgroundForId(id, buffer, mime);
  res.json({ ok: true, id, version: bgVersion(id) });
});

// 배경 삭제. id=숫자 또는 id=all. 비밀번호 필요.
app.delete('/api/background', (req, res) => {
  if (!isBackgroundEditor(req.query.pw || "")) return res.status(401).json({ error: 'unauthorized' });
  if (req.query.id === 'all') {
    for (let id = 1; id <= TABLET_COUNT; id++) clearBackgroundForId(id);
    return res.json({ ok: true, applied: 'all' });
  }
  const id = parseBgId(req);
  if (!id) return res.status(400).json({ error: '잘못된 태블릿 번호입니다.' });
  clearBackgroundForId(id);
  res.json({ ok: true, id });
});

// 게스트 비밀번호 목록. 관리자 전용.
app.get('/api/guests', (req, res) => {
  if (!checkAdminPw(req)) return res.status(401).json({ error: 'unauthorized' });
  pruneGuests();
  const now = Date.now();
  res.json({
    max: MAX_GUESTS,
    guests: guests
      .map((g) => ({ code: g.code, label: g.label || '', expiresAt: g.expiresAt, remainingMs: g.expiresAt - now, canBackground: !!g.canBackground }))
      .sort((a, b) => a.expiresAt - b.expiresAt),
  });
});

// 게스트 비밀번호 발급. 관리자 전용. body: { label, durationHours }
app.post('/api/guests', (req, res) => {
  if (!checkAdminPw(req)) return res.status(401).json({ error: 'unauthorized' });
  pruneGuests();
  if (guests.length >= MAX_GUESTS) {
    return res.status(400).json({ error: `게스트는 최대 ${MAX_GUESTS}개까지 발급할 수 있습니다. 기존 것을 삭제하세요.` });
  }
  const hours = parseFloat((req.body && req.body.durationHours) || 0);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30) {
    return res.status(400).json({ error: '접속 기간이 올바르지 않습니다.' });
  }
  const label = String((req.body && req.body.label) || '').slice(0, 40);
  const canBackground = !!(req.body && req.body.canBackground);
  const code = generateGuestCode();
  const expiresAt = Date.now() + hours * 3600 * 1000;
  guests.push({ code, label, expiresAt, canBackground });
  saveGuests();
  res.json({ ok: true, code, label, expiresAt, canBackground });
});

// 게스트 비밀번호 삭제(회수). 관리자 전용.
app.delete('/api/guests', (req, res) => {
  if (!checkAdminPw(req)) return res.status(401).json({ error: 'unauthorized' });
  const code = String(req.query.code || '');
  const before = guests.length;
  guests = guests.filter((g) => g.code !== code);
  if (guests.length !== before) saveGuests();
  res.json({ ok: true });
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

// 특정 태블릿에게 배경이 바뀌었음을 알린다 (해당 태블릿만 다시 불러오도록).
function notifyTabletBackground(id) {
  const t = tablets.get(id);
  if (t && t.ws.readyState === t.ws.OPEN) {
    t.ws.send(JSON.stringify({ type: 'background', hasBackground: hasBg(id), version: bgVersion(id) }));
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
        // 관리자 비번 또는 유효한 게스트 비번이면 모니터링을 볼 수 있다.
        if (!isValidViewer(msg.password || '')) {
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
        // 접속 직후 이 태블릿의 배경 이미지 상태를 알려줘 바로 표시하게 한다.
        ws.send(JSON.stringify({ type: 'background', hasBackground: hasBg(id), version: bgVersion(id) }));
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
