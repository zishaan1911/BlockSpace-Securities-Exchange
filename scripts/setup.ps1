$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== GASX dev environment setup (Windows 10/11 + WSL + VS Code) ===" -ForegroundColor Cyan
Write-Host "Prerequisites (assumed already installed): WSL with an Ubuntu distro, and VS Code."
Write-Host ""

$distros = @()
try {
    $distros = @(wsl -l -q 2>$null | Where-Object { $_.Trim() -ne "" } | ForEach-Object { $_.Trim() })
} catch {
    $distros = @()
}

if (-not ($distros -contains "Ubuntu")) {
    Write-Host "ERROR: no Ubuntu WSL distro found." -ForegroundColor Red
    Write-Host "Install it first:  wsl --install -d Ubuntu   (reboot if prompted)"
    Write-Host "Then re-run this script."
    exit 1
}

$repo = Split-Path $PSScriptRoot -Parent
$wslRepo = "/mnt/" + (($repo -replace ":", "" -replace "\\", "/")).ToLower()

Write-Host "Running the tool installer inside WSL Ubuntu ..." -ForegroundColor Yellow
wsl -d Ubuntu bash "$wslRepo/scripts/setup.sh"

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host "Next steps (see setup.md):"
Write-Host "  1. In VS Code, install the WSL extension:  code --install-extension ms-vscode-remote.remote-wsl"
Write-Host "  2. Open the repo in VS Code from WSL:   wsl -d Ubuntu  ->  cd repo  ->  code ."
Write-Host "  3. Start the database (after each WSL boot):   sudo service postgresql start"
Write-Host "  4. Configure Sui testnet:                sui client envs (see setup.md)"
Write-Host "  5. Install browser wallets on Windows (Sui Wallet + a throwaway Base wallet)"
