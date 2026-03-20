@echo off
REM Quick start script for MSA Viewer with BLAST
cd /d "%~dp0"

echo Checking Node.js installation...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo Node.js found: 
node --version

echo.
echo Checking BLAST installation...
blastn -version >nul 2>&1
if errorlevel 1 (
    echo WARNING: BLAST is not installed or not in PATH
    echo The BLAST feature will not work until BLAST is installed
    echo Download from: https://ftp.ncbi.nlm.nih.gov/blast/executables/blast+/LATEST/
    echo.
) else (
    echo BLAST found:
    blastn -version
)

REM Check if already running
netstat -ano | findstr ":3000.*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo Server is already running on port 3000.
    echo Run stop-server.bat first to restart it.
    pause
    exit /b 0
)

echo.
echo Installing Node.js dependencies...
call npm install

echo.
echo Starting MSA Viewer Server in background window...
start "MSA Viewer Server" /min cmd /k "cd /d "%~dp0" && node server.js"

echo.
echo Server started. It runs in its own window independent of this terminal.
echo   URL : http://localhost:3000
echo   Stop: run stop-server.bat (or close the MSA Viewer Server window)
echo.
