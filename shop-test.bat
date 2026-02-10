@echo off
REM Quick shop test wrapper for Windows

echo.
echo 🛒 CakraNode Auto Shop Quick Test
echo ==================================
echo.

if "%1"=="" (
    echo Usage: shop-test.bat [category] [item] [quantity] [--debug]
    echo.
    echo Examples:
    echo   shop-test.bat shard "skeleton spawner" 1
    echo   shop-test.bat blocks stone 64
    echo   shop-test.bat food "golden apple" 10 --debug
    echo.
    echo Running with defaults ^(shard, skeleton spawner, 1^)...
    node src/test-auto-shop.js
) else (
    echo Category: %1
    echo Item: %2
    echo Quantity: %3
    echo.
    node src/test-auto-shop.js %*
)
