<#
.SYNOPSIS
Installs Argonaut on a Windows PC: checks what it needs, writes .env, builds and starts the
containers, builds Argonaut.exe and puts a shortcut on the desktop.

.DESCRIPTION
Argonaut runs as four Docker containers (database, API with the web app, spell checker,
speech recognition) and opens in its own window from Argonaut.exe. After this script, start
it from the desktop shortcut: the launcher starts Docker and the containers every time.

Safe to run again: an existing .env, database and shortcut are kept.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -WithStarterTasks
#>
param(
    # The key for the AI assistant (routellm.abacus.ai by default). Optional: without one,
    # everything but the assistant works, and "Configure assistant" in the app explains it.
    [string]$LlmApiKey,
    # Add three example tasks to the Missions tab of a new database.
    [switch]$WithStarterTasks,
    # Don't put a shortcut on the desktop.
    [switch]$NoShortcut
)

$ErrorActionPreference = 'Stop'
# Text piped to docker (the starter tasks) goes as UTF-8, not the console's code page.
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $root '.env'

function Step([string]$text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Ask([string]$question) { (Read-Host "$question [y/N]") -match '^(y|yes|s|sim)$' }

# --- 1. What it needs ----------------------------------------------------------------------
Step 'Checking what Argonaut needs'

if (-not [Environment]::Is64BitOperatingSystem) { throw 'Argonaut needs 64-bit Windows 10 or 11.' }

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw '.NET Framework 4.8 is missing (it ships with Windows 10 and 11). Install it, then run this again.' }
Write-Host '  .NET Framework 4.x: found'

# The WebView2 runtime draws Argonaut's window. It comes with Windows updates.
$webView2 = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
) | ForEach-Object { (Get-ItemProperty $_ -Name pv -ErrorAction SilentlyContinue).pv } | Where-Object { $_ -and $_ -ne '0.0.0.0' } | Select-Object -First 1
if (-not $webView2) {
    Write-Host '  WebView2 runtime: missing'
    if ((Get-Command winget -ErrorAction SilentlyContinue) -and (Ask '  Install the Microsoft Edge WebView2 Runtime with winget now?')) {
        winget install --exact --id Microsoft.EdgeWebView2Runtime --accept-package-agreements
    }
    else {
        throw 'Install the WebView2 Runtime from https://developer.microsoft.com/microsoft-edge/webview2/ and run this again.'
    }
}
else { Write-Host "  WebView2 runtime: $webView2" }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host '  Docker Desktop: missing'
    if ((Get-Command winget -ErrorAction SilentlyContinue) -and (Ask '  Install Docker Desktop with winget now? (it may ask you to restart Windows)')) {
        winget install --exact --id Docker.DockerDesktop --accept-package-agreements
        Write-Host ''
        Write-Host 'Docker Desktop is installed. Start it once (accept its terms), restart Windows if it asks, then run this script again.'
        exit 0
    }
    throw 'Install Docker Desktop from https://www.docker.com/products/docker-desktop/ (WSL 2 backend), then run this again.'
}
Write-Host '  Docker Desktop: found'

# Docker Desktop runs in WSL; an outdated WSL keeps it from starting.
& docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host '  Docker isn''t running: updating WSL and starting Docker Desktop (this can take a minute or two)'
    & wsl --update *> $null
    $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (Test-Path $desktop) { Start-Process $desktop }
    $deadline = (Get-Date).AddMinutes(4)
    do {
        Start-Sleep -Seconds 3
        & docker info *> $null
    } while ($LASTEXITCODE -ne 0 -and (Get-Date) -lt $deadline)
    if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop didn''t start. Open it, wait until it says it''s running, and run this again.' }
}
Write-Host '  Docker engine: running'

# --- 2. Settings ---------------------------------------------------------------------------
Step 'Settings (.env)'

$volume = & docker volume ls -q --filter name=argonaut-db-data
$newDatabase = -not ($volume | Where-Object { $_ -match 'argonaut-db-data$' })

if (Test-Path $envFile) {
    Write-Host "  Keeping the existing $envFile"
}
else {
    $lines = Get-Content (Join-Path $root '.env.example')
    if (-not $LlmApiKey) {
        $LlmApiKey = Read-Host '  AI assistant key (LLM_API_KEY), or Enter to skip for now'
    }
    $lines = $lines | ForEach-Object {
        if ($_ -match '^LLM_API_KEY=') { "LLM_API_KEY=$LlmApiKey" }
        elseif ($_ -match '^SETTINGS_FILE=') { "SETTINGS_FILE=$envFile" }
        else { $_ }
    }
    # The database password is only read when the database is first created, so a new install
    # gets a random one; an existing database keeps the one it was made with.
    if ($newDatabase) {
        $bytes = New-Object byte[] 24
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $password = ([Convert]::ToBase64String($bytes)) -replace '[+/=]', ''
        $lines += ''
        $lines += '# The database password, set when the database was first created. Keep it with the backups.'
        $lines += "POSTGRES_PASSWORD=$password"
    }
    [System.IO.File]::WriteAllLines($envFile, [string[]]$lines, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "  Wrote $envFile"
}

# --- 3. Containers -------------------------------------------------------------------------
Step 'Building and starting the containers (the first time takes several minutes: it compiles speech recognition and downloads its 148 MB model)'

& docker compose --project-directory $root up -d --build
if ($LASTEXITCODE -ne 0) { throw 'docker compose couldn''t start the containers; see the messages above.' }

Write-Host '  Waiting for Argonaut to answer'
$deadline = (Get-Date).AddMinutes(3)
$healthy = $false
while (-not $healthy -and (Get-Date) -lt $deadline) {
    try {
        $healthy = (Invoke-RestMethod -UseBasicParsing 'http://localhost:8787/api/health' -TimeoutSec 5).ok -eq $true
    }
    catch { Start-Sleep -Seconds 2 }
}
if (-not $healthy) { throw 'The API didn''t answer on http://localhost:8787. Check: docker compose logs argonaut-api' }
Write-Host '  Argonaut answers on http://localhost:8787'

if ($WithStarterTasks) {
    Get-Content -Raw (Join-Path $root 'server\seeds\starter-tasks.sql') |
        & docker exec -i argonaut-db psql -U argonaut -d argonaut -v ON_ERROR_STOP=1 -q
    if ($LASTEXITCODE -ne 0) { throw 'Adding the starter tasks failed.' }
    Write-Host '  Added the starter tasks'
}

# --- 4. The app window ---------------------------------------------------------------------
Step 'Building Argonaut.exe'

& (Join-Path $root 'launcher\build.ps1')
$exe = Join-Path $root 'Argonaut.exe'

if (-not $NoShortcut) {
    $shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Argonaut.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $exe
    $shortcut.WorkingDirectory = $root
    $shortcut.IconLocation = "$exe,0"
    $shortcut.Description = 'Argonaut'
    $shortcut.Save()
    Write-Host "  Shortcut: $shortcutPath"
}

Step 'Done'
Write-Host "Start Argonaut from the desktop shortcut, or run $exe."
Write-Host 'It starts Docker and the containers itself each time, and opens its window when they answer.'
