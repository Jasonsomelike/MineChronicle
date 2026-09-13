param([string]$Jar,[string]$Entry,[string]$Out)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z=[IO.Compression.ZipFile]::OpenRead($Jar)
try {
  $e=$z.Entries | Where-Object { $_.FullName -eq $Entry }
  if (-not $e) { exit 2 }
  $s=$e.Open(); $ms=New-Object IO.MemoryStream; $s.CopyTo($ms)
  [IO.File]::WriteAllBytes($Out, $ms.ToArray())
} finally { $z.Dispose() }
