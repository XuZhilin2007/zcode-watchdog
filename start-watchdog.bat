@echo off
title ZCode 额度看门狗
:loop
node "%~dp0watchdog.mjs"
echo 看门狗异常退出，30 秒后自动重启...
timeout /t 30 /nobreak >nul
goto loop
