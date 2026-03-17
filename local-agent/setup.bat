@echo off
chcp 65001 >nul
echo.
echo ==========================================
echo  조인앤조인 로컬 RPA 에이전트 설치
echo ==========================================
echo.

echo [1/4] Python 가상환경 생성 중...
python -m venv .venv
if errorlevel 1 (
    echo [오류] Python이 설치되어 있지 않습니다. python.org에서 설치하세요.
    pause
    exit /b 1
)
call .venv\Scripts\activate

echo [2/4] 패키지 설치 중...
pip install -r requirements.txt

echo [3/4] Playwright 브라우저 설치 중...
python -m playwright install chromium

echo [4/4] 설정 파일 확인...
if not exist .env (
    copy .env.example .env
    echo .env 파일이 생성되었습니다. 편집하여 서버 URL과 API 키를 입력하세요.
) else (
    echo .env 파일이 이미 존재합니다.
)

echo.
echo ==========================================
echo  설치 완료!
echo  1. .env 파일을 편집하세요 (메모장으로 열기)
echo  2. run.bat 으로 실행하세요
echo ==========================================
pause
