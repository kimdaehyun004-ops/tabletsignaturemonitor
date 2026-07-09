(function () {
  const loginEl = document.getElementById('login');
  const adminEl = document.getElementById('adminPage');
  const passwordInput = document.getElementById('passwordInput');
  const loginError = document.getElementById('loginError');
  const sigGrid = document.getElementById('sigGrid');
  const emptyHint = document.getElementById('emptyHint');

  let pw = '';

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
