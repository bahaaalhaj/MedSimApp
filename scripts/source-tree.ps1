[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

# Names only: never open file contents. Prune before descending, including
# junctions/symlinks that could escape the repository or create a traversal loop.
$excludedDirectories = @(
    '.git', 'node_modules', 'dist', '.venv', '.venv-voice', '.vite',
    '__pycache__', '.ruff_cache', '.pytest_cache', '.cache', '.local-quarantine'
)
$excludedPaths = @(
    'backend/data', 'backend/backend', 'backend/tools', 'backend/.tts-cache',
    'backend/generated-audio'
)

function Write-SourceDirectory([string]$Directory, [string]$Prefix) {
    foreach ($item in (Get-ChildItem -LiteralPath $Directory -Force | Sort-Object Name)) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
        $relative = if ($Prefix) { "$Prefix/$($item.Name)" } else { $item.Name }
        if ($item.PSIsContainer) {
            if ($item.Name -in $excludedDirectories -or $relative -in $excludedPaths) { continue }
            Write-Output "$relative/"
            Write-SourceDirectory $item.FullName $relative
        } else {
            if ($item.Name -like '.env*' -and $item.Name -notmatch '^\.env(?:\..+)?\.example$') { continue }
            if ($item.Name -match '\.(?:log(?:\..*)?|pyc|pyo|tsbuildinfo|db(?:-(?:shm|wal|journal))?|sqlite3?(?:-(?:shm|wal|journal))?|gguf|safetensors|onnx|pt|pth|zip|exe|dll|key|pem|pfx)$') { continue }
            if ($item.Name -in @('tree.txt', 'source-tree.txt')) { continue }
            Write-Output $relative
        }
    }
}

Write-SourceDirectory $repo ''
