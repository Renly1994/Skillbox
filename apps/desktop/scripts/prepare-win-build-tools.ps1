$ErrorActionPreference = "Stop"

$archiveUrl = "https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z"
$archiveSha256 = "CDAEC7154DDA7CC31F88D886E2489379A0625A737D610B5AE7F62A12F16743A4"
$cacheBase = if ($env:ELECTRON_BUILDER_CACHE) {
  $env:ELECTRON_BUILDER_CACHE
}
else {
  Join-Path $env:LOCALAPPDATA "electron-builder\Cache"
}
$cacheRoot = Join-Path $cacheBase "winCodeSign"
$toolDirectory = Join-Path $cacheRoot "winCodeSign-2.6.0"
$rceditPath = Join-Path $toolDirectory "rcedit-x64.exe"
$signtoolPath = Join-Path $toolDirectory "windows-10\x64\signtool.exe"

function Get-Sha256([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "")
  }
  finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

if (
  (Test-Path -LiteralPath $rceditPath -PathType Leaf) -and
  (Test-Path -LiteralPath $signtoolPath -PathType Leaf)
) {
  Write-Host "winCodeSign build tools are ready"
  exit 0
}

New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null

$archivePath = Get-ChildItem -LiteralPath $cacheRoot -Filter "*.7z" -File -ErrorAction SilentlyContinue |
  Where-Object { (Get-Sha256 $_.FullName) -eq $archiveSha256 } |
  Select-Object -First 1 -ExpandProperty FullName

if (-not $archivePath) {
  $archivePath = Join-Path $cacheRoot "winCodeSign-2.6.0.7z"
  Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath
}

$actualHash = Get-Sha256 $archivePath
if ($actualHash -ne $archiveSha256) {
  throw "winCodeSign archive checksum validation failed: $archivePath"
}

$sevenZip = Resolve-Path (Join-Path $PSScriptRoot "..\..\..\node_modules\7zip-bin\win\x64\7za.exe")
New-Item -ItemType Directory -Path $toolDirectory -Force | Out-Null
& $sevenZip x -y -bd $archivePath "-o$toolDirectory" "-xr!darwin"
if (
  $LASTEXITCODE -ne 0 -or
  -not (Test-Path -LiteralPath $rceditPath -PathType Leaf) -or
  -not (Test-Path -LiteralPath $signtoolPath -PathType Leaf)
) {
  throw "Failed to extract winCodeSign build tools"
}

Write-Host "winCodeSign build tools prepared: $toolDirectory"
