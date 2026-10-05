@echo off
setlocal

rem ---------------------------------------------------------------------
rem Lanceur Aven.Native (WinUI 3) : build, recherche du binaire,
rem lancement sans passer par le portable portable-x64.
rem ---------------------------------------------------------------------

set "REPO_ROOT=%~dp0"
if not exist "%REPO_ROOT%native" (
    for /d %%D in ("%REPO_ROOT%*") do if exist "%%D\native" set "REPO_ROOT=%%D"
)

set "NATIVE_PROJECT=%REPO_ROOT%native\src\Aven.Native\Aven.Native.csproj"

if not exist "%NATIVE_PROJECT%" (
    echo [E] Projet Windows introuvable : %NATIVE_PROJECT%
    echo [E] Ce script doit etre lance a la racine du projet Aven.
    pause
    exit /b 1
)

set "DOTNET_ROOT=%REPO_ROOT%tools\dotnet-sdk"
set "DOTNET_EXE=%DOTNET_ROOT%\dotnet.exe"
set "DOTNET_CANDIDATES="
for %%D in (
    "%DOTNET_ROOT%"
    "C:\Program Files\dotnet"
    "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn"
    "C:\Program Files (x86)\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\Roslyn"
    "C:\Program Files (x86)\Microsoft Visual Studio\2022\Professional\MSBuild\Current\Bin\Roslyn"
    "C:\Program Files (x86)\Microsoft Visual Studio\2022\Enterprise\MSBuild\Current\Bin\Roslyn"
    "C:\Program Files\dotnet\sdk"
) do (
    if exist "%%~D\dotnet.exe" set "DOTNET_EXE=%%~D\dotnet.exe" && call set "DOTNET_CANDIDATES=%%DOTNET_CANDIDATES%%;%%~D"
)

if not exist "%DOTNET_EXE%" (
    echo [E] SDK dotnet introuvable.
    echo [E] Recherches effectuees : %DOTNET_CANDIDATES%
    echo [E] Installe le .NET 8 SDK (Windows x64) et/ou ajuste DOTNET_ROOT dans ce script.
    pause
    exit /b 1
)

set "PATH=%DOTNET_ROOT%;%PATH%"
setlocal enabledelayedexpansion

echo [I] SDK dotnet : !DOTNET_EXE!
echo [I] Projet : %NATIVE_PROJECT%

echo.
echo [I] Build (Release x64)...
echo.

"%DOTNET_EXE%" build "%NATIVE_PROJECT%" -c Release -p:Platform=x64
if %errorlevel% neq 0 (
    echo.
    echo [E] Build echoue (code %errorlevel%). L'application ne sera pas lancee.
    pause
    exit /b %errorlevel%
)

echo.
echo [I] Build termine.

rem Cherche le binaire publie
set "PUBLISH_DIR="
for /d %%D in ("%REPO_ROOT%native\src\Aven.Native\bin\Release\net8.0-windows10.0.19041.0\win-x64\publish\*") do set "PUBLISH_DIR=%%D"
if not exist "%PUBLISH_DIR%%~nxPUBLISH_DIR%" (
    for /d %%D in ("%REPO_ROOT%native\src\Aven.Native\bin\Release\win-x64\publish\*") do set "PUBLISH_DIR=%%D"
)
if not exist "%PUBLISH_DIR%%~nxPUBLISH_DIR%" (
    for /d %%D in ("%REPO_ROOT%native\src\Aven.Native\bin\Release\*\publish\*") do set "PUBLISH_DIR=%%D"
)

set "BIN_EXE=%PUBLISH_DIR%Aven.Native.exe"
if exist "%BIN_EXE%" (
    echo [I] Binaire trouve : %BIN_EXE%
    start "" "%BIN_EXE%"
    exit /b 0
)

echo.
echo [W] Binaire de release non trouve dans le dossier attendu.
echo [W] Le build a reussi, mais le dossier de publication est absent ou vide.
echo [W] C'est normal si tu as lance uniquement `dotnet build`, sans `dotnet publish`.
echo [W] Option 1 : relance avec publish:
echo      dotnet publish %NATIVE_PROJECT% -c Release -p:Platform=x64 -o "%REPO_ROOT%native\src\Aven.Native\bin\Release\net8.0-windows10.0.19041.0\win-x64\publish"
echo.
echo [W] Option 2 : lance directement l'assembly via dotnet run (developpement) :
echo      dotnet run -p %NATIVE_PROJECT% -c Release -p:Platform=x64
exit /b 1

endlocal
