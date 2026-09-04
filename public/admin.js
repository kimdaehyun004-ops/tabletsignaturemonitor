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

  // ---------- 배경 이미지 관리 (태블릿별) ----------
  const bgSlots = document.getElementById('bgSlots');
  const bgAllFile = document.getElementById('bgAllFile');
  const bgAllApply = document.getElementById('bgAllApply');
  const bgAllClear = document.getElementById('bgAllClear');
  const bgAllStatus = document.getElementById('bgAllStatus');

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function uploadBackground(idParam, file, statusEl) {
    if (!file) {
      statusEl.textContent = '이미지를 먼저 선택하세요.';
      return false;
    }
    if (file.size > 12 * 1024 * 1024) {
      statusEl.textContent = '이미지가 너무 큽니다 (최대 12MB).';
      return false;
    }
    statusEl.textContent = '업로드 중...';
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await fetch(`/api/background?id=${encodeURIComponent(idParam)}&pw=${encodeURIComponent(pw)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        statusEl.textContent = err.error || '업로드 실패';
        return false;
      }
      statusEl.textContent = '적용됨';
      return true;
    } catch {
      statusEl.textContent = '오류 발생';
      return false;
    }
  }

  async function deleteBackground(idParam, statusEl) {
    statusEl.textContent = '삭제 중...';
    try {
      const res = await fetch(`/api/background?id=${encodeURIComponent(idParam)}&pw=${encodeURIComponent(pw)}`, { method: 'DELETE' });
      if (!res.ok) {
        statusEl.textContent = '삭제 실패';
        return false;
      }
      statusEl.textContent = '삭제됨';
      return true;
    } catch {
      statusEl.textContent = '오류 발생';
      return false;
    }
  }

  // 태블릿별 배경 슬롯을 그린다.
  function buildBgSlots(list) {
    bgSlots.innerHTML = '';
    list.forEach(({ id, hasBackground, version }) => {
      const slot = document.createElement('div');
      slot.className = 'bg-slot';

      const title = document.createElement('div');
      title.className = 'bg-slot-title';
      title.textContent = `태블릿 ${id}`;

      const preview = document.createElement('div');
      preview.className = 'bg-slot-preview';
      if (hasBackground) {
        const img = document.createElement('img');
        img.src = `/api/background?id=${id}&v=${version}`;
        preview.appendChild(img);
      } else {
        const em = document.createElement('span');
        em.textContent = '배경 없음';
        preview.appendChild(em);
      }

      const file = document.createElement('input');
      file.type = 'file';
      file.accept = 'image/png,image/jpeg,image/webp,image/gif';

      const btnRow = document.createElement('div');
      btnRow.className = 'bg-slot-btns';
      const applyBtn = document.createElement('button');
      applyBtn.textContent = '적용';
      const delBtn = document.createElement('button');
      delBtn.className = 'danger';
      delBtn.textContent = '삭제';

      const status = document.createElement('span');
      status.className = 'bg-status';

      applyBtn.addEventListener('click', async () => {
        const ok = await uploadBackground(id, file.files && file.files[0], status);
        if (ok) {
          file.value = '';
          refreshBgSlots();
        }
      });
      delBtn.addEventListener('click', async () => {
        const ok = await deleteBackground(id, status);
        if (ok) refreshBgSlots();
      });

      btnRow.appendChild(applyBtn);
      btnRow.appendChild(delBtn);
      slot.appendChild(title);
      slot.appendChild(preview);
      slot.appendChild(file);
      slot.appendChild(btnRow);
      slot.appendChild(status);
      bgSlots.appendChild(slot);
    });
  }

  function refreshBgSlots() {
    fetch(`/api/backgrounds-info?pw=${encodeURIComponent(pw)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) buildBgSlots(data.backgrounds);
      })
      .catch(() => {});
  }

  bgAllApply.addEventListener('click', async () => {
    const ok = await uploadBackground('all', bgAllFile.files && bgAllFile.files[0], bgAllStatus);
    if (ok) {
      bgAllStatus.textContent = '모든 태블릿에 적용됨';
      bgAllFile.value = '';
      refreshBgSlots();
    }
  });
  bgAllClear.addEventListener('click', async () => {
    const ok = await deleteBackground('all', bgAllStatus);
    if (ok) {
      bgAllStatus.textContent = '전체 배경 삭제됨';
      refreshBgSlots();
    }
  });

  // ---------- 게스트 비밀번호 관리 ----------
  const guestLabel = document.getElementById('guestLabel');
  const guestDuration = document.getElementById('guestDuration');
  const guestCreateBtn = document.getElementById('guestCreateBtn');
  const guestStatus = document.getElementById('guestStatus');
  const guestList = document.getElementById('guestList');
  const guestVersionTargets = document.getElementById('guestVersionTargets');
  const guestVersionsEditBox = document.getElementById('guestVersionsEditBox');
  const guestVersionsInput = document.getElementById('guestVersionsInput');

  function normalizeUrl(u) {
    return u.trim().replace(/\/+$/, '');
  }
  // 여러 버전에 동시 발급할 대상 주소 목록 (대시보드와 같은 localStorage 키를 공유).
  function loadVersionUrls() {
    try {
      const arr = JSON.parse(localStorage.getItem('dashboardUrls') || 'null');
      if (Array.isArray(arr) && arr.length) return arr;
    } catch {}
    return [location.origin];
  }
  let versionUrls = loadVersionUrls();

  function renderVersionTargets() {
    guestVersionTargets.innerHTML = '';
    versionUrls.forEach((url, i) => {
      const label = document.createElement('label');
      label.className = 'mon-toggle';
      label.style.color = '#9aa4b2';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.url = url;
      const isSelf = normalizeUrl(url) === normalizeUrl(location.origin);
      const short = url.replace(/^https?:\/\//, '');
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + short + (isSelf ? ' (현재)' : '')));
      guestVersionTargets.appendChild(label);
    });
  }
  renderVersionTargets();

  document.getElementById('guestVersionsEdit').addEventListener('click', () => {
    guestVersionsInput.value = versionUrls.join('\n');
    guestVersionsEditBox.style.display = guestVersionsEditBox.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('guestVersionsSave').addEventListener('click', () => {
    const list = guestVersionsInput.value
      .split('\n')
      .map(normalizeUrl)
      .filter((u) => /^https?:\/\//.test(u));
    versionUrls = list.length ? list : [location.origin];
    localStorage.setItem('dashboardUrls', JSON.stringify(versionUrls));
    guestVersionsEditBox.style.display = 'none';
    renderVersionTargets();
  });

  function formatRemaining(ms) {
    if (ms <= 0) return '만료됨';
    const totalMin = Math.floor(ms / 60000);
    const days = Math.floor(totalMin / 1440);
    const hours = Math.floor((totalMin % 1440) / 60);
    const mins = totalMin % 60;
    if (days > 0) return `${days}일 ${hours}시간 남음`;
    if (hours > 0) return `${hours}시간 ${mins}분 남음`;
    return `${mins}분 남음`;
  }

  function renderGuests(data) {
    guestList.innerHTML = '';
    if (!data.guests.length) {
      const em = document.createElement('div');
      em.className = 'empty-hint';
      em.textContent = '발급된 게스트 비밀번호가 없습니다.';
      guestList.appendChild(em);
    }
    data.guests.forEach((g) => {
      const row = document.createElement('div');
      row.className = 'guest-row';

      const code = document.createElement('span');
      code.className = 'guest-code';
      code.textContent = g.code;

      const meta = document.createElement('span');
      meta.className = 'guest-meta';
      meta.textContent = (g.label ? g.label + ' · ' : '') + formatRemaining(g.remainingMs) + (g.canBackground ? ' · 배경변경 가능' : '');

      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = '삭제';
      del.addEventListener('click', async () => {
        // 이 버전 + 등록된 다른 버전 모두에서 삭제(같은 코드가 심겨 있을 수 있으므로).
        await Promise.all(
          versionUrls.map((url) =>
            fetch(`${url}/api/guests?code=${encodeURIComponent(g.code)}&pw=${encodeURIComponent(pw)}`, { method: 'DELETE' }).catch(() => {})
          )
        );
        refreshGuests();
      });

      row.appendChild(code);
      row.appendChild(meta);
      row.appendChild(del);
      guestList.appendChild(row);
    });
    guestCreateBtn.disabled = data.guests.length >= data.max;
    if (data.guests.length >= data.max) {
      guestStatus.textContent = `최대 ${data.max}개까지 발급됨. 삭제 후 발급하세요.`;
    }
  }

  function refreshGuests() {
    fetch(`/api/guests?pw=${encodeURIComponent(pw)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) renderGuests(data);
      })
      .catch(() => {});
  }

  function selectedTargets() {
    return Array.from(guestVersionTargets.querySelectorAll('input[type=checkbox]:checked')).map((cb) => cb.dataset.url);
  }

  async function postGuest(url, body) {
    try {
      const res = await fetch(`${url}/api/guests?pw=${encodeURIComponent(pw)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, data };
    } catch {
      return { ok: false, data: {} };
    }
  }

  guestCreateBtn.addEventListener('click', async () => {
    const targets = selectedTargets();
    if (!targets.length) {
      guestStatus.textContent = '적용할 버전을 하나 이상 선택하세요.';
      return;
    }
    guestStatus.textContent = '발급 중...';
    const body = {
      label: guestLabel.value,
      durationHours: parseFloat(guestDuration.value),
      canBackground: document.getElementById('guestCanBackground').checked,
    };

    // 1) 첫 번째 대상에서 코드를 발급받는다.
    const first = await postGuest(targets[0], body);
    if (!first.ok) {
      guestStatus.textContent = (first.data && first.data.error) || `발급 실패 (${targets[0].replace(/^https?:\/\//, '')})`;
      return;
    }
    const code = first.data.code;

    // 2) 같은 코드를 나머지 버전들에도 심는다.
    const failed = [];
    for (const url of targets.slice(1)) {
      const r = await postGuest(url, { ...body, code });
      if (!r.ok) failed.push(url.replace(/^https?:\/\//, ''));
    }

    const applied = targets.length - failed.length;
    guestStatus.textContent =
      `발급됨: ${code} (${applied}/${targets.length}개 버전)` + (failed.length ? ` · 실패: ${failed.join(', ')}` : '');
    guestLabel.value = '';
    refreshGuests();
  });

  // 남은 시간 표시를 위해 1분마다 갱신.
  setInterval(() => {
    if (document.getElementById('adminPage').style.display !== 'none') refreshGuests();
  }, 60000);

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
      const actions = document.createElement('span');
      actions.className = 'sig-actions';
      const dl = document.createElement('a');
      dl.href = fileUrl;
      dl.download = item.filename;
      dl.textContent = '다운로드';
      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = '삭제';
      del.addEventListener('click', async () => {
        if (!confirm('이 서명을 삭제할까요? 되돌릴 수 없습니다.')) return;
        del.disabled = true;
        try {
          const res = await fetch(`/api/signature-file/${encodeURIComponent(item.filename)}?pw=${encodeURIComponent(pw)}`, {
            method: 'DELETE',
          });
          if (!res.ok) {
            del.disabled = false;
            alert('삭제에 실패했습니다.');
            return;
          }
          card.remove();
          if (!sigGrid.children.length) emptyHint.style.display = 'block';
        } catch {
          del.disabled = false;
          alert('삭제 중 오류가 발생했습니다.');
        }
      });

      actions.appendChild(dl);
      actions.appendChild(del);
      meta.appendChild(label);
      meta.appendChild(actions);
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
        refreshBgSlots();
        refreshGuests();
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

  const deleteAllBtn = document.getElementById('deleteAllBtn');
  const sigDeleteStatus = document.getElementById('sigDeleteStatus');
  deleteAllBtn.addEventListener('click', async () => {
    if (!sigGrid.children.length) {
      sigDeleteStatus.textContent = '삭제할 서명이 없습니다.';
      return;
    }
    if (!confirm('저장된 모든 서명을 삭제할까요? 되돌릴 수 없습니다.')) return;
    deleteAllBtn.disabled = true;
    sigDeleteStatus.textContent = '삭제 중...';
    try {
      const res = await fetch(`/api/signatures?pw=${encodeURIComponent(pw)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        sigDeleteStatus.textContent = (data && data.error) || '삭제 실패';
        return;
      }
      sigDeleteStatus.textContent = `${data.deleted || 0}개 삭제됨`;
      render([]);
    } catch {
      sigDeleteStatus.textContent = '오류가 발생했습니다.';
    } finally {
      deleteAllBtn.disabled = false;
    }
  });

  const savedPw = sessionStorage.getItem('adminPassword');
  if (savedPw) {
    pw = savedPw;
    load();
  }
})();
