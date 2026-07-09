(function () {
  fetch('/api/host-info')
    .then((r) => r.json())
    .then(({ base, tabletCount, tabletToken }) => {
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
