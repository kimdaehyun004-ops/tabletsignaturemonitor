(function () {
  // 연속된 점 3개의 중점을 이어 2차 베지어 곡선으로 그리면
  // 직선 이어그리기보다 훨씬 부드럽고 끊김 없는 필기감을 만들 수 있다.
  function createSmoothDrawer(ctx) {
    let p1 = null;
    let p2 = null;
    return {
      reset(x, y) {
        p1 = null;
        p2 = { x, y };
        ctx.beginPath();
        ctx.moveTo(x, y);
      },
      addPoint(x, y) {
        const p3 = { x, y };
        if (!p1) {
          ctx.lineTo(p3.x, p3.y);
          ctx.stroke();
          p1 = p2;
          p2 = p3;
          return;
        }
        const mid1 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const mid2 = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
        ctx.beginPath();
        ctx.moveTo(mid1.x, mid1.y);
        ctx.quadraticCurveTo(p2.x, p2.y, mid2.x, mid2.y);
        ctx.stroke();
        p1 = p2;
        p2 = p3;
      },
    };
  }

  const loginEl = document.getElementById('login');
  const monitorEl = document.getElementById('monitorPage');
  const passwordInput = document.getElementById('passwordInput');
  const loginError = document.getElementById('loginError');
  const grid = document.getElementById('grid');
  const connStatus = document.getElementById('connStatus');
  const recentList = document.getElementById('recentList');

  let ws;
  let tabletCount = 10;
  const cells = new Map(); // id -> { canvas, ctx, wrap, dot, savedBadge, savedTimer }

  function buildGrid() {
    grid.innerHTML = '';
    cells.clear();
    for (let id = 1; id <= tabletCount; id++) {
      const cell = document.createElement('div');
      cell.className = 'cell offline';

      const header = document.createElement('div');
      header.className = 'cell-header';
      const label = document.createElement('span');
      label.className = 'tablet-name';
      label.textContent = `태블릿 ${id}`;
      const savedBadge = document.createElement('span');
      savedBadge.className = 'saved-badge';
      savedBadge.textContent = '● 저장됨';
      const dot = document.createElement('span');
      dot.className = 'status-dot';
      header.appendChild(label);
      header.appendChild(savedBadge);
      header.appendChild(dot);

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#111';

      cell.appendChild(header);
      cell.appendChild(canvas);
      grid.appendChild(cell);

      cells.set(id, { canvas, ctx, wrap: cell, dot, savedBadge, savedTimer: null, drawer: createSmoothDrawer(ctx), queue: [] });
    }
    resizeAllCanvases();
  }

  // 캔버스 해상도를 실제로 화면에 표시되는 셀 크기에 맞춰서, 하단에
  // 남는 여백 없이 셀 전체를 꽉 채우고 그림도 흐려지지 않게 한다.
  function resizeAllCanvases() {
    const ratio = window.devicePixelRatio || 1;
    for (const c of cells.values()) {
      const rect = c.canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width * ratio));
      const h = Math.max(1, Math.round(rect.height * ratio));
      if (c.canvas.width !== w || c.canvas.height !== h) {
        c.canvas.width = w;
        c.canvas.height = h;
        c.ctx.lineJoin = 'round';
        c.ctx.lineCap = 'round';
        c.ctx.lineWidth = 3;
        c.ctx.strokeStyle = '#111';
      }
    }
  }
  let resizeDebounce;
  window.addEventListener('resize', () => {
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(resizeAllCanvases, 200);
  });

  // 인터넷을 통해 오는 그리기 데이터는 도착 간격이 고르지 않을 수 있다.
  // 도착 즉시 그리는 대신 큐에 모았다가 매 프레임 일정한 속도로 그려주면
  // 네트워크 지연/버스트로 인한 "뚝뚝 끊기는" 느낌이 크게 줄어든다.
  // 밀린 양이 많으면(backlog) 더 빨리 그려서 지연이 계속 쌓이지 않도록 한다.
  function tickQueues() {
    for (const c of cells.values()) {
      const backlog = c.queue.length;
      if (backlog === 0) continue;
      const drainCount = backlog > 30 ? backlog - 8 : Math.min(4, backlog);
      for (let i = 0; i < drainCount; i++) {
        const p = c.queue.shift();
        const px = p.x * c.canvas.width;
        const py = p.y * c.canvas.height;
        if (p.type === 'start') c.drawer.reset(px, py);
        else if (p.type === 'point') c.drawer.addPoint(px, py);
      }
    }
    requestAnimationFrame(tickQueues);
  }
  requestAnimationFrame(tickQueues);

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
    c.queue.push(...points);
  }

  function applyClear(id) {
    const c = cells.get(id);
    if (!c) return;
    c.queue.length = 0;
    c.ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
  }

  function flashSaved(id, filename, timestamp) {
    const c = cells.get(id);
    if (c) {
      c.wrap.classList.add('flash');
      setTimeout(() => c.wrap.classList.remove('flash'), 700);

      c.savedBadge.classList.add('show');
      clearTimeout(c.savedTimer);
      c.savedTimer = setTimeout(() => c.savedBadge.classList.remove('show'), 3000);
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
        // 로그인 화면이 display:none이었을 때 만든 캔버스는 크기가 0으로 잡히므로,
        // 그리드가 실제로 화면에 보이게 된 뒤 다시 한번 실제 크기에 맞춰준다.
        requestAnimationFrame(resizeAllCanvases);
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
