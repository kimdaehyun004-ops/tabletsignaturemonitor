(function () {
  // 연속된 점 3개의 중점을 이어 2차 베지어 곡선으로 그리면
  // 직선 이어그리기보다 훨씬 부드럽고 끊김 없는 필기감을 만들 수 있다.
  // width는 태블릿에서 계산해 전달한 값을 그대로 써서 원본과 굵기가 동일하게 한다.
  function createSmoothDrawer(ctx) {
    let p1 = null;
    let p2 = null;
    return {
      reset(x, y, width) {
        p1 = null;
        p2 = { x, y };
        if (width) ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x, y);
      },
      addPoint(x, y, width) {
        const p3 = { x, y };
        if (width) ctx.lineWidth = width;
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

  // 그리드 칸 배치(열/행 개수, 칸 크기)를 계산할 때 쓰는 고정 기준 비율.
  // 실제로 접속하는 태블릿이 무엇이든, 몇 대가 붙든 상관없이 항상 이 값으로
  // 배치를 계산하므로 화면 구성 자체는 절대 바뀌지 않는다.
  const GRID_REFERENCE_ASPECT = 4 / 3;
  const GRID_GAP = 10; // style.css .grid의 gap 값과 반드시 일치시켜야 한다.

  let ws;
  let tabletCount = 10;
  // 접속 안 된 칸에 연결 QR코드를 만들기 위한 정보 (관리자 로그인 후 채워짐).
  let hostBase = '';
  let tabletToken = '';
  const cells = new Map(); // id -> { canvas, ctx, header, content, wrap, dot, savedBadge, qrHolder, qrBuilt, aspect }

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

      const content = document.createElement('div');
      content.className = 'cell-content';

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#111';

      // 접속 전 안내: "스캔해서 연결" QR코드가 뜨는 오버레이.
      const qrHolder = document.createElement('div');
      qrHolder.className = 'cell-qr';
      const qrInner = document.createElement('div');
      qrInner.className = 'cell-qr-inner';
      const qrLabel = document.createElement('div');
      qrLabel.className = 'cell-qr-label';
      qrLabel.textContent = `태블릿 ${id} · 스캔해서 연결`;
      qrHolder.appendChild(qrInner);
      qrHolder.appendChild(qrLabel);

      content.appendChild(canvas);
      content.appendChild(qrHolder);
      cell.appendChild(header);
      cell.appendChild(content);
      grid.appendChild(cell);

      cells.set(id, { id, canvas, ctx, header, content, wrap: cell, dot, savedBadge, qrHolder, qrInner, qrBuilt: false, aspect: null, drawer: createSmoothDrawer(ctx), queue: [], history: [] });
    }
    layoutGrid();
  }

  // 태블릿 개수(N)와 고정 기준 비율로, 스크롤 없이 화면 안에 전부 들어가도록
  // 열/행 개수와 각 칸의 정확한 픽셀 크기를 계산한다. 이 값들은 실제 접속된
  // 태블릿 화면 비율과 무관하게 항상 동일하게 나온다 (화상회의 그리드 배치 방식).
  function computeLayout(containerW, containerH, count, headerHeight) {
    let best = null;
    for (let cols = 1; cols <= count; cols++) {
      const rows = Math.ceil(count / cols);

      const cellWFromWidth = (containerW - GRID_GAP * (cols - 1)) / cols;
      const cellHFromWidth = cellWFromWidth / GRID_REFERENCE_ASPECT + headerHeight;

      const cellHFromHeight = (containerH - GRID_GAP * (rows - 1)) / rows;
      const canvasHFromHeight = cellHFromHeight - headerHeight;

      let cellW;
      let cellH;
      if (cellHFromWidth <= cellHFromHeight) {
        cellW = cellWFromWidth;
        cellH = cellHFromWidth;
      } else {
        if (canvasHFromHeight <= 0) continue; // 이 열 구성으로는 헤더 높이도 안 나옴
        cellH = cellHFromHeight;
        cellW = canvasHFromHeight * GRID_REFERENCE_ASPECT;
      }
      if (cellW <= 0 || cellH <= 0) continue;

      // 소수점 반올림으로 인해 스크롤이 생기지 않도록, 계산된 크기보다
      // 한 픽셀 더 작게 내림 처리해 항상 컨테이너 안쪽에 들어오게 한다.
      cellW = Math.floor(cellW) - 1;
      cellH = Math.floor(cellH) - 1;
      if (cellW <= 0 || cellH <= 0) continue;

      const area = cellW * cellH;
      if (!best || area > best.area) {
        best = { cols, rows, cellW, cellH, area };
      }
    }
    return best;
  }

  function layoutGrid() {
    if (cells.size === 0) return;
    const firstCell = cells.values().next().value;
    const headerHeight = firstCell.header.getBoundingClientRect().height || 34;
    // clientWidth/Height는 padding을 포함하므로, 실제로 트랙에 쓸 수 있는
    // 안쪽 공간을 구하려면 padding만큼 빼야 스크롤 없이 정확히 들어맞는다.
    const gridStyle = window.getComputedStyle(grid);
    const paddingX = parseFloat(gridStyle.paddingLeft) + parseFloat(gridStyle.paddingRight);
    const paddingY = parseFloat(gridStyle.paddingTop) + parseFloat(gridStyle.paddingBottom);
    const containerW = grid.clientWidth - paddingX;
    const containerH = grid.clientHeight - paddingY;
    if (containerW <= 0 || containerH <= 0) return;

    const layout = computeLayout(containerW, containerH, tabletCount, headerHeight);
    if (!layout) return;

    grid.style.gridTemplateColumns = `repeat(${layout.cols}, ${layout.cellW}px)`;
    grid.style.gridTemplateRows = `repeat(${layout.rows}, ${layout.cellH}px)`;

    for (const c of cells.values()) fitCanvas(c);
  }

  // 칸(그리드 셀) 자체의 크기는 고정된 채로, 그 안에서 캔버스만 태블릿의
  // 실제 화면 비율에 맞춰(찌그러짐 없이) 최대한 크게, 가운데 정렬로 표시한다.
  // 비율이 다르면 위아래 또는 좌우에 약간의 여백이 생길 수 있지만, 칸 배치
  // 자체는 절대 바뀌지 않는다.
  function fitCanvas(c) {
    const maxW = c.content.clientWidth;
    const maxH = c.content.clientHeight;
    if (maxW <= 0 || maxH <= 0) return;
    const aspect = c.aspect || GRID_REFERENCE_ASPECT;

    let cssW = maxW;
    let cssH = cssW / aspect;
    if (cssH > maxH) {
      cssH = maxH;
      cssW = cssH * aspect;
    }

    const ratio = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(cssW * ratio));
    const h = Math.max(1, Math.round(cssH * ratio));
    if (c.canvas.width === w && c.canvas.height === h) return;

    c.canvas.style.width = `${Math.round(cssW)}px`;
    c.canvas.style.height = `${Math.round(cssH)}px`;
    c.canvas.width = w;
    c.canvas.height = h;
    c.ctx.lineJoin = 'round';
    c.ctx.lineCap = 'round';
    c.ctx.lineWidth = 3;
    c.ctx.strokeStyle = '#111';
    // 캔버스 크기를 다시 잡으면 내용이 지워지므로, 지금까지 받은 서명을 다시 그린다.
    replayHistory(c);
  }

  // 그 칸에 지금까지 그려진 서명을 정규화 좌표로 보관해뒀다가, 캔버스 크기가
  // 바뀌면(창 크기 변경 등) 다시 그려 모니터에서도 서명이 지워지지 않게 한다.
  function replayHistory(c) {
    c.ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
    const drawer = createSmoothDrawer(c.ctx);
    for (const p of c.history) {
      const px = p.x * c.canvas.width;
      const py = p.y * c.canvas.height;
      const width = p.w ? p.w * c.canvas.width : undefined;
      if (p.type === 'start') drawer.reset(px, py, width);
      else if (p.type === 'point') drawer.addPoint(px, py, width);
    }
    c.drawer = drawer;
  }

  let resizeDebounce;
  window.addEventListener('resize', () => {
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(layoutGrid, 200);
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
        const width = p.w ? p.w * c.canvas.width : undefined;
        if (p.type === 'start') c.drawer.reset(px, py, width);
        else if (p.type === 'point') c.drawer.addPoint(px, py, width);
        // 크기 변경 시 다시 그릴 수 있도록 정규화 좌표를 보관한다.
        if (p.type === 'start' || p.type === 'point') c.history.push(p);
      }
    }
    requestAnimationFrame(tickQueues);
  }
  requestAnimationFrame(tickQueues);

  // 접속 안 된 칸에 그 태블릿 전용 연결 QR코드를 만든다. (한 번만 생성)
  function buildCellQr(c) {
    if (c.qrBuilt || !hostBase || typeof QRCode === 'undefined') return;
    const signUrl = `${hostBase}/sign.html?id=${c.id}&token=${encodeURIComponent(tabletToken)}`;
    c.qrInner.innerHTML = '';
    new QRCode(c.qrInner, { text: signUrl, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
    c.qrBuilt = true;
  }

  function buildAllQr() {
    for (const c of cells.values()) buildCellQr(c);
  }

  function applyStatus(list) {
    list.forEach(({ id, online, aspect }) => {
      const c = cells.get(id);
      if (!c) return;
      c.wrap.classList.toggle('offline', !online);
      c.dot.classList.toggle('online', online);
      // 접속 안 된 칸에는 연결 QR코드를 보여주고, 접속되면 숨긴다.
      if (!online) buildCellQr(c);
      c.qrHolder.style.display = online ? 'none' : 'flex';
      // 태블릿의 실제 화면 비율을 그대로 따라가 원본과 똑같은 비율로 그린다
      // (찌그러지지 않음). 비율이 바뀌어 캔버스를 다시 잡을 때는 fitCanvas가
      // 지금까지의 서명을 다시 그려주므로(replayHistory) 지워지지 않는다.
      if (online && aspect && Math.abs(aspect - (c.aspect || 0)) > 0.01) {
        c.aspect = aspect;
        fitCanvas(c);
      }
    });
  }

  function applyStroke(id, points) {
    const c = cells.get(id);
    if (!c) return;
    c.queue.push(...points);
    // 새 서명을 다시 쓰기 시작하면(=새 손님), 이전 저장 표시등은 꺼서
    // "이번 서명은 아직 저장 전"이라는 걸 구분할 수 있게 한다.
    if (points.some((p) => p.type === 'start')) {
      c.savedBadge.classList.remove('show');
    }
  }

  function applyClear(id) {
    const c = cells.get(id);
    if (!c) return;
    c.queue.length = 0;
    c.history.length = 0;
    c.ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
  }

  function flashSaved(id) {
    const c = cells.get(id);
    if (!c) return;
    c.wrap.classList.add('flash');
    setTimeout(() => c.wrap.classList.remove('flash'), 700);

    // 다음 사람이 새로 서명을 시작하기 전까지 계속 켜져 있는 저장 표시등.
    c.savedBadge.classList.add('show');
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
        // 로그인 화면이 display:none이었을 때는 크기를 잴 수 없으므로,
        // 그리드가 실제로 화면에 보이게 된 뒤 다시 한번 배치를 계산한다.
        requestAnimationFrame(layoutGrid);
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
        flashSaved(msg.id);
      }
    });

    ws.addEventListener('close', () => {
      connStatus.textContent = '연결 끊김 - 재연결 중...';
      setTimeout(() => connect(password), 2000);
    });

    ws.addEventListener('error', () => ws.close());
  }

  // 모니터링 화면도 자동으로 꺼지지 않게 유지한다 (Screen Wake Lock).
  let wakeLock = null;
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // 미지원이거나 화면을 벗어난 경우 조용히 넘어간다.
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });

  function start(password) {
    requestWakeLock();
    fetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => {
        tabletCount = cfg.tabletCount;
        if (cfg.instanceName) {
          document.title = `[${cfg.instanceName}] 서명 실시간 모니터링`;
          document.getElementById('instanceBadge').textContent = cfg.instanceName;
          document.getElementById('instanceBadge').style.display = 'inline-block';
        }
        buildGrid();
        connect(password);
      });
    // 접속 안 된 칸에 띄울 연결 QR코드를 만들기 위해 주소·토큰을 가져온다.
    fetch('/api/host-info')
      .then((r) => r.json())
      .then(({ base, tabletToken: token }) => {
        hostBase = base;
        tabletToken = token;
        buildAllQr();
      })
      .catch(() => {});
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
