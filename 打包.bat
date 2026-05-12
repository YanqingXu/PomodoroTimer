@echo off
setlocal
title Pomodoro Timer - Build EXE

set "APP_NAME=Pomodoro-Timer"
set "ELECTRON_VERSION=28.3.3"
set "OUTPUT_DIR=dist\%APP_NAME%-win32-x64"
set "PACK_TMP=.packtmp"

echo ========================================
echo      Pomodoro Timer - Windows EXE Build
echo ========================================
echo.
cd /d "%~dp0"

set ELECTRON_RUN_AS_NODE=

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js was not found. Please install Node.js first.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm was not found. Please check your Node.js installation.
    pause
    exit /b 1
)

echo [1/4] Closing old app process...
taskkill /F /IM "%APP_NAME%.exe" >nul 2>&1

echo [2/4] Preparing runtime dependencies...
if not exist "node_modules\electron-log\package.json" (
    call :InstallPackage electron-log@5.0.0 electron-log
    if errorlevel 1 goto Failed
)

if not exist "node_modules\electron\package.json" (
    call :InstallPackage electron@%ELECTRON_VERSION% electron
    if errorlevel 1 goto Failed
)

echo [3/4] Packaging app...
call npx --yes electron-packager@17.1.2 . %APP_NAME% --platform=win32 --arch=x64 --electron-version=%ELECTRON_VERSION% --out=dist --overwrite --no-prune --ignore="^/dist" --ignore="^/\.git" --ignore="^/node_modules/electron/dist($|/)" --ignore="^/\.packtmp"
if errorlevel 1 goto Failed

if not exist "%OUTPUT_DIR%\%APP_NAME%.exe" goto Failed

echo [4/4] Cleaning temporary files...
if exist "%PACK_TMP%" rmdir /s /q "%PACK_TMP%"

echo.
echo ========================================
echo          Build completed
echo ========================================
echo.
echo Executable:
echo   %OUTPUT_DIR%\%APP_NAME%.exe
echo.
explorer.exe "%OUTPUT_DIR%"
pause
exit /b 0

:InstallPackage
echo   - Installing %~1
if not exist "node_modules" mkdir "node_modules"
if not exist "%PACK_TMP%" mkdir "%PACK_TMP%"
call npm pack %~1 --pack-destination "%PACK_TMP%"
if errorlevel 1 exit /b 1

set "TGZ="
for /f "delims=" %%F in ('dir /b /o-d "%PACK_TMP%\%~2-*.tgz" 2^>nul') do (
    set "TGZ=%PACK_TMP%\%%F"
    goto ExtractPackage
)

:ExtractPackage
if "%TGZ%"=="" exit /b 1
if not exist "node_modules\%~2" mkdir "node_modules\%~2"
tar -xzf "%TGZ%" -C "node_modules\%~2" --strip-components 1
exit /b %ERRORLEVEL%

:Failed
echo.
echo [ERROR] Build failed. Please check the messages above.
if exist "%PACK_TMP%" rmdir /s /q "%PACK_TMP%"
pause
exit /b 1
