@echo off
setlocal

set "PROJECT_NAME=Writing Bank Module"
set "PROJECT_ROOT=%~dp0"

title %PROJECT_NAME% - Development Launcher
echo ========================================
echo   %PROJECT_NAME%
echo   Starting local development services
echo ========================================
echo.

if not exist "%PROJECT_ROOT%package.json" (
    echo [ERROR] Root package.json was not found.
    goto :failed
)
if not exist "%PROJECT_ROOT%package-lock.json" (
    echo [ERROR] package-lock.json was not found. The project uses npm.
    goto :failed
)
if not exist "%PROJECT_ROOT%web\package.json" (
    echo [ERROR] Frontend manifest web\package.json was not found.
    goto :failed
)
if not exist "%PROJECT_ROOT%backend\pom.xml" (
    echo [ERROR] Backend manifest backend\pom.xml was not found.
    goto :failed
)
if not exist "%PROJECT_ROOT%backend\src\main\resources\application.yml" (
    echo [ERROR] Backend configuration application.yml was not found.
    goto :failed
)
if not exist "%PROJECT_ROOT%web\vite.config.ts" (
    echo [ERROR] Frontend configuration web\vite.config.ts was not found.
    goto :failed
)
if not exist "%PROJECT_ROOT%docker-compose.yml" (
    echo [ERROR] docker-compose.yml was not found. It defines the local Firestore emulator.
    goto :failed
)
if not exist "%PROJECT_ROOT%node_modules\.bin\vite.cmd" (
    echo [ERROR] Frontend dependencies are missing. Run npm install from the project root first.
    goto :failed
)

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or is not on PATH. Install Node.js 20 or newer.
    goto :failed
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js 20 or newer is required. Update Node.js and try again.
    goto :failed
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm was not found. Install Node.js with npm and try again.
    goto :failed
)
where java >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Java 17 or newer was not found. Install a JDK and add it to PATH.
    goto :failed
)
set "JAVA_VERSION="
set "JAVA_MAJOR="
for /f "tokens=3" %%V in ('java -version 2^>^&1 ^| findstr /i "version"') do set "JAVA_VERSION=%%~V"
for /f "tokens=1 delims=." %%V in ("%JAVA_VERSION%") do set "JAVA_MAJOR=%%V"
if not defined JAVA_MAJOR (
    echo [ERROR] Could not determine the Java version. Java 17 or newer is required.
    goto :failed
)
if %JAVA_MAJOR% LSS 17 (
    echo [ERROR] Java %JAVA_MAJOR% is installed, but this backend requires Java 17 or newer.
    goto :failed
)
where mvn >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Maven was not found. Install Maven and add it to PATH.
    goto :failed
)
where docker >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker was not found. Install and start Docker Desktop for the Firestore emulator.
    goto :failed
)
docker info >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not running or is unavailable. Start Docker Desktop, then run this launcher again.
    goto :failed
)

echo [1/3] Starting the Firestore emulator required by the backend...
pushd "%PROJECT_ROOT%"
docker compose up -d firestore
if errorlevel 1 (
    popd
    echo [ERROR] Firestore emulator could not be started. Check Docker Desktop and port 8085.
    goto :failed
)
popd

echo.
echo [2/3] Opening the backend in a separate terminal (http://localhost:8080)...
start "Writing Bank - Backend" /D "%PROJECT_ROOT%" cmd /k "npm run dev:backend"

echo [3/3] Opening the frontend in a separate terminal (http://localhost:5174)...
start "Writing Bank - Frontend" /D "%PROJECT_ROOT%" cmd /k "npm run dev:web"

echo.
echo Both service terminals have been opened. Keep them open to view logs.
echo This launcher can now be closed.
exit /b 0

:failed
echo.
echo Startup stopped. Fix the reported issue and run start-dev.bat again.
pause
exit /b 1
