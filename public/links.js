(function () {
  // 로컬 IP(같은 와이파이 필요)로 접속했는지, 클라우드 도메인으로 접속했는지에 따라
  // 안내 문구를 다르게 보여준다.
  function isLocalHost(hostname) {
    return (
      hostname === 'localhost' ||
      /^127\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    );
  }

  fetch('/api/host-info')
    .then((r) => r.json())
    .then(({ base, tabletCount, tabletToken, instanceName }) => {
      const hintText = document.getElementById('hintText');
      if (isLocalHost(new URL(base).hostname)) {
        hintText.textContent += ' (태블릿과 PC가 같은 와이파이에 연결되어 있어야 합니다)';
      }

      if (instanceName) {
        document.title = `[${instanceName}] 태블릿 연결 QR코드`;
        const badge = document.getElementById('instanceBadge');
        badge.textContent = instanceName;
        badge.style.display = 'inline-block';
      }

      const monitorUrl = `${base}/monitor.html`;
      const monitorLink = document.getElementById('monitorLink');
      monitorLink.href = monitorUrl;
      monitorLink.textContent = monitorUrl;
      new QRCode(document.getElementById('monitorQr'), { text: monitorUrl, width: 150, height: 150 });

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

        card.appendChild(h3);
        card.appendChild(qrDiv);
        card.appendChild(a);
        cards.appendChild(card);

        new QRCode(qrDiv, { text: signUrl, width: 150, height: 150 });
      }
    });
})();
