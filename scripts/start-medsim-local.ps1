$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$env:MEDSIM_LLM_PROVIDER = 'llama_cpp'
$env:MEDSIM_LOCAL_LLM_ENABLED = 'true'
& (Join-Path $PSScriptRoot 'start-local-ai.ps1') -Model auto -Wait
$selectedPreflight = & (Join-Path $repo 'backend/.venv/Scripts/python.exe') (Join-Path $repo 'backend/local_ai_preflight.py') | ConvertFrom-Json
$env:MEDSIM_LLM_MODEL_PATH = Join-Path $repo $selectedPreflight.selected_model_path
$processDir = Join-Path $repo 'backend/data/local-ai-processes'
New-Item -ItemType Directory -Force -Path $processDir | Out-Null
$backend = Start-Process -FilePath (Join-Path $repo 'backend/.venv/Scripts/python.exe') -ArgumentList @((Join-Path $repo 'backend/server.py')) -WorkingDirectory $repo -WindowStyle Hidden -PassThru
$backend.Id | Set-Content -LiteralPath (Join-Path $processDir 'backend.pid') -Encoding ascii
$backendDeadline = (Get-Date).AddSeconds(30)
do {
  try { $backendReady = (Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 2).ok -eq $true } catch { $backendReady = $false }
  if (-not $backendReady) { Start-Sleep -Milliseconds 500 }
} while (-not $backendReady -and (Get-Date) -lt $backendDeadline -and -not $backend.HasExited)
if (-not $backendReady) { throw 'FastAPI did not become ready within 30 seconds.' }
$frontend = Start-Process -FilePath 'node.exe' -ArgumentList @((Join-Path $repo 'node_modules/vite/bin/vite.js'),'--host','127.0.0.1') -WorkingDirectory $repo -WindowStyle Hidden -PassThru
$frontend.Id | Set-Content -LiteralPath (Join-Path $processDir 'frontend.pid') -Encoding ascii
$frontendDeadline = (Get-Date).AddSeconds(30)
do {
  try { $frontendReady = (Invoke-WebRequest 'http://127.0.0.1:5173' -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200 } catch { $frontendReady = $false }
  if (-not $frontendReady) { Start-Sleep -Milliseconds 500 }
} while (-not $frontendReady -and (Get-Date) -lt $frontendDeadline -and -not $frontend.HasExited)
if (-not $frontendReady) { throw 'Vite did not become ready within 30 seconds.' }
Write-Host "MedSim ready: backend PID $($backend.Id), frontend PID $($frontend.Id)."
Write-Host 'Open http://127.0.0.1:5173. Health: http://127.0.0.1:8787/health.'
