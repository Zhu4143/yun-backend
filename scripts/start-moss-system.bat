@echo off
setlocal

set "PROJECT_ROOT=%~dp0.."
for %%I in ("%PROJECT_ROOT%") do set "PROJECT_ROOT=%%~fI"

call :port_in_use 3131
if errorlevel 1 (
  start "MOSS Desktop Agent" /D "%PROJECT_ROOT%\yun-desktop-agent" cmd.exe /k npm run start
) else (
  echo [MOSS SYSTEM] Port 3131 already in use; desktop agent not started again.
)

call :port_in_use 3030
if errorlevel 1 (
  start "MOSS Backend" /D "%PROJECT_ROOT%" cmd.exe /k node server.js
) else (
  echo [MOSS SYSTEM] Port 3030 already in use; backend not started again.
)

call :port_in_use 4173
if errorlevel 1 (
  start "MOSS Frontend" /D "%PROJECT_ROOT%\yun-core" cmd.exe /k npm.cmd run dev -- --host 127.0.0.1 --port 4173 --strictPort
) else (
  echo [MOSS SYSTEM] Port 4173 already in use; frontend not started again.
)

echo [MOSS SYSTEM] Waiting for the frontend on port 4173...
call :wait_for_port 4173 60
if errorlevel 1 (
  echo [MOSS SYSTEM] Frontend did not become ready within 60 seconds.
  echo [MOSS SYSTEM] Check the "MOSS Frontend" window for the startup error.
) else (
  start "" http://127.0.0.1:4173/
  echo [MOSS SYSTEM] Frontend ready. Opening the MOSS interface.
)
exit /b 0

:wait_for_port
setlocal EnableDelayedExpansion
set /a "WAITED=0"
:wait_for_port_loop
call :port_in_use %~1
if not errorlevel 1 (
  endlocal
  exit /b 0
)
if !WAITED! geq %~2 (
  endlocal
  exit /b 1
)
timeout /t 1 /nobreak >nul
set /a "WAITED+=1"
goto :wait_for_port_loop

:port_in_use
netstat -ano -p tcp | findstr /r /c:":%~1 .*LISTENING" >nul 2>&1
exit /b %ERRORLEVEL%
