function Export-TrophyItemIcon([string]$Id) {
    if ($Id -notmatch '^ageofmythology:(.+)_item$') { return $null }
    $itemName = $Matches[1]
    Index-ExtraAssets
    $matches = @($assetIndex.Keys | Where-Object {
        if ($_ -cmatch '^assets/ageofmythology/textures/model/([^/]+)/([^/]+)\.png$') {
            "$($Matches[1])_$($Matches[2])" -ceq $itemName
        } else { $false }
    })
    if ($matches.Count -ne 1) { return $null }
    $texture = Export-Texture '' $matches[0]
    if (!$texture) { return $null }
    # AOMLayerDefinitions binds VANILLA_SKULL to SkullModel.m_170947_,
    # createHumanoidHeadLayer: an 8px head with a 0.25px outer hat.
    # AOMEntityRenderConfig maps MobVariant namespace/name to textures/model/.
    return New-EntityIcon @{
        format='java';textureWidth=64;textureHeight=64
        bones=@(
            @{name='head';pivot=@(0,0,0);cubes=@(
                @{origin=@(-4,-8,-4);size=@(8,8,8);uv=@(0,0)}
            )},
            @{name='hat';parent='head';pivot=@(0,0,0);cubes=@(
                @{origin=@(-4,-8,-4);size=@(8,8,8);uv=@(32,0);inflate=0.25}
            )}
        )
    } $texture 'Age of Mythology AOMEntityRenderConfig + AOMLayerDefinitions / Mojang SkullModel.createHumanoidHeadLayer'
}
