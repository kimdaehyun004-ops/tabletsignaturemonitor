(function () {
  const loginEl = document.getElementById('login');
  const adminEl = document.getElementById('adminPage');
  const passwordInput = document.getElementById('passwordInput');
  const loginError = document.getElementById('loginError');
  const sigGrid = document.getElementById('sigGrid');
  const emptyHint = document.getElementById('emptyHint');

  let pw = '';

  fetch('/api/config')
    .then((r) => r.json())
    .then((cfg) => {
      if (cfg.instanceName) {
        document.title = `[${cfg.instanceName}] 서명 관리자 다운로드`;
        const badge = document.getElementById('instanceBadge');
        badge.textContent = cfg.instanceName;
        badge.style.display = 'inline-block';
      }
    })
    .catch(() => {});

  // ---------- 배경 이미지 관리 ----------
  const bgFileInput = document.getElementById('bgFileInput');
  const bgUploadBtn = document.getElementById('bgUploadBtn');
  const bgRemoveBtn = document.getElementById('bgRemoveBtn');
  const bgStatus = document.getElementById('bgStatus');
  const bgPreviewImg = document.getElementById('bgPreviewImg');
  const bgPreviewEmpty = document.getElementById('bgPreviewEmpty');

  function refreshBackgroundPreview() {
    fetch('/api/background-info')
      .then((r) => r.json())
      .then(({ hasBackground, version }) => {
        if (hasBackground) {
          bgPreviewImg.src = `/api/background?v=${version}`;
          bgPreviewImg.style.display = 'block';
          bgPreviewEmpty.style.display = 'none';
        } else {
          bgPreviewImg.style.display = 'none';
          bgPreviewImg.removeAttribute('src');
          bgPreviewEmpty.style.display = 'inline';
        }
      })
      .catch(() => {});
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  bgUploadBtn.addEventListener('click', async () => {
    const file = bgFileInput.files && bgFileInput.files[0];
    if (!file) {
      bgStatus.textContent = '이미지 파일을 먼저 선택하세요.';
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      bgStatus.textContent = '이미지가 너무 큽니다 (최대 12MB).';
      return;
    }
    bgStatus.textContent = '업로드 중...';
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await fetch(`/api/background?pw=${encodeURIComponent(pw)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        bgStatus.textContent = err.error || '업로드에 실패했습니다.';
        return;
      }
      bgStatus.textContent = '적용되었습니다. 모든 태블릿에 반영됩니다.';
      bgFileInput.value = '';
      refreshBackgroundPreview();
    } catch {
      bgStatus.textContent = '업로드 중 오류가 발생했습니다.';
    }
  });

  bgRemoveBtn.addEventListener('click', async () => {
    bgStatus.textContent = '삭제 중...';
    try {
      const res = await fetch(`/api/background?pw=${encodeURIComponent(pw)}`, { method: 'DELETE' });
      if (!res.ok) {
        bgStatus.textContent = '삭제에 실패했습니다.';
        return;
      }
      bgStatus.textContent = '배경을 삭제했습니다.';
      refreshBackgroundPreview();
    } catch {
      bgStatus.textContent = '삭제 중 오류가 발생했습니다.';
    }
  });

  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('ko-KR');
  }

  function render(items) {
    sigGrid.innerHTML = '';
    emptyHint.style.display = items.length === 0 ? 'block' : 'none';
    items.forEach((item) => {
      const fileUrl = `/api/signature-file/${encodeURIComponent(item.filename)}?pw=${encodeURIComponent(pw)}`;

      const card = document.createElement('div');
      card.className = 'sig-card';

      const img = document.createElement('img');
      img.src = fileUrl;
      img.loading = 'lazy';

      const meta = document.createElement('div');
      meta.className = 'sig-meta';
      const label = document.createElement('span');
      label.textContent = item.tabletId ? `태블릿 ${item.tabletId} · ${formatTime(item.timestamp)}` : item.filename;
      const dl = document.createElement('a');
      dl.href = fileUrl;
      dl.download = item.filename;
      dl.textContent = '다운로드';

      meta.appendChild(label);
      meta.appendChild(dl);
      card.appendChild(img);
      card.appendChild(meta);
      sigGrid.appendChild(card);
    });
  }

  function load() {
    fetch(`/api/signatures?pw=${encodeURIComponent(pw)}`)
      .then((r) => {
        if (r.status === 401) throw new Error('unauthorized');
        return r.json();
      })
      .then((items) => {
        loginEl.style.display = 'none';
        adminEl.style.display = 'block';
        sessionStorage.setItem('adminPassword', pw);
        render(items);
        refreshBackgroundPreview();
      })
      .catch(() => {
        loginError.textContent = '비밀번호가 올바르지 않습니다.';
        sessionStorage.removeItem('adminPassword');
      });
  }

  document.getElementById('loginBtn').addEventListener('click', () => {
    pw = passwordInput.value;
    if (!pw) return;
    load();
  });
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('loginBtn').click();
  });
  document.getElementById('refreshBtn').addEventListener('click', load);

  const savedPw = sessionStorage.getItem('adminPassword');
  if (savedPw) {
    pw = savedPw;
    load();
  }
})();
