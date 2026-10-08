@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js est introuvable. Installe-le depuis https://nodejs.org puis relance. & pause & exit /b 1)
echo Verification des dependances (rapide si rien n'a change)...
call npm install
if errorlevel 1 (echo Echec de npm install. & pause & exit /b 1)
rem v10.0.0 : plus d'Electron — "npm run dev" compile le host puis lance Tauri.
call npm run dev
if errorlevel 1 pause
