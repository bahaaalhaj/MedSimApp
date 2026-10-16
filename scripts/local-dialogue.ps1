param(
  [ValidateSet('Setup','StartModel','StartBackend','StartFrontend','Validate','Stop','StopBackend','Status')]
  [string]$Action = 'Status',
  [ValidateSet('4b','1.7b')][string]$Model = '4b',
  [ValidateSet(2048,4096)][int]$ContextSize = 2048,
  [ValidateRange(1,30)][int]$InterpretationTimeoutSeconds = 12,
  [switch]$Offline
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$python = Join-Path $repo 'backend/.venv/Scripts/python.exe'
$root = Join-Path $env:LOCALAPPDATA 'MedSim/local-dialogue'
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'local-dialogue-artifacts.json') -Raw | ConvertFrom-Json
$selected = $manifest.models.$Model
$modelPath = Join-Path $root ('models/' + $selected.filename)
$runtimeDir = Join-Path $root 'llama-b6500-cuda12.4'
$logDir = Join-Path $root 'logs'
$processDir = Join-Path $root 'processes'

function Assert-Artifact($Path, $Artifact) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing artifact: $($Artifact.filename). Run Setup with network access." }
  if ((Get-Item -LiteralPath $Path).Length -ne $Artifact.bytes -or
      (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower() -ne $Artifact.sha256) {
    throw "Incomplete or unverified artifact: $($Artifact.filename). No file was deleted."
  }
}

function Get-Memory {
  $os = Get-CimInstance Win32_OperatingSystem
  return [long]$os.FreePhysicalMemory * 1024
}

function Assert-Memory {
  $available = Get-Memory
  if ($available -lt 2500000000) { throw "unsafe-low-memory: $available bytes available; existing 2500000000-byte floor retained. Close nonessential apps and retry. Audio will not be disabled." }
  if ($ContextSize -eq 4096 -and $available -lt 3200000000) { throw '4096 context requires at least 3200000000 available RAM bytes before testing; begin at 2048.' }
}

function Assert-PortFree([int]$Port) {
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $Port is occupied. No existing process was stopped or adopted."
  }
}

function Download-Artifact($Artifact, $Target) {
  if (Test-Path -LiteralPath $Target) {
    if ((Get-Item -LiteralPath $Target).Length -eq $Artifact.bytes) { Assert-Artifact $Target $Artifact; return }
  }
  if ($Offline) { throw 'Setup downloads are forbidden with -Offline.' }
  # Preserve partial downloads for explicit resumption. Bound each invocation;
  # checksum and size must pass before extraction or loading.
  & curl.exe -L --fail --retry 1 --connect-timeout 15 --max-time 120 --continue-at - --silent --show-error --output $Target $Artifact.url
  if ($LASTEXITCODE -ne 0) { throw "Download incomplete: $($Artifact.filename). Partial file retained; rerun Setup to resume." }
  Assert-Artifact $Target $Artifact
}

function Save-Process($Process, [string]$Name, [string]$Marker) {
  $instance = Get-CimInstance Win32_Process -Filter "ProcessId=$($Process.Id)"
  if (-not $instance) { throw "$Name exited before ownership could be recorded. Inspect logs." }
  @{ pid=$Process.Id; created=$instance.CreationDate.ToUniversalTime().ToString('o');
     executable=$instance.ExecutablePath; marker=$Marker; repo=$repo } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $processDir "$Name.json") -Encoding UTF8
}

function Stop-Owned([string]$Name) {
  $recordPath = Join-Path $processDir "$Name.json"
  if (-not (Test-Path -LiteralPath $recordPath)) { return }
  $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
  $instance = Get-CimInstance Win32_Process -Filter "ProcessId=$($record.pid)" -ErrorAction SilentlyContinue
  if (-not $instance) { Write-Host "$Name is no longer running."; return }
  if ($record.repo -ne $repo -or $instance.ExecutablePath -ne $record.executable -or
      $instance.CreationDate.ToUniversalTime().ToString('o') -ne $record.created -or
      -not $instance.CommandLine -or -not $instance.CommandLine.Contains($record.marker)) {
    throw "Ownership mismatch for $Name; PID $($record.pid) was not stopped."
  }
  # Windows venv python can be a launcher plus a child. Check both ancestry and
  # command marker; never kill all Python/Node processes or a broad process tree.
  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($record.pid)")
  foreach ($child in $children) {
    if ($child.CommandLine -and $child.CommandLine.Contains($record.marker)) {
      Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
    }
  }
  Stop-Process -Id $record.pid -ErrorAction SilentlyContinue
  Write-Host "Stopped script-owned $Name PID $($record.pid)."
}

function Wait-Local($Process, [string]$Url, [int]$Seconds, [string]$Name) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    $Process.Refresh()
    if ($Process.HasExited) { throw "$Name exited; inspect $logDir." }
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { return }
    } catch { }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  Stop-Owned $Name
  throw "$Name did not become ready within $Seconds seconds. Only its owned process was stopped."
}

if ($Action -eq 'Status') {
  @{ runtimeRoot=$root; model=$selected.alias; contextSize=$ContextSize;
     availableRamBytes=(Get-Memory); minimumAvailableRamBytes=2500000000;
     modelPresent=(Test-Path -LiteralPath $modelPath);
     modelCompleteBySize=((Test-Path -LiteralPath $modelPath) -and (Get-Item -LiteralPath $modelPath).Length -eq $selected.bytes);
     runtimePresent=(Test-Path -LiteralPath (Join-Path $runtimeDir 'llama-server.exe'));
     weightsLoaded=$false } | ConvertTo-Json
  return
}
if ($Action -eq 'StopBackend') { Stop-Owned 'backend'; return }
if ($Action -eq 'Stop') {
  foreach ($name in @('frontend','backend','model')) { Stop-Owned $name }
  return
}
New-Item -ItemType Directory -Force -Path $root,$logDir,$processDir,(Join-Path $root 'models'),(Join-Path $root 'downloads'),$runtimeDir | Out-Null
if ($Action -eq 'Setup') {
  Download-Artifact $selected $modelPath
  foreach ($archive in $manifest.runtime.archives) {
    $archivePath = Join-Path $root ('downloads/' + $archive.filename)
    Download-Artifact $archive $archivePath
    Expand-Archive -LiteralPath $archivePath -DestinationPath $runtimeDir -Force
  }
  Write-Host 'Pinned model and CUDA runtime verified. Setup did not load weights or change drivers.'
  return
}

if ($Action -eq 'StartModel') {
  Assert-Memory
  Assert-Artifact $modelPath $selected
  foreach ($archive in $manifest.runtime.archives) { Assert-Artifact (Join-Path $root ('downloads/' + $archive.filename)) $archive }
  $driver = (& nvidia-smi --query-gpu=driver_version --format=csv,noheader | Select-Object -First 1).Trim()
  if ($LASTEXITCODE -ne 0 -or [version]$driver -lt [version]$manifest.runtime.minimumWindowsDriver) {
    throw 'The pinned CUDA 12.4 build requires NVIDIA Windows driver 551.78 or newer. No driver was changed.'
  }
  Assert-PortFree 8080
  $server = Join-Path $runtimeDir 'llama-server.exe'
  $started = Get-Date
  $modelArgs = @('--model',('"'+$modelPath+'"'),'--alias',$selected.alias,'--host','127.0.0.1','--port','8080',
    '--ctx-size',"$ContextSize",'--parallel','1','--gpu-layers','99','--batch-size','128','--ubatch-size','64',
    '--threads','4','--threads-batch','6','--device','CUDA0','--flash-attn','--no-webui')
  $process = Start-Process -FilePath $server -ArgumentList $modelArgs -WorkingDirectory $runtimeDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'model.stdout.log') -RedirectStandardError (Join-Path $logDir 'model.stderr.log')
  Save-Process $process 'model' $modelPath
  Wait-Local $process 'http://127.0.0.1:8080/health' 120 'model'
  $diagnostics = Get-Content -LiteralPath (Join-Path $logDir 'model.stderr.log') -Raw
  if ($diagnostics -notmatch 'ggml_cuda_init' -or $diagnostics -notmatch 'offloaded [1-9][0-9]*/[0-9]+ layers to GPU') {
    Stop-Owned 'model'
    throw 'No positive CUDA layer-offload evidence in startup diagnostics; no CPU-only success was claimed.'
  }
  @{ model=$selected.alias; loadSeconds=((Get-Date)-$started).TotalSeconds; contextSize=$ContextSize;
     availableRamBytes=(Get-Memory); cudaOffloadVerified=$true } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logDir 'model-start.json') -Encoding UTF8
  Write-Host "Model ready with verified GPU offloading. Logs: $logDir. This is not dialogue validation."
  return
}

if ($Action -in @('StartBackend','Validate')) {
  Assert-Memory
  Assert-Artifact $modelPath $selected
  Assert-PortFree 8787
  $served = Invoke-RestMethod 'http://127.0.0.1:8080/v1/models' -TimeoutSec 3
  if ($selected.alias -notin @($served.data.id)) { throw 'The selected model alias is not served. StartModel first.' }
  $measured = Get-Content -LiteralPath (Join-Path $logDir 'model-start.json') -Raw | ConvertFrom-Json
  if (-not $measured.cudaOffloadVerified -or $measured.model -ne $selected.alias -or $measured.contextSize -ne $ContextSize) {
    throw 'Missing matching GPU-offload/context startup evidence. Run StartModel with these settings first.'
  }
  # Set only the child launch environment, then restore this shell exactly.
  $overrides = @{
    MEDSIM_LLM_PROVIDER='llama_cpp'; MEDSIM_LOCAL_LLM_ENABLED='true'; MEDSIM_LLM_BASE_URL='http://127.0.0.1:8080/v1';
    MEDSIM_LLM_PATIENT_MODEL=$selected.alias; MEDSIM_LLM_MODEL_PATH=$modelPath; MEDSIM_LLM_CONTEXT_SIZE="$ContextSize";
    MEDSIM_LLM_MAX_CONCURRENCY='1'; MEDSIM_LLM_THINKING='false'; MEDSIM_LLM_GPU_OFFLOAD='99';
    MEDSIM_SEMANTIC_DIALOGUE_ENABLED='true'; MEDSIM_LOCAL_INTERPRETATION_TIMEOUT_SECONDS="$InterpretationTimeoutSeconds"
  }
  if ($Offline) { $overrides.HF_HUB_OFFLINE='1'; $overrides.TRANSFORMERS_OFFLINE='1'; $overrides.HF_HUB_DISABLE_TELEMETRY='1' }
  $saved = @{}
  try {
    foreach ($key in $overrides.Keys) { $saved[$key]=[Environment]::GetEnvironmentVariable($key,'Process'); [Environment]::SetEnvironmentVariable($key,$overrides[$key],'Process') }
    if ($Action -eq 'Validate') {
      $probeArgs = @((Join-Path $repo 'backend/semantic_dialogue_smoke.py'),'--live','--in-process','--provider','llama_cpp','--suite','full','--audio','--output',(Join-Path $logDir ('probes-'+$Model+'.json')))
      if ($Offline) { $probeArgs += '--offline' }
      & $python @probeArgs
      if ($LASTEXITCODE -ne 0) { throw "Real-model validation exited $LASTEXITCODE; inspect the private report. This is not a unit-test result." }
      return
    }
    $entry = Join-Path $repo 'backend/local_dialogue_entry.py'
    $process = Start-Process -FilePath $python -ArgumentList ('"'+$entry+'"') -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'backend.stdout.log') -RedirectStandardError (Join-Path $logDir 'backend.stderr.log')
  } finally { foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key,$saved[$key],'Process') } }
  Save-Process $process 'backend' $entry
  Wait-Local $process 'http://127.0.0.1:8787/health' 30 'backend'
  Write-Host 'Backend started with local-only dialogue; existing credentials and TTS configuration preserved.'
  return
}

Assert-PortFree 5173
$vite = Join-Path $repo 'node_modules/vite/bin/vite.js'
$process = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @(('"'+$vite+'"'),'--host','127.0.0.1','--port','5173','--strictPort') -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'frontend.stdout.log') -RedirectStandardError (Join-Path $logDir 'frontend.stderr.log')
Save-Process $process 'frontend' $vite
Wait-Local $process 'http://127.0.0.1:5173/' 30 'frontend'
Write-Host 'Frontend: http://127.0.0.1:5173/'
