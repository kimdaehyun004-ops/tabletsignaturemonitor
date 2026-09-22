(function () {
  const loginEl = document.getElementById('login');
  const editorEl = document.getElementById('editorPage');
  const passwordInput = document.getElementById('passwordInput');
  const loginError = document.getElementById('loginError');
  const trayEl = document.getElementById('tray');
  const trayCountEl = document.getElementById('trayCount');
  const stage = document.getElementById('stage');

  let pw = '';
  let signatures = []; // 서버에서 받은 목록 [{filename, tabletId, timestamp}]
  let items = []; // 무대에 올린 항목 [{filename, img, el, imgEl, x, y, w, h, ratio}]
  let selected = null;
  let bgColor = '#00B140'; // 기본: 크로마 그린
  let inkColor = '#111111'; // 기본: 검정
  let zTop = 1;

  document.title = '서명 편집 · 크로마키';
  fetch('/api/config')
    .then((r) => r.json())
    .then((cfg) => {
      if (cfg.instanceName) document.title = `[${cfg.instanceName}] 서명 편집 · 크로마키`;
    })
    .catch(() => {});

  // ---------- 색 적용 ----------
  function applyBg() {
    if (bgColor === 'transparent') {
      stage.classList.add('transparent');
      stage.style.background = '';
    } else {
      stage.classList.remove('transparent');
      stage.style.background = bgColor;
    }
  }

  // 검은 서명 획을 원하는 색으로 다시 칠한다(투명 부분은 그대로). 표시·저장 모두 같은 방식.
  function tintCanvas(img, color) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || 1;
    c.height = img.naturalHeight || 1;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);
    cx.globalCompositeOperation = 'source-in';
    cx.fillStyle = color;
    cx.fillRect(0, 0, c.width, c.height);
    return c;
  }
  function retintItem(it) {
    it.imgEl.src = tintCanvas(it.img, inkColor).toDataURL('image/png');
  }
  function retintAll() {
    items.forEach(retintItem);
  }

  // ---------- 무대 항목 ----------
  function selectItem(it) {
    selected = it;
    items.forEach((o) => o.el.classList.toggle('selected', o === it));
  }

  function addItem(sig) {
    const img = new Image();
    const fileUrl = `/api/signature-file/${encodeURIComponent(sig.filename)}?pw=${encodeURIComponent(pw)}`;
    img.onload = () => {
      const ratio = img.naturalWidth / img.naturalHeight || 2;
      const w = 220;
      const h = Math.round(w / ratio);
      // 살짝 계단식으로 겹치지 않게 배치
      const n = items.length;
      const x = Math.min(20 + n * 24, Math.max(0, stage.clientWidth - w - 20));
      const y = Math.min(20 + n * 20, Math.max(0, stage.clientHeight - h - 20));

      const el = document.createElement('div');
      el.className = 'stage-item';
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.width = w + 'px';
      el.style.height = h + 'px';
      el.style.zIndex = String(++zTop);

      const imgEl = document.createElement('img');
      imgEl.draggable = false;
      el.appendChild(imgEl);

      const handle = document.createElement('div');
      handle.className = 'resize-handle';
      el.appendChild(handle);

      const remove = document.createElement('button');
      remove.className = 'item-remove';
      remove.textContent = '×';
      remove.title = '무대에서 빼기';
      el.appendChild(remove);

      const it = { filename: sig.filename, img, el, imgEl, x, y, w, h, ratio };
      items.push(it);
      stage.appendChild(el);
      retintItem(it);
      selectItem(it);

      // 드래그 이동
      el.addEventListener('pointerdown', (e) => {
        if (e.target === handle || e.target === remove) return;
        selectItem(it);
        it.el.style.zIndex = String(++zTop);
        const startX = e.clientX, startY = e.clientY;
        const ox = it.x, oy = it.y;
        el.setPointerCapture(e.pointerId);
        const move = (ev) => {
          it.x = clamp(ox + (ev.clientX - startX), -it.w + 40, stage.clientWidth - 40);
          it.y = clamp(oy + (ev.clientY - startY), -it.h + 40, stage.clientHeight - 40);
          el.style.left = it.x + 'px';
          el.style.top = it.y + 'px';
        };
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      });

      // 모서리 크기 조절(비율 유지)
      handle.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        selectItem(it);
        const startX = e.clientX;
        const ow = it.w;
        handle.setPointerCapture(e.pointerId);
        const move = (ev) => {
          it.w = clamp(ow + (ev.clientX - startX), 40, 3000);
          it.h = Math.round(it.w / it.ratio);
          el.style.width = it.w + 'px';
          el.style.height = it.h + 'px';
        };
        const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
      });

      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        removeItem(it);
      });
    };
    img.src = fileUrl;
  }

  function removeItem(it) {
    it.el.remove();
    items = items.filter((o) => o !== it);
    if (selected === it) selected = null;
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  // 무대의 항목들을 격자로 자동 정렬한다.
  function arrangeGrid() {
    if (!items.length) return;
    const pad = 16;
    const cols = Math.ceil(Math.sqrt(items.length));
    const rows = Math.ceil(items.length / cols);
    const cellW = (stage.clientWidth - pad * (cols + 1)) / cols;
    const cellH = (stage.clientHeight - pad * (rows + 1)) / rows;
    items.forEach((it, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      let w = cellW;
      let h = w / it.ratio;
      if (h > cellH) {
        h = cellH;
        w = h * it.ratio;
      }
      it.w = Math.round(w);
      it.h = Math.round(h);
      it.x = Math.round(pad + c * (cellW + pad) + (cellW - w) / 2);
      it.y = Math.round(pad + r * (cellH + pad) + (cellH - h) / 2);
      it.el.style.left = it.x + 'px';
      it.el.style.top = it.y + 'px';
      it.el.style.width = it.w + 'px';
      it.el.style.height = it.h + 'px';
    });
  }

  // ---------- 저장(PNG 내보내기) ----------
  function exportPng() {
    const scale = 2; // 고해상도로 저장
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(stage.clientWidth * scale));
    c.height = Math.max(1, Math.round(stage.clientHeight * scale));
    const cx = c.getContext('2d');
    if (bgColor !== 'transparent') {
      cx.fillStyle = bgColor;
      cx.fillRect(0, 0, c.width, c.height);
    }
    // z순서대로 그린다(무대에 쌓인 순서 = items 배열 순서)
    items.forEach((it) => {
      const tinted = tintCanvas(it.img, inkColor);
      cx.drawImage(tinted, it.x * scale, it.y * scale, it.w * scale, it.h * scale);
    });
    const url = c.toDataURL('image/png');
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `signatures-${stamp}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------- 트레이(썸네일) ----------
  function buildTray() {
    trayEl.innerHTML = '';
    trayCountEl.textContent = `${signatures.length}개`;
    signatures.forEach((sig) => {
      const cell = document.createElement('div');
      cell.className = 'tray-cell';
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = `/api/signature-file/${encodeURIComponent(sig.filename)}?pw=${encodeURIComponent(pw)}`;
      const cap = document.createElement('div');
      cap.className = 'tray-cap';
      cap.textContent = sig.tabletId ? `태블릿 ${sig.tabletId}` : sig.filename;
      cell.appendChild(img);
      cell.appendChild(cap);
      cell.addEventListener('click', () => addItem(sig));
      trayEl.appendChild(cell);
    });
  }

  function loadSignatures() {
    return fetch(`/api/signatures?pw=${encodeURIComponent(pw)}`)
      .then((r) => {
        if (!r.ok) throw new Error('unauthorized');
        return r.json();
      })
      .then((list) => {
        signatures = list;
        buildTray();
      });
  }

  // ---------- 툴바 이벤트 ----------
  document.querySelectorAll('.bg-preset').forEach((b) => {
    b.addEventListener('click', () => {
      bgColor = b.getAttribute('data-bg');
      if (bgColor !== 'transparent') document.getElementById('bgCustom').value = bgColor;
      applyBg();
    });
  });
  document.getElementById('bgCustom').addEventListener('input', (e) => {
    bgColor = e.target.value;
    applyBg();
  });
  document.querySelectorAll('.ink-preset').forEach((b) => {
    b.addEventListener('click', () => {
      inkColor = b.getAttribute('data-ink');
      document.getElementById('inkCustom').value = inkColor;
      retintAll();
    });
  });
  document.getElementById('inkCustom').addEventListener('input', (e) => {
    inkColor = e.target.value;
    retintAll();
  });
  document.getElementById('addAllBtn').addEventListener('click', () => {
    signatures.forEach((sig) => addItem(sig));
  });
  document.getElementById('arrangeBtn').addEventListener('click', arrangeGrid);
  document.getElementById('clearStageBtn').addEventListener('click', () => {
    items.slice().forEach(removeItem);
  });
  document.getElementById('exportBtn').addEventListener('click', exportPng);
  document.getElementById('refreshBtn').addEventListener('click', loadSignatures);
  stage.addEventListener('pointerdown', (e) => {
    if (e.target === stage) {
      selected = null;
      items.forEach((o) => o.el.classList.remove('selected'));
    }
  });

  // ---------- 로그인 ----------
  function enter() {
    loadSignatures()
      .then(() => {
        sessionStorage.setItem('adminPassword', pw);
        loginEl.style.display = 'none';
        editorEl.style.display = 'flex';
        applyBg();
      })
      .catch(() => {
        loginError.textContent = '비밀번호가 올바르지 않습니다.';
        sessionStorage.removeItem('adminPassword');
      });
  }
  document.getElementById('loginBtn').addEventListener('click', () => {
    pw = passwordInput.value;
    if (!pw) return;
    enter();
  });
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('loginBtn').click();
  });
  const savedPw = sessionStorage.getItem('adminPassword');
  if (savedPw) {
    pw = savedPw;
    enter();
  }
})();
