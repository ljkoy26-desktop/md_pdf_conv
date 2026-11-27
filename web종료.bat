@echo off
rem Stops the md2pdf web viewer started by the .vbs launcher
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'src[\\/]server\.js' }; if ($p) { $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Write-Host 'md2pdf web viewer stopped.' } else { Write-Host 'md2pdf web viewer is not running.' }"
timeout /t 2 /nobreak >nul
