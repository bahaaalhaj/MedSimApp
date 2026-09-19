$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$python = Join-Path $repo 'backend/.venv/Scripts/python.exe'
Write-Host 'Preflight:'
& $python (Join-Path $repo 'backend/local_ai_preflight.py')
Write-Host 'llama-server:'
try { Invoke-RestMethod 'http://127.0.0.1:8080/health' -TimeoutSec 5 | ConvertTo-Json -Depth 5 } catch { Write-Host 'unavailable' }
Write-Host 'MedSim backend:'
try { Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 15 | ConvertTo-Json -Depth 8 } catch { Write-Host 'unavailable' }
