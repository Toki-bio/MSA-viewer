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

echo.
echo Installing Node.js dependencies...
call npm install

echo.
echo Starting MSA Viewer BLAST Server...
echo Server will run on http://localhost:3000
echo.
call node server.js
