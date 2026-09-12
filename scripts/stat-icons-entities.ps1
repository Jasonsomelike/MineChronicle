$script:vanillaEntities = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'resources/stat-vanilla-entities.json') -Raw | ConvertFrom-Json -AsHashtable
. (Join-Path $PSScriptRoot 'stat-icons-alex.ps1')
. (Join-Path $PSScriptRoot 'stat-icons-aether.ps1')
$script:geometryResourceRoot = ''
$script:geometryResourceIndex = @{}
$script:discoveredEntityBindings = if (Test-Path -LiteralPath '.local/stat-discovered-bindings.json') {
    Get-Content -LiteralPath '.local/stat-discovered-bindings.json' -Raw | ConvertFrom-Json -AsHashtable
} else { @{} }

function Get-DiscoveredEntityBindings([string]$Id) {
    return @($script:discoveredEntityBindings["$($root.id)|$Id"])
}

function Export-BoundGeometryEntityIcon([string]$Id) {
    Index-ExtraAssets
    foreach ($binding in (Get-DiscoveredEntityBindings $Id)) {
        if (!$binding) { continue }
        $geometryPaths = @($binding.references + $binding.matching_geometry | Where-Object { $_ -match '\.geo\.json$' } | Select-Object -Unique)
        $texturePaths = @($binding.references | Where-Object {
            $_ -match '/textures/(?:entity|entities|models?)/.*\.png$' -and $_ -notmatch '(?:_eyes|_glow|_crack|_overlay|_layer)\d*\.png$'
        } | Sort-Object)
        if ($geometryPaths.Count -ne 1 -or !$texturePaths.Count) { continue }
        $document = Read-JsonAsset $geometryPaths[0]
        $geometry = @($document.'minecraft:geometry')[0]
        if (!$geometry.bones) { continue }
        $texturePath = $texturePaths[0]
        $texture = Export-Texture '' $texturePath
        if (!$texture) { continue }
        $ref = $assetIndex[$geometryPaths[0]]
        return New-EntityIcon @{
            format='bedrock'; textureWidth=$geometry.description.texture_width
            textureHeight=$geometry.description.texture_height; bones=$geometry.bones
        } $texture "$(Split-Path $ref[0] -Leaf) > $($geometryPaths[0]) (model resource binding)"
    }
    return $null
}

function Get-GeometryResourceIndex {
    Index-ExtraAssets
    if ($script:geometryResourceRoot -eq $root.path) { return $script:geometryResourceIndex }
    $script:geometryResourceRoot = $root.path
    $script:geometryResourceIndex = @{models=@{}; textures=@{}}
    foreach ($asset in $assetIndex.Keys) {
        if ($asset -cmatch '^assets/([^/]+)/geo/.+\.json$') {
            $namespace = $Matches[1]
            $stem = ([IO.Path]::GetFileName($asset) -replace '(?:\.geo)?\.json$','' -replace '_','').ToLowerInvariant()
            $key = "${namespace}:$stem"
            $script:geometryResourceIndex.models[$key] = @($script:geometryResourceIndex.models[$key]) + $asset
        } elseif ($asset -cmatch '^assets/([^/]+)/textures/(?!items?/|blocks?/|gui/).+\.png$') {
            $namespace = $Matches[1]
            $filename = [IO.Path]::GetFileNameWithoutExtension($asset)
            $stem = ($filename -replace '_','').ToLowerInvariant()
            $key = "${namespace}:$stem"
            $script:geometryResourceIndex.textures[$key] = @($script:geometryResourceIndex.textures[$key]) + $asset
            # A numbered skin belongs to this exact entity, not another species.
            # Statistics contain no variant, so the lowest numbered skin is a
            # stable representative when no unnumbered skin exists.
            if ($filename -match '^(.+)_\d+$') {
                $base = ($Matches[1] -replace '_','').ToLowerInvariant()
                $baseKey = "${namespace}:$base"
                $script:geometryResourceIndex.textures[$baseKey] = @($script:geometryResourceIndex.textures[$baseKey]) + $asset
            }
        }
    }
    return $script:geometryResourceIndex
}

function New-EntityIcon($Geometry, $Texture, [string]$Source) {
    if (!$Geometry.bones -or !$Texture) { return $null }
    $textureCopy = @{} + $Texture
    $textureCopy.source += " + $Source"
    return @{kind='model'; entityModel=$Geometry; layers=@($textureCopy)}
}

function Get-VanillaTextureGeometry($Geometry, $Texture) {
    $geometryCopy = @{} + $Geometry
    $bytes = [IO.File]::ReadAllBytes((Join-Path $outputPath $Texture.file))
    $widthBytes = [byte[]]$bytes[16..19]; [Array]::Reverse($widthBytes)
    $heightBytes = [byte[]]$bytes[20..23]; [Array]::Reverse($heightBytes)
    $width = [BitConverter]::ToInt32($widthBytes)
    $height = [BitConverter]::ToInt32($heightBytes)
    $geometryCopy.textureHeight = [int]($geometryCopy.textureWidth * $height / $width)
    return $geometryCopy
}

function Export-VanillaEntityIcon([string]$Id) {
    if ($Id -cnotmatch '^minecraft:([a-z0-9_]+)$') { return $null }
    $name = $Matches[1]
    $entry = $script:vanillaEntities[$name]
    if (!$entry) { return $null }
    if ($name -eq 'villager') {
        # Profession textures are overlays, not full skins. Render the vanilla
        # base plus a plains type; statistics do not retain a profession/biome.
        $base = Export-Texture 'minecraft:entity/villager/villager'
        if (!$base) { $base = Export-Texture 'minecraft:entity/villager/farmer' }
        if (!$base) { return $null }
        $geometry = Get-VanillaTextureGeometry $entry.model $base
        $icon = New-EntityIcon $geometry $base $entry.source
        $clothes = Export-Texture 'minecraft:entity/villager/type/plains'
        if (!$clothes) { return $icon }
        return @{kind='model';layers=@($icon.layers[0],$clothes);entityParts=@(
            @{entityModel=$geometry;layer=0},@{entityModel=$geometry;layer=1}
        )}
    }
    if ($entry.parts) {
        $parts = @(); $layers = @()
        foreach ($part in $entry.parts) {
            $partTexture = Export-Texture $part.texture
            if (!$partTexture) { return $null }
            $partTexture = @{} + $partTexture
            $partTexture.source += " + $($entry.source)"
            $parts += @{entityModel=(Get-VanillaTextureGeometry $part.model $partTexture); layer=$layers.Count}
            $layers += $partTexture
        }
        return @{kind='model'; entityParts=$parts; layers=$layers}
    }
    $texture = Export-Texture $entry.texture
    if (!$texture) {
        $alternates = @{
            pig = @('entity/pig/temperate_pig','entity/pig/pig_temperate'); cow = @('entity/cow/temperate_cow','entity/cow/cow_temperate');
            chicken = @('entity/chicken/temperate_chicken','entity/chicken/chicken_temperate'); wolf = @('entity/wolf/wolf_pale');
            mooshroom = @('entity/cow/mooshroom_red');
            armadillo = @('entity/armadillo'); snow_golem = @('entity/snow_golem');
            zombified_piglin = @('entity/piglin/zombified_piglin');
            rabbit = @('entity/rabbit/brown'); horse = @('entity/horse/horse_brown');
            villager = @('entity/villager/villager'); frog = @('entity/frog/temperate_frog');
            zombie_villager = @('entity/zombie_villager/zombie_villager','entity/zombie_villager');
            ocelot = @('entity/cat/ocelot','entity/ocelot');
            axolotl = @('entity/axolotl/axolotl_lucy'); tropical_fish = @('entity/fish/tropical_a');
            squid = @('entity/squid/squid'); glow_squid = @('entity/squid/glow_squid');
            guardian = @('entity/guardian/guardian'); elder_guardian = @('entity/guardian/guardian_elder');
            player = @('entity/player/wide/steve'); parched = @('entity/skeleton/parched');
        }
        foreach ($path in $alternates[$name]) {
            $texture = Export-Texture "minecraft:$path"
            if ($texture) { break }
        }
    }
    if (!$texture) { return $null }
    # Old geometry uses the upper part of modern expanded skins. Use real PNG
    # dimensions so those original UV pixel coordinates still select that part.
    $selectedGeometry = $entry.model
    if ($name -in @('horse','donkey','mule') -and $entry.modernModel) {
        $png = [IO.File]::ReadAllBytes((Join-Path $outputPath $texture.file))
        $width = [int]([uint32]$png[16]*16777216 + [uint32]$png[17]*65536 + [uint32]$png[18]*256 + $png[19])
        $height = [int]([uint32]$png[20]*16777216 + [uint32]$png[21]*65536 + [uint32]$png[22]*256 + $png[23])
        if ($width -eq 64 -and $height -eq 64) { $selectedGeometry = $entry.modernModel }
    }
    $geometry = Get-VanillaTextureGeometry $selectedGeometry $texture
    return New-EntityIcon $geometry $texture $entry.source
}

function Export-GeometryEntityIcon([string]$Id) {
    if ($Id -cnotmatch '^([a-z0-9_.-]+):([a-zA-Z0-9_/-]+)$') { return $null }
    $namespace, $name = $Id -split ':', 2
    $index = Get-GeometryResourceIndex
    $stem = ($name -replace '_','').ToLowerInvariant()
    $modelPaths = @($index.models["${namespace}:$stem"] | Where-Object { $_ } | Sort-Object Length, {$_})
    # These installed Age of Mythology classes inherit AbstractBossEntityModel,
    # or explicitly bind its geometry. Preserve each entity's own texture.
    if ($namespace -eq 'ageofmythology' -and $name -in @('end_scholar','good_evil','hell_traveler','ice_thunder_soul','lost_one','sculk_shrieker','shadow_demon')) {
        $modelPaths = @('assets/ageofmythology/geo/abstract_boss.geo.json')
    }
    foreach ($modelPath in $modelPaths) {
        $document = Read-JsonAsset $modelPath
        $geometries = @($document.'minecraft:geometry')
        if (!$geometries.Count -or !$geometries[0].bones) { continue }
        $geometry = $geometries[0]
        # Verified against the installed mod bytecode. CrabModel explicitly uses
        # blue_crab as its fallback. KoiFishModel.TEXTURES[0] is koi_fish_1;
        # the archive's statistics cannot distinguish its 21 color variants.
        $knownSkin = @{
            'crabbersdelight:crab' = 'assets/crabbersdelight/textures/entity/blue_crab.png'
            'crittersandcompanions:koi_fish' = 'assets/crittersandcompanions/textures/entity/koi_fish_1.png'
        }[$Id]
        $texturePaths = @(if ($knownSkin -and $assetIndex.ContainsKey($knownSkin)) { $knownSkin } else {
            @($index.textures["${namespace}:$stem"] | Where-Object { $_ } | Sort-Object @{Expression={$_ -notmatch '/entit(?:y|ies)/'}}, @{Expression={
                $filename=[IO.Path]::GetFileNameWithoutExtension($_)
                if ($filename -match '_(\d+)$') {[int]$Matches[1]} else {-1}
            }}, Length, {$_})
        })
        if (!$texturePaths.Count) { continue }
        $textureId = $texturePaths[0].Substring("assets/$namespace/textures/".Length) -replace '\.png$',''
        $texture = Export-Texture "${namespace}:$textureId"
        $ref = $assetIndex[$modelPath]
        return New-EntityIcon @{
            format='bedrock'; textureWidth=$geometry.description.texture_width;
            textureHeight=$geometry.description.texture_height; bones=$geometry.bones
        } $texture "$(Split-Path $ref[0] -Leaf) > $modelPath"
    }
    return $null
}

function Export-EntityIcon([string]$Id) {
    # Ars Nouveau ClientHandler registers the vanilla renderers for these
    # summons. Their statistic IDs differ; their geometry and skins do not.
    $vanillaSummon = @{
        'ars_nouveau:ally_vex'='vex'
        'ars_nouveau:summon_wolf'='wolf'
        'ars_nouveau:summon_horse'='horse'
    }[$Id]
    if ($vanillaSummon) { return Export-VanillaEntityIcon "minecraft:$vanillaSummon" }
    $icon = Export-VanillaEntityIcon $Id
    if ($icon) { return $icon }
    $icon = Export-BoundGeometryEntityIcon $Id
    if ($icon) { return $icon }
    $icon = Export-AlexEntityIcon $Id
    if ($icon) { return $icon }
    $icon = Export-AetherEntityIcon $Id
    if ($icon) { return $icon }
    $icon = Export-GeometryEntityIcon $Id
    if ($icon) { return $icon }
    return $null
}
