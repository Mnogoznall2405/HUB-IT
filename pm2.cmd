@echo off
setlocal

set "ROOT=%~dp0"
set "NODE_DIR="

for /d %%D in ("%ROOT%tools\node-v*-win-x64") do (
    set "NODE_DIR=%%~fD"
)

if not defined NODE_DIR (
    echo Local Node.js not found under "%ROOT%tools". 1>&2
    exit /b 1
)

set "NODE_EXE=%NODE_DIR%\node.exe"
set "PM2_JS=%APPDATA%\npm\node_modules\pm2\bin\pm2"

if not exist "%NODE_EXE%" (
    echo node.exe not found: "%NODE_EXE%" 1>&2
    exit /b 1
)

if not exist "%PM2_JS%" (
    echo PM2 CLI not found: "%PM2_JS%" 1>&2
    exit /b 1
)

"%NODE_EXE%" "%PM2_JS%" %*
exit /b %ERRORLEVEL%
