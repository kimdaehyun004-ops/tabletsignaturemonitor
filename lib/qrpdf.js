// 태블릿 연결 QR코드를 PDF 한 개로 만든다. 태블릿 1대당 1페이지.
//
// 인터넷이 없는 현장에서도 동작해야 하므로 외부 패키지를 전혀 쓰지 않는다.
// QR은 이미지로 넣지 않고 "검은 사각형"을 직접 그려 넣는다(벡터). 그래서
// 아무리 확대해도 깨지지 않고, 파일도 작다.
//
// 글자는 PDF 기본 내장 글꼴(Helvetica)만 쓴다. 기본 글꼴에는 한글이 없어서
// 라벨은 영문/숫자로 적는다. 한글을 넣으려면 글꼴 파일을 통째로 PDF에
// 심어야 하는데, 그러면 파일이 수 MB로 커지고 복잡해진다.

const { qrMatrix } = require('./qrmodel');

const PAGE_W = 595; // A4 (pt)
const PAGE_H = 842;

// Helvetica 글자 폭 어림값(가운데 정렬용). 1/1000 em 단위의 실제 표에
// 가까운 근사치이며, 라벨을 가운데 맞추는 용도로만 쓴다.
function textWidth(s, size, bold) {
  let w = 0;
  for (const ch of s) {
    let u;
    if (ch === ' ') u = 0.278;
    else if (ch >= '0' && ch <= '9') u = 0.556;
    else if (ch >= 'A' && ch <= 'Z') u = bold ? 0.69 : 0.667;
    else if (ch >= 'a' && ch <= 'z') u = bold ? 0.56 : 0.52;
    else if ('.,:;!|\'`'.includes(ch)) u = 0.28;
    else u = 0.4;
    w += u * size;
  }
  return w;
}

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function centeredText(s, size, bold, y) {
  const x = (PAGE_W - textWidth(s, size, bold)) / 2;
  return `BT /${bold ? 'F1' : 'F2'} ${size} Tf ${x.toFixed(2)} ${y} Td (${esc(s)}) Tj ET\n`;
}

// QR 격자를 사각형들로 그린다. 한 줄에서 검은 칸이 이어지면 하나로 합쳐
// 사각형 개수를 줄인다(파일 크기와 여는 속도에 도움).
function qrOps(text, x0, yTop, size) {
  const { count, grid } = qrMatrix(text);
  const m = size / count;
  let ops = '';
  for (let r = 0; r < count; r++) {
    let c = 0;
    while (c < count) {
      if (!grid[r][c]) { c++; continue; }
      let end = c;
      while (end + 1 < count && grid[r][end + 1]) end++;
      const w = (end - c + 1) * m;
      const x = x0 + c * m;
      // PDF 좌표는 왼쪽 아래가 원점이라 행 번호를 뒤집는다.
      const y = yTop - (r + 1) * m;
      ops += `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${m.toFixed(2)} re\n`;
      c = end + 1;
    }
  }
  return ops + 'f\n';
}

function page(label, big, url, note) {
  const QR = 420;
  const x0 = (PAGE_W - QR) / 2;
  const yTop = 660;
  let s = '';
  s += '1 1 1 rg\n0 0 595 842 re f\n0 0 0 rg\n';   // 흰 바탕
  s += centeredText(label, 26, true, 788);
  s += centeredText(big, 74, true, 700);
  s += qrOps(url, x0, yTop, QR);
  s += centeredText(url, 9, false, 200);
  if (note) s += centeredText(note, 10, false, 176);
  return s;
}

function buildQrPdf({ base, tabletToken, tabletCount, instanceName }) {
  const pages = [];
  const tag = instanceName ? ` [${instanceName}]` : '';

  for (let id = 1; id <= tabletCount; id++) {
    const url = `${base}/sign.html?id=${id}&token=${encodeURIComponent(tabletToken)}`;
    pages.push(page('TABLET' + tag, String(id).padStart(2, '0'), url, 'Scan with the tablet camera'));
  }
  // 마지막 장: PC 모니터링 화면
  pages.push(page('MONITOR' + tag, 'PC', `${base}/monitor.html`, 'PC monitoring screen'));

  // ── PDF 조립 ──
  const objs = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  pages.forEach((content, i) => {
    const pid = 5 + i * 2;
    const cid = pid + 1;
    objs[pid] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${cid} 0 R >>`;
    objs[cid] = { stream: content };
  });

  const chunks = [];
  let offset = 0;
  const push = (s) => {
    const b = Buffer.from(s, 'latin1');
    chunks.push(b);
    offset += b.length;
  };

  push('%PDF-1.4\n');
  const xref = [];
  for (let i = 1; i < objs.length; i++) {
    const o = objs[i];
    if (o == null) continue;
    xref[i] = offset;
    if (typeof o === 'string') {
      push(`${i} 0 obj\n${o}\nendobj\n`);
    } else {
      const body = o.stream;
      push(`${i} 0 obj\n<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}endstream\nendobj\n`);
    }
  }

  const xrefStart = offset;
  const total = objs.length;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) {
    x += String(xref[i] || 0).padStart(10, '0') + ' 00000 n \n';
  }
  x += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  push(x);

  return Buffer.concat(chunks);
}

module.exports = { buildQrPdf };
