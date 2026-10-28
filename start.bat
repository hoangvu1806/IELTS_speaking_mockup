@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Khoi dong backend (FastAPI, cong 8000)...
start "Pron backend" cmd /k "cd backend && python -m uvicorn app:app --host 127.0.0.1 --port 8000"
if not exist frontend\node_modules (
  echo Cai dat thu vien frontend...
  pushd frontend && call npm install && popd
)
echo Khoi dong frontend (Vite, cong 5173)...
start "Pron frontend" cmd /k "cd frontend && npm run dev -- --open"
