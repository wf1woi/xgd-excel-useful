@echo off
setlocal
chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%install_windows.ps1"

if not exist "%PS_SCRIPT%" goto missing_ps

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%"
set "EXIT_CODE=%ERRORLEVEL%"

if "%EXIT_CODE%"=="0" goto success

echo.
echo [ERROR] Script failed. Exit code: %EXIT_CODE%
pause
exit /b %EXIT_CODE%

:missing_ps
echo [ERROR] install_windows.ps1 was not found.
echo [ERROR] Keep the .bat and .ps1 files in the same folder.
pause
exit /b 1

:success
exit /b 0
