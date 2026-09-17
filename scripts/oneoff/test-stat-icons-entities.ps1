param([string]$Assets = '.local/stat-assets')
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$exporter = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'export-stat-icons.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw $errors[0] }
foreach ($function in $exporter.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.FunctionDefinitionAst] }) {
    . ([scriptblock]::Create($function.Extent.Text))
}
. (Join-Path $PSScriptRoot 'stat-icons-entities.ps1')
$outputPath = [IO.Path]::GetFullPath('.local/entity-test-textures')
[IO.Directory]::CreateDirectory($outputPath) | Out-Null
$auditData = Get-Content -LiteralPath '.local/stat-resource-audit.json' -Raw | ConvertFrom-Json
$requests = Get-Content -LiteralPath '.local/stat-icon-requests.json' -Raw | ConvertFrom-Json
$jobs = @{}; $missing = [Collections.Generic.List[object]]::new()
$selected = $requests | Where-Object { $_.entity -and $_.key -notmatch '^(alexsmobs|alexscaves|aether|ad_astra):' } | Sort-Object key -Unique
foreach ($group in $selected | Group-Object root) {
    $root = $auditData.roots | Where-Object id -EQ ([int]$group.Name) | Select-Object -First 1
    $pack = Get-Content -LiteralPath (Join-Path $Assets "$($root.id).json") -Raw | ConvertFrom-Json -AsHashtable
    $assetIndex = $pack.assets
    $zips = @{}; $models = @{}; $textures = @{}; $script:extraAssetsIndexed = $false
    try {
        foreach ($request in $group.Group) {
            $job = Export-EntityIcon $request.key
            if (!$job) { $missing.Add(@{root=$root.id; key=$request.key}); continue }
            $parts = if ($job.entityModel) { @($job.entityModel) } else { @($job.entityParts.entityModel) }
            foreach ($model in $parts) {
                if (!$model.bones.Count -or !$job.layers.Count) { throw "Invalid entity $($request.key)" }
                if ($model.textureWidth -le 0 -or $model.textureHeight -le 0) { throw "Invalid entity UV size $($request.key)" }
            }
            $jobs["$($root.id)|entity:$($request.key)"] = $job
        }
    } finally { foreach ($zip in $zips.Values) { $zip.Dispose() } }
    Write-Output "Entity root $($root.id): $($jobs.Count) supported models"
}
$jobs | ConvertTo-Json -Depth 20 -Compress | Set-Content -LiteralPath (Join-Path $outputPath 'manifest.json') -Encoding utf8
ConvertTo-Json -InputObject @($missing.ToArray()) -Depth 4 | Set-Content -LiteralPath (Join-Path $outputPath 'missing.json') -Encoding utf8
foreach ($key in @('minecraft:zombie','minecraft:creeper','minecraft:cow','minecraft:skeleton','minecraft:enderman')) {
    if (!@($jobs.Keys | Where-Object { $_.EndsWith("|entity:$key") }).Count) { throw "Missing baseline entity: $key" }
}
Write-Output "Verified $($jobs.Count) distinct entity models; $($missing.Count) require a custom model adapter."
