@echo off
cd /d %~dp0
if not exist node_modules (
  echo 처음 실행이라 필요한 파일을 설치합니다. 잠시만 기다려주세요...
  call npm install
)
echo.
echo 서버를 시작합니다. 이 창을 닫으면 서버가 꺼집니다.
echo.
call npm start
pause
