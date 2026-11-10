param(
  [string]$InstallDirectory = "$env:LOCALAPPDATA\SnapTudo\Sidecar",
  [string]$DownloadDirectory = "$env:USERPROFILE\Downloads\SnapTudo"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$sourceRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$installRoot = [IO.Path]::GetFullPath($InstallDirectory)
$hostName = "com.eddysangalli.snaptudo"
$extensionId = "epjkbhcahfaojangofedoginhmcjbfol"

$required = @("snaptudo-sidecar.exe", "yt-dlp.exe")
foreach ($name in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot $name) -PathType Leaf)) {
    throw "Arquivo obrigatório ausente no pacote: $name"
  }
}

New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
New-Item -ItemType Directory -Path $DownloadDirectory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot "snaptudo-sidecar.exe") -Destination $installRoot -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "yt-dlp.exe") -Destination $installRoot -Force

$node = Get-Command node.exe -ErrorAction SilentlyContinue
$ffmpeg = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
$config = [ordered]@{
  ytDlpPath = Join-Path $installRoot "yt-dlp.exe"
  downloadDir = [IO.Path]::GetFullPath($DownloadDirectory)
  nodePath = if ($node) { $node.Source } else { "" }
  ffmpegPath = if ($ffmpeg) { $ffmpeg.Source } else { "" }
}
$config | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installRoot "config.json") -Encoding utf8

$nativeManifest = [ordered]@{
  name = $hostName
  description = "SnapTudo sidecar com yt-dlp"
  path = Join-Path $installRoot "snaptudo-sidecar.exe"
  type = "stdio"
  allowed_origins = @("chrome-extension://$extensionId/")
}
$manifestPath = Join-Path $installRoot "$hostName.json"
$nativeManifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding utf8

$registryKeys = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName",
  "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\$hostName"
)
foreach ($key in $registryKeys) {
  New-Item -Path $key -Force | Out-Null
  Set-Item -Path $key -Value $manifestPath
}

$version = & (Join-Path $installRoot "yt-dlp.exe") --version
Write-Output "Sidecar instalado em: $installRoot"
Write-Output "Downloads em: $DownloadDirectory"
Write-Output "yt-dlp: $version"
Write-Output "Node detectado: $([bool]$node)"
Write-Output "FFmpeg detectado: $([bool]$ffmpeg)"
Write-Output "Recarregue o SnapTudo em chrome://extensions para ativar o sidecar."
