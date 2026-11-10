$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$manifestPath = Join-Path $repoRoot "manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json

if ($manifest.manifest_version -ne 3) {
  throw "manifest_version deve ser 3."
}
if ([string]$manifest.version -notmatch '^\d+\.\d+\.\d+(\.\d+)?$') {
  throw "Versão inválida no manifest: $($manifest.version)"
}

$requiredFiles = @(
  [string]$manifest.background.service_worker,
  [string]$manifest.action.default_popup
)
foreach ($contentScript in $manifest.content_scripts) {
  if ($contentScript.PSObject.Properties.Name -contains "js") {
    $requiredFiles += @($contentScript.js)
  }
  if ($contentScript.PSObject.Properties.Name -contains "css") {
    $requiredFiles += @($contentScript.css)
  }
}
foreach ($iconProperty in $manifest.icons.PSObject.Properties) {
  $requiredFiles += [string]$iconProperty.Value
}

foreach ($relativePath in $requiredFiles | Where-Object { $_ } | Sort-Object -Unique) {
  $fullPath = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    throw "Arquivo referenciado pelo manifest não existe: $relativePath"
  }
}

if (Test-Path -LiteralPath (Join-Path $repoRoot "lib\mux.js")) {
  throw "lib/mux.js não pode ser publicado: arquivo de terceiro sem proveniência redistribuível."
}

$javascriptFiles = Get-ChildItem -LiteralPath $repoRoot -Recurse -File -Filter "*.js" |
  Where-Object { $_.FullName -notlike "*\.git\*" }
foreach ($file in $javascriptFiles) {
  & node --check $file.FullName
  if ($LASTEXITCODE -ne 0) {
    throw "Falha de sintaxe JavaScript: $($file.FullName)"
  }
}

& node (Join-Path $repoRoot "tests\updater.test.js")
if ($LASTEXITCODE -ne 0) {
  throw "Testes do atualizador falharam."
}

Write-Output "Verificação concluída: manifest v$($manifest.version), $($javascriptFiles.Count) arquivos JavaScript."
