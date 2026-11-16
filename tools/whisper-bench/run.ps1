# Creates an isolated Python environment on first use, then runs the Whisper benchmark.
#
#   powershell -ExecutionPolicy Bypass -File tools\whisper-bench\run.ps1
#   powershell -ExecutionPolicy Bypass -File tools\whisper-bench\run.ps1 --models base.en --devices GPU.1 CPU
#
# Downloads (models, packages) and results live in %LOCALAPPDATA%\Argonaut\whisper-bench.

# Failures are caught through exit codes rather than $ErrorActionPreference = 'Stop': in Windows
# PowerShell 5.1, a native tool's harmless warnings on stderr become error records when output is
# redirected, and 'Stop' would abort on them (python -m venv prints one on some machines).

$workDir = Join-Path $env:LOCALAPPDATA 'Argonaut\whisper-bench'
$venvDir = Join-Path $workDir 'venv'
$python = Join-Path $venvDir 'Scripts\python.exe'

if (-not (Test-Path $python)) {
    New-Item -ItemType Directory -Force $workDir -ErrorAction Stop | Out-Null
    # --clear also repairs an environment left half-built by an interrupted run.
    python -m venv --clear $venvDir
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $python)) {
        Write-Error "Creating the Python environment in $venvDir failed"
        exit 1
    }
}

& $python -m pip install --disable-pip-version-check --quiet -r (Join-Path $PSScriptRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) {
    Write-Error "Installing benchmark packages failed"
    exit 1
}

# -u: unbuffered, so progress shows up live even when output is redirected to a log.
& $python -u (Join-Path $PSScriptRoot 'bench.py') @args
exit $LASTEXITCODE
