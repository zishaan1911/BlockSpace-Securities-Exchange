$ErrorActionPreference = "Continue"

$repo = Split-Path $PSScriptRoot -Parent
$wslRepo = "/mnt/" + (($repo -replace ":", "" -replace "\\", "/")).ToLower()

Write-Host ""
Write-Host "=== GASX teardown ===" -ForegroundColor Cyan
Write-Host "Uninstalls PostgreSQL, Node.js, pnpm, uv, Sui CLI and removes project artifacts."
Write-Host "The WSL distro itself is left intact."
Write-Host ""

wsl -d Ubuntu bash "$wslRepo/scripts/teardown.sh" "$wslRepo"

Write-Host ""
Write-Host "Teardown complete. Re-run scripts/setup.ps1 to rebuild the environment." -ForegroundColor Green
