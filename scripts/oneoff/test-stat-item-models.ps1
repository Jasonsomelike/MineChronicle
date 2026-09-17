$ErrorActionPreference = 'Stop'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'export-stat-icons.ps1'),[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors -join [Environment]::NewLine) }
foreach ($name in @('Asset-Path','Item-Definition','Read-Model','Resolve-Model','Texture-Ref','Export-Elements')) {
    $definition=$ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$true) | Where-Object Name -EQ $name | Select-Object -First 1
    . ([scriptblock]::Create($definition.Extent.Text))
}
. (Join-Path $PSScriptRoot 'stat-icons-special.ps1')
$models=@{}
$fixtures=@{
    'assets/minecraft/models/block/template.json' = @{
        elements=@(@{from=@(0,3,0);to=@(16,9,16);faces=@{
            up=@{texture='#cloth';uv=@(0,0,16,16)}
            north=@{texture='#missing';uv=@(0,0,16,16)}
        }})
    }
    'assets/minecraft/models/block/red.json' = @{parent='minecraft:block/template';textures=@{cloth='minecraft:block/red'}}
    'assets/minecraft/models/block/blue.json' = @{parent='minecraft:block/template';textures=@{cloth='minecraft:block/blue'}}
}
function Read-Asset([string]$Name) {
    if ($fixtures.ContainsKey($Name)) { return ,[Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $fixtures[$Name] -Depth 20)) }
    return $null
}
function Export-Texture([string]$Id) { return @{file='fixture.png';source=$Id} }
function Bed-Definition([string]$Color) {
    return @(
        @{type='minecraft:model';model="minecraft:block/$Color"},
        @{type='minecraft:model';model="minecraft:block/$Color";transformation=@{translation=@(0,0,1)}}
    )
}
$red=Export-CompositeItem (Bed-Definition 'red')
$snapshot=ConvertTo-Json -InputObject $red -Depth 20 -Compress
$blue=Export-CompositeItem (Bed-Definition 'blue')
if ((ConvertTo-Json -InputObject $red -Depth 20 -Compress) -cne $snapshot) { throw 'A later color mutated an earlier composite' }
foreach ($job in @($red,$blue)) {
    if ($job.elements.Count -ne 2 -or $job.elements[0].from[2] -ne 0 -or $job.elements[1].from[2] -ne 16 -or $job.elements[1].to[2] -ne 32) { throw 'Composite bed lost its two adjacent block positions' }
    if ($job.elements[0].faces.Count -ne 1 -or !$job.elements[0].faces.ContainsKey('up')) { throw 'Valid faces were discarded with an explicit missing face' }
}
if ((Read-Model 'minecraft:block/template').elements[0].to[2] -ne 16) { throw 'Composite mutated its cached parent template' }
$unsupported=Bed-Definition 'red'; $unsupported[1].transformation.scale=@(1,2,1)
if ($null -ne (Export-CompositeItem $unsupported)) { throw 'Unsupported transform published a partial model' }
Write-Output 'Item model regression checks passed: independent colors, adjacent bed parts, cached parent, valid faces, unsupported transforms.'
