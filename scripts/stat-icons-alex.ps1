function Export-AlexEntityIcon([string]$Id) {
    if ($Id -notmatch '^([a-z0-9_.-]+):([a-z0-9_]+)$' -or $Id.StartsWith('minecraft:')) { return $null }
    $namespace = $Matches[1]; $name = $Matches[2]
    Index-ExtraAssets
    if (!$script:javaEntityClassIndex -or $script:javaEntityRoot -ne $root.path) {
        $script:javaEntityRoot = $root.path
        $script:javaEntityClassIndex = @{}
    }
    if (!$script:javaEntityClassIndex.ContainsKey($namespace)) {
        $index = @{}
        foreach ($archive in $zips.GetEnumerator()) {
            if (!$archive.Value.GetEntry("assets/$namespace/lang/en_us.json")) { continue }
            foreach ($entry in $archive.Value.Entries) {
                if ($entry.FullName -notmatch '/(?:client|entity|render)/.*(?:Model|_Model|Model[A-Z][^/]*)\.class$' -or $entry.FullName.Contains('$')) { continue }
                $simple = [IO.Path]::GetFileNameWithoutExtension($entry.FullName)
                $normalized = (($simple -replace '^Model|_?Model$', '') -replace '_', '').ToLowerInvariant()
                # A model name alone cannot choose between unrelated same-name classes.
                if ($index.ContainsKey($normalized)) { $index[$normalized] = $null }
                else { $index[$normalized] = @{ entry = $entry; archive = $archive.Key } }
            }
        }
        $script:javaEntityClassIndex[$namespace] = $index
    }
    $normalizedName = $name.Replace('_', '')
    # Verified RenderCatfish default: size zero uses ModelCatfishSmall and its
    # matching skin. Model and texture variants must be selected together.
    $modelName = if ($Id -eq 'alexsmobs:catfish') { 'catfishsmall' } else { $normalizedName }
    $classRef = $script:javaEntityClassIndex[$namespace][$modelName]
    if (!$classRef) { $classRef = $script:javaEntityClassIndex[$namespace]["${normalizedName}head"] }
    if (!$classRef) {
        foreach ($binding in (Get-DiscoveredEntityBindings $Id)) {
            if (!$binding) { continue }
            $possible = @($binding.model_classes | Where-Object { $_ -match '(?:Model[A-Z][^/]*|[^/]*Model)\.class$' -and $_ -notmatch '(?:Layer|Armor|Overlay|Feature|Animator)' } | Select-Object -Unique)
            if ($possible.Count -ne 1 -or !$zips.ContainsKey($binding.jar)) { continue }
            $entry = $zips[$binding.jar].GetEntry($possible[0])
            if ($entry) { $classRef = @{entry=$entry;archive=$binding.jar}; break }
        }
    }
    if (!$classRef) { return $null }
    $classEntry = $classRef.entry; $classSource = $classRef.archive
    $className = ($classEntry.FullName -replace '\.class$', '').Replace('/', '.')
    $variant = @{
        'alexsmobs:capuchin_monkey' = 'capuchin_monkey_0'
        'alexsmobs:catfish' = 'catfish_small'
        'alexsmobs:comb_jelly' = 'comb_jelly_blue'
        'cataclysm:ignis' = 'ignis/ignis_idle_0'
    }[$Id]
    $textureId = if ($variant) { "${namespace}:entity/$variant" } else { "${namespace}:entity/$name" }
    # TFClientSetup registers AlphaYetiModel with TFBipedRenderer("yetialpha.png").
    if ($Id -eq 'twilightforest:alpha_yeti') { $textureId = 'twilightforest:model/yetialpha' }
    if ($Id -eq 'twilightforest:knight_phantom') { $textureId = 'twilightforest:model/phantomskeleton' }
    if (!$assetIndex.ContainsKey((Asset-Path $textureId 'textures' 'png'))) {
        $candidate = $assetIndex.Keys | Where-Object {
            $_ -like "assets/$namespace/textures/*.png" -and
            $_ -notmatch '/textures/(?:items?|blocks?|gui|particle)/|/(?:banner|shield|painting)/' -and
            [IO.Path]::GetFileNameWithoutExtension($_).Replace('_', '').ToLowerInvariant() -eq $normalizedName
        } | Sort-Object Length, { $_ } | Select-Object -First 1
        if (!$candidate -and $name -eq 'bone_serpent') { $candidate = "assets/$namespace/textures/entity/bone_serpent_head.png" }
        if (!$candidate) {
            $references = @(Get-DiscoveredEntityBindings $Id | ForEach-Object { $_.references } | Where-Object {
                $_ -match '/textures/(?:entity|entities|models?)/.*\.png$' -and $_ -notmatch '(?:_eyes|_glow|_crack|_overlay|_layer|_charging|_dazed)\d*\.png$'
            } | Sort-Object -Unique)
            if ($references.Count -eq 1) { $candidate = $references[0] }
            elseif ($references.Count -gt 1) {
                # Numbered skins share the same geometry. The first supplied
                # skin is a representative, since statistics have no variant.
                $stems = @($references | ForEach-Object { $_ -replace '\d+\.png$', '.png' } | Select-Object -Unique)
                if ($stems.Count -eq 1) { $candidate = $references[0] }
            }
        }
        if (!$candidate) { return $null }
        $textureId = $candidate -replace "^assets/$namespace/textures/(.+)\.png$", "${namespace}:`$1"
    }
    $texture = Export-Texture $textureId
    if (!$texture) { return $null }
    $cacheRoot = [IO.Path]::GetFullPath('.local/stat-java-models')
    [IO.Directory]::CreateDirectory($cacheRoot) | Out-Null
    $memory = [IO.MemoryStream]::new(); $stream = $classEntry.Open()
    try {
        $stream.CopyTo($memory)
        # Constructors can inherit geometry from other classes in the same JAR.
        $archiveInfo = Get-Item -LiteralPath $classSource
        $archiveIdentity = [Text.Encoding]::UTF8.GetBytes("|$($archiveInfo.Name)|$($archiveInfo.Length)|$($archiveInfo.LastWriteTimeUtc.Ticks)")
        $memory.Write($archiveIdentity, 0, $archiveIdentity.Length)
        $classHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($memory.ToArray())).ToLowerInvariant()
    }
    finally { $stream.Dispose(); $memory.Dispose() }
    $cache = Join-Path $cacheRoot "v8-$classHash.json"
    $errorPath = Join-Path $cacheRoot "v8-$classHash.error.txt"
    if (!(Test-Path -LiteralPath $cache) -and !(Test-Path -LiteralPath $errorPath)) {
        $disassembly = Join-Path $cacheRoot "$classHash.javap.txt"
        $content = & javap -classpath $classSource -c -p $className 2>&1
        if ($LASTEXITCODE -ne 0) { return $null }
        $content | Set-Content -LiteralPath $disassembly -Encoding utf8
        $diagnostic = & node (Join-Path $PSScriptRoot 'stat-entity-java.mjs') $disassembly $className $cache $classSource 2>&1
        if ($LASTEXITCODE -ne 0) {
            $diagnostic | Set-Content -LiteralPath $errorPath -Encoding utf8
        }
    }
    $geometrySource = "$(Split-Path $classSource -Leaf) > $($classEntry.FullName) (original constructor geometry)"
    if (Test-Path -LiteralPath $cache) { $model = Get-Content -LiteralPath $cache -Raw | ConvertFrom-Json -AsHashtable }
    elseif (Get-Command Read-LayerEntityGeometry -ErrorAction SilentlyContinue) {
        $layer = Read-LayerEntityGeometry $className
        if (!$layer) { return $null }
        $model = $layer.model; $geometrySource = $layer.source
    } else { return $null }
    $texture = @{} + $texture
    $texture.source += " + $geometrySource"
    if ($Id -eq 'cataclysm:maledictus') {
        # The renderer draws the ghost skin, then Maledictus_Layer draws armor
        # on the same geometry. Either texture alone omits most of the body.
        $ghost = Export-Texture 'cataclysm:entity/maledictus/maledictus_ghost'
        $armor = Export-Texture 'cataclysm:entity/maledictus/maledictus_armor'
        if (!$ghost -or !$armor) { return $null }
        return @{kind='model';layers=@($ghost,$armor);entityParts=@(
            @{entityModel=$model;layer=0;depthWrite=$false},
            @{entityModel=$model;layer=1}
        )}
    }
    if ($Id -eq 'artifacts:mimic') {
        # MimicRenderer always installs MimicChestLayer. The base model alone
        # contains only the creature's mouth/feet, not its chest shell.
        $shell = Read-LayerEntityGeometry 'artifacts.client.mimic.model.MimicChestLayerModel'
        $skin = Export-Texture 'minecraft:entity/chest/normal'
        if (!$shell -or !$skin) { return $null }
        $skin = @{} + $skin
        $skin.source += " + $($shell.source) (vanilla chest representative)"
        # MimicChestLayer applies X=180 degrees then translates
        # (-0.5,-1.5,-0.5) blocks before drawing its chest-coordinate model.
        $shell.model = $shell.model | ConvertTo-Json -Depth 24 -Compress | ConvertFrom-Json -AsHashtable
        $shellRoot = $shell.model.bones | Where-Object { !$_.parent } | Select-Object -First 1
        $shellRoot.pivot = @(-8,24,8)
        $shellRoot.rotation = @([Math]::PI,0,0)
        # setChestRotations at ticksInAir=11: the fully opened attack pose.
        $model = $model | ConvertTo-Json -Depth 24 -Compress | ConvertFrom-Json -AsHashtable
        foreach ($partModel in @($model,$shell.model)) {
            foreach ($bone in $partModel.bones) {
                if ($bone.name -match '/lid$') { $bone.rotation = @((-[Math]::PI/3),0,0) }
                if ($bone.name -match '/bottom$') { $bone.rotation = @(([Math]::PI/6),0,0) }
            }
        }
        return @{kind='model'; layers=@($texture,$skin); entityParts=@(
            @{entityModel=$model;layer=0},
            @{entityModel=$shell.model;layer=1}
        )}
    }
    if ($Id -eq 'alexsmobs:comb_jelly') {
        $overlay = Export-Texture 'alexsmobs:entity/comb_jelly_overlay'
        if ($overlay) {
            # RenderCombJelly.STRIPES_MODEL uses the same constructor with a
            # small inflation. Keep its original overlay on a separate surface.
            $outer = $model | ConvertTo-Json -Depth 24 -Compress | ConvertFrom-Json -AsHashtable
            foreach ($bone in $outer.bones) { foreach ($cube in $bone.cubes) { $cube.inflate = [double]$cube.inflate + 0.05 } }
            return @{kind='model'; layers=@($texture,$overlay); entityParts=@(
                @{entityModel=$model;layer=0;depthWrite=$false},
                @{entityModel=$outer;layer=1;depthWrite=$false}
            )}
        }
    }
    return @{ kind = 'model'; entityModel = $model; layers = @($texture) }
}
