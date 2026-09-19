$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$processDir = Join-Path $repo 'backend/data/local-ai-processes'
foreach ($name in @('frontend','backend','llm')) {
  $pidFile = Join-Path $processDir "$name.pid"
  if (-not (Test-Path -LiteralPath $pidFile)) { continue }
  $processId = [int](Get-Content -LiteralPath $pidFile -Raw)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
  if ($process -and $process.CommandLine -and $process.CommandLine.IndexOf($repo, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$processId" -ErrorAction SilentlyContinue)
    foreach ($child in $children) {
      if ($child.CommandLine -and $child.CommandLine.IndexOf($repo, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
      }
    }
    Stop-Process -Id $processId -ErrorAction SilentlyContinue
    Write-Host "Stopped repository-owned $name process $processId."
  } elseif ($process) {
    Write-Warning "PID $processId no longer belongs to this repository; it was not stopped."
  }
  Remove-Item -LiteralPath $pidFile -Force
}
