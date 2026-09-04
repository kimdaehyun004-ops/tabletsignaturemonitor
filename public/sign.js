(function () {
  // 연속된 점 3개의 중점을 이어 2차 베지어 곡선으로 그리면
  // 직선 이어그리기보다 훨씬 부드럽고 끊김 없는 필기감을 만들 수 있다.
  // width를 매 구간마다 바꿔주면 실제 펜처럼 굵기가 자연스럽게 변한다.
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

  // 굵기를 일정하게 유지해 깔끔한 펜 선으로 그린다. 값은 사용자가 고를 수 있고
  // 브라우저에 저장되어 유지된다.
  let PEN_WIDTH = parseFloat(localStorage.getItem('penWidth') || '2.8') || 2.8;
  function createWidthTracker() {
    return {
      reset() {},
      next() {
        return PEN_WIDTH;
      },
    };
  }

  // 화면이 자동으로 꺼지지 않게 유지한다 (Screen Wake Lock).
  // 화면을 잠깐 벗어나면 잠금이 풀리므로, 다시 보일 때마다 재요청한다.
  let wakeLock = null;
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch {
      // 사용자가 화면을 벗어났거나 미지원 환경이면 조용히 넘어간다.
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });

  // 서명 중 길게 눌러 뜨는 메뉴(컨텍스트 메뉴)를 막아 실수 조작을 줄인다.
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  const params = new URLSearchParams(location.search);
  let tabletId = params.get('id') || localStorage.getItem('tabletId');
  let token = params.get('token') || localStorage.getItem('tabletToken');

  const setupEl = document.getElementById('setup');
  const signPageEl = document.getElementById('signPage');
  const idSelect = document.getElementById('idSelect');
  const tokenInput = document.getElementById('tokenInput');
  const setupError = document.getElementById('setupError');

  function showSetup() {
    setupEl.style.display = 'block';
    signPageEl.style.display = 'none';
    fetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => {
        idSelect.innerHTML = '';
        for (let i = 1; i <= cfg.tabletCount; i++) {
          const opt = document.createElement('option');
          opt.value = i;
          opt.textContent = `태블릿 ${i}`;
          idSelect.appendChild(opt);
        }
      });
  }

  document.getElementById('startBtn').addEventListener('click', () => {
    tabletId = idSelect.value;
    token = tokenInput.value;
    if (!token) {
      setupError.textContent = '토큰을 입력하세요.';
      return;
    }
    localStorage.setItem('tabletId', tabletId);
    localStorage.setItem('tabletToken', token);
    setupEl.style.display = 'none';
    signPageEl.style.display = 'flex';
    document.documentElement.requestFullscreen().catch(() => {});
    requestWakeLock();
    init();
  });

  if (!tabletId || !token) {
    showSetup();
    return;
  }

  signPageEl.style.display = 'flex';
  requestWakeLock();
  init();

  function init() {
    document.getElementById('tabletLabel').textContent = `태블릿 ${tabletId}`;
    // v1/v2/v3처럼 여러 버전을 동시에 운영할 때, 이 태블릿이 어느 버전에
    // 연결되어 있는지 화면에서 바로 확인할 수 있게 표시한다.
    fetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => {
        if (cfg.instanceName) {
          document.getElementById('tabletLabel').textContent = `태블릿 ${tabletId} · ${cfg.instanceName}`;
          document.title = `[${cfg.instanceName}] 서명 - 태블릿 ${tabletId}`;
        }
      })
      .catch(() => {});

    const signPageEl2 = document.getElementById('signPage');
    const canvas = document.getElementById('signCanvas');
    const ctx = canvas.getContext('2d');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const miniDot = document.getElementById('miniDot');
    const miniText = document.getElementById('miniText');
    const miniStatus = document.getElementById('miniStatus');
    const toast = document.getElementById('toast');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const hideUiBtn = document.getElementById('hideUiBtn');

    function updateFullscreenBtn() {
      fullscreenBtn.textContent = document.fullscreenElement ? '⛶ 전체화면 종료' : '⛶ 전체화면';
    }
    fullscreenBtn.addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    });
    document.addEventListener('fullscreenchange', updateFullscreenBtn);

    // 펜 굵기 선택 (얇게/보통/굵게/매우 굵게). 선택값은 브라우저에 저장된다.
    const penWidthSelect = document.getElementById('penWidthSelect');
    penWidthSelect.value = String(PEN_WIDTH);
    penWidthSelect.addEventListener('change', () => {
      PEN_WIDTH = parseFloat(penWidthSelect.value) || 2.8;
      localStorage.setItem('penWidth', String(PEN_WIDTH));
    });

    // 화면 정리(숨김) 모드: 상단바·하단 버튼을 숨기고 서명 영역만 남긴다.
    // 좌상단 미니 표시등을 더블 터치하면 다시 나타난다.
    function setUiHidden(hidden) {
      signPageEl2.classList.toggle('ui-hidden', hidden);
      // 상단바/하단 버튼이 사라지거나 나타나면 캔버스 영역 크기가 달라지므로
      // 다시 계산해 서명을 새 크기에 맞춰 복원한다 (resizeCanvas가 redraw 호출).
      requestAnimationFrame(resizeCanvas);
    }
    hideUiBtn.addEventListener('click', () => setUiHidden(true));

    // 더블 터치(빠르게 두 번) 감지 → UI 복원
    let lastTapTime = 0;
    function handleMiniTap() {
      const now = Date.now();
      if (now - lastTapTime < 400) {
        lastTapTime = 0;
        setUiHidden(false);
      } else {
        lastTapTime = now;
      }
    }
    miniStatus.addEventListener('click', handleMiniTap);

    let ws;
    let reconnectDelay = 1000;
    let pendingPoints = [];
    let flushScheduled = false;
    let drawing = false;

    const signBg = document.getElementById('signBg');
    const canvasWrap = document.getElementById('canvasWrap');

    // 관리자가 올린 배경 이미지를 화면에 표시하거나 숨긴다.
    // version 값을 붙여 이미지가 바뀌면 브라우저 캐시를 우회해 새로 불러온다.
    function applyBackground(hasBackground, version) {
      if (hasBackground) {
        signBg.src = `/api/background?id=${encodeURIComponent(tabletId)}&v=${version || 0}`;
        signBg.style.display = 'block';
        canvasWrap.classList.add('has-bg');
      } else {
        signBg.style.display = 'none';
        signBg.removeAttribute('src');
        canvasWrap.classList.remove('has-bg');
      }
    }

    // 태블릿마다 실제 화면 비율이 다를 수 있으므로, 모니터링 화면이 이 비율을
    // 그대로 따라 그려야 서명이 늘어나거나 찌그러지지 않고 원본과 똑같이 보인다.
    function currentAspect() {
      const rect = canvas.getBoundingClientRect();
      return rect.height > 0 ? rect.width / rect.height : 4 / 3;
    }

    // 지금까지 그린 서명 획을 정규화 좌표(0~1)로 보관해, 화면 회전 등으로
    // 캔버스 크기가 다시 잡혀도 그대로 다시 그려서 서명이 지워지지 않게 한다.
    let strokeHistory = [];

    function redraw() {
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const drawer = createSmoothDrawer(ctx);
      for (const p of strokeHistory) {
        const px = p.x * rect.width;
        const py = p.y * rect.height;
        const width = p.w ? p.w * rect.width : undefined;
        if (p.type === 'start') drawer.reset(px, py, width);
        else if (p.type === 'point') drawer.addPoint(px, py, width);
      }
    }

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      ctx.scale(ratio, ratio);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#111';
      // 크기를 다시 잡으면 캔버스가 비워지므로, 기존 서명을 다시 그려 복원한다.
      redraw();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'aspect', aspect: currentAspect() }));
      }
    }
    window.addEventListener('resize', resizeCanvas);
    // 일부 태블릿 브라우저는 회전 직후 resize 이벤트가 늦게 오거나 치수가
    // 안정되기 전에 와서, 화면 회전 후 살짝 지연을 두고 한번 더 재계산한다.
    window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 300));
    resizeCanvas();

    function setStatus(online, text) {
      statusDot.classList.toggle('online', online);
      statusText.textContent = text;
      // 숨김 모드의 좌상단 미니 표시등도 함께 갱신한다.
      miniDot.classList.toggle('online', online);
      miniText.textContent = text;
    }

    function connect() {
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${protocol}://${location.host}`);

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'hello', role: 'tablet', id: tabletId, token, aspect: currentAspect() }));
      });

      ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'auth_ok') {
          setStatus(true, '연결됨');
          reconnectDelay = 1000;
        } else if (msg.type === 'auth_error') {
          setStatus(false, '인증 실패: ' + msg.message);
          localStorage.removeItem('tabletToken');
          ws.close();
        } else if (msg.type === 'background') {
          applyBackground(msg.hasBackground, msg.version);
        } else if (msg.type === 'remote_clear') {
          // 모니터(관리자/게스트)가 원격으로 이 태블릿 화면을 지웠다.
          drawing = false;
          activePointerId = null;
          strokeHistory = [];
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          toast.textContent = '화면이 초기화되었습니다';
          toast.classList.add('show');
          setTimeout(() => {
            toast.classList.remove('show');
            toast.textContent = '저장되었습니다';
          }, 1200);
        }
      });

      ws.addEventListener('close', () => {
        setStatus(false, '재연결 중...');
        setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
      });

      ws.addEventListener('error', () => ws.close());
    }
    connect();

    function normPoint(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left) / rect.width,
        y: (clientY - rect.top) / rect.height,
      };
    }

    function queuePoint(type, x, y, w) {
      // 회전 시 복원을 위해 로컬에도 보관하고, 모니터로도 전송한다.
      strokeHistory.push({ type, x, y, w });
      pendingPoints.push({ type, x, y, w });
      if (!flushScheduled) {
        flushScheduled = true;
        requestAnimationFrame(flushPoints);
      }
    }

    function flushPoints() {
      flushScheduled = false;
      if (pendingPoints.length === 0) return;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stroke', points: pendingPoints }));
      }
      pendingPoints = [];
    }

    const localDrawer = createSmoothDrawer(ctx);
    const widthTracker = createWidthTracker();

    // 서명 중 손바닥이나 두 번째 손가락이 화면에 닿아도 흔들리지 않도록,
    // 먼저 닿은 손가락(pointerId) 하나만 인식하고 나머지는 무시한다.
    let activePointerId = null;

    canvas.addEventListener('pointerdown', (e) => {
      if (activePointerId !== null) return; // 이미 다른 손가락으로 그리는 중
      activePointerId = e.pointerId;
      drawing = true;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // 일부 브라우저 환경에서 드물게 실패할 수 있으나, 그리기 자체는 계속 진행한다.
      }
      const { x, y } = normPoint(e.clientX, e.clientY);
      const rect = canvas.getBoundingClientRect();
      widthTracker.reset();
      const width = widthTracker.next(x * rect.width, y * rect.height, e.timeStamp);
      localDrawer.reset(x * rect.width, y * rect.height, width);
      queuePoint('start', x, y, width / rect.width);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!drawing || e.pointerId !== activePointerId) return;
      const { x, y } = normPoint(e.clientX, e.clientY);
      const rect = canvas.getBoundingClientRect();
      const width = widthTracker.next(x * rect.width, y * rect.height, e.timeStamp);
      localDrawer.addPoint(x * rect.width, y * rect.height, width);
      queuePoint('point', x, y, width / rect.width);
    });

    function endStroke(e) {
      if (!drawing || e.pointerId !== activePointerId) return;
      drawing = false;
      activePointerId = null;
      const { x, y } = normPoint(e.clientX, e.clientY);
      queuePoint('end', x, y);
    }
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);

    document.getElementById('clearBtn').addEventListener('click', () => {
      strokeHistory = [];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'clear' }));
      }
    });

    document.getElementById('saveBtn').addEventListener('click', () => {
      const dataUrl = canvas.toDataURL('image/png');
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'save', dataUrl }));
      }
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 1500);
      setTimeout(() => {
        strokeHistory = [];
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'clear' }));
        }
      }, 600);
    });
  }
})();
