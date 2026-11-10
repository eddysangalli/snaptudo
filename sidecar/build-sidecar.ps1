param(
  [Parameter(Mandatory = $true)]
  [string]$Version,
  [string]$OutputDirectory = "..\dist"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$sidecarRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$repoRoot = [IO.Path]::GetFullPath((Join-Path $sidecarRoot ".."))
$outputRoot = [IO.Path]::GetFullPath((Join-Path $sidecarRoot $OutputDirectory))
$repoPrefix = $repoRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $outputRoot.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "A saída do sidecar deve permanecer dentro do repositório."
}
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

$buildRoot = Join-Path $sidecarRoot "build"
if (Test-Path -LiteralPath $buildRoot) {
  Remove-Item -LiteralPath $buildRoot -Recurse -Force
}
$packageRoot = Join-Path $buildRoot "package"
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null

Push-Location $sidecarRoot
try {
  & go test ./...
  if ($LASTEXITCODE -ne 0) { throw "Testes Go do sidecar falharam." }

  $env:GOOS = "windows"
  $env:GOARCH = "amd64"
  $env:CGO_ENABLED = "0"
  & go build -trimpath -ldflags "-s -w -X main.version=$Version" -o (Join-Path $packageRoot "snaptudo-sidecar.exe") ./cmd/snaptudo-sidecar
  if ($LASTEXITCODE -ne 0) { throw "Build Go do sidecar falhou." }
}
finally {
  Pop-Location
}

$headers = @{ "User-Agent" = "SnapTudo-sidecar-builder" }
if ($env:GITHUB_TOKEN) { $headers.Authorization = "Bearer $env:GITHUB_TOKEN" }
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest" -Headers $headers
$ytDlpAsset = $release.assets | Where-Object name -eq "yt-dlp.exe"
if (-not $ytDlpAsset -or -not $ytDlpAsset.digest) {
  throw "Release oficial do yt-dlp sem yt-dlp.exe ou digest."
}
$ytDlpPath = Join-Path $packageRoot "yt-dlp.exe"
Invoke-WebRequest -Uri $ytDlpAsset.browser_download_url -OutFile $ytDlpPath -Headers $headers
$actualYtDlpHash = (Get-FileHash -LiteralPath $ytDlpPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ytDlpAsset.digest -ne ("sha256:" + $actualYtDlpHash)) {
  throw "SHA-256 do yt-dlp oficial divergiu."
}

Copy-Item -LiteralPath (Join-Path $sidecarRoot "install-sidecar.ps1") -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $sidecarRoot "uninstall-sidecar.ps1") -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $sidecarRoot "README.md") -Destination $packageRoot

$metadata = [ordered]@{
  sidecarVersion = $Version.TrimStart("v")
  snapTudoVersion = $Version.TrimStart("v")
  ytDlpVersion = $release.tag_name
  ytDlpSha256 = $actualYtDlpHash
  builtAt = [DateTimeOffset]::UtcNow.ToString("o")
  extensionId = "epjkbhcahfaojangofedoginhmcjbfol"
}
$metadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $packageRoot "versions.json") -Encoding utf8

$zipName = "snaptudo-sidecar-v$($Version.TrimStart('v'))-win-x64.zip"
$zipPath = Join-Path $outputRoot $zipName
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $packageRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$zipPath.sha256", "$zipHash  $zipName`n", [Text.UTF8Encoding]::new($false))

[pscustomobject]@{
  Version = $Version.TrimStart("v")
  Package = $zipPath
  Sha256 = $zipHash
  YtDlpVersion = $release.tag_name
  YtDlpSha256 = $actualYtDlpHash
} | Format-List
