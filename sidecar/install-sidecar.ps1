param(
  [string]$InstallDirectory = "$env:ProgramData\SnapTudo\Sidecar",
  [string]$DownloadDirectory = "$([Environment]::GetFolderPath('UserProfile'))\Downloads\SnapTudo"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $elevatedArgs = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", ('"' + $PSCommandPath + '"'),
    "-InstallDirectory", ('"' + $InstallDirectory + '"'),
    "-DownloadDirectory", ('"' + $DownloadDirectory + '"')
  )
  $elevated = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $elevatedArgs -PassThru -Wait
  exit $elevated.ExitCode
}

$sourceRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$installRoot = [IO.Path]::GetFullPath($InstallDirectory)
$hostName = "com.eddysangalli.snaptudo"
$extensionId = "epjkbhcahfaojangofedoginhmcjbfol"
$utf8NoBom = [Text.UTF8Encoding]::new($false)

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
[IO.File]::WriteAllText(
  (Join-Path $installRoot "config.json"),
  ($config | ConvertTo-Json),
  $utf8NoBom
)

$nativeManifest = [ordered]@{
  name = $hostName
  description = "SnapTudo sidecar com yt-dlp"
  path = Join-Path $installRoot "snaptudo-sidecar.exe"
  type = "stdio"
  allowed_origins = @("chrome-extension://$extensionId/")
}
$manifestPath = Join-Path $installRoot "$hostName.json"
[IO.File]::WriteAllText(
  $manifestPath,
  ($nativeManifest | ConvertTo-Json -Depth 4),
  $utf8NoBom
)

$registryPaths = @(
  "Software\Google\Chrome\NativeMessagingHosts\$hostName",
  "Software\Microsoft\Edge\NativeMessagingHosts\$hostName",
  "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\$hostName"
)

$registryRoots = @("HKCU", "HKLM")

foreach ($root in $registryRoots) {
  foreach ($path in $registryPaths) {
    foreach ($view in @("32", "64")) {
      & reg.exe add "$root\$path" /ve /t REG_SZ /d $manifestPath /f "/reg:$view" | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "Falha ao registrar $root\$path na visão $view-bit."
      }
    }
  }
}

$version = & (Join-Path $installRoot "yt-dlp.exe") --version
Write-Output "Sidecar instalado em: $installRoot"
Write-Output "Downloads em: $DownloadDirectory"
Write-Output "yt-dlp: $version"
Write-Output "Node detectado: $([bool]$node)"
Write-Output "FFmpeg detectado: $([bool]$ffmpeg)"
Write-Output "Registro: $($registryRoots -join ', ') (32 e 64 bits)"
Write-Output "Recarregue o SnapTudo em chrome://extensions para ativar o sidecar."
