param([ValidateSet('auto','4b','1.7b')] [string]$Model='auto', [switch]$Wait)
$ErrorActionPreference = 'Stop'
$provider = $env:MEDSIM_LLM_PROVIDER
$enabled = $env:MEDSIM_LOCAL_LLM_ENABLED
if ($provider -ne 'llama_cpp' -or $enabled -ne 'true') {
  throw 'Offline inference requires MEDSIM_LLM_PROVIDER=llama_cpp and MEDSIM_LOCAL_LLM_ENABLED=true.'
}
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$existingReady = $false
try { $existingReady = (Invoke-RestMethod 'http://127.0.0.1:8080/health' -TimeoutSec 2).status -eq 'ok' } catch { }
if ($existingReady) {
  Write-Host 'llama-server is already ready on 127.0.0.1:8080.'
  return
}
$python = Join-Path $repo 'backend/.venv/Scripts/python.exe'
$preflight = & $python (Join-Path $repo 'backend/local_ai_preflight.py') | ConvertFrom-Json
if (-not $preflight.ready) { throw "Local-AI preflight failed: $($preflight.safety_status)" }
$primary = Join-Path $repo 'backend/data/llm-models/Qwen3-4B-Q4_K_M.gguf'
$fallback = Join-Path $repo 'backend/data/llm-models/Qwen3-1.7B-Q8_0.gguf'
$selected = if ($Model -eq '4b') { $primary } elseif ($Model -eq '1.7b') { $fallback } elseif ($preflight.selected_model -like '*1.7B*') { $fallback } else { $primary }
$alias = 'qwen3-local'
$server = Get-ChildItem -LiteralPath (Join-Path $repo 'backend/tools/llama.cpp') -Filter 'llama-server.exe' -Recurse | Select-Object -First 1
if (-not $server) { throw 'llama-server.exe is missing. Run scripts/setup-local-ai.ps1.' }
$logDir = Join-Path $repo 'backend/data/local-ai-logs'
$processDir = Join-Path $repo 'backend/data/local-ai-processes'
New-Item -ItemType Directory -Force -Path $logDir,$processDir | Out-Null
$deviceLine = (& $server.FullName --list-devices 2>&1 | Select-String -Pattern '^\s*Vulkan\d+:.*NVIDIA' | Select-Object -First 1).Line
$device = if ($deviceLine) { ($deviceLine -split ':', 2)[0].Trim() } else { $null }
$args = @(
  '--model',$selected,'--alias',$alias,'--host','127.0.0.1','--port','8080',
  '--ctx-size','4096','--parallel','1',
  '--fit','on','--fit-target','1024','--batch-size','128','--ubatch-size','64',
  '--threads','4','--threads-batch','6','--cache-type-k','q8_0','--cache-type-v','q8_0',
  '--flash-attn','auto','--reasoning','off','--no-reasoning-preserve','--no-webui','--no-slots'
)
if ($device) { $args += @('--device',$device,'--gpu-layers','all') } else { $args += @('--device','none','--gpu-layers','0') }
$process = Start-Process -FilePath $server.FullName -ArgumentList $args -WorkingDirectory $server.DirectoryName -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'server.out.log') -RedirectStandardError (Join-Path $logDir 'server.err.log') -PassThru
$process.Id | Set-Content -LiteralPath (Join-Path $processDir 'llm.pid') -Encoding ascii
Write-Host "Started local model $alias (PID $($process.Id))."
if ($Wait) {
  $deadline = (Get-Date).AddSeconds(120)
  do {
    try { $health = Invoke-RestMethod 'http://127.0.0.1:8080/health' -TimeoutSec 2; if ($health.status -eq 'ok') { Write-Host 'llama-server ready.'; return } } catch { }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline -and -not $process.HasExited)
  if (-not $process.HasExited) { Stop-Process -Id $process.Id }
  if ($selected -eq $primary -and (Test-Path -LiteralPath $fallback)) {
    Write-Warning '4B did not become ready; starting the official 1.7B fallback.'
    & $PSCommandPath -Model '1.7b' -Wait
    return
  }
  throw 'llama-server did not become ready within 120 seconds. See backend/data/local-ai-logs.'
}
