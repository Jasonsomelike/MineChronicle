function Read-DraconicObject([string]$Name, [string]$ModelAsset) {
    if (!$assetIndex.ContainsKey($Name)) {
        $modelRef = $assetIndex[$ModelAsset]
        if (!$modelRef) { return $null }
        if ($modelRef[1]) {
            if (!$zips.ContainsKey($modelRef[0])) { $zips[$modelRef[0]] = [IO.Compression.ZipFile]::OpenRead($modelRef[0]) }
            if ($zips[$modelRef[0]].GetEntry($Name)) { $assetIndex[$Name] = @($modelRef[0], $Name) }
        } else {
            $assetRoot = $modelRef[0].Substring(0, $modelRef[0].Length - $ModelAsset.Length)
            $file = Join-Path $assetRoot $Name
            if (Test-Path -LiteralPath $file -PathType Leaf) { $assetIndex[$Name] = @($file, '') }
        }
    }
    $bytes = Read-Asset $Name
    if (!$bytes) { return $null }
    return @{ text = [Text.Encoding]::UTF8.GetString($bytes); source = "$(Split-Path $assetIndex[$Name][0] -Leaf) > $Name" }
}

function Export-DraconicIcon([string]$Id) {
    if ($Id -notmatch '^draconicevolution:([a-z0-9_]+)$') { return $null }
    $name = $Matches[1]
    $modelAsset = Asset-Path "draconicevolution:item/$name" 'models' 'json'
    $model = Read-JsonAsset $modelAsset
    if (!$model -or $model.loader -ne 'codechickenlib:class') { return $null }

    # These are the mod's bundled flat inventory sprites, not UV texture sheets.
    if ($model.class -match '\.RenderModular[A-Za-z]+\$' -and $name -match '^(wyvern|draconic|chaotic)_(axe|bow|chestpiece|hoe|pickaxe|shovel|staff|sword)$') {
        $texture = Export-EntityTexture "draconicevolution:item/tools/$name"
        if ($texture) { return @{ kind = 'item'; layers = @($texture) } }
    }

    if ($model.class -match '\.RenderItemEnergyCrystal\$' -and $name -match '^(basic|wyvern|draconic)_(io|relay|wireless)_crystal$') {
        $tier = $Matches[1]
        $half = $Matches[2] -eq 'io'
        $objectName = if ($half) { 'crystal_half' } else { 'crystal' }
        $object = Read-DraconicObject "assets/draconicevolution/models/block/$objectName.obj" $modelAsset
        $texture = Export-EntityTexture 'draconicevolution:models/crystal_no_shader'
        if (!$object -or !$texture) { return $null }
        # RenderTileEnergyCrystal's shader-disabled RGB values, multiplied by 255.
        $tint = switch ($tier) { 'basic' { 0x0059a5 } 'wyvern' { 0x8c4ce5 } 'draconic' { 0xff912b } }
        $texture = @{} + $texture
        $texture.source += " + $($object.source) (original model, shader fallback)"
        $layers = @($texture)
        $materials = @{ '*' = @{ layer = 0; tint = $tint } }
        if ($half) {
            $base = Export-EntityTexture 'draconicevolution:models/crystal_base'
            if (!$base) { return $null }
            $layers += $base
            $materials.Base = @{ layer = 1 }
        }
        return @{ kind = 'model'; obj = $object.text; objMaterials = $materials; layers = $layers; rotation = @(30, 225, 0) }
    }

    if ($model.class -match '\.RenderItemChaosShard\$' -and $name -match '^(chaos_shard|large_chaos_frag|medium_chaos_frag|small_chaos_frag)$') {
        $object = Read-DraconicObject 'assets/draconicevolution/models/item/chaos_shard.obj' $modelAsset
        $texture = Export-EntityTexture 'draconicevolution:block/chaos_crystal'
        if (!$object -or !$texture) { return $null }
        $texture = @{} + $texture
        $texture.source += " + $($object.source) (original model, static outer texture)"
        $scale = switch ($name) { 'chaos_shard' { 1 } 'large_chaos_frag' { 0.75 } 'medium_chaos_frag' { 0.5 } 'small_chaos_frag' { 0.25 } }
        return @{ kind = 'model'; obj = $object.text; layers = @($texture); rotation = @(0, 0, 0); iconScale = $scale }
    }
    return $null
}
