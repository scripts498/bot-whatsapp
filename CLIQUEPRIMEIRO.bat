@echo off
echo ============================================
echo         ISAAC BOT - INICIANDO...
echo ============================================
echo.
set /p RESPOSTA="Quer refazer o QR code? (s/n): "

if /i "%RESPOSTA%"=="s" (
    echo Apagando sessao antiga...
    if exist auth_info rmdir /s /q auth_info
)

node index.js
pause