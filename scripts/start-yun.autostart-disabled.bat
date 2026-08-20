@echo off
chcp 65001 >nul
set "YUN_PROJECT_DIR=C:\Users\zhudo\yun-liquid-ui-react"
cd /d "%YUN_PROJECT_DIR%"
start "" /min powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File "%YUN_PROJECT_DIR%\scripts\start-yun.ps1" -DebugOcr -Silent
