param(
    [Parameter(Mandatory)][string]$Audit,
    [Parameter(Mandatory)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$auditData = Get-Content -LiteralPath $Audit -Raw | ConvertFrom-Json
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($outputRoot) | Out-Null
$archiveCache = @{}
$errors = [Collections.Generic.List[string]]::new()

function Read-Language([string]$Text, [string]$Entry) {
    if ($Entry.EndsWith('.json')) {
        try { return ConvertFrom-Json -InputObject $Text -AsHashtable } catch { return @{} }
    }
    $result = @{}
    foreach ($line in $Text -split '\r?\n') {
        if ($line -match '^\s*#' -or !$line.Contains('=')) { continue }
        $key, $value = $line -split '=', 2
        $result[$key.Trim()] = $value.Trim()
    }
    return $result
}

function Read-Archive([IO.FileInfo]$File) {
    $cacheKey = "$($File.FullName)|$($File.Length)|$($File.LastWriteTimeUtc.Ticks)"
    if ($archiveCache.ContainsKey($cacheKey)) { return $archiveCache[$cacheKey] }
    $result = @{ lang = @{}; assets = @{} }
    $zip = $null
    try {
        $zip = [IO.Compression.ZipFile]::OpenRead($File.FullName)
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName
            if ($name -match '^assets/[^/]+/lang/(zh_cn|en_us)\.(json|lang)$' -and $entry.Length -lt 8MB) {
                $locale = $Matches[1]
                $reader = [IO.StreamReader]::new($entry.Open())
                try { $data = Read-Language $reader.ReadToEnd() $name } finally { $reader.Dispose() }
                if (!$result.lang.ContainsKey($locale)) { $result.lang[$locale] = @{} }
                foreach ($pair in $data.GetEnumerator()) {
                    if ($pair.Value -is [string] -and $pair.Value.Length -lt 240) {
                        $result.lang[$locale][$pair.Key] = @($pair.Value, "$($File.Name) > $name")
                    }
                }
            }
            if ($name -cmatch '^assets/[^/]+/(models|items)/.+\.json$|^assets/[^/]+/textures/(item|items|block|blocks)/.+\.png$' -and $entry.Length -lt 4MB) {
                $result.assets[$name] = @($File.FullName, $name)
            }
        }
    } catch { $errors.Add("$($File.FullName): $_") } finally { if ($zip) { $zip.Dispose() } }
    $archiveCache[$cacheKey] = $result
    return $result
}

$rootIds = @($auditData.keys.roots | Sort-Object -Unique)
foreach ($root in $auditData.roots) {
    if ($root.id -notin $rootIds) { continue }
    $target = Join-Path $outputRoot "$($root.id).json"
    if ((Test-Path -LiteralPath $target) -and (Get-Item -LiteralPath $target).Length -gt 0) { continue }
    $result = @{ id = $root.id; packs = @($root.instances.name); version = $root.instances[0].minecraft_version; lang = @{ zh_cn = @{}; en_us = @{} }; assets = @{} }
    $archives = [Collections.Generic.List[IO.FileInfo]]::new()
    foreach ($jar in @(Get-ChildItem -LiteralPath $root.path -Filter '*.jar' -ErrorAction SilentlyContinue)) { $archives.Add($jar) }
    foreach ($jar in @(Get-ChildItem -LiteralPath (Join-Path $root.path 'mods') -Filter '*.jar' -ErrorAction SilentlyContinue | Sort-Object Name)) { $archives.Add($jar) }
    $options = Join-Path $root.path 'options.txt'
    $enabled = @()
    if (Test-Path -LiteralPath $options) {
        $line = Get-Content -LiteralPath $options | Where-Object { $_.StartsWith('resourcePacks:') } | Select-Object -First 1
        if ($line) { try { $enabled = $line.Substring(14) | ConvertFrom-Json } catch {} }
    }
    $looseDirectories = [Collections.Generic.List[string]]::new()
    foreach ($name in $enabled) {
        if (!$name.StartsWith('file/')) { continue }
        $pack = Join-Path (Join-Path $root.path 'resourcepacks') $name.Substring(5)
        if (Test-Path -LiteralPath $pack -PathType Leaf) { $archives.Add((Get-Item -LiteralPath $pack)) }
        elseif (Test-Path -LiteralPath $pack -PathType Container) { $looseDirectories.Add($pack) }
    }
    foreach ($relative in @('kubejs','resources','config/openloader/resources','config/paxi/resourcepacks')) {
        $dir = Join-Path $root.path $relative
        if (Test-Path -LiteralPath $dir -PathType Container) {
            $looseDirectories.Add($dir)
            foreach ($pack in @(Get-ChildItem -LiteralPath $dir -Filter '*.zip')) { $archives.Add($pack) }
        }
    }
    foreach ($archive in $archives) {
        $data = Read-Archive $archive
        foreach ($locale in @('zh_cn','en_us')) {
            if (!$data.lang.ContainsKey($locale)) { continue }
            foreach ($pair in $data.lang[$locale].GetEnumerator()) { $result.lang[$locale][$pair.Key] = $pair.Value }
        }
        foreach ($pair in $data.assets.GetEnumerator()) { $result.assets[$pair.Key] = $pair.Value }
    }
    foreach ($dir in $looseDirectories) {
        foreach ($file in Get-ChildItem -LiteralPath $dir -Recurse -File) {
            $relative = [IO.Path]::GetRelativePath($dir, $file.FullName).Replace('\','/')
            $assetIndex = $relative.IndexOf('assets/')
            if ($assetIndex -lt 0) { continue }
            $relative = $relative.Substring($assetIndex)
            if ($relative -match '^assets/[^/]+/lang/(zh_cn|en_us)\.(json|lang)$' -and $file.Length -lt 8MB) {
                $locale = $Matches[1]
                $data = Read-Language (Get-Content -LiteralPath $file.FullName -Raw) $relative
                foreach ($pair in $data.GetEnumerator()) {
                    if ($pair.Value -is [string] -and $pair.Value.Length -lt 240) { $result.lang[$locale][$pair.Key] = @($pair.Value, "$(Split-Path $dir -Leaf) > $relative") }
                }
            }
            if ($relative -cmatch '^assets/[^/]+/(models|items)/.+\.json$|^assets/[^/]+/textures/(item|items|block|blocks)/.+\.png$' -and $file.Length -lt 4MB) { $result.assets[$relative] = @($file.FullName, '') }
        }
    }
    $result | ConvertTo-Json -Depth 8 -Compress | Set-Content -LiteralPath $target -Encoding utf8
    Write-Output "Root $($root.id) $($result.packs -join ', '): $($result.lang.zh_cn.Count) Chinese names; $($result.assets.Count) assets"
    $archiveCache.Clear()
    [GC]::Collect()
}
$errors | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputRoot 'errors.json') -Encoding utf8
