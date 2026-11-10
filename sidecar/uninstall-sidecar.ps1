param(
  [string]$InstallDirectory = "$env:LOCALAPPDATA\SnapTudo\Sidecar",
  [switch]$KeepLogs
)

$ErrorActionPreference = "Stop"
$hostName = "com.eddysangalli.snaptudo"
$registryKeys = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName",
  "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\$hostName"
)
foreach ($key in $registryKeys) {
  if (Test-Path -LiteralPath $key) {
    Remove-Item -LiteralPath $key -Recurse -Force
  }
}

$installRoot = [IO.Path]::GetFullPath($InstallDirectory)
$expectedRoot = [IO.Path]::GetFullPath("$env:LOCALAPPDATA\SnapTudo").TrimEnd('\') + '\'
if (-not $installRoot.StartsWith($expectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Recusado remover pasta fora de $expectedRoot"
}

if (Test-Path -LiteralPath $installRoot) {
  if ($KeepLogs) {
    Get-ChildItem -LiteralPath $installRoot -Force | Where-Object Name -ne "logs" | Remove-Item -Recurse -Force
  } else {
    Remove-Item -LiteralPath $installRoot -Recurse -Force
  }
}
Write-Output "Registro do sidecar removido. Os downloads do usuário foram preservados."
