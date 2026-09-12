$script:layerEntitySources = @{}
$script:layerEntitySourceRoot = ''
$script:layerVanillaModels = $null

function Read-LayerEntityGeometry([string]$ClassName, [string]$Method = 'auto', [object[]]$Arguments = @()) {
    Index-ExtraAssets
    if ($script:layerEntitySourceRoot -ne $root.path) {
        $script:layerEntitySourceRoot = $root.path
        $script:layerEntitySources = @{}
    }
    $entryName = $ClassName.Replace('.', '/') + '.class'
    if (!$script:layerEntitySources.ContainsKey($entryName)) {
        $script:layerEntitySources[$entryName] = $null
        foreach ($archive in $zips.GetEnumerator()) {
            if ($archive.Value.GetEntry($entryName)) {
                $script:layerEntitySources[$entryName] = $archive.Key
                break
            }
        }
    }
    $archivePath = $script:layerEntitySources[$entryName]
    if (!$archivePath) { return $null }
    $file = Get-Item -LiteralPath $archivePath
    $argumentsJson = ConvertTo-Json -InputObject @($Arguments) -Depth 8 -Compress
    $cacheIdentity = "layer-v6|$archivePath|$($file.Length)|$($file.LastWriteTimeUtc.Ticks)|$ClassName|$Method|$argumentsJson"
    $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($cacheIdentity))).ToLowerInvariant()
    $directory = [IO.Path]::GetFullPath('.local/stat-layer-models')
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $cachePath = Join-Path $directory "$hash.json"
    $errorPath = Join-Path $directory "$hash.error.txt"
    if (Test-Path -LiteralPath $errorPath) { return $null }
    if (!(Test-Path -LiteralPath $cachePath)) {
        $output = & node (Join-Path $PSScriptRoot 'stat-entity-layer.mjs') $archivePath $ClassName $Method $argumentsJson 2> $errorPath
        if ($LASTEXITCODE -ne 0) { return $null }
        Remove-Item -LiteralPath $errorPath -ErrorAction SilentlyContinue
        $geometry = ($output -join [Environment]::NewLine) | ConvertFrom-Json -AsHashtable
        if (!$geometry.bones) { return $null }
        $geometry | ConvertTo-Json -Depth 24 -Compress | Set-Content -LiteralPath $cachePath -Encoding utf8
    }
    return @{
        model = Get-Content -LiteralPath $cachePath -Raw | ConvertFrom-Json -AsHashtable
        source = "$(Split-Path $archivePath -Leaf) > $entryName ($Method original geometry)"
    }
}

function Export-AetherEntityIcon([string]$Id) {
    if ($Id -cnotmatch '^(aether|ad_astra):([a-z0-9_]+)$') { return $null }
    $namespace, $name = $Id -split ':', 2
    $specifications = [Collections.Generic.List[object]]::new()
    if ($namespace -eq 'ad_astra') {
        $textures = @{
            corrupted_lunarian = 'mob/lunarian/corrupted_lunarian'
            glacian_ram = 'mob/glacian_ram/glacian_ram'
            martian_raptor = 'mob/martian_raptor'
            mogler = 'mob/mogler'
            pygro = 'mob/pygro'
            star_crawler = 'mob/star_crawler'
        }
        if (!$textures.ContainsKey($name)) { return $null }
        $modelName = ($name -split '_' | ForEach-Object { $_.Substring(0, 1).ToUpperInvariant() + $_.Substring(1) }) -join ''
        $specifications.Add(@{ class="earth.terrarium.adastra.client.models.entities.mobs.${modelName}Model"; texture="ad_astra:entity/$($textures[$name])" })
    } else {
        $prefix = 'com.aetherteam.aether.client.renderer.entity.model.'
        $simple = @{
            aechor_plant = @('AechorPlant', 'aechor_plant/aechor_plant')
            aerbunny = @('Aerbunny', 'aerbunny/aerbunny')
            aerwhale = @('Aerwhale', 'aerwhale/aerwhale')
            mimic = @('Mimic', 'mimic/normal')
            slider = @('Slider', 'slider/slider_asleep')
            sun_spirit = @('SunSpirit', 'sun_spirit/sun_spirit')
            fire_minion = @('FireMinion', 'sun_spirit/sun_spirit')
            zephyr = @('Zephyr', 'zephyr/zephyr')
        }
        if ($simple.ContainsKey($name)) {
            $modelName, $texturePath = $simple[$name]
            $specifications.Add(@{ class="${prefix}${modelName}Model"; texture="aether:entity/mobs/$texturePath" })
        } elseif ($name -in @('moa', 'cockatrice')) {
            $texturePath = if ($name -eq 'moa') { 'moa/blue_moa' } else { 'cockatrice/cockatrice' }
            $specifications.Add(@{ class="${prefix}BipedBirdModel"; arguments=@(@{inflate=@(0,0,0)}); texture="aether:entity/mobs/$texturePath" })
        } elseif ($name -in @('phyg', 'flying_cow')) {
            $vanilla = if ($name -eq 'phyg') { 'pig' } else { 'cow' }
            $wingOffset = if ($name -eq 'phyg') { 10 } else { 0 }
            $specifications.Add(@{ vanilla=$vanilla; texture="aether:entity/mobs/$name/$name" })
            $specifications.Add(@{ class="${prefix}QuadrupedWingsModel"; method='createMainLayer'; arguments=@($wingOffset); texture="aether:entity/mobs/$name/${name}_wings" })
        } elseif ($name -eq 'sheepuff') {
            $specifications.Add(@{ class="${prefix}SheepuffModel"; texture='aether:entity/mobs/sheepuff/sheepuff' })
            $specifications.Add(@{ class="${prefix}SheepuffWoolModel"; method='createFurLayer'; arguments=@(@{inflate=@(1.75,1.75,1.75)},0); texture='aether:entity/mobs/sheepuff/sheepuff_wool' })
        } elseif ($name -in @('valkyrie', 'valkyrie_queen')) {
            $specifications.Add(@{ class="${prefix}ValkyrieModel"; texture="aether:entity/mobs/$name/$name" })
            $specifications.Add(@{ class="${prefix}ValkyrieWingsModel"; method='createMainLayer'; arguments=@(4.5,2.5); texture="aether:entity/mobs/$name/$name" })
        } elseif ($name -in @('sentry', 'blue_swet', 'golden_swet')) {
            $texturePath = switch ($name) { 'sentry' { 'sentry/sentry' } 'blue_swet' { 'swet/swet_blue' } 'golden_swet' { 'swet/swet_golden' } }
            if ($name -ne 'sentry') { $specifications.Add(@{ vanilla='slime'; texture="aether:entity/mobs/$texturePath" }) }
            # AetherRenderers binds SENTRY/SWET_OUTER to SlimeModel.createOuterBodyLayer.
            $outer = @{format='java';textureWidth=64;textureHeight=32;bones=@(@{name='root';pivot=@(0,0,0);rotation=@(0,0,0);cubes=@(@{origin=@(-4,16,-4);size=@(8,8,8);uv=@(0,0)})})}
            $specifications.Add(@{ model=$outer; source='Mojang SlimeModel.createOuterBodyLayer'; texture="aether:entity/mobs/$texturePath" })
        } else { return $null }
    }

    $layers = [Collections.Generic.List[object]]::new()
    $parts = [Collections.Generic.List[object]]::new()
    foreach ($specification in $specifications) {
        $texture = Export-Texture $specification.texture
        if (!$texture) { return $null }
        if ($specification.class) {
            $method = if ($specification.method) { $specification.method } else { 'createBodyLayer' }
            $geometry = Read-LayerEntityGeometry $specification.class $method @($specification.arguments)
        } elseif ($specification.vanilla) {
            if (!$script:layerVanillaModels) {
                $script:layerVanillaModels = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'resources/stat-vanilla-entities.json') -Raw | ConvertFrom-Json -AsHashtable
            }
            $geometry = $script:layerVanillaModels[$specification.vanilla]
        } else { $geometry = $specification }
        if (!$geometry -or !$geometry.model.bones) { return $null }
        if ($Id -eq 'aether:aerbunny') {
            # AerbunnyModel.renderToBuffer translates the separate puff by one block.
            foreach ($bone in $geometry.model.bones) {
                if ($bone.name -eq 'root/puff') { $bone.pivot[1] += 16 }
                if ($bone.name -match 'root/body/(?:right|left)_(?:front|back)_leg$') { $bone.rotation[0] = -[Math]::PI / 2 }
            }
        }
        if ($Id -eq 'aether:aechor_plant') {
            # Original AechorPlantModel.setupAnim at age zero, idle and unhurt.
            foreach ($bone in $geometry.model.bones) {
                if ($bone.name -eq 'root/stem') { $bone.pivot[1] = 0.875 }
                if ($bone.name -eq 'root/head') { $bone.pivot[1] = 1.75 }
                if ($bone.name -match '/stamen_stem_(\d+)$') {
                    $index = [int]$Matches[1] - 1
                    $bone.rotation[0] = 0.2 + $index / 15
                    $bone.rotation[1] = 0.1 + 2.0943952 * $index
                    $bone.pivot[1] = 1.75
                } elseif ($bone.name -match '/leaf_(\d+)$') {
                    $index = [int]$Matches[1] - 1
                    $bone.rotation[0] = if ($index % 2 -eq 0) { 0.1 } else { 0.2 }
                    $bone.rotation[1] = 0.31415927 + 0.62831855 * $index
                    $bone.pivot[1] = 1.75
                } elseif ($bone.name -match '/(upper|lower)_petal_(\d+)$') {
                    $index = 2 * ([int]$Matches[2] - 1) + [int]($Matches[1] -eq 'lower')
                    $bone.rotation[0] = if ($index % 2 -eq 0) { -0.25 } else { -0.4125 }
                    $bone.rotation[1] = 0.62831855 * $index
                    $bone.pivot[1] = 1.75
                }
            }
        }
        if ($specification.class -like '*QuadrupedWingsModel') {
            # Original setupAnim: grounded wings, stable fold=0.1 and angle=0.
            $inner = [Math]::Acos(0.1) - [Math]::PI / 2
            $outer = -[Math]::Acos(0.1) - [Math]::PI / 2 - $inner
            foreach ($bone in $geometry.model.bones) {
                if ($bone.name -match '/(left|right)_wing_(inner|outer)$') {
                    $angle = if ($Matches[2] -eq 'inner') { $inner } else { $outer }
                    $bone.rotation[2] = if ($Matches[1] -eq 'left') { $angle } else { -$angle }
                }
            }
        }
        if ($specification.class -like '*ValkyrieWingsModel') {
            # ValkyrieWingsLayer.setupWingRotation at age zero, on the ground.
            foreach ($bone in $geometry.model.bones) {
                if ($bone.name -match '/(left|right)_wing$') {
                    $bone.rotation[1] = if ($Matches[1] -eq 'left') { -0.2 } else { 0.2 }
                    $bone.rotation[2] = 0
                }
            }
        }
        $texture = @{} + $texture
        $texture.source += " + $($geometry.source)"
        $parts.Add(@{ entityModel=$geometry.model; layer=$layers.Count })
        $layers.Add($texture)
    }
    if ($parts.Count -eq 1) { return @{kind='model';entityModel=$parts[0].entityModel;layers=$layers.ToArray()} }
    return @{kind='model';entityParts=$parts.ToArray();layers=$layers.ToArray()}
}
