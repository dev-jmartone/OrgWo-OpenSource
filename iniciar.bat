@echo off
title OrgWo - Servidor local
cd /d "%~dp0"

echo ============================================================
echo   OrgWo - Servidor Docker
echo ============================================================
echo.

echo [DOCKER] Iniciando contenedor de aplicacion...
docker compose up --build

echo.
echo [APAGANDO] Deteniendo servicios...
docker compose down >nul 2>&1
echo Todo apagado correctamente.
pause
exit /b 0
