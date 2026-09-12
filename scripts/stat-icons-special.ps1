# Offline adapters for built-in/entity inventory renderers. Textures always
# come from the instance's selected resource stack; no web images at runtime.
$script:legacyIconResources = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'stat-legacy-resources.json') -Raw | ConvertFrom-Json -AsHashtable

function Export-CompositeItem($Definitions) {
    $result = @{kind='model';textures=@{};elements=@();layers=@()}
    foreach ($definition in $Definitions) {
        $selected = Item-Definition $definition
        if (!$selected.model) { return $null }
        # 26.2 beds compose two ordinary models with a one-block translation.
        # Reject unsupported transforms rather than publish distorted geometry.
        $transform = if ($definition.transformation) { $definition.transformation } else { @{} }
        foreach ($key in @('left_rotation','right_rotation')) {
            if ($transform[$key] -and (($transform[$key] -join ',') -notin @('0,0,0,1','0,0,0,-1'))) { return $null }
        }
        if ($transform.scale -and ($transform.scale -join ',') -ne '1,1,1') { return $null }
        $part = Export-Elements (Read-Model $selected.model)
        if (!$part) { return $null }
        $offset = if ($transform.translation) { $transform.translation } else { @(0,0,0) }
        foreach ($element in $part.elements) {
            for ($axis=0; $axis -lt 3; $axis++) {
                $element.from[$axis] += 16 * $offset[$axis]
                $element.to[$axis] += 16 * $offset[$axis]
                if ($element.rotation) { $element.rotation.origin[$axis] += 16 * $offset[$axis] }
            }
        }
        foreach ($entry in $part.textures.GetEnumerator()) { $result.textures[$entry.Key] = $entry.Value }
        $result.elements += $part.elements
        if (!$result.display) { $result.display = $part.display }
    }
    $result.layers = @($result.textures.Values)
    return $result
}

function Export-LegacyIcon([string]$Id) {
    if ($pack.version -notmatch '^1\.[0-7](?:\.|$)') { return $null }
    $entry = $script:legacyIconResources.Values | Where-Object key -EQ $Id | Select-Object -First 1
    if (!$entry) { return $null }
    if ($entry.texture) {
        $texture = Export-Texture "minecraft:$($entry.texture)"
        if (!$texture) { return $null }
        if ($entry.tint) { $texture = @{} + $texture; $texture.tint = $entry.tint }
        return @{kind='item';layers=@($texture)}
    }
    $faces = @{}; $refs = @{}
    foreach ($face in @('north','south','east','west','up','down')) {
        $index = switch ($face) { 'up' {1} 'down' {2} 'south' {3} default {0} }
        $stem = if ($entry.sides.Count -gt $index) { $entry.sides[$index] } else { $entry.sides[0] }
        $refs[$face] = "minecraft:blocks/$stem"
        $faces[$face] = @{texture="#$face";uv=@(0,0,16,16)}
    }
    $job = Export-Elements @{elements=@(@{from=@(0,0,0);to=@(16,16,16);faces=$faces});textures=$refs;display=@{gui=@{rotation=@(30,225,0);scale=@(0.625,0.625,0.625)}}}
    if ($job -and $entry.tint) { foreach ($texture in $job.layers) { $texture.tint = $entry.tint } }
    return $job
}

function Export-SpecialItemIcon([string]$Id) {
    if ($Id -match '^(ad_astra|ad_astra_rocketed):tier_([1-7])_rocket$') {
        $namespace=$Matches[1]; $tier=[int]$Matches[2]
        $class = if ($namespace -eq 'ad_astra') { 'earth.terrarium.adastra.client.models.entities.vehicles.RocketModel' }
            else { 'net.celsiusqc.ad_astra_rocketed.client.models.entities.RocketedRocketModel' }
        $geometry = Read-LayerEntityGeometry $class "createTier${tier}Layer"
        $texture = Export-Texture "${namespace}:entity/rocket/tier_${tier}_rocket"
        if (!$geometry -or !$texture) { return $null }
        $job = New-EntityIcon $geometry.model $texture $geometry.source
        $job.rotation = @(20,155,-20)
        return $job
    }
    if ($Id -match '^slashblade:slashblade(?:_(wood|white|silverbamboo|bamboo))?$') {
        $skin = if ($Matches[1]) { $Matches[1] } else { 'blade' }
        Index-ExtraAssets
        $modelAsset = 'assets/slashblade/model/blade.obj'
        $bytes = Read-Asset $modelAsset
        $texture = Export-Texture '' "assets/slashblade/model/$skin.png"
        if (!$bytes -or !$texture) { return $null }
        # SlashBladeTEISR.renderIcon selects only item_blade (not the world
        # sheath, broken blade, fragment, or attack effect in the same OBJ).
        $ref = $assetIndex[$modelAsset]
        $texture = @{} + $texture
        $texture.source += " + $(Split-Path $ref[0] -Leaf) > $modelAsset / item_blade"
        return @{kind='model';obj=[Text.Encoding]::UTF8.GetString($bytes);objGroups=@('item_blade');objWrap='repeat';layers=@($texture);rotation=@(15,-25,-5)}
    }
    $legacy = Export-LegacyIcon $Id
    if ($legacy) { return $legacy }
    if ($Id -notmatch '^minecraft:(.+)$') { return $null }
    $name = $Matches[1]
    if ($name -eq 'leather_chestplate') {
        $base = Export-Texture 'minecraft:item/leather_chestplate'
        $overlay = Export-Texture 'minecraft:item/leather_chestplate_overlay'
        if ($base -and $overlay) {
            $base = @{} + $base; $base.tint = 0xA06540
            return @{kind='item';layers=@($base,$overlay)}
        }
    }
    if ($name -match '^(?:([a-z_]+)_)?shulker_box$') {
        $skin = if ($Matches[1]) { 'shulker_' + $Matches[1] } else { 'shulker' }
        $texture = Export-Texture "minecraft:entity/shulker/$skin"
        $geometry = @{format='java';textureWidth=64;textureHeight=64;bones=@(
            @{name='lid';pivot=@(0,24,0);cubes=@(@{origin=@(-8,-16,-8);size=@(16,12,16);uv=@(0,0)})},
            @{name='base';pivot=@(0,24,0);cubes=@(@{origin=@(-8,-8,-8);size=@(16,8,16);uv=@(0,28)})}
        )}
        return New-EntityIcon $geometry $texture 'Mojang ShulkerModel.createBodyLayer / closed inventory box, lid + base'
    }
    if ($name -match '^([a-z_]+)_bed$') {
        $texture = Export-Texture "minecraft:entity/bed/$($Matches[1])"
        $pi = [Math]::PI
        # BedRenderer.createHeadLayer/createFootLayer, assembled into the
        # inventory's two-block bed. Keep original per-leg UVs and rotations.
        $geometry = @{format='java';textureWidth=64;textureHeight=64;bones=@(
            @{name='head';rotation=@((-$pi/2),0,0)},
            @{name='head_main';parent='head';cubes=@(@{origin=@(0,0,0);size=@(16,16,6);uv=@(0,0)})},
            @{name='head_left';parent='head';rotation=@(($pi/2),0,($pi/2));cubes=@(@{origin=@(0,6,0);size=@(3,3,3);uv=@(50,6)})},
            @{name='head_right';parent='head';rotation=@(($pi/2),0,$pi);cubes=@(@{origin=@(-16,6,0);size=@(3,3,3);uv=@(50,18)})},
            @{name='foot';pivot=@(0,0,-16);rotation=@((-$pi/2),0,0)},
            @{name='foot_main';parent='foot';cubes=@(@{origin=@(0,0,0);size=@(16,16,6);uv=@(0,22)})},
            @{name='foot_left';parent='foot';rotation=@(($pi/2),0,0);cubes=@(@{origin=@(0,6,-16);size=@(3,3,3);uv=@(50,0)})},
            @{name='foot_right';parent='foot';rotation=@(($pi/2),0,(3*$pi/2));cubes=@(@{origin=@(-16,6,-16);size=@(3,3,3);uv=@(50,12)})}
        )}
        $job = New-EntityIcon $geometry $texture 'Mojang BedRenderer.createHeadLayer + createFootLayer'
        if ($job) { $job.rotation = @(30,145,0) }
        return $job
    }
    if ($name -match '^([a-z_]+?)(?:_wall)?_banner$') {
        $colors = @{white=0xF9FFFE;orange=0xF9801D;magenta=0xC74EBD;light_blue=0x3AB3DA;yellow=0xFED83D;lime=0x80C71F;pink=0xF38BAA;gray=0x474F52;light_gray=0x9D9D97;cyan=0x169C9C;purple=0x8932B8;blue=0x3C44AA;brown=0x835432;green=0x5E7C16;red=0xB02E26;black=0x1D1D21}
        $color = $colors[$Matches[1]]
        if ($null -eq $color) { return $null }
        $base = Export-Texture 'minecraft:entity/banner_base'
        if (!$base) { $base = Export-Texture 'minecraft:entity/banner/banner_base' }
        $cloth = Export-Texture 'minecraft:entity/banner/base'
        if (!$base -or !$cloth) { return $null }
        $cloth = @{} + $cloth; $cloth.tint = $color
        $post = @{format='java';textureWidth=64;textureHeight=64;bones=@(
            @{name='pole';cubes=@(@{origin=@(-1,-30,-1);size=@(2,42,2);uv=@(44,0)})},
            @{name='bar';cubes=@(@{origin=@(-10,-32,-1);size=@(20,2,2);uv=@(0,42)})}
        )}
        $flag = @{format='java';textureWidth=64;textureHeight=64;bones=@(
            @{name='flag';pivot=@(0,-32,0);rotation=@(-0.00785398,0,0);cubes=@(@{origin=@(-10,0,-2);size=@(20,40,1);uv=@(0,0)})}
        )}
        return @{kind='model';layers=@($base,$cloth);entityParts=@(@{entityModel=$post;layer=0},@{entityModel=$flag;layer=1});rotation=@(5,155,0)}
    }
    return $null
}
