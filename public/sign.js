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
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    let ws;
    let reconnectDelay = 1000;
    let pendingPoints = [];
    let flushScheduled = false;
    let drawing = false;

    function setStatus(online, text) {
      statusDot.classList.toggle('online', online);
      statusText.textContent = text;
    }

    function connect() {
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${protocol}://${location.host}`);

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'hello', role: 'tablet', id: tabletId, token }));
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

    function queuePoint(type, x, y) {
      pendingPoints.push({ type, x, y });
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

    canvas.addEventListener('pointerdown', (e) => {
      drawing = true;
      canvas.setPointerCapture(e.pointerId);
      const { x, y } = normPoint(e.clientX, e.clientY);
      const rect = canvas.getBoundingClientRect();
      localDrawer.reset(x * rect.width, y * rect.height);
      queuePoint('start', x, y);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const { x, y } = normPoint(e.clientX, e.clientY);
      const rect = canvas.getBoundingClientRect();
      localDrawer.addPoint(x * rect.width, y * rect.height);
      queuePoint('point', x, y);
    });

    function endStroke(e) {
      if (!drawing) return;
      drawing = false;
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
