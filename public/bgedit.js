(function () {
  const loginEl = document.getElementById('login');
  const pageEl = document.getElementById('page');
  const passwordInput = document.getElementById('passwordInput');
  const loginError = document.getElementById('loginError');

  const bgSlots = document.getElementById('bgSlots');
  const bgAllFile = document.getElementById('bgAllFile');
  const bgAllApply = document.getElementById('bgAllApply');
  const bgAllClear = document.getElementById('bgAllClear');
  const bgAllStatus = document.getElementById('bgAllStatus');

  let pw = '';

  fetch('/api/config')
    .then((r) => r.json())
    .then((cfg) => {
      if (cfg.instanceName) {
        document.title = `[${cfg.instanceName}] 태블릿 배경 편집`;
        const badge = document.getElementById('instanceBadge');
        badge.textContent = cfg.instanceName;
        badge.style.display = 'inline-block';
      }
    })
    .catch(() => {});

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
    return fetch(`/api/backgrounds-info?pw=${encodeURIComponent(pw)}`)
      .then((r) => {
        if (r.status === 401) throw new Error('unauthorized');
        return r.json();
      })
      .then((data) => {
        buildBgSlots(data.backgrounds);
        return true;
      });
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

  function enter() {
    refreshBgSlots()
      .then(() => {
        sessionStorage.setItem('bgeditPassword', pw);
        loginEl.style.display = 'none';
        pageEl.style.display = 'block';
      })
      .catch(() => {
        loginError.textContent = '비밀번호가 올바르지 않거나 배경 변경 권한이 없습니다.';
        sessionStorage.removeItem('bgeditPassword');
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

  const savedPw = sessionStorage.getItem('bgeditPassword');
  if (savedPw) {
    pw = savedPw;
    enter();
  }
})();
