@echo off
chcp 65001 >nul
title نظام المواعيد - خادم الشبكة الداخلية
cd /d "%~dp0\.."
echo ============================================
echo   تشغيل نظام المواعيد (خادم الشبكة الداخلية)
echo ============================================
if exist "server\service-account.json" (echo المزامنة مع Firebase: مفعّلة) else (echo المزامنة مع Firebase: غير مفعّلة)
echo.
node server\server.js
echo.
echo توقف الخادم. اضغط أي زر للإغلاق.
pause >nul
