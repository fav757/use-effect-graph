# use-effect-graph

The extended analyzer exports structured provenance JSON, contextual paths,
state boundaries/history, and a JSON-based Graphviz viewer. See
[analysis/README.md](analysis/README.md) for the reproducible workflow and
comparison with the preserved baseline described below.

This project contains a custom CodeQL graph query for React `useEffect`
dependencies and callback patterns. The query finds `useEffect` calls with
array-literal dependency lists, follows the variables referenced by each entry,
and shows Effect Events and stable callbacks on separate paths.

For example:

```ts
const request = makeRequest(userId)

useEffect(() => {
  // ...
}, [request])
```

Produces edges similar to:

```text
useEffect -> request -> makeRequest
                     -> userId
```

The query is located at
`codeql-queries/codeql-custom-queries-javascript/example.ql`.

## Callback examples in the dashboard

- `ActivityFeed` uses `useEffectEvent` for its automatic refresh timer. Each tick
  reads the latest loading state so it skips an overlapping fetch, and records
  the filter active when that refresh was requested. Changing the filter or
  loading state does not restart the timer.
- `SettingsPanel` uses the local `useStableCallback` hook for closing settings
  by button or Escape. The key listener remains attached while the callback
  reads the latest open state. The hook keeps one function identity and updates
  its callback ref in a layout effect after each callback change.

In the styled graph, a solid line from an effect is a dependency or source
relationship. A dotted line means the effect invokes an Effect Event. A dashed
line from either callback hook shows a captured value read by its callback;
those values do not become effect dependencies just because the callback reads
them. `useEffectEvent` is called only from the timer effect and is omitted from
its dependency list.

## Prerequisites

- PowerShell
- The CodeQL CLI available as `codeql`
- Graphviz available as `dot`
- Project dependencies installed if you also want to run the React example

Check the command-line tools with:

```powershell
codeql version
dot -V
```

## Generate the graph

Graph generation has four distinct stages:

```text
source code -> CodeQL database -> BQRS results -> DOT -> HTML/SVG/PNG
```

Run all commands below from the repository root. Databases belong under
`codeql-db/` (ignored by Git); graph data and rendered outputs belong under
`codeql-graph/`.

### 1. Create a current CodeQL database

A CodeQL database is a snapshot. Running the query again does **not** import
source edits into an existing database. Recreate the database after changing
the application:

```powershell
codeql database create codeql-db\current-db `
  --language=javascript-typescript `
  --source-root=. `
  --overwrite
```

`--overwrite` replaces only the generated database at
`codeql-db/current-db`. For JavaScript/TypeScript, CodeQL runs its extractor;
this does not run the project's `npm run build` command.

### 2. Run the query

```powershell
codeql query run `
  codeql-queries\codeql-custom-queries-javascript\example.ql `
  --database=codeql-db\current-db `
  --output=codeql-graph\use-effects.bqrs
```

You can inspect the number of graph edges with:

```powershell
codeql bqrs info codeql-graph\use-effects.bqrs
```

The `#select` result-set row count is the number of graph edges.

### 3. Decode BQRS edges to CSV

First decode the selected edges with all entity information:

```powershell
codeql bqrs decode codeql-graph\use-effects.bqrs `
  --result-set='#select' `
  --format=csv `
  --entities=all `
  --no-titles `
  --output=codeql-graph\edges.csv
```

### 4. Choose a generation option

Both options use the same `edges.csv` from step 3 and preserve the same nodes
and connections. Choose either option after decoding the query results.

| Option | Appearance | Generation |
| --- | --- | --- |
| Classic (original) | Ungrouped graph with basic node colors and no callback edge styles | PowerShell commands below and Graphviz |
| Styled (recommended) | Source-file groups, distinct callback paths, legend, counts, zoom controls, export links | `render-graph.ps1` and `viewer-template.html` |

Both options write `codeql-graph/use-effects.dot`, `.svg`, `.png`, and `.html`.
Running either option replaces those rendered files with the selected design.
You can switch designs by running the other option without rerunning CodeQL.

#### Option A: Classic (original)

Then create the labeled DOT graph:

```powershell
$rows = Import-Csv codeql-graph\edges.csv `
  -Header parentId,parentLabel,parentUrl,childId,childLabel,childUrl

$nodes = @{}
foreach ($row in $rows) {
  $nodes[$row.parentId] = @($row.parentLabel, $row.parentUrl)
  $nodes[$row.childId] = @($row.childLabel, $row.childUrl)
}

$dotLines = [System.Collections.Generic.List[string]]::new()
$dotLines.Add('digraph UseEffects {')
$dotLines.Add('  graph [rankdir=LR, bgcolor="#fafafa", pad="0.3", nodesep="0.5", ranksep="0.8"];')
$dotLines.Add('  node [shape=box, style="rounded,filled", fillcolor="#e8f0fe", color="#5f6f89", fontname="Segoe UI"];')
$dotLines.Add('  edge [color="#708090", arrowsize="0.8"];')

foreach ($entry in $nodes.GetEnumerator()) {
  $rawLabel = [string]$entry.Value[0]
  $url = [string]$entry.Value[1]
  $location = ($url -split '/')[-1]
  $parts = $location -split ':'
  $fileName = $parts[0]
  $line = $parts[1]

  $sourcePath = ([uri]($url -replace ':\d+:\d+:\d+:\d+$', '')).LocalPath
  $sourceLine = (Get-Content -LiteralPath $sourcePath)[([int]$parts[1]) - 1]
  $callText = $sourceLine.Substring(([int]$parts[2]) - 1)

  if ($callText -match '^useEffect\s*\(') {
    $label = 'useEffect'
    $fill = '#fce8b2'
  } elseif ($callText -match '^useEffectEvent\s*\(') {
    $label = 'useEffectEvent'
    $fill = '#fff3df'
  } elseif ($callText -match '^useStableCallback\s*\(') {
    $label = 'useStableCallback'
    $fill = '#e6f7f2'
  } else {
    $label = $rawLabel.Replace('"', '\"')
    $fill = '#e8f0fe'
  }

  $dotLines.Add((
    '  "{0}" [label="{1}\n{2}:{3}", fillcolor="{4}", URL="{5}"];' -f
      $entry.Key, $label, $fileName, $line, $fill, $url
  ))
}

foreach ($row in $rows) {
  $dotLines.Add(('  "{0}" -> "{1}";' -f $row.parentId, $row.childId))
}

$dotLines.Add('}')
$dotLines | Set-Content -Encoding ascii codeql-graph\use-effects.dot
```

ASCII output is intentional. Windows PowerShell's UTF-8 encoding can add a byte
order mark that some Graphviz versions reject with a syntax error near
`digraph`.

#### Render the classic visual formats

SVG:

```powershell
dot -Tsvg codeql-graph\use-effects.dot -o codeql-graph\use-effects.svg
```

PNG:

```powershell
dot -Tpng codeql-graph\use-effects.dot -o codeql-graph\use-effects.png
```

Standalone HTML with inline SVG:

```powershell
dot -Tsvg_inline codeql-graph\use-effects.dot `
  -o codeql-graph\use-effects-inline.svg

$svg = Get-Content -Raw codeql-graph\use-effects-inline.svg
$html = '<!doctype html><html><head><meta charset="utf-8"><title>useEffect dependency graph</title><style>html,body{margin:0;min-height:100%;background:#fafafa}body{display:grid;place-items:center;padding:24px;box-sizing:border-box}svg{max-width:100%;height:auto}</style></head><body>' + $svg + '</body></html>'
$html | Set-Content -Encoding utf8 codeql-graph\use-effects.html
Remove-Item -LiteralPath codeql-graph\use-effects-inline.svg
```

Open `codeql-graph/use-effects.html` in a browser.

#### Option B: Styled (new)

Render the grouped graph and all visual formats with:

```powershell
powershell -ExecutionPolicy Bypass -File codeql-graph\render-graph.ps1
```

The renderer reads `edges.csv` and produces DOT, SVG, PNG, and standalone HTML.
Nodes are grouped by source file. Purple cards identify effects, amber cards
identify Effect Events, teal cards identify stable callbacks or hook references,
and blue cards identify values. Solid edges show dependencies and source values,
dotted edges show Effect Event invocations, and dashed edges show callback
captures. Hook calls are classified by their exact source position, so
`useEffectEvent` is never counted as `useEffect`.
The HTML viewer includes graph counts, a legend, zoom controls, and export links.

Open `codeql-graph/use-effects.html` in a browser. Customize graph styling in
`codeql-graph/render-graph.ps1` and the viewer in
`codeql-graph/viewer-template.html`, then rerun the renderer. The script writes
DOT as UTF-8 without a byte order mark for Graphviz compatibility.

## Why `dot` alone does not update the graph

This command only renders the DOT file that already exists:

```powershell
dot -Tsvg codeql-graph\use-effects.dot -o codeql-graph\use-effects.svg
```

It does not read the application, the CodeQL database, or the BQRS file. If only
the BQRS timestamp changed, `use-effects.dot` is still stale until stages 3 and 4 are
run.

Likewise, `codeql query run` reads a database snapshot. It does not detect source
changes made after that database was created.

## VS Code database lock

The CodeQL VS Code extension can keep the selected database cache locked. A CLI
query against that same database may then fail with a message similar to:

```text
Error initializing the IMB disk cache: the cache directory is already locked
```

Remove or deselect the database in the CodeQL sidebar, close the relevant VS Code
window, or use a separate database path such as `codeql-db/current-db`. Do not
delete the `.lock` file while a CodeQL query server is active.

## Current output files

The generation process creates:

- `use-effects.bqrs`: raw CodeQL query results
- `edges.csv`: decoded parent/child entities
- `use-effects.dot`: Graphviz graph source
- `use-effects.html`: browser-ready graph
- `use-effects.svg`: scalable image
- `use-effects.png`: raster preview

## Query scope and limitations

- Only calls whose callee name is `useEffect` and whose second argument is an
  array literal are included as effect roots.
- Callback paths cover local variables assigned directly from `useEffectEvent`
  or `useStableCallback`. Effect Events must be called inside a detected effect;
  stable callbacks must be reachable from an effect dependency.
- Callback capture edges exclude variables declared inside the callback. They
  are separate from the recursive effect dependency traversal.
- Entries such as `[object.property]` and `[a + b]` include every variable
  reference found inside the entry expression.
- Source traversal is transitive through assigned expressions. Nested calls,
  object and array literals, templates, and function expressions are searched.
- The analysis is syntactic and conservative. A variable with multiple assigned
  expressions can introduce multiple branches.
- Traversal can stop at parameters, imports, globals, or variables without a
  source expression available in the database.
- A locally defined function used as a callee can appear as a source node because
  it is referenced by the assigned expression.
- `getCalleeName() = "useEffect"` can also match a non-React function with that
  name. The query currently does not verify that the function was imported from
  React.
- Effects with no dependency array, a non-literal dependency array, or an empty
  array do not produce useful graph edges.

## CodeQL's built-in DOT interpreter

CodeQL supports interpreting `@kind graph` BQRS results directly as DOT.
However, with the current query and CLI setup, the auxiliary `nodes` result set
is empty even though `#select` contains the correct edges. The built-in
interpreter therefore produces an empty graph:

```text
digraph {
  compound=true;
}
```

The CSV-to-DOT step above deliberately uses the valid `#select` edges and their
entity labels instead.

## Run the example application

```powershell
npm run dev
```

The application is a React and TypeScript example built with Vite.
