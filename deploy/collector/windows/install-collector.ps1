<#
.SYNOPSIS
  Installateur manuel du collector Orbis (alternative au MSI).
  À exécuter en tant qu'administrateur.

.DESCRIPTION
  Copie l'exécutable pkg (orbis-collector.exe) + le template de config,
  crée le service Windows, et démarre le service.

  Pré-requis : avoir compilé l'exe au préalable :
    cd packages\collector
    pnpm run build
    pnpm run build:exe
    # → dist\orbis-collector.exe

.PARAMETER InstallDir
  Répertoire d'installation (défaut : C:\Program Files\OrbisCollector)

.PARAMETER ServiceName
  Nom du service Windows (défaut : OrbisCollector)

.EXAMPLE
  .\install-collector.ps1
#>
param(
  [string]$InstallDir = "C:\Program Files\OrbisCollector",
  [string]$ServiceName = "OrbisCollector"
)

$ErrorActionPreference = "Stop"

# ─── Checks ────────────────────────────────────────────────
$exe = ".\dist\orbis-collector.exe"
if (-not (Test-Path $exe)) {
  Write-Error "Exécutable introuvable : $exe`nCompilez d'abord : pnpm run build && pnpm run build:exe"
  exit 1
}

# ─── Directories ───────────────────────────────────────────
$configDir = Join-Path $env:ProgramData "OrbisCollector"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $configDir | Out-Null

# ─── Copy files ────────────────────────────────────────────
Write-Host "Copie des fichiers vers $InstallDir ..."
Copy-Item -Force $exe $InstallDir
Copy-Item -Force ".\collector.env.example" $InstallDir

# Copy the template to ProgramData if it does not exist (do not overwrite user configuration).
$activeEnv = Join-Path $configDir "collector.env"
if (-not (Test-Path $activeEnv)) {
  Copy-Item -Force ".\collector.env.example" $activeEnv
  Write-Host "Config créée : $activeEnv (éditez-la avant de démarrer)"
}

# ─── Service Windows ───────────────────────────────────────
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  Write-Host "Service existant détecté — suppression..."
  Stop-Service $ServiceName -ErrorAction SilentlyContinue
  sc.exe delete $ServiceName | Out-Null
  Start-Sleep -Seconds 2
}

$binPath = Join-Path $InstallDir "orbis-collector.exe"
Write-Host "Création du service $ServiceName ..."
New-Service `
  -Name $ServiceName `
  -DisplayName "Orbis Collector" `
  -Description "Network discovery collector for Orbis" `
  -BinaryPathName "`"$binPath`"" `
  -StartupType Automatic | Out-Null

# ─── Start after configuration ─────────────────────────────
Write-Host ""
Write-Host "Collector installé. Configurez d'abord : $activeEnv"
Write-Host "Then start it with: Start-Service $ServiceName"
