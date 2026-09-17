Add-Type -AssemblyName System.IO.Compression.FileSystem
function List-Zip([string]$path, [string[]]$filters) {
  if (-not (Test-Path $path)) { return @() }
  try { $z = [System.IO.Compression.ZipFile]::OpenRead($path) } catch { return @() }
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($e in $z.Entries) {
    $n = $e.FullName
    foreach ($f in $filters) {
      if ($n -like $f) { $out.Add($n); break }
    }
  }
  $z.Dispose()
  return $out
}
$targets = @(
  @{p='D:\QQ下载\落幕曲\.minecraft\versions\GT New Horizons\mods\SpecialMobs-3.6.3.jar'; f=@('*Poison*','*poison*','*spider*','*textures/entity*')},
  @{p='D:\QQ下载\落幕曲\.minecraft\versions\Chapter of Yuusha 3\mods\faded_conquest_2-1.3.0-forge-1.20.1.jar'; f=@('*terrible*','*Ten*','*textures/entity*','*geo*')},
  @{p='D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\iceandfire-2.1.13-1.20.1-beta-5.jar'; f=@('*dragon*','*cyclops*','*deathworm*','*ghost*','*seaserpent*')},
  @{p='D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\L_Enders_Cataclysm-3.09.jar'; f=@('*ignis*','*maledictus*')},
  @{p='D:\QQ下载\落幕曲\.minecraft\versions\Chapter of Yuusha 3\mods\born_in_chaos_[Forge]1.20.1_1.7.3.jar'; f=@('*corpse_fly*','*maggot*','*fly*')},
  @{p='D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\The_Graveyard_3.1_(FORGE)_for_1.20.1.jar'; f=@('*ghoul*')},
  @{p='D:\QQ下载\落幕曲\.minecraft\versions\Chapter of Yuusha 3\mods\GrimoireOfGaia4-1.20.1-4.0.0-alpha.11.jar'; f=@('*dryad*')},
  @{p='D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\mowziesmobs-1.7.2.jar'; f=@('*wroughtnaut*','*ferrous*')},
  @{p='E:\mc\1\.minecraft\versions\龙之冒险：新征程v2.4\mods\IceAndFireCE-1.2.6-1.20.1-forge.jar'; f=@('*dragon*','*textures/entity*')},
  @{p='D:\QQ下载\服务器3.0\服务器3.0\.minecraft\versions\All the Mods 10\All the Mods 10.jar'; f=@('*enderdragon*','*magma*','*textures/entity/enderdragon*','*textures/entity/magma*')}
)
foreach ($t in $targets) {
  Write-Host "==== $([IO.Path]::GetFileName($t.p)) ===="
  $hits = List-Zip $t.p $t.f | Select-Object -First 50
  $hits | ForEach-Object { Write-Host $_ }
  Write-Host "hits=$($hits.Count)"
  Write-Host ""
}
