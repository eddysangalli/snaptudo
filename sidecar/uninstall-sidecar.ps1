param(
  [string]$InstallDirectory = "$env:ProgramData\SnapTudo\Sidecar",
  [switch]$KeepLogs
)

$ErrorActionPreference = "Stop"
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $elevatedArgs = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", ('"' + $PSCommandPath + '"'),
    "-InstallDirectory", ('"' + $InstallDirectory + '"')
  )
  if ($KeepLogs) { $elevatedArgs += "-KeepLogs" }
  $elevated = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $elevatedArgs -PassThru -Wait
  exit $elevated.ExitCode
}

$hostName = "com.eddysangalli.snaptudo"
$registryPaths = @(
  "Software\Google\Chrome\NativeMessagingHosts\$hostName",
  "Software\Microsoft\Edge\NativeMessagingHosts\$hostName",
  "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\$hostName"
)

$registryRoots = @("HKCU", "HKLM")

foreach ($root in $registryRoots) {
  foreach ($path in $registryPaths) {
    foreach ($view in @("32", "64")) {
      & reg.exe delete "$root\$path" /f "/reg:$view" 2>$null | Out-Null
    }
  }
}

$installRoot = [IO.Path]::GetFullPath($InstallDirectory)
$allowedRoots = @(
  [IO.Path]::GetFullPath("$env:ProgramData\SnapTudo").TrimEnd('\') + '\',
  [IO.Path]::GetFullPath("$env:LOCALAPPDATA\SnapTudo").TrimEnd('\') + '\'
)
$isAllowed = $false
foreach ($root in $allowedRoots) {
  if ($installRoot.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
    $isAllowed = $true
    break
  }
}
if (-not $isAllowed) {
  throw "Recusado remover pasta fora das raízes do SnapTudo."
}

if (Test-Path -LiteralPath $installRoot) {
  if ($KeepLogs) {
    Get-ChildItem -LiteralPath $installRoot -Force | Where-Object Name -ne "logs" | Remove-Item -Recurse -Force
  } else {
    Remove-Item -LiteralPath $installRoot -Recurse -Force
  }
}
Write-Output "Registro do sidecar removido. Os downloads do usuário foram preservados."
