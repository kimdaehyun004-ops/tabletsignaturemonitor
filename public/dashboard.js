(function () {
  const loginEl = document.getElementById('login');
  const dashEl = document.getElementById('dashPage');
  const passwordInput = document.getElementById('passwordInput');
  const loginError = document.getElementById('loginError');
  const cards = document.getElementById('cards');
  const editBox = document.getElementById('editBox');
  const urlsInput = document.getElementById('urlsInput');

  let pw = '';
  let refreshTimer = null;

  // 모니터링할 버전 주소 목록. 저장 전에는 현재 접속한 주소(=이 페이지가 올라간 버전)를 기본값으로 쓴다.
  function loadUrls() {
    const saved = localStorage.getItem('dashboardUrls');
    if (saved) {
      try {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.length) return arr;
      } catch {}
    }
    return [location.origin];
  }
  function saveUrls(arr) {
    localStorage.setItem('dashboardUrls', JSON.stringify(arr));
  }
  let urls = loadUrls();

  function normalizeUrl(u) {
    return u.trim().replace(/\/+$/, '');
  }

  function fetchStatus(baseUrl) {
    return fetch(`${baseUrl}/api/status?pw=${encodeURIComponent(pw)}`, { cache: 'no-store' })
      .then((r) => {
        if (r.status === 401) return { error: 'auth' };
        if (!r.ok) return { error: 'http' };
        return r.json();
      })
      .catch(() => ({ error: 'unreachable' }));
  }

  function makeCard(baseUrl) {
    const card = document.createElement('div');
    card.className = 'dash-card';
    card.innerHTML = `
      <div class="dash-card-head">
        <span class="dash-name">불러오는 중...</span>
        <span class="dash-count"></span>
      </div>
      <div class="dash-url"></div>
      <div class="dash-dots"></div>
      <div class="dash-links"></div>
    `;
    card.querySelector('.dash-url').textContent = baseUrl;
    const links = card.querySelector('.dash-links');
    [
      ['모니터링', `${baseUrl}/monitor.html`],
      ['관리자', `${baseUrl}/admin.html`],
      ['QR', `${baseUrl}/links.html`],
    ].forEach(([label, href]) => {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = label + ' ↗';
      links.appendChild(a);
    });
    return card;
  }

  function renderCard(card, baseUrl, status) {
    const nameEl = card.querySelector('.dash-name');
    const countEl = card.querySelector('.dash-count');
    const dotsEl = card.querySelector('.dash-dots');
    card.classList.remove('err');
    dotsEl.innerHTML = '';

    if (status.error) {
      card.classList.add('err');
      nameEl.textContent =
        status.error === 'auth' ? '비밀번호 불일치' : status.error === 'unreachable' ? '접속 불가(깨어나는 중일 수 있음)' : '오류';
      countEl.textContent = '';
      return;
    }

    nameEl.textContent = status.instanceName || baseUrl.replace(/^https?:\/\//, '');
    countEl.textContent = `${status.online} / ${status.tabletCount} 접속`;
    countEl.classList.toggle('some', status.online > 0);

    const onlineSet = new Set(status.onlineIds || []);
    for (let id = 1; id <= status.tabletCount; id++) {
      const d = document.createElement('span');
      d.className = 'dash-dot' + (onlineSet.has(id) ? ' on' : '');
      d.title = `태블릿 ${id}`;
      d.textContent = id;
      dotsEl.appendChild(d);
    }
  }

  function render() {
    cards.innerHTML = '';
    const cardEls = urls.map((u) => {
      const card = makeCard(u);
      cards.appendChild(card);
      return card;
    });
    urls.forEach((u, i) => {
      fetchStatus(u).then((status) => renderCard(cardEls[i], u, status));
    });
  }

  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(render, 5000);
  }

  function enter() {
    // 현재 버전(이 페이지가 올라간 곳)으로 비밀번호를 먼저 검증한다.
    fetchStatus(location.origin).then((status) => {
      if (status.error === 'auth') {
        loginError.textContent = '비밀번호가 올바르지 않습니다.';
        sessionStorage.removeItem('dashboardPassword');
        return;
      }
      sessionStorage.setItem('dashboardPassword', pw);
      loginEl.style.display = 'none';
      dashEl.style.display = 'block';
      urlsInput.value = urls.join('\n');
      render();
      startAutoRefresh();
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

  document.getElementById('refreshBtn').addEventListener('click', render);
  document.getElementById('editBtn').addEventListener('click', () => {
    editBox.style.display = editBox.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('saveUrlsBtn').addEventListener('click', () => {
    const list = urlsInput.value
      .split('\n')
      .map(normalizeUrl)
      .filter((u) => /^https?:\/\//.test(u));
    urls = list.length ? list : [location.origin];
    saveUrls(urls);
    editBox.style.display = 'none';
    render();
  });

  const savedPw = sessionStorage.getItem('dashboardPassword');
  if (savedPw) {
    pw = savedPw;
    enter();
  }
})();
