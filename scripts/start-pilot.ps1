[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9]+[a-z0-9.-]*[a-z0-9]$')]
    [string]$PilotHost,
    [switch]$TextOnly
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$python = Join-Path $repo 'backend/.venv/Scripts/python.exe'
$entry = Join-Path $repo 'backend/pilot_server.py'
$runtimeDir = Join-Path $repo 'backend/data/pilot'
$stateFile = Join-Path $runtimeDir 'process.json'
if (-not (Test-Path -LiteralPath $python)) { throw 'Install backend requirements in backend/.venv first.' }
if (Test-Path -LiteralPath $stateFile) { throw 'Pilot process state exists. Run scripts/stop-pilot.ps1 before starting again.' }
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 8788)
try { $listener.Start() } finally { $listener.Stop() }
Push-Location $repo
$saved = @{}
$overrides = @{ MEDSIM_PILOT_MODE = '1'; MEDSIM_PILOT_ORIGIN = "https://$PilotHost" }
if ($TextOnly) {
    $overrides['PATIENT_TTS_PROVIDER'] = 'disabled'
    $overrides['PATIENT_TTS_FALLBACK'] = 'disabled'
    $overrides['PATIENT_TTS_ENABLED'] = 'false'
}
$pilotProcess = $null
try {
    foreach ($key in $overrides.Keys) {
        $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key, $overrides[$key], 'Process')
    }
    # Validate before database access, build, or launching a process.
    & $python -c "import sys; sys.path.insert(0, 'backend'); from medsim_backend.config import load_runtime_settings; load_runtime_settings()"
    if ($LASTEXITCODE -ne 0) { throw 'Invalid pilot hostname.' }
    & node node_modules/typescript/bin/tsc -b
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript check failed.' }
    & node node_modules/vite/bin/vite.js build
    if ($LASTEXITCODE -ne 0) { throw 'Production build failed.' }
    & node scripts/verify/frontend-answer-leakage.ts
    if ($LASTEXITCODE -ne 0) { throw 'Production frontend leakage check failed.' }
    & $python backend/pilot_backup.py
    if ($LASTEXITCODE -ne 0) { throw 'SQLite backup failed; pilot was not started.' }
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    $pilotProcess = Start-Process -FilePath $python -ArgumentList @(('"' + $entry + '"')) -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'stdout.log') -RedirectStandardError (Join-Path $runtimeDir 'stderr.log')
    @{ pid = $pilotProcess.Id; startedUtcTicks = $pilotProcess.StartTime.ToUniversalTime().Ticks; entry = $entry } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
    $deadline = (Get-Date).AddSeconds(30)
    $ready = $false
    do {
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:8788/health' -TimeoutSec 2
            $ready = $health.ok -eq $true -and $health.pilot -eq $true
        } catch { $ready = $false }
        if (-not $ready) { Start-Sleep -Milliseconds 250 }
        $pilotProcess.Refresh()
    } while (-not $ready -and -not $pilotProcess.HasExited -and (Get-Date) -lt $deadline)
    if (-not $ready) { throw 'Pilot did not start. Inspect backend/data/pilot/stderr.log.' }
    Write-Host 'Pilot ready on 127.0.0.1:8788 (production build). No public tunnel has been started.'
    Write-Host "Allowed public origin: https://$PilotHost"
    Write-Host 'Local browser check: http://localhost:8788. Use the HTTPS tunnel URL for student sessions.'
    Write-Host 'Stop: powershell -NoProfile -File .\scripts\stop-pilot.ps1'
} catch {
    if ($pilotProcess -and (Test-Path -LiteralPath $stateFile)) { & (Join-Path $PSScriptRoot 'stop-pilot.ps1') }
    throw
} finally {
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') }
    Pop-Location
}
