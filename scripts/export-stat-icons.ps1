param([string]$Requests = '.local/stat-icon-requests.json', [string]$Assets = '.local/stat-assets', [string]$Output = '.local/stat-textures', [string]$Audit = '.local/stat-resource-audit.json')
$ErrorActionPreference = 'Stop'
$requestsData = Get-Content -LiteralPath $Requests -Raw | ConvertFrom-Json
$auditData = Get-Content -LiteralPath $Audit -Raw | ConvertFrom-Json
$outputPath = [IO.Path]::GetFullPath($Output)
[IO.Directory]::CreateDirectory($outputPath) | Out-Null
$results = @{}
$failures = [Collections.Generic.List[string]]::new()
. (Join-Path $PSScriptRoot 'stat-icons-draconic.ps1')
. (Join-Path $PSScriptRoot 'stat-icons-modern-industrialization.ps1')
. (Join-Path $PSScriptRoot 'stat-icons-entities.ps1')
. (Join-Path $PSScriptRoot 'stat-icons-gregtech.ps1')
. (Join-Path $PSScriptRoot 'stat-icons-special.ps1')
. (Join-Path $PSScriptRoot 'stat-icons-trophies.ps1')
function Read-Asset([string]$Name) {
    if (!$assetIndex.ContainsKey($Name)) { return $null }
    $ref = $assetIndex[$Name]
    if (!$ref[1]) { return [IO.File]::ReadAllBytes($ref[0]) }
    if (!$zips.ContainsKey($ref[0])) { $zips[$ref[0]] = [IO.Compression.ZipFile]::OpenRead($ref[0]) }
    $entry = $zips[$ref[0]].GetEntry($ref[1])
    if (!$entry -or $entry.Length -gt 4MB) { return $null }
    $stream = $entry.Open()
    $memory = [IO.MemoryStream]::new()
    try { $stream.CopyTo($memory); return ,$memory.ToArray() } finally { $stream.Dispose(); $memory.Dispose() }
}
function Read-JsonAsset([string]$Name) {
    $bytes = Read-Asset $Name
    if (!$bytes) { return $null }
    try { return [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json -AsHashtable } catch { return $null }
}
function Item-Definition($Definition, [int]$Depth = 0) {
    if (!$Definition -or $Depth -gt 12) { return $null }
    switch ($Definition.type -replace '^minecraft:', '') {
        'model' { return @{ model = $Definition.model } }
        'composite' { return @{ composite = $Definition.models } }
        'special' {
            if (($Definition.model.type -replace '^minecraft:', '') -eq 'chest') {
                return @{ chest = $Definition.model.texture }
            }
            return @{ special = ($Definition.model.type -replace '^minecraft:', ''); model = $Definition.base }
        }
        'select' { return Item-Definition $Definition.fallback ($Depth + 1) }
        'range_dispatch' { return Item-Definition $Definition.fallback ($Depth + 1) }
        'condition' { return Item-Definition $Definition.on_false ($Depth + 1) }
    }
    return $null
}
function Index-ExtraTexture([string]$Texture) {
    $asset = Asset-Path $Texture 'textures' 'png'
    if (!$asset -or $assetIndex.ContainsKey($asset)) { return }
    Index-ExtraAssets
}
function Index-ExtraAssets {
    if ($script:extraAssetsIndexed) { return }
    $script:extraAssetsIndexed = $true
    $knownAssets = [Collections.Generic.HashSet[string]]::new([string[]]@($assetIndex.Keys))
    $candidates = [Collections.Generic.List[string]]::new()
    $loose = [Collections.Generic.List[string]]::new()
    foreach ($file in @(Get-ChildItem -LiteralPath $root.path -Filter '*.jar' -ErrorAction SilentlyContinue)) { $candidates.Add($file.FullName) }
    foreach ($file in @(Get-ChildItem -LiteralPath (Join-Path $root.path 'mods') -Filter '*.jar' -ErrorAction SilentlyContinue | Sort-Object Name)) { $candidates.Add($file.FullName) }
    $enabled = @()
    $options = Join-Path $root.path 'options.txt'
    if (Test-Path -LiteralPath $options) {
        $line = Get-Content -LiteralPath $options | Where-Object { $_.StartsWith('resourcePacks:') } | Select-Object -First 1
        if ($line) { try { $enabled = $line.Substring(14) | ConvertFrom-Json } catch {} }
    }
    foreach ($name in $enabled) {
        if ($name.StartsWith('file/')) {
            $candidate = Join-Path (Join-Path $root.path 'resourcepacks') $name.Substring(5)
            if (Test-Path -LiteralPath $candidate -PathType Container) { $loose.Add($candidate) }
            else { $candidates.Add($candidate) }
        }
    }
    foreach ($dir in @('kubejs','resources','config/openloader/resources','config/paxi/resourcepacks')) {
        $candidate = Join-Path $root.path $dir
        foreach ($file in @(Get-ChildItem -LiteralPath $candidate -Filter '*.zip' -ErrorAction SilentlyContinue)) { $candidates.Add($file.FullName) }
        $loose.Add($candidate)
    }
    # Some mods store inventory layers outside textures/item. Index that resource
    # stack once per root, preserving pack precedence and the original entries.
    foreach ($candidate in @($candidates.ToArray()) + @($loose.ToArray())) {
        if (Test-Path -LiteralPath $candidate -PathType Container) {
            foreach ($file in Get-ChildItem -LiteralPath $candidate -Recurse -File) {
                $relative = [IO.Path]::GetRelativePath($candidate, $file.FullName).Replace('\','/')
                $offset = $relative.IndexOf('assets/')
                if ($offset -lt 0) { continue }
                $relative = $relative.Substring($offset)
                if (!$knownAssets.Contains($relative) -and $relative -cmatch '^assets/[^/]+/(?:(?:models|items|blockstates|geo)/.+\.(?:json|obj)|textures/.+\.png|model/.+\.(?:obj|png))$' -and $file.Length -lt 4MB) {
                    $assetIndex[$relative] = @($file.FullName,'')
                }
            }
        } elseif (Test-Path -LiteralPath $candidate -PathType Leaf) {
            if (!$zips.ContainsKey($candidate)) { $zips[$candidate] = [IO.Compression.ZipFile]::OpenRead($candidate) }
            foreach ($entry in $zips[$candidate].Entries) {
                $relative = $entry.FullName
                if (!$knownAssets.Contains($relative) -and $relative -cmatch '^assets/[^/]+/(?:(?:models|items|blockstates|geo)/.+\.(?:json|obj)|textures/.+\.png|model/.+\.(?:obj|png))$' -and $entry.Length -lt 4MB) {
                    $assetIndex[$relative] = @($candidate,$relative)
                }
            }
        }
    }
}
function Asset-Path([string]$Id, [string]$Kind, [string]$Extension) {
    if ($Id -cnotmatch '^(?:[a-z0-9_.-]+:)?[a-zA-Z0-9_./-]+$' -or $Id.Contains('..')) { return '' }
    $ns, $name = if ($Id.Contains(':')) { $Id -split ':', 2 } else { @('minecraft',$Id) }
    return "assets/$ns/$Kind/$name.$Extension"
}
function Read-Model([string]$Id, [int]$Depth = 0) {
    if ($Depth -gt 12) { return $null }
    if ($models.ContainsKey($Id)) { return $models[$Id] }
    $bytes = Read-Asset (Asset-Path $Id 'models' 'json')
    if (!$bytes) { return $null }
    try { $model = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json -AsHashtable } catch { return $null }
    $result = Resolve-Model $model $Depth
    $models[$Id] = $result
    return $result
}
function Resolve-Model($Model, [int]$Depth = 0) {
    if (!$Model -or $Depth -gt 12) { return $null }
    if ($Model.loader -in @('forge:separate_transforms','neoforge:separate_transforms')) {
        $gui = if ($Model.perspectives.gui) { $Model.perspectives.gui } else { $Model.base }
        return Resolve-Model $gui ($Depth + 1)
    }
    if ($Model.loader -eq 'sophisticatedstorage:simple_material' -and $Model.base -and $Model.overlay) {
        return Resolve-Model @{
            loader='forge:composite';children=@{base=$Model.base;overlay=$Model.overlay}
            display=$Model.display
        } ($Depth + 1)
    }
    $result = @{ textures = @{}; generated = $false; cube = $false; elements = @(); display = @{} }
    if ($model.parent) {
        $result.generated = $model.parent -match '(?:^|:)(?:item/(generated|handheld|handheld_rod)|builtin/generated)$'
        $result.cube = $model.parent -match '(?:^|:)block/cube(?:_|$)'
        $parent = Read-Model $model.parent ($Depth + 1)
        if ($parent) {
            $result.generated = $result.generated -or $parent.generated
            $result.cube = $result.cube -or $parent.cube
            foreach ($pair in $parent.textures.GetEnumerator()) { $result.textures[$pair.Key] = $pair.Value }
            $result.elements = $parent.elements
            foreach ($pair in $parent.display.GetEnumerator()) { $result.display[$pair.Key] = $pair.Value }
            $result.loader = $parent.loader
        }
    }
    if ($model.textures) { foreach ($pair in $model.textures.GetEnumerator()) { $result.textures[$pair.Key] = $pair.Value } }
    if ($model.ContainsKey('elements')) { $result.elements = $model.elements }
    if ($model.display) { foreach ($pair in $model.display.GetEnumerator()) { $result.display[$pair.Key] = $pair.Value } }
    if ($model.loader) { $result.loader = $model.loader }
    if ($model.gui_light) { $result.gui_light = $model.gui_light }
    if ($model.loader -in @('forge:composite','neoforge:composite') -and $model.children) {
        foreach ($part in $model.children.GetEnumerator()) {
            if ($model.visibility -and $model.visibility.ContainsKey($part.Key) -and !$model.visibility[$part.Key]) { continue }
            $child = Resolve-Model $part.Value ($Depth + 1)
            if (!$child -or !$child.elements.Count) { return $null }
            foreach ($element in $child.elements) {
                $copy = @{} + $element
                $copy.faces = @{}
                foreach ($pair in $element.faces.GetEnumerator()) {
                    $face = @{} + $pair.Value
                    $texture = $face.texture
                    if ($texture.StartsWith('#')) { $texture = Texture-Ref $child.textures $texture.Substring(1) }
                    elseif ($child.textures.ContainsKey($texture)) { $texture = Texture-Ref $child.textures $texture }
                    if (!$texture) { return $null }
                    $face.texture = $texture
                    $copy.faces[$pair.Key] = $face
                }
                $result.elements += $copy
            }
        }
    }
    return $result
}
function Texture-Ref($Textures, [string]$Name) {
    $value = $Textures[$Name]
    for ($i = 0; $i -lt 12 -and $value -is [string] -and $value.StartsWith('#'); $i++) { $value = $Textures[$value.Substring(1)] }
    if ($value -isnot [string] -or $value.StartsWith('#')) { return $null }
    return $value
}
function Read-BlockModel([string]$Id) {
    $ns, $name = $Id -split ':', 2
    $model = Read-Model "${ns}:block/$name"
    if ($model -and $model.elements.Count) { return $model }
    Index-ExtraAssets
    $state = Read-JsonAsset (Asset-Path $Id 'blockstates' 'json')
    if (!$state.variants) { return $null }
    # Statistics have no block state. Prefer the mature/lower variant for crops,
    # then a stable default from the actual state definition.
    $variants = @($state.variants.GetEnumerator() | Sort-Object @{Expression={
        if ($_.Key -match '(?:^|,)age=(\d+)') { [int]$Matches[1] } else { 0 }
    };Descending=$true}, @{Expression={ $_.Key -match 'half=upper' }}, Key)
    foreach ($variant in $variants) {
        $selected = @($variant.Value)[0]
        if (!$selected.model) { continue }
        $model = Read-Model $selected.model
        if ($model -and $model.elements.Count) { return $model }
    }
    return $null
}
function Export-Texture([string]$Id, [string]$AssetName = '') {
    $name = if ($AssetName) { $AssetName } else { Asset-Path $Id 'textures' 'png' }
    if (!$name) { return $null }
    if ($textures.ContainsKey($name)) { return $textures[$name] }
    if (!$assetIndex.ContainsKey($name)) { Index-ExtraTexture $Id }
    $bytes = Read-Asset $name
    if (!$bytes) { return $null }
    $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([byte[]]$bytes)).ToLowerInvariant()
    $target = Join-Path $outputPath "$hash.png"
    if (!(Test-Path -LiteralPath $target)) { [IO.File]::WriteAllBytes($target, [byte[]]$bytes) }
    $ref = $assetIndex[$name]
    $result = @{ file = "$hash.png"; source = "$(Split-Path $ref[0] -Leaf) > $name" }
    # Animation metadata belongs to the selected texture's own resource archive.
    $metadata = $null
    if (!$ref[1]) {
        $metadataPath = "$($ref[0]).mcmeta"
        if (Test-Path -LiteralPath $metadataPath -PathType Leaf) {
            $metadata = [IO.File]::ReadAllText($metadataPath)
        }
    } else {
        $entry = $zips[$ref[0]].GetEntry("$($ref[1]).mcmeta")
        if ($entry -and $entry.Length -lt 1MB) {
            $reader = [IO.StreamReader]::new($entry.Open())
            try { $metadata = $reader.ReadToEnd() } finally { $reader.Dispose() }
        }
    }
    if ($metadata) {
        try {
            $parsed = ConvertFrom-Json -InputObject $metadata -AsHashtable
            if ($parsed.ContainsKey('animation')) { $result.animation = $parsed.animation }
        } catch {}
    }
    $textures[$name] = $result
    return $result
}
function Export-EntityTexture([string]$Id) {
    Index-ExtraTexture $Id
    return Export-Texture $Id
}
function Export-Elements($Model) {
    $layers = @{}
    $elements = [Collections.Generic.List[object]]::new()
    foreach ($element in $Model.elements) {
        $faces = @{}
        foreach ($pair in $element.faces.GetEnumerator()) {
            $face = @{} + $pair.Value
            # Blockbench leaves explicit #missing markers on untextured faces.
            # Omit those faces while keeping all valid geometry and original UVs.
            if ($face.texture -eq '#missing' -and !$Model.textures.ContainsKey('missing')) { continue }
            $id = if ($face.texture.StartsWith('#')) { Texture-Ref $Model.textures $face.texture.Substring(1) }
                elseif ($Model.textures.ContainsKey($face.texture)) { Texture-Ref $Model.textures $face.texture }
                else { $face.texture }
            if (!$id) { return $null }
            if (!$layers.ContainsKey($id)) {
                $texture = Export-Texture $id
                if (!$texture) { return $null }
                $layers[$id] = $texture
            }
            $face.texture = $id
            $faces[$pair.Key] = $face
        }
        $copy = @{} + $element
        # Parent models share array instances. Composite transforms must not
        # move previously exported colors or mutate the cached template.
        $copy.from = @($element.from)
        $copy.to = @($element.to)
        if ($element.rotation) {
            $copy.rotation = @{} + $element.rotation
            $copy.rotation.origin = @($element.rotation.origin)
        }
        $copy.faces = $faces
        $elements.Add($copy)
    }
    if (!$elements.Count) { return $null }
    return @{kind='model'; elements=@($elements.ToArray()); textures=$layers; layers=@($layers.Values); display=$Model.display.gui; gui_light=$Model.gui_light}
}
foreach ($group in $requestsData | Group-Object root) {
    $pack = Get-Content -LiteralPath (Join-Path $Assets "$($group.Name).json") -Raw | ConvertFrom-Json -AsHashtable
    $root = $auditData.roots | Where-Object id -EQ ([int]$group.Name) | Select-Object -First 1
    $assetIndex = $pack.assets
    $zips = @{}; $models = @{}; $textures = @{}
    $script:extraAssetsIndexed = $false
    try {
        foreach ($request in $group.Group | Sort-Object @{Expression={"$($_.entity)|$($_.key)"}} -Unique) {
            try {
                if ($request.entity) {
                    $identity = "$($group.Name)|entity:$($request.key)"
                    $entity = Export-EntityIcon $request.key
                    if ($entity) { $results[$identity] = $entity }
                    continue
                }
                $ns,$name = $request.key -split ':',2
                if ($request.key -eq 'minecraft:air') { continue }
                if ($ns -eq 'gtceu') { $null = Get-GregTechContext }
                $definition = Read-JsonAsset (Asset-Path $request.key 'items' 'json')
                $selected = if ($definition) { Item-Definition $definition.model } else { @{model="${ns}:item/$name"} }
                $chest = if ($selected.chest) { $selected.chest } elseif (!$definition -and $ns -eq 'minecraft') {
                    switch ($name) { 'chest' { 'minecraft:normal' } 'trapped_chest' { 'minecraft:trapped' } 'ender_chest' { 'minecraft:ender' } }
                }
                $identity = "$($group.Name)|$($request.key)"
                if ($selected.composite) {
                    $custom = Export-CompositeItem $selected.composite
                    if ($custom) { $results[$identity] = $custom }
                    continue
                }
                $custom = Export-SpecialItemIcon $request.key
                if ($custom) { $results[$identity] = $custom; continue }
                $custom = Export-TrophyItemIcon $request.key
                if ($custom) { $results[$identity] = $custom; continue }
                $custom = Export-DraconicIcon $request.key
                if ($custom) { $results[$identity] = $custom; continue }
                $custom = if ($ns -in @('modern_industrialization','industrialization_overdrive')) { Export-ModernIndustrializationIcon $request.key }
                if ($custom) { $results[$identity] = $custom; continue }
                if ($ns -eq 'sophisticatedstorage' -and $name -match '^(?:(copper|iron|gold|diamond|netherite)_)?chest$') {
                    $tier = $Matches[1]
                    $layers = @(Export-EntityTexture 'sophisticatedstorage:entity/chest/oak')
                    if ($tier) { $layers += Export-EntityTexture "sophisticatedstorage:entity/chest/${tier}_tier" }
                    if ($layers.Count -and $null -notin $layers) { $results[$identity] = @{kind='chest'; layers=$layers} }
                    continue
                }
                if ($chest) {
                    $chestNs, $chestName = if ($chest.Contains(':')) { $chest -split ':',2 } else { @('minecraft',$chest) }
                    $texture = Export-EntityTexture "${chestNs}:entity/chest/$chestName"
                    if ($texture) { $results[$identity] = @{kind='chest';layers=@($texture)} }
                    continue
                }
                if ($request.key -eq 'minecraft:shield' -or $selected.special -eq 'shield') {
                    $texture = Export-EntityTexture 'minecraft:entity/shield_base_nopattern'
                    if (!$texture) { $texture = Export-EntityTexture 'minecraft:entity/shield_base' }
                    if ($texture) { $results[$identity] = @{kind='shield'; layers=@($texture)} }
                    continue
                }
                if (!$selected.model) { continue }
                $model = Read-Model $selected.model
                if (!$model -and !$definition) { $model = Read-BlockModel $request.key }
                $layers = @(); $kind = 'item'
                if ($model -and $model.generated) {
                    foreach ($key in @('layer0','layer1','layer2','layer3','layer4')) {
                        $ref = Texture-Ref $model.textures $key
                        if ($ref) { $texture = Export-Texture $ref; if ($texture) { $layers += $texture } else { $layers = @(); break } }
                    }
                } elseif ($model -and $model.elements.Count) {
                    $job = Export-Elements $model
                    if ($job) { $results[$identity] = $job; continue }
                }
                if (!$layers.Count -and (!$model -or !$model.elements.Count)) {
                    foreach ($folder in @('item','items')) {
                        $texture = Export-Texture "${ns}:$folder/$name"
                        if ($texture) { $layers = @($texture); break }
                    }
                }
                if ($layers.Count) { $results[$identity] = @{kind=$kind;layers=$layers} }
                elseif ($ns -eq 'gtceu') {
                    $job = Export-GregTechIcon $request.key
                    if ($job) { $results[$identity] = $job }
                }
            } catch { $failures.Add("$($request.key): $_") }
        }
    } finally { foreach ($zip in $zips.Values) { $zip.Dispose() } }
    Write-Output "Icons root $($group.Name): $($results.Count) source icons"
    $pack = $null; $assetIndex = $null; $models.Clear(); $textures.Clear(); $zips.Clear()
    [GC]::Collect()
}
$results | ConvertTo-Json -Depth 20 -Compress | Set-Content -LiteralPath (Join-Path $outputPath 'manifest.json') -Encoding utf8
ConvertTo-Json -InputObject @($failures.ToArray()) | Set-Content -LiteralPath (Join-Path $outputPath 'errors.json') -Encoding utf8
