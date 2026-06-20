@echo off
REM CopilotKit Runtime Watchdog
REM 检查8766端口是否在监听，不在则重启

netstat -ano | findstr ":8766" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    REM 端口正常，静默退出
    exit /b 0
)

REM 端口不在，重启runtime
echo [%date% %time%] CopilotKit Runtime not running, restarting... >> "%~dp0watchdog.log"
cd /d "%~dp0"
start /b node runtime-server.js
timeout /t 3 /nobreak >nul

netstat -ano | findstr ":8766" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [%date% %time%] Restarted successfully >> "%~dp0watchdog.log"
) else (
    echo [%date% %time%] FAILED to restart >> "%~dp0watchdog.log"
)
