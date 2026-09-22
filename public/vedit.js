(function () {
  // 모니터와 동일한 부드러운 곡선 드로잉(정규화 좌표로 저장해 크기가 바뀌면 다시 그린다).
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
  const editorEl = document.getElementById('editorPage');
  const passwordInput = document.getElementById('passwordInput');
  const loginError = document.getElementById('loginError');
  const stage = document.getElementById('stage');
  const sourceListEl = document.getElementById('sourceList');
  const trayCountEl = document.getElementById('trayCount');

  let pw = '';
  let bgColor = '#00B140';
  let inkColor = '#111111';
  let autoAdd = true;
  let zTop = 1;

  const sources = new Map(); // key `${vi}:${id}` -> source
  const versionNames = []; // index -> 표시 이름
  let conns = []; // per version { url, index, ws, timer, closedByUs }

  document.title = 'V태블릿 편집 · 실시간 크로마키';

  // ---------- 버전 주소 목록 (대시보드와 같은 localStorage 키 공유) ----------
  function loadVersionUrls() {
    try {
      const arr = JSON.parse(localStorage.getItem('dashboardUrls') || 'null');
      if (Array.isArray(arr) && arr.length) return arr.map((u) => u.replace(/\/+$/, ''));
    } catch {}
    return [location.origin];
  }
  let versionUrls = loadVersionUrls();

  // ---------- 색 ----------
  function applyBg() {
    if (bgColor === 'transparent') {
      stage.classList.add('transparent');
      stage.style.background = '';
    } else {
      stage.classList.remove('transparent');
      stage.style.background = bgColor;
    }
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  // ---------- 소스(버전+태블릿) ----------
  function keyOf(vi, id) {
    return vi + ':' + id;
  }
  function ensureSource(vi, id) {
    const key = keyOf(vi, id);
    let s = sources.get(key);
    if (!s) {
      s = { key, vi, id, label: `${versionNames[vi] || 'V' + (vi + 1)} · 태블릿 ${id}`, online: false, history: [], queue: [], placed: false, item: null };
      sources.set(key, s);
    }
    return s;
  }

  function renderSourceList() {
    sourceListEl.innerHTML = '';
    const list = [...sources.values()].filter((s) => s.online || s.placed);
    trayCountEl.textContent = `${list.filter((s) => s.online).length}대 접속`;
    list.sort((a, b) => (a.vi - b.vi) || (a.id - b.id));
    list.forEach((s) => {
      const row = document.createElement('button');
      row.className = 'source-row' + (s.placed ? ' placed' : '') + (s.online ? '' : ' off');
      row.innerHTML = `<span class="src-dot"></span><span class="src-name"></span><span class="src-state"></span>`;
      row.querySelector('.src-name').textContent = s.label;
      row.querySelector('.src-state').textContent = s.placed ? '무대에 있음' : s.online ? '접속' : '끊김';
      row.addEventListener('click', () => {
        if (!s.placed) addToStage(s);
      });
      sourceListEl.appendChild(row);
    });
  }

  // ---------- 무대 배치 ----------
  function addToStage(s) {
    if (s.placed) return;
    const aspect = s.aspect || 1.6;
    const w = 300;
    const h = Math.round(w / aspect);
    const n = [...sources.values()].filter((o) => o.placed).length;
    const x = clamp(24 + n * 26, 0, Math.max(0, stage.clientWidth - w - 10));
    const y = clamp(24 + n * 22, 0, Math.max(0, stage.clientHeight - h - 10));

    const el = document.createElement('div');
    el.className = 'vitem';
    el.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;z-index:${++zTop};`;

    const canvas = document.createElement('canvas');
    el.appendChild(canvas);

    const remove = document.createElement('button');
    remove.className = 'item-remove';
    remove.textContent = '×';
    remove.title = '무대에서 빼기';
    el.appendChild(remove);

    ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((h2) => {
      const rh = document.createElement('div');
      rh.className = 'rh rh-' + h2;
      rh.dataset.h = h2;
      el.appendChild(rh);
    });

    const label = document.createElement('div');
    label.className = 'vitem-label';
    label.textContent = s.label;
    el.appendChild(label);

    stage.appendChild(el);
    s.item = { el, canvas, ctx: canvas.getContext('2d'), drawer: null, x, y, w, h };
    s.placed = true;
    fitCanvas(s);
    selectItem(s);

    // 이동 (본체/캔버스 드래그)
    el.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('rh') || e.target === remove) return;
      selectItem(s);
      el.style.zIndex = String(++zTop);
      const sx = e.clientX, sy = e.clientY;
      const ox = s.item.x, oy = s.item.y;
      el.setPointerCapture(e.pointerId);
      const move = (ev) => {
        s.item.x = clamp(ox + (ev.clientX - sx), -s.item.w + 40, stage.clientWidth - 40);
        s.item.y = clamp(oy + (ev.clientY - sy), -s.item.h + 40, stage.clientHeight - 40);
        el.style.left = s.item.x + 'px';
        el.style.top = s.item.y + 'px';
      };
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });

    // 자유 변형 (변/모서리 8방향, 비율 잠금 없음 → 찌그러뜨리기 가능)
    el.querySelectorAll('.rh').forEach((rh) => {
      rh.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        selectItem(s);
        const name = rh.dataset.h;
        const left = name.includes('w'), right = name.includes('e'), top = name.includes('n'), bottom = name.includes('s');
        const start = { x: s.item.x, y: s.item.y, w: s.item.w, h: s.item.h };
        const anchorRight = start.x + start.w, anchorBottom = start.y + start.h;
        const sx = e.clientX, sy = e.clientY;
        rh.setPointerCapture(e.pointerId);
        const move = (ev) => {
          const dx = ev.clientX - sx, dy = ev.clientY - sy;
          let { x, y, w, h } = start;
          if (right) w = Math.max(30, start.w + dx);
          if (left) { w = Math.max(30, start.w - dx); x = anchorRight - w; }
          if (bottom) h = Math.max(30, start.h + dy);
          if (top) { h = Math.max(30, start.h - dy); y = anchorBottom - h; }
          s.item.x = x; s.item.y = y; s.item.w = w; s.item.h = h;
          el.style.left = x + 'px'; el.style.top = y + 'px';
          el.style.width = w + 'px'; el.style.height = h + 'px';
          fitCanvas(s);
        };
        const up = () => { rh.removeEventListener('pointermove', move); rh.removeEventListener('pointerup', up); };
        rh.addEventListener('pointermove', move);
        rh.addEventListener('pointerup', up);
      });
    });

    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromStage(s);
    });

    renderSourceList();
  }

  function removeFromStage(s) {
    if (s.item) s.item.el.remove();
    s.item = null;
    s.placed = false;
    if (selectedSource === s) selectedSource = null;
    renderSourceList();
  }

  let selectedSource = null;
  function selectItem(s) {
    selectedSource = s;
    sources.forEach((o) => { if (o.item) o.item.el.classList.toggle('selected', o === s); });
  }

  // 캔버스 백킹 크기를 박스에 맞추고, 지금까지의 획을 다시 그린다(자유 변형 반영).
  function fitCanvas(s) {
    const it = s.item;
    if (!it) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(it.w));
    const ch = Math.max(1, Math.round(it.h));
    it.canvas.style.width = cw + 'px';
    it.canvas.style.height = ch + 'px';
    it.canvas.width = Math.round(cw * dpr);
    it.canvas.height = Math.round(ch * dpr);
    replay(s);
  }

  function replay(s) {
    const it = s.item;
    if (!it) return;
    const ctx = it.ctx;
    ctx.clearRect(0, 0, it.canvas.width, it.canvas.height);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = inkColor;
    const drawer = createSmoothDrawer(ctx);
    for (const p of s.history) {
      const px = p.x * it.canvas.width;
      const py = p.y * it.canvas.height;
      const width = p.w ? p.w * it.canvas.width : undefined;
      if (p.type === 'start') drawer.reset(px, py, width);
      else if (p.type === 'point') drawer.addPoint(px, py, width);
    }
    it.drawer = drawer;
  }

  function retintAll() {
    sources.forEach((s) => { if (s.placed) replay(s); });
  }

  // ---------- 실시간 그리기 루프 ----------
  function tick() {
    sources.forEach((s) => {
      if (!s.placed || !s.item) return;
      const backlog = s.queue.length;
      if (backlog === 0) return;
      const drain = backlog > 30 ? backlog - 8 : Math.min(4, backlog);
      const it = s.item;
      for (let i = 0; i < drain; i++) {
        const p = s.queue.shift();
        if (p.type === 'start' || p.type === 'point') s.history.push(p);
        if (!it.drawer) continue;
        const px = p.x * it.canvas.width;
        const py = p.y * it.canvas.height;
        const width = p.w ? p.w * it.canvas.width : undefined;
        if (p.type === 'start') it.drawer.reset(px, py, width);
        else if (p.type === 'point') it.drawer.addPoint(px, py, width);
      }
    });
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------- 버전 연결 (실시간 모니터 WS) ----------
  function handleMsg(vi, msg) {
    if (msg.type === 'status') {
      (msg.tablets || []).forEach((t) => {
        const s = ensureSource(vi, t.id);
        s.online = !!t.online;
        if (t.aspect) s.aspect = t.aspect;
        if (autoAdd && t.online && !s.placed) addToStage(s);
      });
      renderSourceList();
    } else if (msg.type === 'stroke') {
      const s = ensureSource(vi, msg.id);
      s.online = true;
      s.queue.push(...msg.points);
      if (autoAdd && !s.placed) addToStage(s);
    } else if (msg.type === 'clear') {
      const s = ensureSource(vi, msg.id);
      s.queue.length = 0;
      s.history.length = 0;
      if (s.item) s.item.ctx.clearRect(0, 0, s.item.canvas.width, s.item.canvas.height), (s.item.drawer = createSmoothDrawer(s.item.ctx)), (s.item.ctx.strokeStyle = inkColor);
    } else if (msg.type === 'auth_error') {
      loginError.textContent = (versionNames[vi] || 'V' + (vi + 1)) + ' 연결 실패: ' + (msg.message || '');
    }
  }

  function connectAll() {
    // 기존 연결 정리
    conns.forEach((c) => { c.closedByUs = true; if (c.timer) clearTimeout(c.timer); try { c.ws && c.ws.close(); } catch {} });
    conns = versionUrls.map((url, index) => {
      const c = { url, index, ws: null, timer: null, closedByUs: false };
      const wsUrl = url.replace(/^http/, 'ws');
      function open() {
        if (c.closedByUs) return;
        let ws;
        try { ws = new WebSocket(wsUrl); } catch { c.timer = setTimeout(open, 3000); return; }
        c.ws = ws;
        ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'hello', role: 'monitor', password: pw })));
        ws.addEventListener('message', (ev) => { try { handleMsg(index, JSON.parse(ev.data)); } catch {} });
        ws.addEventListener('close', () => { if (!c.closedByUs) c.timer = setTimeout(open, 3000); });
        ws.addEventListener('error', () => { try { ws.close(); } catch {} });
      }
      open();
      return c;
    });
  }

  // 각 버전 이름을 미리 가져온다(표시용). /api/status는 CORS 허용.
  function loadVersionNames() {
    return Promise.all(
      versionUrls.map((url, i) =>
        fetch(`${url}/api/status?pw=${encodeURIComponent(pw)}`, { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => { versionNames[i] = (d && d.instanceName) || 'V' + (i + 1); })
          .catch(() => { versionNames[i] = 'V' + (i + 1); })
      )
    );
  }

  // ---------- 툴바 ----------
  document.querySelectorAll('.bg-preset').forEach((b) => {
    b.addEventListener('click', () => {
      bgColor = b.getAttribute('data-bg');
      if (bgColor !== 'transparent') document.getElementById('bgCustom').value = bgColor;
      applyBg();
    });
  });
  document.getElementById('bgCustom').addEventListener('input', (e) => { bgColor = e.target.value; applyBg(); });
  document.querySelectorAll('.ink-preset').forEach((b) => {
    b.addEventListener('click', () => { inkColor = b.getAttribute('data-ink'); document.getElementById('inkCustom').value = inkColor; retintAll(); });
  });
  document.getElementById('inkCustom').addEventListener('input', (e) => { inkColor = e.target.value; retintAll(); });
  document.getElementById('autoAdd').addEventListener('change', (e) => { autoAdd = e.target.checked; });
  document.getElementById('addAllBtn').addEventListener('click', () => {
    sources.forEach((s) => { if (s.online && !s.placed) addToStage(s); });
  });
  document.getElementById('clearStageBtn').addEventListener('click', () => {
    [...sources.values()].forEach((s) => { if (s.placed) removeFromStage(s); });
  });
  document.getElementById('versionsBtn').addEventListener('click', () => {
    const box = document.getElementById('versionsBox');
    document.getElementById('versionsInput').value = versionUrls.join('\n');
    box.style.display = box.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('versionsSave').addEventListener('click', () => {
    const list = document.getElementById('versionsInput').value.split('\n').map((u) => u.trim().replace(/\/+$/, '')).filter((u) => /^https?:\/\//.test(u));
    versionUrls = list.length ? list : [location.origin];
    localStorage.setItem('dashboardUrls', JSON.stringify(versionUrls));
    document.getElementById('versionsBox').style.display = 'none';
    loadVersionNames().then(connectAll);
  });
  stage.addEventListener('pointerdown', (e) => {
    if (e.target === stage) { selectedSource = null; sources.forEach((o) => { if (o.item) o.item.el.classList.remove('selected'); }); }
  });

  // 출력 모드: 무대만 크게 (방송/키잉용). 실제 전체화면도 함께 시도.
  const exitOutputBtn = document.getElementById('exitOutput');
  function setOutput(on) {
    editorEl.classList.toggle('output-mode', on);
    exitOutputBtn.style.display = on ? 'block' : 'none';
    if (on) { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); }
    else if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); }
  }
  document.getElementById('outputBtn').addEventListener('click', () => setOutput(true));
  exitOutputBtn.addEventListener('click', () => setOutput(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOutput(false); });

  // ---------- 로그인 ----------
  function enter() {
    // 현재 버전으로 비번 확인 후 진입
    fetch(`/api/status?pw=${encodeURIComponent(pw)}`, { cache: 'no-store' })
      .then((r) => {
        if (r.status === 401) throw new Error('auth');
        return r.json();
      })
      .then(() => {
        sessionStorage.setItem('adminPassword', pw);
        // 이 기기에서는 다음부터 비밀번호 없이 바로 들어오도록 기억한다.
        try { localStorage.setItem('veditPassword', pw); } catch {}
        loginEl.style.display = 'none';
        editorEl.style.display = 'flex';
        applyBg();
        return loadVersionNames();
      })
      .then(connectAll)
      .catch(() => {
        loginEl.style.display = 'block';
        loginError.textContent = '비밀번호가 올바르지 않습니다.';
        try { localStorage.removeItem('veditPassword'); } catch {}
      });
  }
  document.getElementById('loginBtn').addEventListener('click', () => {
    pw = passwordInput.value;
    if (!pw) return;
    enter();
  });
  passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('loginBtn').click(); });

  // 비밀번호 없이 접속: 링크의 ?pw= 값, 이 기기에 기억된 값, 또는 관리자 세션 순으로
  // 자동 로그인한다. 한 번만 설정해두면 다음부터는 로그인 화면 없이 바로 들어온다.
  let autoPw = '';
  try { autoPw = new URLSearchParams(location.search).get('pw') || ''; } catch {}
  if (!autoPw) { try { autoPw = localStorage.getItem('veditPassword') || ''; } catch {} }
  if (!autoPw) { try { autoPw = sessionStorage.getItem('adminPassword') || ''; } catch {} }
  if (autoPw) { pw = autoPw; enter(); }
})();
