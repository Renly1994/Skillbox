param(
  [Parameter(Mandatory = $true)]
  [string]$ReleaseDirectory
)

$ErrorActionPreference = "Stop"
$exePath = Join-Path $ReleaseDirectory "win-unpacked\SkillboxApp.exe"
$iconPath = Join-Path $PSScriptRoot "..\resources\icon.ico"

if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
  throw "Windows package is missing SkillboxApp.exe: $exePath"
}

Add-Type -AssemblyName System.Drawing
$actualIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($exePath)
$expectedIcon = [System.Drawing.Icon]::new($iconPath, [System.Drawing.Size]::new(32, 32))
$actualBitmap = $actualIcon.ToBitmap()
$expectedBitmap = $expectedIcon.ToBitmap()

try {
  $difference = 0
  for ($y = 0; $y -lt 32; $y += 1) {
    for ($x = 0; $x -lt 32; $x += 1) {
      $actual = $actualBitmap.GetPixel($x, $y)
      $expected = $expectedBitmap.GetPixel($x, $y)
      $difference += [Math]::Abs([int]$actual.A - [int]$expected.A)
      $difference += [Math]::Abs([int]$actual.R - [int]$expected.R)
      $difference += [Math]::Abs([int]$actual.G - [int]$expected.G)
      $difference += [Math]::Abs([int]$actual.B - [int]$expected.B)
    }
  }

  $meanDifference = $difference / (32 * 32 * 4)
  if ($meanDifference -gt 15) {
    throw "SkillboxApp.exe does not contain the product icon; mean pixel difference: $([Math]::Round($meanDifference, 2))"
  }

  Write-Host "Windows EXE icon verification passed; mean pixel difference: $([Math]::Round($meanDifference, 2))"
}
finally {
  $actualBitmap.Dispose()
  $expectedBitmap.Dispose()
  $actualIcon.Dispose()
  $expectedIcon.Dispose()
}
