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

$publicKey = [Convert]::FromBase64String([string]$manifest.key)
$keyHash = [Security.Cryptography.SHA256]::HashData($publicKey)
$idAlphabet = "abcdefghijklmnop"
$extensionIdChars = for ($i = 0; $i -lt 16; $i++) {
  $idAlphabet[[int]($keyHash[$i] -shr 4)]
  $idAlphabet[[int]($keyHash[$i] -band 15)]
}
$extensionId = -join $extensionIdChars
if ($extensionId -ne "epjkbhcahfaojangofedoginhmcjbfol") {
  throw "A chave do manifest gerou ID inesperado: $extensionId"
}
$sidecarInstaller = Get-Content -LiteralPath (Join-Path $repoRoot "sidecar\install-sidecar.ps1") -Raw
if (-not $sidecarInstaller.Contains($extensionId)) {
  throw "O instalador do sidecar não autoriza o ID fixo da extensão."
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

& node (Join-Path $repoRoot "tests\instagram-filename.test.js")
if ($LASTEXITCODE -ne 0) {
  throw "Testes de nomes do Instagram falharam."
}

& node (Join-Path $repoRoot "tests\story-main-world.browser.test.js")
if ($LASTEXITCODE -ne 0) {
  throw "Teste do fluxo ativo de Stories falhou."
}

& node (Join-Path $repoRoot "tests\sidecar-compat.test.js")
if ($LASTEXITCODE -ne 0) {
  throw "Testes de compatibilidade do sidecar falharam."
}

Push-Location (Join-Path $repoRoot "sidecar")
try {
  & go test ./...
  if ($LASTEXITCODE -ne 0) {
    throw "Testes Go do sidecar falharam."
  }
}
finally {
  Pop-Location
}

Write-Output "Verificação concluída: manifest v$($manifest.version), $($javascriptFiles.Count) arquivos JavaScript e sidecar Go."
