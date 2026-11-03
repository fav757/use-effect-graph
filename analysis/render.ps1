param([Parameter(Mandatory=$true)][string]$JsonPath)
$ErrorActionPreference = 'Stop'
$json = (Resolve-Path -LiteralPath $JsonPath).Path
$result = Get-Content -LiteralPath $json -Raw -Encoding UTF8 | ConvertFrom-Json
$directory = [IO.Path]::GetDirectoryName($json)
$stem = [IO.Path]::GetFileNameWithoutExtension($json)
& node (Join-Path $PSScriptRoot 'render.ts') $json
if ($LASTEXITCODE -ne 0) { throw 'JSON to DOT conversion failed.' }
foreach ($format in @('svg','png')) {
  & dot "-T$format" (Join-Path $directory "$stem.dot") -o (Join-Path $directory "$stem.$format")
  if ($LASTEXITCODE -ne 0) { throw "Graphviz failed: $format" }
}
$svg = Get-Content -LiteralPath (Join-Path $directory "$stem.svg") -Raw -Encoding UTF8
$svg = $svg.Substring($svg.IndexOf('<svg'))
$template = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../codeql-graph/viewer-template.html') -Raw -Encoding UTF8
$html = $template.Replace('{{GRAPH}}',$svg).Replace('{{EFFECTS}}',[string]@($result.effects).Count).Replace('{{NODES}}',[string]@($result.entities).Count).Replace('{{EDGES}}',[string]@($result.edges).Count).Replace('{{FILES}}',[string]@($result.entities.location.file | Sort-Object -Unique).Count)
$html = $html.Replace('use-effects.svg',"$stem.svg").Replace('use-effects.png',"$stem.png")
$html = $html.Replace('Effect and callback map','Effect provenance').Replace('Trace effect dependencies and callback captures.','Sources flow toward effects. Dashed captures and dotted hook declarations are annotations.')
$html = $html.Replace('Grouped by source file','Modeled provenance paths')
$html = $html -replace '<div class="legend" aria-label="Graph legend">.*?</div><div class="controls"', '<div class="legend" aria-label="Graph legend"><span>Solid: modeled flow</span><span>Dashed: lexical capture</span><span>Dotted: declared Hook dependency</span></div><div class="controls"'
[IO.File]::WriteAllText((Join-Path $directory "$stem.html"), $html, [Text.UTF8Encoding]::new($false))
Write-Output "Graph viewer: $(Join-Path $directory "$stem.html")"

