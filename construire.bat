@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js est introuvable. Installe-le depuis https://nodejs.org puis relance. & pause & exit /b 1)
echo Verification des dependances (rapide si rien n'a change)...
call npm install
if errorlevel 1 (echo Echec de npm install. & pause & exit /b 1)
call npm run package:win
if errorlevel 1 pause
