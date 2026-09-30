@echo off
title OrgWo - Servidor local (PRODUCCION)
cd /d "%~dp0"

echo ============================================================
echo   OrgWo [PRODUCCION]
echo   Iniciando servidor local en http://127.0.0.1:5000
echo   Las solicitudes de Remedy se enviaran a Servidor Remedy (PRODUCCION)
echo ============================================================
echo.

REM ============================================================
REM Detectar interprete de Python (PATH, LocalAppData o VENV)
REM ============================================================
set "PYTHON_EXE="

if exist "%~dp0.venv\Scripts\python.exe" (
    set "PYTHON_EXE=%~dp0.venv\Scripts\python.exe"
    goto :python_found
)

where python >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_EXE=python"
    goto :python_found
)

where py >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_EXE=py"
    goto :python_found
)

if exist "%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe" (
    set "PYTHON_EXE=%LOCALAPPDATA%\Python\pythoncore-3.14-64\python.exe"
    set "PATH=%LOCALAPPDATA%\Python\pythoncore-3.14-64;%LOCALAPPDATA%\Python\pythoncore-3.14-64\Scripts;%LOCALAPPDATA%\Python\bin;%PATH%"
    goto :python_found
)

if exist "%LOCALAPPDATA%\Python\bin\python.exe" (
    set "PYTHON_EXE=%LOCALAPPDATA%\Python\bin\python.exe"
    set "PATH=%LOCALAPPDATA%\Python\bin;%PATH%"
    goto :python_found
)

for /d %%D in ("%LOCALAPPDATA%\Python\pythoncore-*") do (
    if exist "%%D\python.exe" (
        set "PYTHON_EXE=%%D\python.exe"
        set "PATH=%%D;%%D\Scripts;%PATH%"
        goto :python_found
    )
)

for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do (
    if exist "%%D\python.exe" (
        set "PYTHON_EXE=%%D\python.exe"
        set "PATH=%%D;%%D\Scripts;%PATH%"
        goto :python_found
    )
)

for /d %%D in ("%ProgramFiles%\Python3*") do (
    if exist "%%D\python.exe" (
        set "PYTHON_EXE=%%D\python.exe"
        set "PATH=%%D;%%D\Scripts;%PATH%"
        goto :python_found
    )
)

:python_found
if "%PYTHON_EXE%"=="" (
    echo [ERROR] Python no esta instalado o no esta en el PATH.
    echo.
    echo Instalalo desde https://www.python.org/downloads/
    echo Asegurate de tildar "Add Python to PATH" en el instalador.
    echo.
    pause
    exit /b 1
)

REM Verificar dependencias (Flask, Pillow, Requests, PyWin32, Waitress, Psutil)
"%PYTHON_EXE%" -c "import flask, PIL, requests, win32com.client, waitress, psutil" >nul 2>&1
if errorlevel 1 (
    echo [SETUP] Instalando dependencias necesarias: Flask, Pillow, Requests, PyWin32, Waitress, Psutil...
    "%PYTHON_EXE%" -m pip install flask pillow requests pywin32 waitress psutil
    if errorlevel 1 (
        echo.
        echo [ERROR] No se pudieron instalar las dependencias necesarias.
        pause
        exit /b 1
    )
    echo.
)

REM Arrancar en Produccion
set ENV=PROD
set PORT=5000
"%PYTHON_EXE%" Backend/main.py

echo.
echo El servidor se detuvo. Presiona cualquier tecla para cerrar.
pause >nul
