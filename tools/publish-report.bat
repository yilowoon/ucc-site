@echo off
REM ---------------------------------------------------------------
REM  ucc.or.kr 보고서 자동 게시 (Windows 작업 스케줄러용)
REM  사용: publish-report.bat "C:\경로\보고서.docx"
REM  계정은 setx 로 등록한 사용자 환경변수를 사용합니다.
REM    setx UCC_ADMIN_USER "admin"
REM    setx UCC_ADMIN_PASS "비밀번호"
REM ---------------------------------------------------------------
setlocal
cd /d "%~dp0.."

if "%~1"=="" (
  echo [오류] 올릴 문서 경로를 인자로 주세요.
  echo   예: publish-report.bat "C:\Users\USER\Desktop\보고서.docx"
  exit /b 1
)

if "%UCC_ADMIN_USER%"=="" (
  echo [오류] UCC_ADMIN_USER 환경변수가 없습니다. README.md 를 참고하세요.
  exit /b 1
)

node tools\publish-report.mjs --file "%~1" %2 %3 %4 %5 %6 %7 %8 %9
exit /b %ERRORLEVEL%
