@echo off
REM Pilot launcher until MSI ships ITInventBrowserProbe.exe
setlocal
set "REPO=C:\Project\Image_scan"
set "PYTHONPATH=%REPO%;%REPO%\WEB-itinvent"
cd /d "%REPO%"
where python >nul 2>&1
if errorlevel 1 (
  echo python not found in PATH
  exit /b 2
)
python "%REPO%\browser_probe_agent.py" %*
