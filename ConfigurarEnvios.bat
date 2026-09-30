@echo off
title Configurando Template Generator
color 0A
echo ===================================================
echo Registrando protocolos para abrir Outlook...
echo ===================================================

:: Esto obtiene la ruta exacta en donde este archivo .bat esta siendo ejecutado
set "SCRIPT_DIR=%~dp0"
set "PS_TARGET=%SCRIPT_DIR%SendToOutlook.ps1"

:: Ejecutamos comandos nativos de registro para evitar errores de comillas
reg add "HKCU\Software\Classes\templategen" /ve /t REG_SZ /d "URL:TemplateGenerator Protocol" /f >nul
reg add "HKCU\Software\Classes\templategen" /v "URL Protocol" /t REG_SZ /d "" /f >nul
reg add "HKCU\Software\Classes\templategen\shell\open\command" /ve /t REG_SZ /d "powershell.exe -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File \"%PS_TARGET%\" \"%%1\"" /f >nul

echo.
echo ===================================================
echo Configuracion FINALIZADA con exito.
echo.
echo Ya puedes abrir el generador .html libremente desde
echo cualquier parte (siempre y cuando esta carpeta la 
echo mantengas en un mismo lugar y no borres los archivos).
echo ===================================================
pause
