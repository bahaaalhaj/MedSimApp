param(
  [Parameter(Mandatory=$true)][string]$Url,
  [Parameter(Mandatory=$true)][string]$Target,
  [Parameter(Mandatory=$true)][long]$Size,
  [Parameter(Mandatory=$true)][string]$Sha256,
  [ValidateRange(1,64)][int]$PartCount=24,
  [ValidateRange(1,24)][int]$MaxParallel=4,
  [ValidateRange(1048576,67108864)][long]$TransferChunkBytes=8388608
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$modelRoot = (Resolve-Path (Join-Path $repo 'backend/data/llm-models')).Path
$targetPath = [IO.Path]::GetFullPath((Join-Path $repo $Target))
if (-not $targetPath.StartsWith($modelRoot + [IO.Path]::DirectorySeparatorChar)) { throw 'Target must stay inside backend/data/llm-models.' }
$partDir = $targetPath + '.parts'
if (-not $partDir.StartsWith($modelRoot + [IO.Path]::DirectorySeparatorChar)) { throw 'Invalid part directory.' }
New-Item -ItemType Directory -Force -Path $partDir | Out-Null
$chunk = [math]::Ceiling($Size / $PartCount)
$complete = $false
for ($round = 1; $round -le 64 -and -not $complete; $round++) {
  $pending = @()
  for ($index = 0; $index -lt $PartCount; $index++) {
    $start = [long]($index * $chunk)
    $end = [long][math]::Min($Size - 1, ($index + 1) * $chunk - 1)
    $expected = $end - $start + 1
    $part = Join-Path $partDir ('part-{0:D3}' -f $index)
    $existing = if (Test-Path -LiteralPath $part) { (Get-Item -LiteralPath $part).Length } else { 0L }
    $incoming = $part + '.incoming'
    if (Test-Path -LiteralPath $incoming) {
      $incomingLength = (Get-Item -LiteralPath $incoming).Length
      if ($incomingLength -gt ($expected - $existing)) { throw "Saved range is larger than expected: $incoming" }
      if ($incomingLength -gt 0) {
        $destination = [IO.File]::Open($part, [IO.FileMode]::Append, [IO.FileAccess]::Write)
        $source = [IO.File]::OpenRead($incoming)
        try { $source.CopyTo($destination) } finally { $source.Dispose(); $destination.Dispose() }
        $existing += $incomingLength
      }
      Remove-Item -LiteralPath $incoming -Force
    }
    if ($existing -gt $expected) { throw "Range part is larger than expected: $part" }
    if ($existing -eq $expected) { continue }
    $pending += [pscustomobject]@{
      Index=$index; Part=$part; Incoming=$incoming; Existing=$existing;
      Expected=$expected; Start=($start + $existing); End=[long][math]::Min($end, $start + $existing + $TransferChunkBytes - 1)
    }
  }
  if (-not $pending.Count) { $complete = $true; break }
  Write-Host "Download pass $round`: $($pending.Count) range parts remain."
  for ($offset = 0; $offset -lt $pending.Count; $offset += $MaxParallel) {
    $last = [math]::Min($pending.Count - 1, $offset + $MaxParallel - 1)
    $items = @($pending[$offset..$last])
    $jobs = @($items | ForEach-Object {
      if (Test-Path -LiteralPath $_.Incoming) { Remove-Item -LiteralPath $_.Incoming -Force }
      $arguments = @(
        '-L','--fail','--retry','0','--connect-timeout','30','--max-time','90',
        '--speed-limit','1024','--speed-time','60',
        '--silent','--show-error','--range',"$($_.Start)-$($_.End)",'--output',$_.Incoming,$Url
      )
      [pscustomobject]@{ Item=$_; Process=(Start-Process -FilePath 'curl.exe' -ArgumentList $arguments -WindowStyle Hidden -PassThru) }
    })
    $jobs.Process | Wait-Process
    foreach ($job in $jobs) {
      if (-not (Test-Path -LiteralPath $job.Item.Incoming)) { continue }
      $incomingLength = (Get-Item -LiteralPath $job.Item.Incoming).Length
      if ($incomingLength -gt ($job.Item.Expected - $job.Item.Existing)) {
        throw "Downloaded range is larger than expected: $($job.Item.Incoming)"
      }
      if ($incomingLength -gt 0) {
        $destination = [IO.File]::Open($job.Item.Part, [IO.FileMode]::Append, [IO.FileAccess]::Write)
        $source = [IO.File]::OpenRead($job.Item.Incoming)
        try { $source.CopyTo($destination) } finally { $source.Dispose(); $destination.Dispose() }
      }
      Remove-Item -LiteralPath $job.Item.Incoming -Force
    }
  }
}
if (-not $complete) { throw 'Range download remains incomplete after 64 resumable passes.' }
$output = [IO.File]::Open($targetPath, [IO.FileMode]::Create, [IO.FileAccess]::Write)
try {
  for ($index = 0; $index -lt $PartCount; $index++) {
    $part = Join-Path $partDir ('part-{0:D3}' -f $index)
    $input = [IO.File]::OpenRead($part)
    try { $input.CopyTo($output) } finally { $input.Dispose() }
  }
} finally { $output.Dispose() }
if ((Get-Item -LiteralPath $targetPath).Length -ne $Size) { throw 'Combined model size mismatch.' }
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $targetPath).Hash.ToLower()
if ($actual -ne $Sha256.ToLower()) { throw 'Combined model SHA-256 mismatch.' }
Remove-Item -LiteralPath $partDir -Recurse -Force
Write-Host "Verified $targetPath"
