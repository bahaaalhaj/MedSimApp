[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$entry = Join-Path $repo 'backend/pilot_server.py'
$stateFile = Join-Path $repo 'backend/data/pilot/process.json'
if (-not (Test-Path -LiteralPath $stateFile)) { Write-Host 'No managed pilot process.'; return }
$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
$ownedProcess = Get-Process -Id ([int]$state.pid) -ErrorAction SilentlyContinue
if ($ownedProcess) {
    $details = Get-CimInstance Win32_Process -Filter "ProcessId=$($ownedProcess.Id)"
    if ($state.entry -ne $entry -or $ownedProcess.StartTime.ToUniversalTime().Ticks -ne [long]$state.startedUtcTicks -or
        -not $details.CommandLine -or $details.CommandLine.IndexOf($entry, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw 'PID identity does not match this pilot. No process was stopped; inspect the state file.'
    }
    # Windows venv python.exe is a redirector with a real interpreter child.
    # Validate the entire owned tree before stopping children then the launcher.
    $tree = [Collections.Generic.List[object]]::new()
    $tree.Add($details)
    for ($index = 0; $index -lt $tree.Count; $index++) {
        $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($tree[$index].ProcessId)")
        foreach ($child in $children) {
            # Windows closes the hidden console host when its interpreters exit.
            if ($child.Name -eq 'conhost.exe') { continue }
            if (-not $child.CommandLine -or $child.CommandLine.IndexOf($entry, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
                throw 'Unexpected child process; pilot state retained for inspection.'
            }
            $tree.Add($child)
        }
    }
    for ($index = $tree.Count - 1; $index -ge 0; $index--) {
        $member = $tree[$index]
        $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($member.ProcessId)"
        if (-not $current) { continue }
        if ($current.CreationDate -ne $member.CreationDate -or $current.CommandLine -ne $member.CommandLine) {
            throw 'Process identity changed during shutdown; state retained.'
        }
        $targetProcess = Get-Process -Id $member.ProcessId -ErrorAction SilentlyContinue
        if ($targetProcess) {
            Stop-Process -Id $targetProcess.Id
            $targetProcess.WaitForExit(10000) | Out-Null
            if (-not $targetProcess.HasExited) { throw 'Pilot has not exited; state was retained.' }
        }
    }
    Write-Host 'Stopped the managed pilot process.'
} else { Write-Host 'Pilot process had already exited.' }
Remove-Item -LiteralPath $stateFile -Force
Write-Host 'Database, backups and logs retained. Stop any separately launched ngrok terminal with Ctrl+C.'
