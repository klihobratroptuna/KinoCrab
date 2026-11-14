@echo off
setlocal

rem Project launcher for Docker. Portable on another machine:
rem - working folder is taken from this file own location, so the project path does not matter;
rem - Docker is taken from PATH, with a fallback to the default Docker Desktop folder;
rem - docker compose is used, legacy docker-compose.exe is picked if the plugin is absent;
rem - Node is needed only for npm install and for the build helper, without Node the build is
rem   done with plain docker commands.
rem ASCII on purpose: a bat file is read in the console code page, so Cyrillic here would be
rem   garbled on a machine with another code page.
rem
rem Flags:
rem   --recreate    recreate the containers
rem   --skip-build  do not rebuild the web image
rem   --skip-sync   start only web and pocketbase
rem   --superuser   create the PocketBase superuser from PB_EMAIL and PB_PASSWORD in .env

cd /d "%~dp0"

set "RECREATE="
set "SKIPBUILD="
set "SKIPSINC="
set "SUPERUSER="
for %%a in (%*) do (
    if /i "%%a"=="--recreate" set "RECREATE=1"
    if /i "%%a"=="--skip-build" set "SKIPBUILD=1"
    if /i "%%a"=="--skip-sync" set "SKIPSINC=1"
    if /i "%%a"=="--superuser" set "SUPERUSER=1"
)

rem Docker: PATH first, then the default Docker Desktop folder.
set "DOCKER="
where docker >nul 2>&1
if not errorlevel 1 set "DOCKER=docker"
if not defined DOCKER if exist "C:\Program Files\Docker\Docker\resources\bin\docker.exe" set "DOCKER=C:\Program Files\Docker\Docker\resources\bin\docker.exe"
if not defined DOCKER (
    echo Docker was not found in PATH or in the default Docker Desktop folder.
    exit /b 1
)
"%DOCKER%" version >nul 2>&1
if errorlevel 1 (
    echo Docker daemon does not answer. Start Docker Desktop and repeat.
    exit /b 1
)

set "COMPOSE_EXE="
"%DOCKER%" compose version >nul 2>&1
if errorlevel 1 if exist "C:\Program Files\Docker\Docker\resources\bin\docker-compose.exe" set "COMPOSE_EXE=C:\Program Files\Docker\Docker\resources\bin\docker-compose.exe"

rem Tokens and the PocketBase login come from .env: compose reads them at start.
if not exist ".env" (
    echo There is no .env here. Copy .env.example, fill the tokens, then repeat.
    exit /b 1
)

rem The sync services mount ./node_modules from the host, so without them containers start
rem and fall down at once. The pocketbase package is needed by all of them.
if not exist "node_modules\pocketbase" (
    where node >nul 2>&1
    if errorlevel 1 (
        echo node_modules is missing and Node is not in PATH, so npm install cannot run.
        echo Starting only web and pocketbase.
        set "SKIPSINC=1"
    ) else (
        echo Installing dependencies: npm install
        call npm install
        if errorlevel 1 exit /b 1
    )
)

if not defined SKIPBUILD (
    where node >nul 2>&1
    if not errorlevel 1 if "%DOCKER%"=="docker" (
        echo Building the web image with the project helper...
        node scripts\docker-build-web.mjs
        if errorlevel 1 exit /b 1
    ) else (
        echo Building the web image with plain docker commands...
        call :compose build web
        if errorlevel 1 (
            echo First build attempt failed, retrying with the legacy builder.
            set "DOCKER_BUILDKIT=0"
            call :compose build web
            if errorlevel 1 exit /b 1
        )
    )
)

if defined RECREATE (
    echo Recreating containers...
    if defined SKIPSINC (
        call :compose up -d --force-recreate web pocketbase
    ) else (
        call :compose up -d --force-recreate
    )
) else (
    echo Starting containers...
    if defined SKIPSINC (
        call :compose up -d web pocketbase
    ) else (
        call :compose up -d
    )
)
if errorlevel 1 exit /b 1

call :compose ps

rem Values are read before the block below: inside a block cmd expands percent names when it
rem parses the block, so a set inside the same block would give empty values here.
set "PBE="
set "FBP="
for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
    if /i "%%a"=="PB_EMAIL" set "PBE=%%b"
    if /i "%%a"=="PB_PASSWORD" set "FBP=%%b"
)

if defined SUPERUSER (
    if defined PBE if defined FBP (
        echo Creating the PocketBase superuser...
        call :compose exec -T pocketbase pocketbase superuser upsert "%PBE%" "%FBP%" --dir=/pb_data
    ) else (
        echo PB_EMAIL or PB_PASSWORD is not in .env, superuser not created.
    )
)

netstat -ano | findstr /c:":3000" >nul && echo Port 3000 is used by something else, check the app address.

echo App:        http://localhost:3000
echo PocketBase: http://localhost:8090
endlocal
exit /b 0

:compose
if defined COMPOSE_EXE (
    "%COMPOSE_EXE%" %*
) else (
    "%DOCKER%" compose %*
)
exit /b %errorlevel%