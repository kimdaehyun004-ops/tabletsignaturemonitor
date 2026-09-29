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
  let stageAspect = 0; // 0 = 자유(채우기), 그 외 = 가로/세로 비율

  const sources = new Map(); // key `${vi}:${id}` -> source
  const versionNames = []; // index -> 표시 이름
  let conns = []; // per version { url, index, ws, timer, closedByUs }
  let selectedItem = null;

  document.title = 'V태블릿 편집 · 실시간 크로마키';

  function loadVersionUrls() {
    try {
      const arr = JSON.parse(localStorage.getItem('dashboardUrls') || 'null');
      if (Array.isArray(arr) && arr.length) return arr.map((u) => u.replace(/\/+$/, ''));
    } catch {}
    return [location.origin];
  }
  let versionUrls = loadVersionUrls();

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

  // 드래그 중 다른 서명(또는 무대 중앙)과 세로 중심이 가까우면 같은 높이에 착 붙인다.
  // → 손으로 옮겨도 가로로 반듯하게 정렬된다.
  function snapItemY(item) {
    const SNAP = 9;
    const cy = item.y + item.h / 2;
    let target = null;
    if (Math.abs(cy - stage.clientHeight / 2) < SNAP) target = stage.clientHeight / 2;
    if (target === null) {
      sources.forEach((s) => s.items.forEach((it) => {
        if (it === item || target !== null) return;
        const oc = it.y + it.h / 2;
        if (Math.abs(cy - oc) < SNAP) target = oc;
      }));
    }
    if (target !== null) item.y = Math.round(target - item.h / 2);
  }

  // 무대의 모든 서명을 한 줄로(가로) 반듯하게 배치한다. 각자의 현재 비율은 유지한다.
  function arrangeRow() {
    const items = [];
    sources.forEach((s) => s.items.forEach((it) => items.push(it)));
    if (!items.length) return;
    const pad = 16;
    const n = items.length;
    let H = stage.clientHeight * 0.6;
    const aspects = items.map((it) => (it.h > 0 ? it.w / it.h : 1.6));
    const widthsAt = (h) => aspects.map((a) => h * a);
    let widths = widthsAt(H);
    let total = widths.reduce((a, b) => a + b, 0) + pad * (n - 1);
    const maxW = stage.clientWidth - pad * 2;
    if (total > maxW) {
      const sumW = widths.reduce((a, b) => a + b, 0);
      H = H * ((maxW - pad * (n - 1)) / sumW);
      widths = widthsAt(H);
      total = widths.reduce((a, b) => a + b, 0) + pad * (n - 1);
    }
    let x = Math.round((stage.clientWidth - total) / 2);
    const y = Math.round((stage.clientHeight - H) / 2);
    items.forEach((it, i) => {
      it.w = Math.round(widths[i]);
      it.h = Math.round(H);
      it.x = x;
      it.y = y;
      it.el.style.left = it.x + 'px';
      it.el.style.top = it.y + 'px';
      it.el.style.width = it.w + 'px';
      it.el.style.height = it.h + 'px';
      fitCanvas(it);
      x += it.w + pad;
    });
  }

  // 무대를 선택한 화면비로 고정한다(방송 프레임). 0이면 영역을 꽉 채운다.
  function applyStageSize() {
    const wrap = document.querySelector('.editor-stagewrap');
    if (!wrap) return;
    if (!stageAspect) {
      wrap.classList.remove('fixed-res');
      stage.style.flex = '';
      stage.style.width = '';
      stage.style.height = '';
      stage.style.margin = '';
      return;
    }
    wrap.classList.add('fixed-res');
    stage.style.flex = 'none';
    stage.style.margin = 'auto';
    const outputMode = editorEl.classList.contains('output-mode');
    const hint = wrap.querySelector('.stage-hint');
    const hintH = outputMode || !hint ? 0 : hint.offsetHeight + 8;
    const pad = outputMode ? 0 : 24;
    const availW = wrap.clientWidth - pad;
    const availH = wrap.clientHeight - hintH - pad;
    let w = availW;
    let h = w / stageAspect;
    if (h > availH) {
      h = availH;
      w = h * stageAspect;
    }
    stage.style.width = Math.max(1, Math.floor(w)) + 'px';
    stage.style.height = Math.max(1, Math.floor(h)) + 'px';
  }
  window.addEventListener('resize', applyStageSize);

  // ---------- 소스(버전+태블릿). 한 소스를 무대에 여러 개(복제) 올릴 수 있다. ----------
  function keyOf(vi, id) {
    return vi + ':' + id;
  }
  function ensureSource(vi, id) {
    const key = keyOf(vi, id);
    let s = sources.get(key);
    if (!s) {
      s = { key, vi, id, label: `${versionNames[vi] || 'V' + (vi + 1)} · 태블릿 ${id}`, online: false, history: [], queue: [], items: [] };
      sources.set(key, s);
    }
    return s;
  }
  function isPlaced(s) {
    return s.items.length > 0;
  }
  function totalItems() {
    let n = 0;
    sources.forEach((s) => (n += s.items.length));
    return n;
  }

  function renderSourceList() {
    sourceListEl.innerHTML = '';
    const list = [...sources.values()].filter((s) => s.online || isPlaced(s));
    trayCountEl.textContent = `${list.filter((s) => s.online).length}대 접속`;
    list.sort((a, b) => (a.vi - b.vi) || (a.id - b.id));
    list.forEach((s) => {
      const placed = isPlaced(s);
      const row = document.createElement('button');
      row.className = 'source-row' + (placed ? ' placed' : '') + (s.online ? '' : ' off');
      row.innerHTML = `<span class="src-dot"></span><span class="src-name"></span><span class="src-state"></span>`;
      row.querySelector('.src-name').textContent = s.label;
      row.querySelector('.src-state').textContent = placed ? `무대 ${s.items.length}개` : s.online ? '접속' : '끊김';
      row.title = placed ? '누르면 같은 서명을 하나 더 추가합니다' : '누르면 무대에 올립니다';
      row.addEventListener('click', () => addToStage(s));
      sourceListEl.appendChild(row);
    });
  }

  // ---------- 무대 배치 ----------
  function addToStage(s, opts) {
    opts = opts || {};
    const aspect = s.aspect || 1.6;
    const w = opts.w || 300;
    const h = opts.h || Math.round(w / aspect);
    let x, y;
    if (opts.x != null) {
      x = clamp(opts.x, 0, Math.max(0, stage.clientWidth - 40));
      y = clamp(opts.y, 0, Math.max(0, stage.clientHeight - 40));
    } else {
      const n = totalItems();
      x = clamp(24 + n * 26, 0, Math.max(0, stage.clientWidth - w - 10));
      y = clamp(24 + n * 22, 0, Math.max(0, stage.clientHeight - h - 10));
    }

    const el = document.createElement('div');
    el.className = 'vitem';
    el.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;z-index:${++zTop};`;

    const canvas = document.createElement('canvas');
    el.appendChild(canvas);

    const dup = document.createElement('button');
    dup.className = 'item-dup';
    dup.textContent = '⧉';
    dup.title = '같은 서명 복제';
    el.appendChild(dup);

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
    const item = { source: s, el, canvas, ctx: canvas.getContext('2d'), drawer: null, x, y, w, h };
    s.items.push(item);
    fitCanvas(item);
    selectItem(item);

    // 이동 (본체/캔버스 드래그)
    el.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('rh') || e.target === remove || e.target === dup) return;
      selectItem(item);
      el.style.zIndex = String(++zTop);
      const sx = e.clientX, sy = e.clientY;
      const ox = item.x, oy = item.y;
      el.setPointerCapture(e.pointerId);
      const move = (ev) => {
        item.x = clamp(ox + (ev.clientX - sx), -item.w + 40, stage.clientWidth - 40);
        item.y = clamp(oy + (ev.clientY - sy), -item.h + 40, stage.clientHeight - 40);
        snapItemY(item);
        el.style.left = item.x + 'px';
        el.style.top = item.y + 'px';
      };
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });

    // 자유 변형 (변/모서리 8방향, 비율 잠금 없음 → 찌그러뜨리기 가능)
    el.querySelectorAll('.rh').forEach((rh) => {
      rh.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        selectItem(item);
        const name = rh.dataset.h;
        const left = name.includes('w'), right = name.includes('e'), top = name.includes('n'), bottom = name.includes('s');
        const start = { x: item.x, y: item.y, w: item.w, h: item.h };
        const anchorRight = start.x + start.w, anchorBottom = start.y + start.h;
        const sx = e.clientX, sy = e.clientY;
        rh.setPointerCapture(e.pointerId);
        const move = (ev) => {
          const dx = ev.clientX - sx, dy = ev.clientY - sy;
          let { x, y, w: nw, h: nh } = start;
          if (right) nw = Math.max(30, start.w + dx);
          if (left) { nw = Math.max(30, start.w - dx); x = anchorRight - nw; }
          if (bottom) nh = Math.max(30, start.h + dy);
          if (top) { nh = Math.max(30, start.h - dy); y = anchorBottom - nh; }
          item.x = x; item.y = y; item.w = nw; item.h = nh;
          el.style.left = x + 'px'; el.style.top = y + 'px';
          el.style.width = nw + 'px'; el.style.height = nh + 'px';
          fitCanvas(item);
        };
        const up = () => { rh.removeEventListener('pointermove', move); rh.removeEventListener('pointerup', up); };
        rh.addEventListener('pointermove', move);
        rh.addEventListener('pointerup', up);
      });
    });

    dup.addEventListener('click', (e) => {
      e.stopPropagation();
      // 같은 서명을 하나 더(같은 크기, 살짝 옆으로) 올린다.
      addToStage(s, { x: item.x + 30, y: item.y + 30, w: item.w, h: item.h });
    });
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      removeItem(item);
    });

    renderSourceList();
    return item;
  }

  function removeItem(item) {
    item.el.remove();
    const arr = item.source.items;
    const i = arr.indexOf(item);
    if (i >= 0) arr.splice(i, 1);
    if (selectedItem === item) selectedItem = null;
    renderSourceList();
  }

  function selectItem(item) {
    selectedItem = item;
    sources.forEach((s) => s.items.forEach((it) => it.el.classList.toggle('selected', it === item)));
  }

  // 캔버스 백킹 크기를 박스에 맞추고, 지금까지의 획을 다시 그린다(자유 변형 반영).
  function fitCanvas(item) {
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(item.w));
    const ch = Math.max(1, Math.round(item.h));
    item.canvas.style.width = cw + 'px';
    item.canvas.style.height = ch + 'px';
    item.canvas.width = Math.round(cw * dpr);
    item.canvas.height = Math.round(ch * dpr);
    replay(item);
  }

  function replay(item) {
    const ctx = item.ctx;
    ctx.clearRect(0, 0, item.canvas.width, item.canvas.height);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = inkColor;
    const drawer = createSmoothDrawer(ctx);
    for (const p of item.source.history) {
      const px = p.x * item.canvas.width;
      const py = p.y * item.canvas.height;
      const width = p.w ? p.w * item.canvas.width : undefined;
      if (p.type === 'start') drawer.reset(px, py, width);
      else if (p.type === 'point') drawer.addPoint(px, py, width);
    }
    item.drawer = drawer;
  }

  function retintAll() {
    sources.forEach((s) => s.items.forEach(replay));
  }

  // ---------- 실시간 그리기 루프 ----------
  function tick() {
    sources.forEach((s) => {
      if (!s.items.length) return;
      const backlog = s.queue.length;
      if (backlog === 0) return;
      const drain = backlog > 30 ? backlog - 8 : Math.min(4, backlog);
      for (let i = 0; i < drain; i++) {
        const p = s.queue.shift();
        if (p.type === 'start' || p.type === 'point') s.history.push(p);
        s.items.forEach((it) => {
          if (!it.drawer) return;
          const px = p.x * it.canvas.width;
          const py = p.y * it.canvas.height;
          const width = p.w ? p.w * it.canvas.width : undefined;
          if (p.type === 'start') it.drawer.reset(px, py, width);
          else if (p.type === 'point') it.drawer.addPoint(px, py, width);
        });
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
        if (autoAdd && t.online && !isPlaced(s)) addToStage(s);
      });
      renderSourceList();
    } else if (msg.type === 'stroke') {
      const s = ensureSource(vi, msg.id);
      s.online = true;
      s.queue.push(...msg.points);
      if (autoAdd && !isPlaced(s)) addToStage(s);
    } else if (msg.type === 'clear') {
      const s = ensureSource(vi, msg.id);
      s.queue.length = 0;
      s.history.length = 0;
      s.items.forEach((it) => {
        it.ctx.clearRect(0, 0, it.canvas.width, it.canvas.height);
        it.drawer = createSmoothDrawer(it.ctx);
        it.ctx.strokeStyle = inkColor;
      });
    } else if (msg.type === 'auth_error') {
      loginError.textContent = (versionNames[vi] || 'V' + (vi + 1)) + ' 연결 실패: ' + (msg.message || '');
    }
  }

  function connectAll() {
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
  const resSelect = document.getElementById('resSelect');
  const resCustom = document.getElementById('resCustom');
  resSelect.addEventListener('change', () => {
    if (resSelect.value === 'custom') {
      resCustom.style.display = 'inline-block';
      return;
    }
    resCustom.style.display = 'none';
    stageAspect = parseFloat(resSelect.value) || 0;
    applyStageSize();
  });
  resCustom.addEventListener('change', () => {
    const m = resCustom.value.match(/(\d+(?:\.\d+)?)\s*[x×:]\s*(\d+(?:\.\d+)?)/);
    if (m) {
      const a = parseFloat(m[1]) / parseFloat(m[2]);
      if (isFinite(a) && a > 0) {
        stageAspect = a;
        applyStageSize();
      }
    }
  });
  document.getElementById('autoAdd').addEventListener('change', (e) => { autoAdd = e.target.checked; });
  document.getElementById('addAllBtn').addEventListener('click', () => {
    sources.forEach((s) => { if (s.online && !isPlaced(s)) addToStage(s); });
  });
  document.getElementById('rowBtn').addEventListener('click', arrangeRow);
  document.getElementById('clearStageBtn').addEventListener('click', () => {
    sources.forEach((s) => s.items.slice().forEach(removeItem));
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
    if (e.target === stage) { selectedItem = null; sources.forEach((s) => s.items.forEach((it) => it.el.classList.remove('selected'))); }
  });

  // 출력 모드
  const exitOutputBtn = document.getElementById('exitOutput');
  const clearOutBtn = document.getElementById('clearOut');
  let screenDetails = null;
  let targetScreen = null;

  function clearStage() {
    sources.forEach((s) => s.items.slice().forEach(removeItem));
  }

  function fullscreenOut() {
    const el = document.documentElement;
    if (!el.requestFullscreen) return;
    const opts = targetScreen ? { screen: targetScreen } : undefined;
    Promise.resolve()
      .then(() => el.requestFullscreen(opts))
      .catch(() => { if (opts) el.requestFullscreen().catch(() => {}); });
  }
  function setOutput(on) {
    editorEl.classList.toggle('output-mode', on);
    exitOutputBtn.style.display = on ? 'block' : 'none';
    clearOutBtn.style.display = on ? 'block' : 'none';
    if (on) fullscreenOut();
    else if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); }
    setTimeout(applyStageSize, 60);
  }
  document.getElementById('outputBtn').addEventListener('click', () => setOutput(true));
  exitOutputBtn.addEventListener('click', () => setOutput(false));
  clearOutBtn.addEventListener('click', () => {
    if (confirm('무대의 모든 서명을 지울까요?')) clearStage();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOutput(false); });

  const screenSelect = document.getElementById('screenSelect');
  document.getElementById('screenBtn').addEventListener('click', async () => {
    if (!('getScreenDetails' in window)) {
      alert('이 브라우저는 모니터 선택을 지원하지 않습니다.\n출력할 모니터로 이 창을 옮긴 뒤 "출력 모드"를 누르면 그 모니터에 전체화면으로 표시됩니다.');
      return;
    }
    try {
      if (!screenDetails) screenDetails = await window.getScreenDetails();
    } catch {
      alert('모니터 접근 권한이 필요합니다. 주소창 옆 권한 아이콘에서 "화면 관리"를 허용해주세요.');
      return;
    }
    const build = () => {
      screenSelect.innerHTML = '';
      screenDetails.screens.forEach((s, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = `모니터 ${i + 1} (${s.width}×${s.height})${s.isPrimary ? ' · 주모니터' : ''}`;
        screenSelect.appendChild(opt);
      });
      const cur = screenDetails.screens.indexOf(screenDetails.currentScreen);
      screenSelect.value = String(cur >= 0 ? cur : 0);
      targetScreen = screenDetails.screens[parseInt(screenSelect.value, 10)] || null;
    };
    build();
    screenDetails.addEventListener && screenDetails.addEventListener('screenschange', build);
    screenSelect.style.display = 'inline-block';
  });
  screenSelect.addEventListener('change', () => {
    if (screenDetails) targetScreen = screenDetails.screens[parseInt(screenSelect.value, 10)] || null;
    if (editorEl.classList.contains('output-mode')) fullscreenOut();
  });

  // ---------- 로그인 ----------
  function enter() {
    fetch(`/api/status?pw=${encodeURIComponent(pw)}`, { cache: 'no-store' })
      .then((r) => {
        if (r.status === 401) throw new Error('auth');
        return r.json();
      })
      .then(() => {
        sessionStorage.setItem('adminPassword', pw);
        try { localStorage.setItem('veditPassword', pw); } catch {}
        loginEl.style.display = 'none';
        editorEl.style.display = 'flex';
        applyBg();
        applyStageSize();
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

  let autoPw = '';
  try { autoPw = new URLSearchParams(location.search).get('pw') || ''; } catch {}
  if (!autoPw) { try { autoPw = localStorage.getItem('veditPassword') || ''; } catch {} }
  if (!autoPw) { try { autoPw = sessionStorage.getItem('adminPassword') || ''; } catch {} }
  if (autoPw) { pw = autoPw; enter(); }
})();
