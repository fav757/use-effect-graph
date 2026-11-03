param(
  [string]$SourceDirectory = (Join-Path $PSScriptRoot '../src'),
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '../codeql-graph/provenance'),
  [string]$DatabaseDirectory,
  [ValidateRange(1, 1000000)][int]$MaxDepth = 96,
  [ValidateRange(1, 1000000)][int]$MaxContexts = 64,
  [ValidateRange(1, 1000000)][int]$MaxPaths = 128,
  [ValidateRange(1, 100000000)][int]$MaxSteps = 50000,
  [ValidateRange(1, 32)][int]$Threads = 2,
  [ValidateRange(2048, 65536)][int]$Ram = 6000,
  [switch]$SkipRender,
  [string]$Expectations
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source = (Resolve-Path -LiteralPath $SourceDirectory).Path
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (-not $DatabaseDirectory) { $DatabaseDirectory = Join-Path $repo ('codeql-db/provenance-' + [guid]::NewGuid().ToString('N')) }
$database = [IO.Path]::GetFullPath($DatabaseDirectory)
if (Test-Path -LiteralPath $database) { throw "Choose a new database directory; it already exists: $database" }
if ($output -eq $source -or $output.StartsWith($source.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'OutputDirectory must be outside SourceDirectory to keep extraction reproducible.'
}
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.Directory]::CreateDirectory($output) | Out-Null
$timings = [Collections.Generic.List[object]]::new()
function Invoke-Stage([string]$Name, [scriptblock]$Action) {
  $timer = [Diagnostics.Stopwatch]::StartNew()
  & $Action
  $timer.Stop()
  $timings.Add([pscustomobject]@{ stage = $Name; seconds = [Math]::Round($timer.Elapsed.TotalSeconds, 3) })
}
function Invoke-Native([string]$Executable, [string[]]$Arguments) {
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE" }
}
$version = (& codeql version --format=json | Out-String | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { throw 'CodeQL CLI is unavailable.' }
$nodeVersion = & node --version
if ($LASTEXITCODE -ne 0 -or [int]($nodeVersion -replace '^v(\d+).*$', '$1') -lt 24) { throw 'Node.js 24 or newer is required for native TypeScript execution.' }
$queries = Join-Path $repo 'codeql-queries/codeql-custom-queries-javascript'
$libraryPath = & codeql resolve library-path "--query=$(Join-Path $queries 'extended.ql')"
if ($LASTEXITCODE -ne 0 -or -not (($libraryPath -join '') -match 'javascript-all[\\/]2\.10\.0')) { throw 'Install the CodeQL bundle containing codeql/javascript-all 2.10.0.' }
function Get-SourceHashes {
  $snapshot = [ordered]@{}
  Get-ChildItem -LiteralPath $source -Recurse -File | Where-Object { $_.Extension -in @('.ts','.tsx','.js','.jsx') -and $_.FullName -notmatch '[\\/]node_modules[\\/]' } | Sort-Object FullName | ForEach-Object {
    $key = $_.FullName.Substring($source.TrimEnd('\','/').Length + 1).Replace('\','/')
    $snapshot[$key] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  return $snapshot
}
$hashes = Get-SourceHashes
Invoke-Stage 'database' { Invoke-Native 'codeql' @('database','create',$database,'--language=javascript-typescript',"--source-root=$source",'--build-mode=none',"--threads=$Threads","--ram=$Ram") }
$modes = @('inventory','baseline','baseline-units','standard-value','standard-taint','extended','extended-state')
foreach ($mode in $modes) {
  $query = Join-Path $queries "$mode.ql"
  $bqrs = Join-Path $output "$mode.bqrs"
  Invoke-Stage "query:$mode" { Invoke-Native 'codeql' @('query','run',$query,"--database=$database","--output=$bqrs","--threads=$Threads","--ram=$Ram") }
  $decoded = Join-Path $output "$mode.raw.json"
  Invoke-Stage "decode:$mode" { Invoke-Native 'codeql' @('bqrs','decode',$bqrs,'--format=json','--entities=id',"--output=$decoded") }
}
$limits = @{ maxDepth=$MaxDepth; maxContexts=$MaxContexts; maxPaths=$MaxPaths; maxSteps=$MaxSteps } | ConvertTo-Json -Compress
$limitsPath = Join-Path $output 'limits.json'
[IO.File]::WriteAllText($limitsPath, $limits, $utf8)
foreach ($mode in @('standard-value','standard-taint','extended','extended-state')) {
  Invoke-Stage "export:$mode" { Invoke-Native 'node' @((Join-Path $PSScriptRoot 'export.ts'),(Join-Path $output 'inventory.raw.json'),(Join-Path $output "$mode.raw.json"),$source,$mode,(Join-Path $output "$mode.json"),$limitsPath) }
}
$currentHashes = Get-SourceHashes
if ($currentHashes.Count -ne $hashes.Count) { throw 'Source files were added or removed during analysis.' }
foreach ($key in $hashes.Keys) {
  if ($currentHashes[$key] -ne $hashes[$key]) { throw "Source changed during analysis: $key" }
}
if (-not $SkipRender) {
  Invoke-Stage 'graphviz' { & (Join-Path $PSScriptRoot 'render.ps1') -JsonPath (Join-Path $output 'extended-state.json') }
}
if ($Expectations) {
  Invoke-Stage 'compare' { Invoke-Native 'node' @((Join-Path $PSScriptRoot 'check.ts'),$output,(Resolve-Path -LiteralPath $Expectations).Path,$source) }
}
$manifest = [ordered]@{ schemaVersion='1.0.0'; codeql=$version.version; javascriptAll='2.10.0'; node=$nodeVersion; powershell=$PSVersionTable.PSVersion.ToString(); sourceHashes=$hashes; limits=($limits | ConvertFrom-Json); stages=$timings; database=$database }
$manifest['resultSchemaVersion'] = '2.0.0'
[IO.File]::WriteAllText((Join-Path $output 'run.json'), ($manifest | ConvertTo-Json -Depth 12), $utf8)
Write-Output "Analysis written to $output"

