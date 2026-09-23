param([string]$OutputDirectory = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$rows = @(Import-Csv (Join-Path $OutputDirectory 'edges.csv') -Header parentId,parentLabel,parentUrl,childId,childLabel,childUrl)
$nodes = @{}
foreach ($row in $rows) {
  $nodes[$row.parentId] = @($row.parentLabel, $row.parentUrl)
  $nodes[$row.childId] = @($row.childLabel, $row.childUrl)
}
function Escape-Dot([string]$Value) { $Value.Replace('\', '\\').Replace('"', '\"') }
$groups = @{}
$effectCount = 0
foreach ($id in $nodes.Keys) {
  $label, $url = $nodes[$id]
  $location = ($url -split '/')[-1] -split ':'
  $file = $location[0]
  if (-not $groups.ContainsKey($file)) { $groups[$file] = @() }
  $effect = $label.StartsWith('useEffe')
  if ($effect) { $label = 'useEffect'; $effectCount++ }
  $groups[$file] += [pscustomobject]@{ Id=$id; Label=$label; Url=$url; Line=[int]$location[1]; Effect=$effect }
}
$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add('digraph UseEffects {')
$lines.Add('graph [rankdir=LR, bgcolor="#f5f7fb", pad="0.5", nodesep="0.28", ranksep="0.7", compound=true, fontname="Segoe UI", fontsize=18, fontcolor="#17233c"];')
$lines.Add('node [shape=box, style="rounded,filled", margin="0.22,0.14", fontname="Segoe UI", fontsize=12, penwidth=1.2];')
$lines.Add('edge [color="#9aaac2", penwidth=1.3, arrowsize=0.65];')
$index = 0
foreach ($file in ($groups.Keys | Sort-Object)) {
  $lines.Add(('subgraph cluster_{0} {{ label="{1}"; labeljust=l; style="rounded,filled"; color="#dce3ee"; fillcolor="white"; margin=24;' -f $index, (Escape-Dot $file)))
  foreach ($node in ($groups[$file] | Sort-Object Line,Label)) {
    $fill = '#f0f5ff'; $stroke = '#c8d8f3'; $ink = '#254b82'
    if ($node.Effect) { $fill = '#ede9fe'; $stroke = '#c4b5fd'; $ink = '#5b36a8' }
    $label = [System.Net.WebUtility]::HtmlEncode($node.Label)
    $lines.Add(('"{0}" [label=<<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0"><TR><TD ALIGN="LEFT"><FONT COLOR="{1}"><B>{2}</B></FONT></TD></TR><TR><TD ALIGN="LEFT"><FONT COLOR="#738199" POINT-SIZE="10">line {3}</FONT></TD></TR></TABLE>>, fillcolor="{4}", color="{5}", URL="{6}", tooltip="{7}:{3}"];' -f $node.Id,$ink,$label,$node.Line,$fill,$stroke,(Escape-Dot $node.Url),(Escape-Dot $file)))
  }
  $lines.Add('}')
  $index++
}
foreach ($row in $rows) { $lines.Add(('"{0}" -> "{1}";' -f $row.parentId,$row.childId)) }
$lines.Add('}')
$utf8 = [System.Text.UTF8Encoding]::new($false)
$dotPath = Join-Path $OutputDirectory 'use-effects.dot'
[System.IO.File]::WriteAllLines($dotPath, $lines, $utf8)
foreach ($format in @('svg', 'png')) {
  & dot "-T$format" $dotPath -o (Join-Path $OutputDirectory "use-effects.$format")
  if ($LASTEXITCODE -ne 0) { throw "Graphviz failed to render $format" }
}
$svg = Get-Content -Raw (Join-Path $OutputDirectory 'use-effects.svg')
$svg = $svg.Substring($svg.IndexOf('<svg'))
$template = Get-Content -Raw (Join-Path $PSScriptRoot 'viewer-template.html')
$html = $template.Replace('{{GRAPH}}', $svg).Replace('{{EFFECTS}}', [string]$effectCount).Replace('{{NODES}}', [string]$nodes.Count).Replace('{{EDGES}}', [string]$rows.Count).Replace('{{FILES}}', [string]$groups.Count)
[System.IO.File]::WriteAllText((Join-Path $OutputDirectory 'use-effects.html'), $html, $utf8)
Write-Output "Rendered $($nodes.Count) nodes and $($rows.Count) edges across $($groups.Count) files."
