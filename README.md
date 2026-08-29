# use-effect-graph

This project contains a custom CodeQL graph query for React `useEffect`
dependencies. The query finds `useEffect` calls with array-literal dependency
lists, adds the variables referenced by each array entry, and recursively follows
variables referenced by their assigned expressions.

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

Run all commands below from the repository root.

### 1. Create a current CodeQL database

A CodeQL database is a snapshot. Running the query again does **not** import
source edits into an existing database. Recreate the database after changing
the application:

```powershell
codeql database create codeql-graph\current-db `
  --language=javascript-typescript `
  --source-root=. `
  --overwrite
```

`--overwrite` replaces only the generated database at
`codeql-graph/current-db`. For JavaScript/TypeScript, CodeQL runs its extractor;
this does not run the project's `npm run build` command.

### 2. Run the query

```powershell
codeql query run `
  codeql-queries\codeql-custom-queries-javascript\example.ql `
  --database=codeql-graph\current-db `
  --output=codeql-graph\use-effects.bqrs
```

You can inspect the number of graph edges with:

```powershell
codeql bqrs info codeql-graph\use-effects.bqrs
```

The `#select` result-set row count is the number of graph edges.

### 3. Convert BQRS edges to Graphviz DOT

First decode the selected edges with all entity information:

```powershell
codeql bqrs decode codeql-graph\use-effects.bqrs `
  --result-set='#select' `
  --format=csv `
  --entities=all `
  --no-titles `
  --output=codeql-graph\edges.csv
```

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

  if ($rawLabel.StartsWith('useEffe')) {
    $label = 'useEffect'
    $fill = '#fce8b2'
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

### 4. Render the visual formats

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

## Why `dot` alone does not update the graph

This command only renders the DOT file that already exists:

```powershell
dot -Tsvg codeql-graph\use-effects.dot -o codeql-graph\use-effects.svg
```

It does not read the application, the CodeQL database, or the BQRS file. If only
the BQRS timestamp changed, `use-effects.dot` is still stale until stage 3 is
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
window, or use a separate database path such as `codeql-graph/current-db`. Do not
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
  array literal are included.
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
