[CmdletBinding()]
param(
  [string]$TargetRoot = (Join-Path $env:LOCALAPPDATA 'FORGE\forge-v1-portable')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Fail-Closed([string]$Message) {
  [ordered]@{ schema_version='1.0.0'; status='FAIL_CLOSED'; message=$Message } | ConvertTo-Json -Depth 5
  exit 3
}

$target = [IO.Path]::GetFullPath($TargetRoot)
$protected = @(
  [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('UserProfile')) '.agent-shared')),
  [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex')),
  [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex-maxplus'))
)
foreach ($root in $protected) {
  if ($target.TrimEnd('\') -eq $root.TrimEnd('\') -or $target.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    Fail-Closed "Refusing protected target root: $target"
  }
}
$receiptPath = Join-Path $target '.forge-portable-install.json'
if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) {
  [ordered]@{ schema_version='1.0.0'; checkpoint='P11_PORTABLE_ROLLBACK'; status='NO_OP'; target_root=$target; removed_files=0 } | ConvertTo-Json
  exit 0
}
$receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
foreach ($entry in $receipt.managed_files) {
  $file = Join-Path $target ($entry.path -replace '/', '\')
  if (Test-Path -LiteralPath $file) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { Fail-Closed "Managed path is not a file: $($entry.path)" }
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $entry.sha256) { Fail-Closed "Managed payload drift; refusing rollback: $($entry.path)" }
  }
}
$configPath = Join-Path $target 'machine-config.json'
if (Test-Path -LiteralPath $configPath -PathType Leaf) {
  $configHash = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($configHash -ne $receipt.machine_config_sha256) { Fail-Closed 'Machine config changed; refusing to delete it automatically.' }
}
$registryPath = Join-Path $target 'machine-inputs\Model_Intelligence\MODEL_REGISTRY.json'
if (Test-Path -LiteralPath $registryPath -PathType Leaf) {
  $registryHash = (Get-FileHash -LiteralPath $registryPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($registryHash -ne $receipt.machine_registry_sha256) { Fail-Closed 'Machine registry changed; refusing to delete it automatically.' }
}
$removed = 0
foreach ($entry in @($receipt.managed_files | Sort-Object { $_.path.Length } -Descending)) {
  $file = Join-Path $target ($entry.path -replace '/', '\')
  if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file -Force; $removed++ }
}
foreach ($ownedDir in @('state','sandbox','machine-inputs')) {
  $dir = Join-Path $target $ownedDir
  if (Test-Path -LiteralPath $dir -PathType Container) { Remove-Item -LiteralPath $dir -Recurse -Force }
}
if (Test-Path -LiteralPath $configPath -PathType Leaf) { Remove-Item -LiteralPath $configPath -Force }
Remove-Item -LiteralPath $receiptPath -Force
$directories = @(Get-ChildItem -LiteralPath $target -Directory -Recurse -Force -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending)
foreach ($dir in $directories) {
  if (@(Get-ChildItem -LiteralPath $dir.FullName -Force -ErrorAction SilentlyContinue).Count -eq 0) { Remove-Item -LiteralPath $dir.FullName -Force }
}
$remaining = @(Get-ChildItem -LiteralPath $target -Force -ErrorAction SilentlyContinue)
if ($remaining.Count -eq 0) { Remove-Item -LiteralPath $target -Force }
[ordered]@{
  schema_version='1.0.0'; checkpoint='P11_PORTABLE_ROLLBACK'; status='ROLLED_BACK'
  package_id=$receipt.package_id; target_root=$target; removed_files=$removed
  provider_homes_modified=$false; credentials_modified=$false
} | ConvertTo-Json -Depth 6
