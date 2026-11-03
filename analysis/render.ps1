param([Parameter(Mandatory=$true)][string]$JsonPath)
$ErrorActionPreference = 'Stop'
$json = (Resolve-Path -LiteralPath $JsonPath).Path
$directory = [IO.Path]::GetDirectoryName($json)
$stem = [IO.Path]::GetFileNameWithoutExtension($json)
& node (Join-Path $PSScriptRoot 'render.ts') $json
if ($LASTEXITCODE -ne 0) { throw 'JSON to DOT conversion failed.' }
foreach ($format in @('svg','png')) {
  & dot "-T$format" (Join-Path $directory "$stem.dot") -o (Join-Path $directory "$stem.$format")
  if ($LASTEXITCODE -ne 0) { throw "Graphviz failed: $format" }
}
& node (Join-Path $PSScriptRoot 'render.ts') $json --html
if ($LASTEXITCODE -ne 0) { throw 'Report HTML generation failed.' }
Write-Output "Graph viewer: $(Join-Path $directory "$stem.html")"

