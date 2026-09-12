# GTCEu creates these models at runtime. Read its installed registrations without
# loading mod classes or launching Minecraft, then reuse that pack's PNGs/models.
$script:gregTechContexts = @{}
$script:gregTechRootContexts = @{}

function Read-GregTechClass([string]$Jar, [string]$Class) {
    $javap = Get-Command javap -ErrorAction SilentlyContinue
    if (!$javap) { return '' }
    $text = & $javap.Source -c -p -classpath $Jar $Class 2>$null
    if ($LASTEXITCODE -ne 0) { return '' }
    return $text -join "`n"
}

function Read-GregTechInteger([string]$Line) {
    if ($Line -match '// int (-?\d+)') { return [int]$Matches[1] }
    if ($Line -match ':\s+(?:bi|si)push\s+(-?\d+)') { return [int]$Matches[1] }
    if ($Line -match ':\s+iconst_(\d)') { return [int]$Matches[1] }
    if ($Line -match ':\s+iconst_m1') { return -1 }
    return $null
}

function Initialize-GregTechNestedAssets {
    $candidates=@($assetIndex.GetEnumerator() | Where-Object { $_.Key.StartsWith('assets/gtceu/') -and $_.Value[1] } | ForEach-Object {$_.Value[0]} | Sort-Object -Unique)
    foreach($candidate in $candidates) {
        if (!$zips.ContainsKey($candidate)) {$zips[$candidate]=[IO.Compression.ZipFile]::OpenRead($candidate)}
        foreach($entry in @($zips[$candidate].Entries | Where-Object {$_.FullName -match '^META-INF/jarjar/.*(?:GregTech-Modern|gtceu).*\.jar$'})) {
            if ($entry.Length -gt 150MB) {continue}
            $hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes("$candidate|$($entry.FullName)|$($entry.Length)|$($entry.LastWriteTime.Ticks)"))).ToLowerInvariant()
            $dir=Join-Path $outputPath $hash
            [IO.Directory]::CreateDirectory($dir) | Out-Null
            $target=Join-Path $dir ([IO.Path]::GetFileName($entry.FullName))
            if (!(Test-Path -LiteralPath $target)) {
                $source=$entry.Open(); $destination=[IO.File]::Create($target)
                try {$source.CopyTo($destination)} finally {$source.Dispose();$destination.Dispose()}
            }
            if (!$zips.ContainsKey($target)) {$zips[$target]=[IO.Compression.ZipFile]::OpenRead($target)}
            foreach($asset in $zips[$target].Entries) {
                if ($asset.FullName.StartsWith('assets/') -and !$assetIndex.ContainsKey($asset.FullName)) {$assetIndex[$asset.FullName]=@($target,$asset.FullName)}
            }
        }
    }
}

function Get-GregTechContext {
    $rootKey = [string]$root.id
    if ($script:gregTechRootContexts.ContainsKey($rootKey)) { return $script:gregTechRootContexts[$rootKey] }
    $ref = $assetIndex['assets/gtceu/models/item/material_sets/dull/dust.json']
    if (!$ref) {
        Initialize-GregTechNestedAssets
        $ref=$assetIndex['assets/gtceu/models/item/material_sets/dull/dust.json']
    }
    if (!$ref -or !$ref[1]) { $script:gregTechRootContexts[$rootKey] = $null; return $null }
    $jar = [string]$ref[0]
    if (!$script:gregTechContexts.ContainsKey($jar)) {
        $file = Get-Item -LiteralPath $jar
        $signature = "$($file.FullName)|$($file.Length)|$($file.LastWriteTimeUtc.Ticks)|5"
        $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($signature))).ToLowerInvariant()
        $cache = Join-Path $outputPath "gregtech-$hash.json"
        $context = if (Test-Path -LiteralPath $cache) { Get-Content -LiteralPath $cache -Raw | ConvertFrom-Json -AsHashtable } else { $null }
        if (!$context) {
            $context = @{materials=@{}; iconParents=@{}; secondary=$false; jar=(Split-Path $jar -Leaf)}
            $materialClass = Read-GregTechClass $jar 'com.gregtechceu.gtceu.api.data.chemical.material.Material'
            $context.secondary = $materialClass.Contains('getLayerARGB')
            $materialFields=@{}
            foreach ($class in @('ElementMaterials','FirstDegreeMaterials','SecondDegreeMaterials','HigherDegreeMaterials','OrganicChemistryMaterials','UnknownCompositionMaterials','GCyMMaterials')) {
                $text = Read-GregTechClass $jar "com.gregtechceu.gtceu.common.data.materials.$class"
                $blocks = [regex]::Matches($text, '(?ms)^\s+\d+: new[^\n]+// class [^\n]+/Material\$Builder\n(?<body>.*?)^\s+\d+: putstatic[^\n]+/GTMaterials\.(?<field>\w+):')
                foreach ($block in $blocks) {
                    $body = $block.Groups['body'].Value
                    $name = [regex]::Match($body, '// String ([a-z0-9_]+)\n').Groups[1].Value
                    if (!$name) { continue }
                    $materialFields[$block.Groups['field'].Value]=$name
                    $material = @{color=0xFFFFFF; secondary=$null; icon='dull'; source="$($context.jar) > $class.$($block.Groups['field'].Value)"}
                    if ($body -match 'Material\$Builder\.gem:') { $material.icon = 'gem_vertical' }
                    if ($body -match 'MaterialIconSet\.([A-Z_]+):') { $material.icon = $Matches[1].ToLowerInvariant() }
                    $lines = $body -split "`n"
                    for ($i=1; $i -lt $lines.Length; $i++) {
                        if ($lines[$i] -match 'Material\$Builder\.(color|secondaryColor):\(I') {
                            $kind = $Matches[1]
                            $offset = if ($lines[$i].Contains('(IZ)')) { 2 } else { 1 }
                            $value = Read-GregTechInteger $lines[$i-$offset]
                            if ($null -ne $value) { $material[$(if ($kind -eq 'color') {'color'} else {'secondary'})] = $value -band 0xFFFFFF }
                            elseif ($kind -eq 'color' -and $i -gt 1 -and $lines[$i-1] -match 'Material\.getMaterial(?:A)?RGB:' -and $lines[$i-2] -match '/GTMaterials\.(\w+):') {
                                $material.colorFrom=$Matches[1]
                            }
                        }
                    }
                    if ($body.Contains('colorAverage:') -and $material.color -eq 0xFFFFFF) { continue }
                    $context.materials[$name] = $material
                }
            }
            for ($pass=0;$pass -lt 3;$pass++) {
                foreach ($material in $context.materials.Values) {
                    if ($material.colorFrom -and $materialFields.ContainsKey($material.colorFrom)) {
                        $other=$context.materials[$materialFields[$material.colorFrom]]
                        if ($other) {$material.color=$other.color}
                    }
                }
            }
            $sets = Read-GregTechClass $jar 'com.gregtechceu.gtceu.api.data.chemical.material.info.MaterialIconSet'
            foreach ($block in [regex]::Matches($sets, '(?ms)// String ([a-z_]+)\n(.*?)putstatic[^\n]+Field ([A-Z_]+):')) {
                $name = $block.Groups[1].Value
                $parent = if ($block.Groups[2].Value -match 'getstatic[^\n]+Field ([A-Z_]+):') { $Matches[1].ToLowerInvariant() } elseif ($name -ne 'dull') { 'dull' } else { '' }
                $context.iconParents[$name] = $parent
            }
            $context | ConvertTo-Json -Depth 6 -Compress | Set-Content -LiteralPath $cache -Encoding utf8
        }
        $script:gregTechContexts[$jar] = $context
    }
    $script:gregTechRootContexts[$rootKey] = $script:gregTechContexts[$jar]
    return $script:gregTechRootContexts[$rootKey]
}

function Export-GregTechTexture([string]$Id, $Tint, [string]$Source = '') {
    $texture = Export-Texture $Id
    if (!$texture) { return $null }
    $copy = @{} + $texture
    if ($null -ne $Tint -and $Tint -ne 0xFFFFFF) { $copy.tint = [int]$Tint }
    if ($Source) { $copy.source += " + $Source" }
    return $copy
}

function Read-GregTechMaterialModel($Context, $Material, [string]$Type, [string]$Folder = 'item') {
    $icon = $Material.icon
    for ($i=0; $i -lt 15 -and $icon; $i++) {
        $model = Read-Model "gtceu:${Folder}/material_sets/$icon/$Type"
        if ($model) { return $model }
        $icon = $Context.iconParents[$icon]
    }
    return $null
}

function Export-GregTechLayers($Context, $Material, $Model, [bool]$Tool = $false) {
    if (!$Model -or !$Model.generated) { return $null }
    $layers = @()
    for ($i=0; $i -lt 5; $i++) {
        $ref = Texture-Ref $Model.textures "layer$i"
        if (!$ref) { continue }
        $tint = $null
        $colorIndex = if ($Tool) { $i - 1 } else { $i }
        if ($colorIndex -eq 0) { $tint = $Material.color }
        elseif ($colorIndex -eq 1 -and $Context.secondary) { $tint = if ($null -ne $Material.secondary) { $Material.secondary } else { $Material.color } }
        $texture = Export-GregTechTexture $ref $tint $Material.source
        if (!$texture) { return $null }
        $layers += $texture
    }
    if (!$layers.Count) { return $null }
    return @{kind='item'; layers=$layers}
}

function New-GregTechCuboid($From, $To, $Textures, $FaceTextures, $Display = $null) {
    $faces = @{}
    foreach ($side in @('north','south','east','west','up','down')) {
        $texture = if ($FaceTextures.ContainsKey($side)) { $FaceTextures[$side] } else { $FaceTextures.side }
        if (!$texture -or !$Textures.ContainsKey($texture)) { return $null }
        $faces[$side] = @{texture=$texture; uv=@(0,0,16,16)}
    }
    if (!$Display) { $Display=@{rotation=@(30,225,0);translation=@(0,0,0);scale=@(0.625,0.625,0.625)} }
    return @{kind='model';textures=$Textures;layers=@($Textures.Values);elements=@(@{from=$From;to=$To;faces=$faces});display=$Display}
}

function Export-GregTechPipe($Context, [string]$Name) {
    if ($Name -notmatch '^(.+)_(tiny|small|normal|large|huge|quadruple|nonuple)_(fluid|item)_pipe$') { return $null }
    $material = $Context.materials[$Matches[1]]; $size=$Matches[2]; $type=$Matches[3]
    if (!$material) { return $null }
    $wood = if ($material.icon -eq 'wood') { '_wood' } else { '' }
    $side = Export-GregTechTexture "gtceu:block/pipe/pipe_side$wood" $material.color $material.source
    $end = Export-GregTechTexture "gtceu:block/pipe/pipe_${size}_in$wood" $material.color $material.source
    if (!$side -or !$end) { return $null }
    $diameter = @{tiny=4;small=6;normal=8;large=12;huge=14;quadruple=15.2;nonuple=15.2}[$size]
    # PipeModel uses NORTH + SOUTH connections (mask 12) for inventory rendering.
    $low = (16-$diameter)/2; $high=16-$low
    return New-GregTechCuboid @($low,$low,0) @($high,$high,16) @{side=$side;end=$end} @{side='side';north='end';south='end'}
}

function Export-GregTechWire($Context, [string]$Name) {
    if ($Name -notmatch '^(.+)_(single|double|quadruple|octal|hex)_(wire|cable)$') { return $null }
    $material=$Context.materials[$Matches[1]]; $size=$Matches[2]; $type=$Matches[3]
    if (!$material) { return $null }
    $icon = $material.icon; $side=$null; $end=$null
    for ($i=0; $i -lt 15 -and $icon; $i++) {
        $side = Export-GregTechTexture "gtceu:block/material_sets/$icon/wire" $material.color $material.source
        if (!$side) { $side = Export-GregTechTexture "gtceu:block/material_sets/$icon/wire_side" $material.color $material.source }
        if ($side) {
            $end = Export-GregTechTexture "gtceu:block/material_sets/$icon/wire_end" $material.color $material.source
            if (!$end) { $end=$side }
            break
        }
        $icon=$Context.iconParents[$icon]
    }
    if (!$side) { return $null }
    $diameter = @{single=2;double=4;quadruple=6;octal=8;hex=12}[$size]
    if ($type -eq 'cable') {
        $insulation=@{single=1;double=2;quadruple=3;octal=4;hex=5}[$size]
        $cover=Export-GregTechTexture "gtceu:block/cable/insulation_$insulation" $null
        if (!$cover) { return $null }
        $side=$cover; $diameter+=2
    }
    $low=(16-$diameter)/2; $high=16-$low
    return New-GregTechCuboid @($low,$low,0) @($high,$high,16) @{side=$side;end=$end} @{side='side';north='end';south='end'}
}

function Export-GregTechModel($Model, $Tint = $null, [string]$Source = '') {
    if (!$Model -or !$Model.elements.Count) { return $null }
    $job=Export-Elements $Model
    if (!$job) { return $null }
    if ($null -ne $Tint) {
        $colorMap=if ($Tint -is [Collections.IDictionary]) {$Tint} else {@{1=[int]$Tint}}
        foreach ($element in $job.elements) {
            foreach($face in $element.faces.Values) {
                if (!$face.ContainsKey('tintindex') -or !$colorMap.ContainsKey([int]$face.tintindex)) {continue}
                $tintValue=$colorMap[[int]$face.tintindex]
                $key=$face.texture
                $coloredKey="$key-tint-$tintValue"
                if (!$job.textures.ContainsKey($coloredKey)) {
                    $copy=@{}+$job.textures[$key]
                    $copy.tint=[int]$tintValue
                    if ($Source) {$copy.source+=" + $Source"}
                    $job.textures[$coloredKey]=$copy
                }
                $face.texture=$coloredKey
            }
        }
        $job.layers=@($job.textures.Values)
    }
    return $job
}

function Read-GregTechInlineModel($Definition) {
    if ($Definition -is [string]) {return Read-Model $Definition}
    if (!$Definition) {return $null}
    $parent=if ($Definition.parent) {Read-Model $Definition.parent} else {$null}
    $model=if ($parent) {@{}+$parent} else {@{textures=@{};elements=@();display=@{}}}
    $model.textures=if ($parent) {@{}+$parent.textures} else {@{}}
    if ($Definition.textures) {foreach($key in $Definition.textures.Keys) {$model.textures[$key]=$Definition.textures[$key]}}
    if ($Definition.ContainsKey('elements')) {$model.elements=$Definition.elements}
    if ($Definition.display) {$model.display=$Definition.display}
    return $model
}

function Add-GregTechOverlay($Job, [string]$Folder) {
    $overlayFaces=@{north='front';south='back';east='side';west='side';up='top';down='bottom'}
    $faces=@{}
    foreach ($face in $overlayFaces.Keys) {
        $ref="gtceu:$Folder/overlay_$($overlayFaces[$face])"
        $texture=Export-GregTechTexture $ref $null
        if (!$texture) { continue }
        $Job.textures[$ref]=$texture
        $faces[$face]=@{texture=$ref;uv=@(0,0,16,16)}
    }
    if (!$faces.Count) { return $null }
    $Job.elements+=@{from=@(-0.01,-0.01,-0.01);to=@(16.01,16.01,16.01);faces=$faces}
    $Job.layers=@($Job.textures.Values)
    return $Job
}

function Export-GregTechMachine($Context, [string]$Name) {
    $definition=Read-JsonAsset "assets/gtceu/models/block/machine/$Name.json"
    if ($definition -and $definition.loader -eq 'gtceu:machine') {
        $variant=if ($definition.variants) {$definition.variants.Values | Select-Object -First 1} elseif ($definition.multipart) {
            $entry=$definition.multipart | Where-Object {!$_.when -or $_.when.recipe_logic_status -eq 'idle'} | Select-Object -First 1
            $entry.apply
        } else {$null}
        $model=Read-GregTechInlineModel $variant.model
        $tint=$null; $source=''
        if ($Name -match '^(.+)_(drum|crate)$') {
            $material=$Context.materials[$Matches[1]]
            if ($material -and $material.icon -ne 'wood') {$tint=$material.color; $source=$material.source}
        }
        $job=Export-GregTechModel $model $tint $source
        if ($job) {return $job}
    }
    $tier=''; $machine=$Name; $steam=$false
    if ($Name -match '^(ulv|lv|mv|hv|ev|iv|luv|zpm|uv|uhv|uev|uiv|uxv|opv|max)_(.+)$') {
        $tier=$Matches[1]; $machine=$Matches[2]
    } elseif ($Name -match '^(lp|hp)_steam_(.+)$') {
        $tier=if ($Matches[1] -eq 'lp') {'bricked_bronze'} else {'bricked_steel'}
        $machine=$Matches[2]; $steam=$true
    }
    if ($tier) {
        $casing=if ($steam) {"gtceu:block/casings/steam/$tier"} else {"gtceu:block/casings/voltage/$tier"}
        $hull=Read-Model 'gtceu:block/machine/hull_machine'
        if (!$hull) { return $null }
        $model=@{}+$hull; $model.textures=@{}+$hull.textures
        foreach ($face in @('side','top','bottom')) {$model.textures[$face]="$casing/$face"}
        $job=Export-GregTechModel $model
        if (!$job) { return $null }
        if ($machine -eq 'machine_casing') { return $job }
        $part=@{
            machine_hull='hull'; input_bus='item_bus.import'; output_bus='item_bus.export'
            input_hatch='fluid_hatch.import'; output_hatch='fluid_hatch.export'
            energy_input_hatch='energy_hatch.input'; energy_output_hatch='energy_hatch.output'
            muffler_hatch='muffler_hatch'; neutron_accelerator='neutron_accelerator'
        }[$machine]
        if ($part) {
            $overlay=Export-GregTechModel (Read-Model "gtceu:block/machine/part/$part")
            if (!$overlay) { return $null }
            $job.elements+=$overlay.elements
            foreach($key in $overlay.textures.Keys) {$job.textures[$key]=$overlay.textures[$key]}
            $job.layers=@($job.textures.Values)
            return $job
        }
        $folder="block/machines/$machine"
        if ($steam -and $machine -match '^(solid|liquid|solar)_boiler$') {
            $boiler=@{solid='coal';liquid='lava';solar='solar'}[$Matches[1]]
            $folder="block/generators/boiler/$boiler"
        }
        return Add-GregTechOverlay $job $folder
    }
    if ($Name -match '^(.+)_(drum|crate)$') {
        $material=$Context.materials[$Matches[1]]; $kind=$Matches[2]
        if ($material) {
            $base=if ($material.icon -eq 'wood') {'wooden'} else {'metal'}
            $modelPath=if ($kind -eq 'crate') {"gtceu:block/machine/crate/${base}_crate"} else {"gtceu:block/machine/${base}_drum"}
            $tint=if ($base -eq 'metal') {$material.color} else {$null}
            return Export-GregTechModel (Read-Model $modelPath) $tint $material.source
        }
    }
    $casings=@{
        bronze_machine_casing='steam/bronze'; steam_machine_casing='steam/steel'
        bronze_brick_casing='solid/machine_casing_bronze_plated_bricks'
        bronze_firebox_casing='firebox/machine_casing_firebox_bronze'
        bronze_gearbox='gearbox/machine_casing_gearbox_bronze'; bronze_pipe_casing='pipe/machine_casing_pipe_bronze'
        steel_firebox_casing='firebox/machine_casing_firebox_steel'
        steel_gearbox='gearbox/machine_casing_gearbox_steel'; steel_pipe_casing='pipe/machine_casing_pipe_steel'
        coke_oven_bricks='solid/machine_coke_bricks'; firebricks='solid/machine_primitive_bricks'
        heatproof_machine_casing='solid/machine_casing_heatproof'; solid_machine_casing='solid/machine_casing_solid_steel'
        clean_machine_casing='solid/machine_casing_clean_stainless_steel'
        stable_machine_casing='solid/machine_casing_stable_titanium'
        robust_machine_casing='solid/machine_casing_robust_tungstensteel'
    }
    $multiblocks=@{
        coke_oven=@('solid/machine_coke_bricks','block/multiblock/coke_oven')
        primitive_blast_furnace=@('solid/machine_primitive_bricks','block/multiblock/primitive_blast_furnace')
        electric_blast_furnace=@('solid/machine_casing_heatproof','block/multiblock/electric_blast_furnace')
        bronze_large_boiler=@('solid/machine_casing_bronze_plated_bricks','block/multiblock/generator/large_bronze_boiler')
    }
    $casing=$casings[$Name]
    if ($multiblocks.ContainsKey($Name)) {$casing=$multiblocks[$Name][0]}
    if ($casing) {
        $base="gtceu:block/casings/$casing"
        $side=Export-GregTechTexture $base $null
        if (!$side) {$side=Export-GregTechTexture "$base/side" $null}
        if (!$side) {return $null}
        $top=Export-GregTechTexture "$base/top" $null
        $bottom=Export-GregTechTexture "$base/bottom" $null
        if (!$top) {$top=$side}; if (!$bottom) {$bottom=$side}
        $job=New-GregTechCuboid @(0,0,0) @(16,16,16) @{side=$side;top=$top;bottom=$bottom} @{side='side';up='top';down='bottom'}
        if ($multiblocks.ContainsKey($Name)) { return Add-GregTechOverlay $job $multiblocks[$Name][1] }
        return $job
    }
    if ($Name -eq 'coke_oven_hatch') {return Export-GregTechModel (Read-Model 'gtceu:block/machine/part/coke_oven_hatch')}
    return $null
}

function Export-GregTechOre($Context, [string]$Name) {
    if ($Name -notmatch '^(?:(deepslate|netherrack|endstone|granite|diorite|andesite|basalt|marble|red_granite)_)?(.+)_ore$') {return $null}
    $stone=$Matches[1]; $material=$Context.materials[$Matches[2]]
    if (!$material) {return $null}
    if (!$stone) {$stone='stone'}
    $baseId=if ($stone -in @('marble','basalt','red_granite')) {"gtceu:block/stones/$stone/stone"} elseif ($stone -eq 'endstone') {'minecraft:block/end_stone'} else {"minecraft:block/$stone"}
    $base=Export-GregTechTexture $baseId $null
    if (!$base) {return $null}
    $job=New-GregTechCuboid @(0,0,0) @(16,16,16) @{base=$base} @{side='base'}
    $icon=$material.icon; $overlay=$null; $second=$null
    for ($i=0; $i -lt 15 -and $icon; $i++) {
        $overlay=Export-GregTechTexture "gtceu:block/material_sets/$icon/ore" $material.color $material.source
        if ($overlay) {
            $secondary=if ($null -ne $material.secondary) {$material.secondary} else {$material.color}
            $second=Export-GregTechTexture "gtceu:block/material_sets/$icon/ore_layer2" $secondary $material.source
            break
        }
        $icon=$Context.iconParents[$icon]
    }
    if (!$overlay) {return $null}
    $index=0
    foreach($texture in @($overlay,$second)) {
        if (!$texture) {continue}
        $index++; $key="ore$index"; $job.textures[$key]=$texture
        $faces=@{}
        foreach($face in @('up','down','north','south','east','west')) {$faces[$face]=@{texture=$key;uv=@(0,0,16,16)}}
        $epsilon=0.01*$index
        $job.elements+=@{from=@(-$epsilon,-$epsilon,-$epsilon);to=@((16+$epsilon),(16+$epsilon),(16+$epsilon));faces=$faces}
    }
    $job.layers=@($job.textures.Values)
    return $job
}

function Export-GregTechIcon([string]$Id) {
    if (!$Id.StartsWith('gtceu:')) { return $null }
    $context = Get-GregTechContext
    if (!$context) { return $null }
    $name=$Id.Substring(6)
    $job=Export-GregTechPipe $context $name
    if ($job) { return $job }
    $job=Export-GregTechWire $context $name
    if ($job) { return $job }
    $job=Export-GregTechMachine $context $name
    if ($job) { return $job }
    $job=Export-GregTechOre $context $name
    if ($job) { return $job }
    if ($name -match '^(.+)_(axe|pickaxe|shovel|sword|hoe|hammer|mallet|saw|file|wrench|screwdriver|crowbar|wire_cutter|mortar|knife|butchery_knife|spade|scythe|plunger|mining_hammer)$') {
        $material=$context.materials[$Matches[1]]; $tool=$Matches[2]
        if ($material) {
            $job=Export-GregTechLayers $context $material (Read-Model "gtceu:item/tools/$tool") $true
            if ($job) { return $job }
        }
    }
    $patterns = @(
        @('^tiny_(.+)_dust$','dust_tiny'), @('^small_(.+)_dust$','dust_small'),
        @('^impure_(.+)_dust$','dust_impure'), @('^pure_(.+)_dust$','dust_pure'),
        @('^purified_(.+)_ore$','crushed_purified'), @('^refined_(.+)_ore$','crushed_refined'),
        @('^crushed_(.+)_ore$','crushed'), @('^raw_(.+)$','raw_ore'),
        @('^long_(.+)_rod$','rod_long'), @('^small_(.+)_gear$','gear_small'),
        @('^small_(.+)_spring$','spring_small'), @('^fine_(.+)_wire$','wire_fine'),
        @('^double_(.+)_plate$','plate_double'), @('^dense_(.+)_plate$','plate_dense'),
        @('^hot_(.+)_ingot$','ingot_hot'), @('^double_(.+)_ingot$','ingot_double'),
        @('^chipped_(.+)_gem$','gem_chipped'), @('^flawed_(.+)_gem$','gem_flawed'),
        @('^flawless_(.+)_gem$','gem_flawless'), @('^exquisite_(.+)_gem$','gem_exquisite'),
        @('^(.+)_buzz_saw_blade$','tool_head_buzz_saw'), @('^(.+)_chainsaw_tip$','tool_head_chainsaw'),
        @('^(.+)_drill_head$','tool_head_drill'), @('^(.+)_wrench_tip$','tool_head_wrench'),
        @('^(.+)_(dust|ingot|plate|gem|nugget|rod|bolt|screw|ring|foil|gear|rotor|spring|round|lens|turbine_blade)$','')
    )
    foreach ($pattern in $patterns) {
        if ($name -notmatch $pattern[0]) { continue }
        $material=$context.materials[$Matches[1]]
        $type=if ($pattern[1]) {$pattern[1]} else {$Matches[2]}
        if (!$material) { continue }
        $job=Export-GregTechLayers $context $material (Read-GregTechMaterialModel $context $material $type)
        if ($job) { return $job }
    }
    if ($name -match '^(raw_)?(.+)_(block|frame)$') {
        $raw=$Matches[1]; $material=$context.materials[$Matches[2]]
        $type=if ($Matches[3] -eq 'frame') {'frame_gt'} elseif ($raw) {'raw_ore_block'} else {'block'}
        if ($material) {
            $model=Read-GregTechMaterialModel $context $material $type 'block'
            if ($model -and $model.elements.Count) {
                $secondary=if ($context.secondary -and $null -ne $material.secondary) {$material.secondary} else {$material.color}
                $job=Export-GregTechModel $model @{0=$material.color;1=$secondary} $material.source
                if ($job) {return $job}
            }
        }
    }
    return $null
}
