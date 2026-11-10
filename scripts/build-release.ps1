param(
  [string]$ExpectedVersion = "",
  [string]$OutputDirectory = "dist"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$manifestPath = Join-Path $repoRoot "manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$version = [string]$manifest.version

if ($ExpectedVersion -and $ExpectedVersion.TrimStart("v") -ne $version) {
  throw "A tag/versão '$ExpectedVersion' não corresponde ao manifest '$version'."
}

$outputRoot = if ([IO.Path]::IsPathRooted($OutputDirectory)) {
  [IO.Path]::GetFullPath($OutputDirectory)
} else {
  [IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
}

$repoPrefix = $repoRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $outputRoot.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "A pasta de saída deve permanecer dentro do repositório: $outputRoot"
}

if (Test-Path -LiteralPath $outputRoot) {
  Remove-Item -LiteralPath $outputRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $outputRoot | Out-Null

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("snaptudo-release-" + [Guid]::NewGuid().ToString("N"))
$stageRoot = Join-Path $tempRoot "package"
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

try {
  $runtimeItems = @(
    "background",
    "content",
    "icons",
    "lib",
    "popup",
    "recipes",
    "manifest.json",
    "README.md",
    "LICENSE",
    "PRIVACY.md",
    "THIRD_PARTY_NOTICES.md"
  )

  foreach ($item in $runtimeItems) {
    $source = Join-Path $repoRoot $item
    if (-not (Test-Path -LiteralPath $source)) {
      throw "Item obrigatório ausente: $item"
    }
    Copy-Item -LiteralPath $source -Destination $stageRoot -Recurse -Force
  }

  $zipName = "snaptudo-v$version.zip"
  $zipPath = Join-Path $outputRoot $zipName
  Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal

  $sha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $checksumPath = Join-Path $outputRoot "$zipName.sha256"
  [IO.File]::WriteAllText($checksumPath, "$sha256  $zipName`n", [Text.UTF8Encoding]::new($false))

  [pscustomobject]@{
    Version = $version
    Package = $zipPath
    Sha256 = $sha256
    Checksum = $checksumPath
  } | Format-List
}
finally {
  $tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
  if ($resolvedTemp.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTemp)) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}
