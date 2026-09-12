# Modern Industrialization 2.5.5: MachineBakedModel, OverlaysJson and ModelHelper.
# Inventory models use the base casing facing north with inactive face overlays.
function Export-ModernIndustrializationIcon([string]$Id) {
    if ($Id -cnotmatch '^([a-z0-9_.-]+):([a-z0-9_./-]+)$') { return $null }
    $namespace, $name = $Id -split ':', 2
    $modelId = "${namespace}:item/$name"
    $machine = $null
    for ($depth = 0; $depth -lt 12; $depth++) {
        $raw = Read-JsonAsset (Asset-Path $modelId 'models' 'json')
        if (!$raw -and $depth -eq 0) {
            $modelId = "${namespace}:block/$name"
            $raw = Read-JsonAsset (Asset-Path $modelId 'models' 'json')
        }
        if (!$raw) { return $null }
        if ($raw.loader -eq 'modern_industrialization:machine') {
            $machine = $raw
            break
        }
        if (!$raw.parent) { return $null }
        $modelId = $raw.parent
    }
    if (!$machine -or !$machine.casing) { return $null }

    Index-ExtraAssets
    $casingId = if ($machine.casing.Contains(':')) { $machine.casing } else { "modern_industrialization:$($machine.casing)" }
    $casingNamespace, $casingName = $casingId -split ':', 2
    $casingModelId = "${casingNamespace}:machine_casing/$casingName"
    $casingDefinition = Read-JsonAsset (Asset-Path $casingModelId 'models' 'json')
    if (!$casingDefinition) { return $null }
    $casing = if ($casingDefinition.loader -eq 'modern_industrialization:use_block_model') {
        Read-BlockModel $casingDefinition.block
    } else {
        Read-Model $casingModelId
    }
    if (!$casing -or !$casing.elements.Count) { return $null }

    $overlays = @{}
    if ($machine.default_overlays) {
        foreach ($pair in $machine.default_overlays.GetEnumerator()) { $overlays[$pair.Key] = $pair.Value }
    }
    if ($machine.tiered_overlays) {
        foreach ($pair in $machine.tiered_overlays.GetEnumerator()) {
            $tierId = if ($pair.Key.Contains(':')) { $pair.Key } else { "modern_industrialization:$($pair.Key)" }
            if ($tierId -ne $casingId) { continue }
            foreach ($overlay in $pair.Value.GetEnumerator()) {
                if ($null -ne $overlay.Value) { $overlays[$overlay.Key] = $overlay.Value }
            }
            break
        }
    }

    $elements = [Collections.Generic.List[object]]::new()
    foreach ($element in $casing.elements) { $elements.Add($element) }
    $faceOverlays = @{
        north = @('front', 'side')
        west = @('left', 'side')
        south = @('back', 'side')
        east = @('right', 'side')
        up = @('top_n', 'top')
        down = @('bottom_n', 'bottom')
    }
    # The loader offsets each overlay by 0.0005 blocks to avoid z-fighting.
    $offset = 0.008
    foreach ($direction in @('north', 'west', 'south', 'east', 'up', 'down')) {
        $textureId = $null
        foreach ($field in $faceOverlays[$direction]) {
            if ($null -ne $overlays[$field]) { $textureId = $overlays[$field]; break }
        }
        if (!$textureId) { continue }
        $from = @(0, 0, 0)
        $to = @(16, 16, 16)
        switch ($direction) {
            'north' { $from[2] = -$offset; $to[2] = -$offset }
            'west' { $from[0] = -$offset; $to[0] = -$offset }
            'south' { $from[2] = 16 + $offset; $to[2] = 16 + $offset }
            'east' { $from[0] = 16 + $offset; $to[0] = 16 + $offset }
            'up' { $from[1] = 16 + $offset; $to[1] = 16 + $offset }
            'down' { $from[1] = -$offset; $to[1] = -$offset }
        }
        $elements.Add(@{
            from = $from
            to = $to
            faces = @{ $direction = @{ texture = $textureId; uv = @(0, 0, 16, 16) } }
        })
    }
    return Export-Elements @{
        textures = $casing.textures
        elements = $elements.ToArray()
        display = @{ gui = @{ rotation = @(30, 225, 0); translation = @(0, 0, 0); scale = @(0.625, 0.625, 0.625) } }
        gui_light = 'side'
    }
}
