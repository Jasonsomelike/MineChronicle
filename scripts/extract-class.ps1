param(
  [Parameter(Mandatory=$true)][string]$Jar,
  [Parameter(Mandatory=$true)][string]$Class,
  [Parameter(Mandatory=$true)][string]$Out
)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$entry = ($Class -replace '\.', '/') + '.class'
$z = [IO.Compression.ZipFile]::OpenRead($Jar)
try {
  $e = $z.Entries | Where-Object { $_.FullName -eq $entry }
  if (-not $e) { Write-Error "missing $entry"; exit 2 }
  $s = $e.Open()
  $ms = New-Object IO.MemoryStream
  $s.CopyTo($ms)
  [IO.File]::WriteAllBytes($Out, $ms.ToArray())
  Write-Output "ok $($ms.Length)"
} finally {
  $z.Dispose()
}
