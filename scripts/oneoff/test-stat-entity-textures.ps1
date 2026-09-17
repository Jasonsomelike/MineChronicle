$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'stat-icons-entities.ps1'),[ref]$tokens,[ref]$errors)
if ($errors.Count) {throw $errors[0]}
foreach ($function in $ast.EndBlock.Statements | Where-Object {$_ -is [Management.Automation.Language.FunctionDefinitionAst]}) {
    . ([scriptblock]::Create($function.Extent.Text))
}
function Index-ExtraAssets {}
function Read-JsonAsset([string]$Name) {
    if (!$assetIndex.ContainsKey($Name)) {return $null}
    return @{'minecraft:geometry'=@(@{description=@{texture_width=64;texture_height=32};bones=@(@{name='body';cubes=@(@{origin=@(0,0,0);size=@(1,1,1);uv=@(0,0)})})})}
}
function Export-Texture([string]$Id) {
    $namespace,$name=$Id -split ':',2
    $asset="assets/$namespace/textures/$name.png"
    if (!$assetIndex.ContainsKey($asset)) {return $null}
    return @{file='fixture.png';source="fixture.jar > $asset"}
}
function Assert-EntitySkin([string]$Id, [string[]]$Skins, [string]$Expected) {
    $namespace,$name=$Id -split ':',2
    $script:geometryResourceRoot=''
    $script:geometryResourceIndex=@{}
    $script:root=@{path=$Id}
    $script:assetIndex=@{}
    $script:assetIndex["assets/$namespace/geo/$name.geo.json"]=@('fixture.jar','model')
    foreach($skin in $Skins) {$script:assetIndex["assets/$namespace/textures/$skin.png"]=@('fixture.jar','skin')}
    $job=Export-GeometryEntityIcon $Id
    if (!$Expected) {
        if ($job) {throw "An item-only texture was attached to entity $Id"}
    } elseif (!$job -or !$job.layers[0].source.Contains("textures/$Expected.png")) {
        throw "Wrong entity texture for ${Id}: $($job.layers[0].source)"
    }
}
Assert-EntitySkin 'fixture:beast' @('item/beast','block/beast','gui/beast','entity/beast') 'entity/beast'
Assert-EntitySkin 'fixture:beast' @('item/beast','block/beast','gui/beast') ''
Assert-EntitySkin 'fixture:beast' @('item/beast','entity/beast_10','entity/beast_2','entity/beast_1') 'entity/beast_1'
Assert-EntitySkin 'fixture:beast' @('entity/other_beast_1','entity/beast_1_other') ''
Assert-EntitySkin 'crabbersdelight:crab' @('item/crab','entity/red_crab','entity/blue_crab') 'entity/blue_crab'
Assert-EntitySkin 'crittersandcompanions:koi_fish' @('item/koi_fish','entity/koi_fish_10','entity/koi_fish_1') 'entity/koi_fish_1'
Write-Output 'Verified 6 entity-skin cases: item/block/gui exclusion, exact entity identity, numeric variants, and actual crab/koi defaults.'
