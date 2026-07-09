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

  // 손가락(또는 펜)이 빠르게 움직일수록 얇게, 천천히 움직일수록 굵게 그려서
  // 실제 펜으로 쓰는 것 같은 강약이 느껴지도록 한다.
  const MIN_WIDTH = 1.6;
  const MAX_WIDTH = 3.4;
  function createWidthTracker() {
    let lastX = null;
    let lastY = null;
    let lastT = 0;
    let smoothed = MAX_WIDTH;
    return {
      reset() {
        lastX = null;
        lastY = null;
        smoothed = MAX_WIDTH;
      },
      next(x, y, t) {
        if (lastX == null) {
          lastX = x;
          lastY = y;
          lastT = t;
          return smoothed;
        }
        const dt = Math.max(1, t - lastT);
        const dist = Math.hypot(x - lastX, y - lastY);
        const speed = dist / dt; // px / ms
        const target = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, MAX_WIDTH - speed * 6));
        smoothed = smoothed * 0.7 + target * 0.3;
        lastX = x;
        lastY = y;
        lastT = t;
        return smoothed;
      },
    };
  }

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
    init();
  });

  if (!tabletId || !token) {
    showSetup();
    return;
  }

  signPageEl.style.display = 'flex';
  init();

  function init() {
    document.getElementById('tabletLabel').textContent = `태블릿 ${tabletId}`;

    const canvas = document.getElementById('signCanvas');
    const ctx = canvas.getContext('2d');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const toast = document.getElementById('toast');
    const fullscreenBtn = document.getElementById('fullscreenBtn');

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

    let ws;
    let reconnectDelay = 1000;
    let pendingPoints = [];
    let flushScheduled = false;
    let drawing = false;

    // 태블릿마다 실제 화면 비율이 다를 수 있으므로, 모니터링 화면이 이 비율을
    // 그대로 따라 그려야 서명이 늘어나거나 찌그러지지 않고 원본과 똑같이 보인다.
    function currentAspect() {
      const rect = canvas.getBoundingClientRect();
      return rect.height > 0 ? rect.width / rect.height : 4 / 3;
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
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'clear' }));
        }
      }, 600);
    });
  }
})();
