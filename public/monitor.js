(function () {
  const loginEl = document.getElementById('login');
  const monitorEl = document.getElementById('monitorPage');
  const passwordInput = document.getElementById('passwordInput');
  const loginError = document.getElementById('loginError');
  const grid = document.getElementById('grid');
  const connStatus = document.getElementById('connStatus');
  const recentList = document.getElementById('recentList');

  const CELL_W = 640;
  const CELL_H = 480;

  let ws;
  let tabletCount = 10;
  const cells = new Map(); // id -> { canvas, ctx, wrap, dot }

  function buildGrid() {
    grid.innerHTML = '';
    cells.clear();
    for (let id = 1; id <= tabletCount; id++) {
      const cell = document.createElement('div');
      cell.className = 'cell offline';

      const header = document.createElement('div');
      header.className = 'cell-header';
      const label = document.createElement('span');
      label.textContent = `태블릿 ${id}`;
      const dot = document.createElement('span');
      dot.className = 'status-dot';
      header.appendChild(label);
      header.appendChild(dot);

      const canvas = document.createElement('canvas');
      canvas.width = CELL_W;
      canvas.height = CELL_H;
      const ctx = canvas.getContext('2d');
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#111';

      cell.appendChild(header);
      cell.appendChild(canvas);
      grid.appendChild(cell);

      cells.set(id, { canvas, ctx, wrap: cell, dot });
    }
  }

  function applyStatus(list) {
    list.forEach(({ id, online }) => {
      const c = cells.get(id);
      if (!c) return;
      c.wrap.classList.toggle('offline', !online);
      c.dot.classList.toggle('online', online);
    });
  }

  function applyStroke(id, points) {
    const c = cells.get(id);
    if (!c) return;
    const { ctx, canvas } = c;
    points.forEach((p) => {
      const px = p.x * canvas.width;
      const py = p.y * canvas.height;
      if (p.type === 'start') {
        ctx.beginPath();
        ctx.moveTo(px, py);
      } else if (p.type === 'point') {
        ctx.lineTo(px, py);
        ctx.stroke();
      }
    });
  }

  function applyClear(id) {
    const c = cells.get(id);
    if (!c) return;
    c.ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
  }

  function flashSaved(id, filename, timestamp) {
    const c = cells.get(id);
    if (c) {
      c.wrap.classList.add('flash');
      setTimeout(() => c.wrap.classList.remove('flash'), 700);
    }
    const item = document.createElement('div');
    item.className = 'recent-item';
    const img = document.createElement('img');
    img.src = `/signatures/${encodeURIComponent(filename)}`;
    const span = document.createElement('span');
    span.textContent = `태블릿 ${id} · ${new Date(timestamp).toLocaleTimeString('ko-KR')}`;
    item.appendChild(img);
    item.appendChild(span);
    recentList.prepend(item);
    while (recentList.children.length > 30) {
      recentList.removeChild(recentList.lastChild);
    }
  }

  function connect(password) {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocol}://${location.host}`);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'hello', role: 'monitor', password }));
    });

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'auth_ok') {
        sessionStorage.setItem('monitorPassword', password);
        loginEl.style.display = 'none';
        monitorEl.style.display = 'flex';
        connStatus.textContent = '연결됨';
      } else if (msg.type === 'auth_error') {
        loginError.textContent = msg.message;
        sessionStorage.removeItem('monitorPassword');
      } else if (msg.type === 'status') {
        applyStatus(msg.tablets);
      } else if (msg.type === 'stroke') {
        applyStroke(msg.id, msg.points);
      } else if (msg.type === 'clear') {
        applyClear(msg.id);
      } else if (msg.type === 'saved') {
        flashSaved(msg.id, msg.filename, msg.timestamp);
      }
    });

    ws.addEventListener('close', () => {
      connStatus.textContent = '연결 끊김 - 재연결 중...';
      setTimeout(() => connect(password), 2000);
    });

    ws.addEventListener('error', () => ws.close());
  }

  function start(password) {
    fetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => {
        tabletCount = cfg.tabletCount;
        buildGrid();
        connect(password);
      });
  }

  document.getElementById('loginBtn').addEventListener('click', () => {
    const pw = passwordInput.value;
    if (!pw) return;
    start(pw);
  });
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('loginBtn').click();
  });

  const savedPw = sessionStorage.getItem('monitorPassword');
  if (savedPw) {
    loginEl.style.display = 'none';
    monitorEl.style.display = 'flex';
    start(savedPw);
  }
})();
