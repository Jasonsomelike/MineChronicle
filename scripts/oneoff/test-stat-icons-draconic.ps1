param([string]$Assets = '.local/stat-assets', [string]$Audit = '.local/stat-resource-audit.json')
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$exporter = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'export-stat-icons.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw $errors[0] }
foreach ($function in $exporter.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.FunctionDefinitionAst] }) {
    . ([scriptblock]::Create($function.Extent.Text))
}
. (Join-Path $PSScriptRoot 'stat-icons-draconic.ps1')
$outputPath = [IO.Path]::GetFullPath('.local/draconic-test-textures')
[IO.Directory]::CreateDirectory($outputPath) | Out-Null
$auditData = Get-Content -LiteralPath $Audit -Raw | ConvertFrom-Json
$allRequests = Get-Content -LiteralPath '.local/stat-icon-requests.json' -Raw | ConvertFrom-Json
$jobs = @{}
$total = 0
foreach ($rootId in @(2, 17, 18, 20)) {
    $root = $auditData.roots | Where-Object id -EQ $rootId | Select-Object -First 1
    $pack = Get-Content -LiteralPath (Join-Path $Assets "$rootId.json") -Raw | ConvertFrom-Json -AsHashtable
    $assetIndex = $pack.assets
    $zips = @{}; $models = @{}; $textures = @{}; $script:extraAssetsIndexed = $false
    try {
        foreach ($request in $allRequests | Where-Object { $_.root -eq $rootId -and $_.key -like 'draconicevolution:*' } | Sort-Object key -Unique) {
            $job = Export-DraconicIcon $request.key
            if (!$job) { continue }
            if (!$job.layers.Count -or $null -in $job.layers) { throw "Missing layer: $($request.key)" }
            foreach ($layer in $job.layers) {
                $file = Join-Path $outputPath $layer.file
                if (!(Test-Path -LiteralPath $file)) { throw "Missing texture file: $($request.key)" }
                $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($file))).ToLowerInvariant()
                if ($layer.file -ne "$hash.png") { throw "Texture changed from source bytes: $($request.key)" }
            }
            if ($job.obj -and $job.obj -notmatch '(?m)^f ') { throw "OBJ has no faces: $($request.key)" }
            $jobs["$rootId|$($request.key)"] = $job
            $total++
        }
        foreach ($module in $allRequests | Where-Object { $_.root -eq $rootId -and $_.key -like 'draconicevolution:item_*' } | Sort-Object key -Unique) {
            $model = Read-Model ($module.key -replace ':', ':item/')
            foreach ($key in @('layer0', 'layer1')) {
                $id = Texture-Ref $model.textures $key
                if (!$id -or !(Export-Texture $id)) { throw "Missing original module layer: $($module.key) $key" }
            }
        }
        if (Export-DraconicIcon 'minecraft:stone') { throw 'Foreign namespace was matched' }
        if (Export-DraconicIcon 'draconicevolution:module_core') { throw 'Standard item was overridden' }
    } finally { foreach ($zip in $zips.Values) { $zip.Dispose() } }
}
foreach ($key in @('2|draconicevolution:chaotic_axe', '2|draconicevolution:chaos_shard', '2|draconicevolution:large_chaos_frag', '2|draconicevolution:medium_chaos_frag', '18|draconicevolution:draconic_bow', '18|draconicevolution:draconic_chestpiece', '18|draconicevolution:basic_relay_crystal', '20|draconicevolution:wyvern_io_crystal')) {
    if (!$jobs.ContainsKey($key)) { throw "Required special icon missing: $key" }
}
if ($jobs['2|draconicevolution:large_chaos_frag'].iconScale -ne 0.75 -or $jobs['2|draconicevolution:medium_chaos_frag'].iconScale -ne 0.5) { throw 'Shard sizes no longer match original renderer' }
$jobs | ConvertTo-Json -Depth 10 -Compress | Set-Content -LiteralPath (Join-Path $outputPath 'manifest.json') -Encoding utf8
Write-Output "Verified $total Draconic special icons and all requested module layers across 4 installed modpack roots."
