# 인수인계 문서 (태블릿 서명 실시간 모니터링)

> 새 채팅/새 세션에서 이 프로젝트를 이어서 작업할 때 이 문서를 먼저 읽으세요.
> 저장소: `kimdaehyun004-ops/tabletsignaturemonitor` (기본 브랜치 `main`)

---

## 1. 이게 뭐 하는 프로그램인가

행사장에서 **여러 대의 태블릿에 사람들이 손으로 서명**을 하면, **PC 모니터링 화면에서 그 서명이 실시간으로 그려지는 것**을 한눈에 보고, 완료된 서명 이미지를 관리자가 다운로드할 수 있는 웹 프로그램. (예: "NH AGENTIC AI BANK VISION DAY" 같은 브랜딩 프레임 위에 서명)

- 태블릿 화면(`sign.html`) ↔ 서버(Node + WebSocket) ↔ PC 모니터(`monitor.html`)가 실시간 연결
- 완전히 독립된 프로젝트 (다른 사이트와 분리)

---

## 2. 배포 구조 (중요)

- **호스팅: Render.com** (Node 웹서비스). 저장소 `main`에 push하면 자동 재배포됨.
- **같은 코드로 3개 독립 배포(V1/V2/V3)** 를 운영 중. 각각 다른 Render 서비스 + 다른 환경변수.
  - V1: `https://tabletsignaturemonitor.onrender.com`
  - V2: `https://tabletsignaturemonitor-v2.onrender.com`
  - V3: `https://tabletsignaturemonitor-v3.onrender.com`
  - (V2/V3 정확한 주소는 Render 대시보드에서 확인)
- 용도: 한 곳에서 태블릿 많이(최대 30) 쓸 때 나눠 쓰거나, 서로 다른 2~3곳에서 동시에 독립 운영.
- **무료 요금제 주의점 2가지:**
  1. 오래 접속 없으면 서버가 "잠자기(cold start)" → 다음 접속 시 최대 50초 지연. 행사 전 미리 한 번 깨워두면 됨. (유료 Starter 월 $7이면 잠자기 없음)
  2. **디스크가 임시(ephemeral)** — 재배포/재시작 시 `data/` 폴더(저장된 서명, 업로드한 배경, 발급한 게스트 목록)가 **초기화될 수 있음.** 그래서 배경·게스트는 행사 직전에 세팅 권장. (영구 보관이 필요하면 유료 디스크 또는 외부 스토리지 연동 필요 — 아직 미구현)

### 환경변수 (Render 각 서비스 Environment에서 설정)
| KEY | 예시값 | 설명 |
|---|---|---|
| `ADMIN_PASSWORD` | `8450` | 모니터/관리자 접속 비밀번호 |
| `TABLET_TOKEN` | `1234` | 태블릿 접속 토큰 (모든 태블릿 공용) |
| `TABLET_COUNT` | `10` | 사용할 태블릿 대수 |
| `INSTANCE_NAME` | `V1` | 화면에 표시할 버전 이름 (V1/V2/V3 구분용) |
| `PORT` | (자동) | Render가 자동 지정, 직접 넣지 않음 |

> 통합 대시보드(`dashboard.html`)를 쓰려면 V1/V2/V3의 `ADMIN_PASSWORD`를 **똑같이** 맞춰야 함.
> 비밀번호 변경 = Render 환경변수에서 수정 후 재배포 (웹에서 직접 변경은 무료 요금제 한계로 미지원).

---

## 3. 기술 구조

```
태블릿 sign.html ─┐
                 ├─(WebSocket, wss)─▶  Render의 Node 서버 1개  ◀─(WebSocket)─ PC monitor.html / 게스트
태블릿 sign.html ─┘                    (Express 정적 서빙 + ws + 파일저장)
                                        └ 관리자 admin.html, 배경편집 bgedit.html, QR links.html, 통합 dashboard.html
```

- **서버(`server.js`)**: Express로 `public/` 정적 서빙 + REST API + `ws` WebSocketServer(같은 포트).
- **실시간 전송 방식**: 태블릿이 서명 획을 **정규화 좌표(0~1) + 굵기**로 잘게 보냄 → 서버가 모든 모니터에 브로드캐스트 → 모니터가 똑같이 다시 그림. 저장 시에만 PNG(dataURL) 한 번 전송.
- **데이터 사용량**: 매우 적음(서명 1건 ≈ 130KB, 하루 500건 ≈ 70~150MB). 무료 요금제로 충분.
- 별도 실시간 SaaS(Pusher/Ably)는 **메시지 과금 구조상 오히려 불리**해서 안 씀.

### WebSocket 메시지 종류
- 태블릿→서버: `hello`(role:tablet, id, token, aspect), `aspect`, `stroke`(points[]), `clear`, `save`(dataUrl)
- 서버→태블릿: `auth_ok`/`auth_error`, `background`(hasBackground, version)
- 모니터→서버: `hello`(role:monitor, password)
- 서버→모니터: `auth_ok`/`auth_error`, `status`(tablets[]), `stroke`, `clear`, `saved`

### REST API (server.js)
- `GET /api/config` → { tabletCount, instanceName } (공개)
- `GET /api/host-info` → { base, tabletCount, tabletToken, instanceName } (공개; QR 생성용)
- `GET /api/status?pw=` → 접속 현황 { instanceName, online, onlineIds } (관람 권한, **CORS 허용** — 대시보드 크로스도메인용)
- `GET /api/signatures?pw=` → 저장된 서명 목록 (관리자 전용)
- `GET /api/signature-file/:filename?pw=` → 서명 PNG 다운로드 (관리자 전용)
- `GET /api/background?id=N&v=` → 태블릿 N의 배경 이미지 (공개)
- `GET /api/background-info?id=N` → 배경 존재/버전 (공개)
- `GET /api/backgrounds-info?pw=` → 전체 배경 슬롯 정보 (관리자 또는 배경권한 게스트)
- `POST /api/background?id=N|all&pw=` → 배경 업로드/교체 (관리자 또는 배경권한 게스트)
- `DELETE /api/background?id=N|all&pw=` → 배경 삭제 (관리자 또는 배경권한 게스트)
- `GET/POST/DELETE /api/guests?pw=` → 게스트 발급/목록/삭제 (관리자 전용)

### 권한 체계
- `checkAdminPw` = 관리자 비번만
- `isValidViewer` = 관리자 **또는** 유효한 게스트 (모니터 접속용)
- `isBackgroundEditor` = 관리자 **또는** `canBackground=true` 게스트 (배경 편집용)

---

## 4. 페이지(화면) 목록 — `public/`

| 파일 | 용도 | 접근 |
|---|---|---|
| `sign.html` / `sign.js` | **태블릿 서명 화면**. 배경 위에 서명, 저장, 펜 굵기, 화면정리(키오스크), 전체화면 | 태블릿 토큰 |
| `monitor.html` / `monitor.js` | **PC 실시간 모니터링 보드** (흰 바탕, 모든 태블릿 서명 표시) | 관리자/게스트 비번 |
| `admin.html` / `admin.js` | **관리자 페이지**: 서명 다운로드, 태블릿별 배경 업로드, 게스트 발급 | 관리자 비번 |
| `bgedit.html` / `bgedit.js` | **배경 편집 전용 페이지** (배경권한 게스트도 사용 가능) | 관리자/배경게스트 |
| `links.html` / `links.js` | 태블릿 연결용 **QR코드** 페이지 | 공개 |
| `dashboard.html` / `dashboard.js` | **V1/V2/V3 통합 접속현황** 대시보드 (여러 버전 한 화면) | 관리자 비번(공용) |
| `qrcode.lib.js` | QR 생성 라이브러리(MIT) | - |
| `style.css` | 전체 공용 스타일 | - |
| `manifest.json` | 태블릿 홈화면 추가용 PWA manifest | - |

---

## 5. 지금까지 구현된 기능 (전부)

### 태블릿 서명 화면 (`sign.html`)
- 부드러운 서명 렌더링(2차 베지어 곡선), **일정한 펜 굵기**(속도별 가변은 선 깨짐 문제로 제거)
- **펜 굵기 선택**(얇게/보통/굵게/매우굵게, 저장됨)
- **두 손가락/손바닥 무시** (먼저 닿은 pointer 하나만 인식)
- **화면 회전해도 서명 유지**(정규화 좌표 보관 후 재그리기)
- **배경 이미지**(브랜딩 프레임) 위에 서명 — 배경은 태블릿별로 다르게 가능. 저장 파일에는 **서명 획만** 포함(배경 제외)
- **화면 정리(키오스크) 모드**: 상단/하단 UI 숨기고 좌상단에 연결표시등만. 더블터치로 복원
- **전체화면**, **화면 꺼짐 방지**(Wake Lock), 당겨서새로고침/롱프레스메뉴/텍스트선택 방지
- 접속: QR 스캔 또는 번호+토큰 입력. 브라우저에 저장되어 재접속 자동

### PC 모니터링 (`monitor.html`)
- **흰 보드** 형태(격자 어두운 테두리 없음) — 통째로 캡처해 크롭 가능
- 태블릿 서명이 **원본과 같은 화면비율**로 표시(찌그러짐 없음), 회전/창크기 바뀌어도 유지
- 상단 **연결상태 한눈 표시**(태블릿 1●2●…), 저장 시 "저장됨" 표시
- **하단 QR 스트립**: 미접속 태블릿 연결 QR
- 상단 컨트롤(브라우저에 저장됨):
  - **글씨 표시**(태블릿 번호 라벨, 기본 꺼짐)
  - **칸 구분선**(기본 켜짐)
  - **미접속 숨기기**
  - **가로 칸 수**(자동/1~N, 예: 10 = 한 줄)
  - **드래그로 칸 위치(순서) 변경**
- 화면 꺼짐 방지(Wake Lock)

### 관리자 (`admin.html`)
- 저장된 서명 **썸네일 + 다운로드**
- **태블릿별 배경** 업로드/교체/삭제 + "모든 태블릿에 같게 적용" + "전체 삭제"
- **게스트 비밀번호** 발급(최대 5개, 접속기간 1시간~3일, 만료 자동), "배경 변경 허용" 옵션
- 실시간 모니터링/통합현황/배경편집 링크

### 게스트 (view-only + 선택적 배경편집)
- 관리자가 발급한 6자리 코드로 **모니터링 관람**
- "배경 변경 허용" 게스트는 `bgedit.html`에서 **배경만** 편집 가능
- 다운로드·게스트관리는 항상 관리자 전용

### 통합/멀티 배포
- `INSTANCE_NAME`으로 V1/V2/V3 화면 구분(노란 배지)
- `dashboard.html`에서 여러 버전 접속현황을 한 화면에(주소 등록식, CORS)

---

## 6. 로컬 개발/실행 방법

```bash
git clone https://github.com/kimdaehyun004-ops/tabletsignaturemonitor
cd tabletsignaturemonitor
npm install
# .env 파일 생성:
printf 'PORT=3000\nADMIN_PASSWORD=8450\nTABLET_TOKEN=1234\nTABLET_COUNT=10\nINSTANCE_NAME=V1\n' > .env
npm start
# http://localhost:3000/monitor.html (비번 8450)
# http://localhost:3000/sign.html?id=1&token=1234
```
- Windows용 `시작.bat` 더블클릭으로도 실행 가능(설치+실행+QR페이지 자동 오픈).
- `.env`, `node_modules/`, `data/` 는 `.gitignore`로 제외됨.

### 테스트 방식(참고)
- 지금까지 변경마다 **Playwright(헤드리스 Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`)** 로 서버 띄우고 태블릿/모니터/관리자 흐름을 검증한 뒤 커밋함. (npm으로 임시 폴더에 playwright 설치해 사용)

---

## 7. 아직 안 된 것 / 다음에 할 만한 것 (아이디어)

- **영구 저장**: 무료 요금제 디스크가 임시라 서명/배경/게스트가 재배포 시 사라짐 → 유료 디스크 또는 외부 스토리지(S3 등) 연동
- 게스트 권한 세분화 확장(예: 다운로드 허용 게스트)
- 저장 서명 ZIP 일괄 다운로드
- 태블릿별 서로 다른 토큰(현재는 공용 1개)

---

## 8. 커밋 규칙(이 세션 기준)
- `main`에 직접 커밋/푸시(자동 재배포). 변경 후 항상 로컬 검증 → 커밋 → 푸시.
- 커밋 메시지 끝에 attribution 붙임(세션에서 지정된 형식 사용).
