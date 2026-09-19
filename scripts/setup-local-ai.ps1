param([switch]$SkipModels, [switch]$SkipRuntime, [switch]$Include4B)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$downloads = Join-Path $repo 'backend/tools/downloads'
$runtime = Join-Path $repo 'backend/tools/llama.cpp'
$models = Join-Path $repo 'backend/data/llm-models'
New-Item -ItemType Directory -Force -Path $downloads,$runtime,$models | Out-Null

$artifacts = @(
  @{ Name='llama-b10948-bin-win-vulkan-x64.zip'; Url='https://github.com/ggml-org/llama.cpp/releases/download/b10948/llama-b10948-bin-win-vulkan-x64.zip'; Sha='75c97002b04958a61c45bf1117aa8d88f5466523240e8b04960379122151235b'; Size=31674100L; Kind='runtime' },
  @{ Name='Qwen3-4B-Q4_K_M.gguf'; Url='https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf'; Sha='7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5'; Size=2497280256L; Kind='model' },
  @{ Name='Qwen3-1.7B-Q8_0.gguf'; Url='https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/90862c4b9d2787eaed51d12237eafdfe7c5f6077/Qwen3-1.7B-Q8_0.gguf'; Sha='061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a'; Size=1834426016L; Kind='model' }
)
foreach ($item in $artifacts) {
  if (($SkipModels -and $item.Kind -eq 'model') -or ($SkipRuntime -and $item.Kind -eq 'runtime')) { continue }
  if ($item.Name -eq 'Qwen3-4B-Q4_K_M.gguf' -and -not $Include4B) { continue }
  $target = if ($item.Kind -eq 'model') { Join-Path $models $item.Name } else { Join-Path $downloads $item.Name }
  if (-not (Test-Path -LiteralPath $target) -or (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLower() -ne $item.Sha) {
    if ($item.Kind -eq 'model') {
      & (Join-Path $PSScriptRoot 'download-ranged.ps1') -Url $item.Url -Target "backend/data/llm-models/$($item.Name)" -Size $item.Size -Sha256 $item.Sha
    } else {
      if ((Test-Path -LiteralPath $target) -and (Get-Item -LiteralPath $target).Length -ge $item.Size) {
        # A complete-sized file with the wrong digest cannot be resumed safely.
        Remove-Item -LiteralPath $target -Force
      }
      & curl.exe -L --fail --retry 3 --continue-at - --output $target $item.Url
      if ($LASTEXITCODE -ne 0) { throw "Download failed: $($item.Name)" }
    }
  }
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLower()
  if ($actual -ne $item.Sha) { throw "SHA-256 mismatch: $($item.Name)" }
  Write-Host "Verified $($item.Name)"
}
if (-not $SkipRuntime) {
  Expand-Archive -Force -LiteralPath (Join-Path $downloads 'llama-b10948-bin-win-vulkan-x64.zip') -DestinationPath $runtime
}
& "$repo/backend/.venv/Scripts/python.exe" "$repo/backend/local_ai_preflight.py"
