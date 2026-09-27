@echo off
netstat -ano | findstr :6379 | findstr LISTENING >nul
if %errorlevel% equ 0 (
    echo Redis is already running on port 6379.
    ping -n 86400 127.0.0.1 >nul
) else (
    echo Starting Redis Server...
    "%LOCALAPPDATA%\Microsoft\WinGet\Packages\taizod1024.redis-windows-fork_Microsoft.Winget.Source_8wekyb3d8bbwe\Redis-8.10.1-Windows-x64-msys2\redis-server.exe"
)
