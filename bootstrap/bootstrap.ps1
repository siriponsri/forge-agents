[CmdletBinding()]
param(
  [string]$TargetRoot = (Join-Path $env:LOCALAPPDATA 'FORGE\forge-v1-portable'),
  [string]$FixtureJson
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Fail-Closed([string]$Message) {
  [ordered]@{ schema_version='1.0.0'; status='FAIL_CLOSED'; message=$Message; model_backed_calls=0 } | ConvertTo-Json -Depth 5
  exit 3
}

$packageRoot = [IO.Path]::GetFullPath($PSScriptRoot)
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
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem) { Fail-Closed 'Supported platform is 64-bit Windows.' }

$manifestPath = Join-Path $packageRoot 'P11_PORTABLE_PACKAGE_MANIFEST.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { Fail-Closed 'Package manifest missing.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.credentials_included -ne $false -or $manifest.plur_enabled -ne $false) { Fail-Closed 'Package security flags are invalid.' }
$receiptPath = Join-Path $target '.forge-portable-install.json'

if (Test-Path -LiteralPath $target -PathType Container) {
  $existing = @(Get-ChildItem -LiteralPath $target -Force -ErrorAction Stop)
  if ($existing.Count -gt 0 -and -not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) {
    Fail-Closed 'Target is not empty and has no matching FORGE install receipt.'
  }
}

if (Test-Path -LiteralPath $receiptPath -PathType Leaf) {
  $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  if ($receipt.package_id -ne $manifest.package_id) { Fail-Closed 'Existing installation belongs to another package ID.' }
  foreach ($entry in $manifest.payload_files) {
    $file = Join-Path $target ($entry.path -replace '/', '\')
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { Fail-Closed "Installed payload missing: $($entry.path)" }
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $entry.sha256) { Fail-Closed "Installed payload drift: $($entry.path)" }
  }
  $registryPath = Join-Path $target 'machine-inputs\Model_Intelligence\MODEL_REGISTRY.json'
  if (-not (Test-Path -LiteralPath $registryPath -PathType Leaf)) { Fail-Closed 'Machine-local model registry is missing.' }
  $registryHash = (Get-FileHash -LiteralPath $registryPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($registryHash -ne $receipt.machine_registry_sha256) { Fail-Closed 'Machine-local model registry drift.' }
  $doctorArgs = @{ TargetRoot=$target }
  if ($FixtureJson) { $doctorArgs.FixtureJson = $FixtureJson }
  $doctorText = & (Join-Path $packageRoot 'doctor.ps1') @doctorArgs
  $doctor = $doctorText | ConvertFrom-Json
  [ordered]@{
    schema_version='1.0.0'; checkpoint='P11_PORTABLE_BOOTSTRAP'; status=$doctor.status
    package_id=$manifest.package_id; target_root=$target; idempotent=$true; files_copied=0
    doctor=$doctor; credentials_copied=$false; provider_homes_modified=$false; model_backed_calls=0
  } | ConvertTo-Json -Depth 15
  exit 0
}

New-Item -ItemType Directory -Path $target -Force | Out-Null
$copied = [System.Collections.Generic.List[object]]::new()
try {
  foreach ($entry in $manifest.payload_files) {
    $source = Join-Path $packageRoot ('payload\' + ($entry.path -replace '/', '\'))
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Package payload missing: $($entry.path)" }
    $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($sourceHash -ne $entry.sha256) { throw "Package payload hash mismatch: $($entry.path)" }
    $destination = Join-Path $target ($entry.path -replace '/', '\')
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
    $destinationHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($destinationHash -ne $entry.sha256) { throw "Copied payload hash mismatch: $($entry.path)" }
    $copied.Add([ordered]@{ path=$entry.path; sha256=$destinationHash })
  }
  $configPath = Join-Path $target 'machine-config.json'
  $config = [ordered]@{
    schema_version='1.0.0'; package_id=$manifest.package_id; plur_enabled=$false
    provider_policy='NATIVE_LOGIN_ONLY_NO_CREDENTIAL_COPY'
    provider_homes=[ordered]@{
      official_codex=(Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex')
      maxplus=(Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex-maxplus')
    }
  }
  $config | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $configPath -Encoding UTF8
  $configHash = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $registryPath = Join-Path $target 'machine-inputs\Model_Intelligence\MODEL_REGISTRY.json'
  New-Item -ItemType Directory -Path (Split-Path -Parent $registryPath) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $packageRoot 'offline-registry.template.json') -Destination $registryPath
  $registryHash = (Get-FileHash -LiteralPath $registryPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $receipt = [ordered]@{
    schema_version='1.0.0'; checkpoint='P11_PORTABLE_INSTALL_RECEIPT'; installed_at=(Get-Date).ToUniversalTime().ToString('o')
    package_id=$manifest.package_id; target_root=$target; managed_files=$copied
    machine_config_sha256=$configHash; machine_registry_sha256=$registryHash
    credentials_copied=$false; provider_homes_modified=$false
  }
  $receipt | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
} catch {
  Fail-Closed $_.Exception.Message
}

$doctorArgs = @{ TargetRoot=$target }
if ($FixtureJson) { $doctorArgs.FixtureJson = $FixtureJson }
$doctorText = & (Join-Path $packageRoot 'doctor.ps1') @doctorArgs
$doctor = $doctorText | ConvertFrom-Json
[ordered]@{
  schema_version='1.0.0'; checkpoint='P11_PORTABLE_BOOTSTRAP'; status=$doctor.status
  package_id=$manifest.package_id; target_root=$target; idempotent=$false; files_copied=$copied.Count
  doctor=$doctor; credentials_copied=$false; provider_homes_modified=$false; model_backed_calls=0
} | ConvertTo-Json -Depth 15
if ($doctor.status -eq 'BLOCKED_WITH_ACTION') { exit 2 }
