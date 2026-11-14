@echo off
cd /d "%~dp0"
where python >nul 2>nul || (echo Python was not found. Install Python 3.9+ from python.org and tick "Add to PATH". & pause & exit /b 1)
python -m pip install -q -r requirements.txt
echo Starting Kassa Run 3D on http://localhost:8080 ...
start "" cmd /c "timeout /t 3 >nul & start http://localhost:8080"
python server\app.py
echo.
echo The server stopped. If you saw "address already in use", close the other window running the game (or set PORT=8081) and try again.
pause
