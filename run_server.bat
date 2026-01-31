@echo off
setlocal

cd /d "%~dp0"

call "%~dp0install.bat"

set PYTHONUTF8=1

start "" powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 1; Start-Process 'http://127.0.0.1:8000/'"

".venv\Scripts\python.exe" -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000

endlocal
