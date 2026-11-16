(function () {
  // QR 크기 단계. 현장에서 "작아서 인식이 안 된다"는 문제를 줄이기 위해
  // 기본값을 넉넉히 키우고, 더 크게 보는 수단을 여러 개 둔다.
  const SIZES = { normal: 220, big: 320, huge: 440 };
  const SIZE_LABEL = { normal: '보통', big: '크게', huge: '아주 크게' };

  function savedSize() {
    const v = localStorage.getItem('qrSize');
    return SIZES[v] ? v : 'big'; // 기본값을 "크게"로 둔다
  }
  let sizeKey = savedSize();

  // 오류정정 레벨은 M을 쓴다.
  // 기본값 H는 복원력이 높은 대신 칸(모듈) 수가 많아져서, 같은 크기로 그려도
  // 칸 하나가 작아진다. 화면/종이로 보여주는 용도에서는 M이 칸이 굵어져
  // 카메라 인식이 훨씬 잘 된다.
  const LEVEL = (window.QRCode && QRCode.CorrectLevel && QRCode.CorrectLevel.M) || 0;

  function makeQR(el, text, px) {
    el.innerHTML = '';
    new QRCode(el, { text, width: px, height: px, correctLevel: LEVEL });
  }

  function isLocalHost(hostname) {
    return (
      hostname === 'localhost' ||
      /^127\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    );
  }

  let tablets = []; // [{ id, url, qrEl }]
  let monitorEntry = null;

  fetch('/api/host-info')
    .then((r) => r.json())
    .then(({ base, tabletCount, tabletToken, instanceName }) => {
      const hintText = document.getElementById('hintText');
      const hostname = new URL(base).hostname;
      const baseEl = document.getElementById('currentBase');
      if (baseEl) baseEl.textContent = base;

      if (hostname === 'localhost' || /^127\./.test(hostname)) {
        // 이 페이지를 localhost 로 열면 QR 안에도 localhost 가 들어가서
        // 태블릿에서는 절대 연결되지 않는다. 가장 흔한 실수라 크게 경고한다.
        hintText.innerHTML =
          '<b style="color:#b45309;">주의: 지금 주소가 localhost 입니다. 이 QR은 태블릿에서 동작하지 않습니다.</b><br>' +
          '검은 창에 표시된 <b>이 PC 주소(http://192.168...)</b>로 다시 접속한 뒤 QR을 사용하세요.';
      } else if (isLocalHost(hostname)) {
        hintText.textContent += ' (태블릿이 이 PC와 같은 공유기에 연결되어 있어야 합니다. 인터넷은 필요 없습니다)';
      }

      if (instanceName) {
        document.title = `[${instanceName}] 태블릿 연결 QR코드`;
        const badge = document.getElementById('instanceBadge');
        badge.textContent = instanceName;
        badge.style.display = 'inline-block';
      }

      // ── PC 모니터링 화면 QR
      const monitorUrl = `${base}/monitor.html`;
      const monitorLink = document.getElementById('monitorLink');
      monitorLink.href = monitorUrl;
      monitorLink.textContent = monitorUrl;
      monitorLink.target = '_blank';
      monitorLink.rel = 'noopener';
      const monQrEl = document.getElementById('monitorQr');
      monitorEntry = { id: 'PC 모니터링 화면', url: monitorUrl, qrEl: monQrEl };
      monQrEl.addEventListener('click', () => openZoom(monitorEntry));

      // ── 태블릿별 QR
      const cards = document.getElementById('tabletCards');
      for (let id = 1; id <= tabletCount; id++) {
        const signUrl = `${base}/sign.html?id=${id}&token=${encodeURIComponent(tabletToken)}`;

        const card = document.createElement('div');
        card.className = 'card';

        const h3 = document.createElement('h3');
        h3.textContent = `태블릿 ${id}`;

        const qrDiv = document.createElement('div');
        qrDiv.className = 'qr';

        const a = document.createElement('a');
        a.href = signUrl;
        a.textContent = signUrl;

        const zoomBtn = document.createElement('button');
        zoomBtn.className = 'qr-zoom-btn';
        zoomBtn.type = 'button';
        zoomBtn.textContent = '🔍 크게 보기';

        card.appendChild(h3);
        card.appendChild(qrDiv);
        card.appendChild(zoomBtn);
        card.appendChild(a);
        cards.appendChild(card);

        const entry = { id: `태블릿 ${id}`, url: signUrl, qrEl: qrDiv };
        tablets.push(entry);
        qrDiv.addEventListener('click', () => openZoom(entry));
        zoomBtn.addEventListener('click', () => openZoom(entry));
      }

      renderAll(SIZES[sizeKey]);
      setupToolbar();
    });

  function renderAll(px) {
    // 카드 칸 너비를 QR 크기에 맞춰 넓힌다. (QR 크기 + 좌우 여백 + 카드 안쪽 여백)
    // 이걸 안 하면 QR을 키웠을 때 칸 밖으로 넘쳐 옆 카드에 가려지고,
    // 가려진 QR은 카메라로 읽히지 않는다.
    document.documentElement.style.setProperty('--qr-cell', (px + 80) + 'px');
    if (monitorEntry) makeQR(monitorEntry.qrEl, monitorEntry.url, px);
    for (const t of tablets) makeQR(t.qrEl, t.url, px);
  }

  // ───────── 크기 조절 / 인쇄 툴바 ─────────
  function setupToolbar() {
    const bar = document.getElementById('qrToolbar');
    if (!bar) return;
    bar.querySelectorAll('[data-size]').forEach((btn) => {
      if (btn.dataset.size === sizeKey) btn.classList.add('active');
      btn.addEventListener('click', () => {
        sizeKey = btn.dataset.size;
        try { localStorage.setItem('qrSize', sizeKey); } catch {}
        bar.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('active', b === btn));
        renderAll(SIZES[sizeKey]);
      });
    });

    const printBtn = document.getElementById('printBtn');
    if (printBtn) {
      printBtn.addEventListener('click', () => {
        // 인쇄할 때는 큰 해상도로 다시 그려야 종이에서도 또렷하다.
        // 태블릿 1대당 1장씩 나오도록 CSS(@media print)에서 페이지를 나눈다.
        renderAll(620);
        document.body.classList.add('printing');
        setTimeout(() => {
          window.print();
          document.body.classList.remove('printing');
          renderAll(SIZES[sizeKey]);
        }, 350);
      });
    }
  }

  // ───────── 전체화면 확대 보기 ─────────
  let zoomIndex = -1;

  function zoomList() {
    return monitorEntry ? [monitorEntry].concat(tablets) : tablets.slice();
  }

  function openZoom(entry) {
    const list = zoomList();
    zoomIndex = list.indexOf(entry);
    showZoom();
  }

  function showZoom() {
    const list = zoomList();
    if (zoomIndex < 0 || zoomIndex >= list.length) return;
    const entry = list[zoomIndex];
    const overlay = document.getElementById('qrOverlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    document.getElementById('qrOverlayTitle').textContent = entry.id;
    document.getElementById('qrOverlayUrl').textContent = entry.url;
    // 화면 높이의 상당 부분을 쓰도록 크게 그린다.
    const px = Math.max(260, Math.floor(Math.min(window.innerWidth * 0.82, window.innerHeight * 0.62)));
    makeQR(document.getElementById('qrOverlayQr'), entry.url, px);
    document.getElementById('qrOverlayCount').textContent = `${zoomIndex + 1} / ${list.length}`;
  }

  function closeZoom() {
    const overlay = document.getElementById('qrOverlay');
    if (overlay) overlay.style.display = 'none';
    zoomIndex = -1;
  }

  function moveZoom(step) {
    const list = zoomList();
    if (!list.length) return;
    zoomIndex = (zoomIndex + step + list.length) % list.length;
    showZoom();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const close = document.getElementById('qrClose');
    const prev = document.getElementById('qrPrev');
    const next = document.getElementById('qrNext');
    const overlay = document.getElementById('qrOverlay');
    if (close) close.addEventListener('click', closeZoom);
    if (prev) prev.addEventListener('click', () => moveZoom(-1));
    if (next) next.addEventListener('click', () => moveZoom(1));
    if (overlay) {
      // 배경(어두운 영역)을 누르면 닫힌다. QR 자체를 눌렀을 때는 닫지 않는다.
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closeZoom(); });
    }
  });

  document.addEventListener('keydown', (e) => {
    const overlay = document.getElementById('qrOverlay');
    if (!overlay || overlay.style.display === 'none') return;
    if (e.key === 'Escape') closeZoom();
    else if (e.key === 'ArrowLeft') moveZoom(-1);
    else if (e.key === 'ArrowRight') moveZoom(1);
  });

  window.addEventListener('resize', () => {
    const overlay = document.getElementById('qrOverlay');
    if (overlay && overlay.style.display !== 'none') showZoom();
  });
})();
