$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repo 'backend/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'Backend virtual environment is missing.' }
& $python (Join-Path $repo 'backend/openrouter_preflight.py')
exit $LASTEXITCODE
