@echo off
setlocal

set "PROJECT_ROOT=%~dp0.."
for %%I in ("%PROJECT_ROOT%") do set "PROJECT_ROOT=%%~fI"
set "SERVICE_DIR=%PROJECT_ROOT%\tools\moss-tts-service"
set "MODEL_DIR=%SERVICE_DIR%\model"

set "CONDA_BAT="
if exist "%USERPROFILE%\anaconda3\condabin\conda.bat" set "CONDA_BAT=%USERPROFILE%\anaconda3\condabin\conda.bat"
if not defined CONDA_BAT if exist "%USERPROFILE%\miniconda3\condabin\conda.bat" set "CONDA_BAT=%USERPROFILE%\miniconda3\condabin\conda.bat"
if not defined CONDA_BAT (
  where conda >nul 2>&1
  if errorlevel 1 (
    echo [MOSS TTS] Conda was not found on PATH or in the default Anaconda locations.
    echo Install Miniconda or Anaconda, then create: conda create -n moss-tts python=3.8 -y
    pause
    exit /b 1
  )
)

if not exist "%MODEL_DIR%\moss.pth" (
  echo [MOSS TTS] Missing model file: %MODEL_DIR%\moss.pth
  pause
  exit /b 1
)

if not exist "%MODEL_DIR%\config.json" (
  echo [MOSS TTS] Missing model file: %MODEL_DIR%\config.json
  pause
  exit /b 1
)

if defined CONDA_BAT (
  call "%CONDA_BAT%" activate moss-tts
) else (
  call conda activate moss-tts
)
if errorlevel 1 (
  echo [MOSS TTS] Conda environment moss-tts is unavailable.
  echo Create it first: conda create -n moss-tts python=3.8 -y
  pause
  exit /b 1
)

pushd "%SERVICE_DIR%"
echo [MOSS TTS] Starting CPU-first local service at http://127.0.0.1:5010
python server.py
set "EXIT_CODE=%ERRORLEVEL%"
popd
echo [MOSS TTS] Service stopped with exit code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%
