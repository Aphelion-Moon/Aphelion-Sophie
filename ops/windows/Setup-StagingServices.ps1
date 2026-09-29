#Requires -RunAsAdministrator
#Requires -Version 7
<#
.SYNOPSIS
  Registers the isolated staging database and tunnel connector as Manual services under their own
  virtual accounts, replacing the foreground staging launcher. Supports -WhatIf; idempotent.

.DESCRIPTION
  aphelion-bot-postgres  pg_ctl runservice for <Staging>\postgres-data on 127.0.0.1:<Port>, as
                         NT SERVICE\aphelion-bot-postgres, from Sophie's own copy of the reviewed
                         PostgreSQL build (so no other service's binaries or identity are shared).
  aphelion-bot-tunnel    the pinned cloudflared connector for the staging tunnel, as
                         NT SERVICE\aphelion-bot-tunnel, reading only its token file.

  Each account gets metadata/traverse access on the ancestors it walks and exactly the files it needs;
  neither can read the staging credential files. Nothing is started.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$InstallRoot = 'C:\Aphelion\Sophie',
    [string]$PostgresSource = 'C:\ss14\postgres\pgsql',
    [int]$Port = 52435,
    [string]$Connector = 'C:\Program Files (x86)\cloudflared\cloudflared.exe',
    [string]$ConnectorSha256 = '8635DA433B6DF8194746E88ED9D2589566C20E38BFC2A80E431A348B7C765841',
    [string]$WrapperSha256 = '9DBA15B5CC15F9F51190BC8D35BFEB3F870276FDB53902D1CB7B95DC502F603F'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Staging = Join-Path $InstallRoot 'staging'
$Data = Join-Path $Staging 'postgres-data'
$PgRoot = Join-Path $InstallRoot 'postgres\pgsql'
$PgLogs = Join-Path $InstallRoot 'logs\postgres'
$TunnelDirectory = Join-Path $InstallRoot 'services\tunnel'
$TunnelToken = Join-Path $Staging 'tunnel-token'
$Manifest = Join-Path $InstallRoot 'package\source\legal\postgresql-test-runtime.json'

function Get-ServiceSid([string]$Id) {
    ([System.Security.Principal.NTAccount]::new('NT SERVICE', $Id)).Translate([System.Security.Principal.SecurityIdentifier]).Value
}
function Add-Grant([string]$Path, [string]$Sid, [System.Security.AccessControl.FileSystemRights]$Rights, [System.Security.AccessControl.InheritanceFlags]$Inheritance) {
    $acl = Get-Acl -LiteralPath $Path
    $present = @($acl.Access | Where-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq $Sid -and
        $_.InheritanceFlags -eq $Inheritance -and ($_.FileSystemRights -band $Rights) -eq $Rights })
    if ($present.Count -gt 0) { Write-Host "  = $Path"; return }
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new($Sid), $Rights, $Inheritance, 'None', 'Allow'))
    if ($PSCmdlet.ShouldProcess($Path, "Grant $Rights")) { Set-Acl -LiteralPath $Path -AclObject $acl; Write-Host "  + $Path" }
}
$metadata = [System.Security.AccessControl.FileSystemRights]'ListDirectory, ReadAttributes, ReadExtendedAttributes, Traverse, ReadPermissions, Synchronize'
$tree = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'

Write-Host 'Preparing Sophie PostgreSQL binaries...'
$review = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
if (-not (Test-Path -LiteralPath (Join-Path $PgRoot 'bin\postgres.exe'))) {
    if ($PSCmdlet.ShouldProcess($PgRoot, "Copy bin/lib/share from $PostgresSource")) {
        foreach ($part in 'bin', 'lib', 'share') {
            robocopy (Join-Path $PostgresSource $part) (Join-Path $PgRoot $part) /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "PostgreSQL copy failed: $part" }
        }
    }
}
# Licence notices at the distribution root are part of the reviewed file set.
foreach ($notice in Get-ChildItem -LiteralPath $PostgresSource -File) {
    $target = Join-Path $PgRoot $notice.Name
    if ((Test-Path -LiteralPath $PgRoot) -and -not (Test-Path -LiteralPath $target) -and $PSCmdlet.ShouldProcess($target, 'Copy notice')) { Copy-Item -LiteralPath $notice.FullName -Destination $target }
}
if (Test-Path -LiteralPath (Join-Path $PgRoot 'bin\postgres.exe')) {
    foreach ($file in $review.files) {
        $actual = (Get-FileHash -LiteralPath (Join-Path $PgRoot ($file.path -replace '/', '\')) -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $file.sha256) { throw "Reviewed PostgreSQL file mismatch: $($file.path)" }
    }
    Write-Host "  = $($review.files.Count) reviewed PostgreSQL $($review.version) files verified"
}
if ((Get-FileHash -LiteralPath $Connector -Algorithm SHA256).Hash -ne $ConnectorSha256) { throw 'Connector hash mismatch' }
if ((Get-FileHash -LiteralPath (Join-Path $InstallRoot 'services\core\aphelion-bot.exe') -Algorithm SHA256).Hash -ne $WrapperSha256) { throw 'Wrapper hash mismatch' }

Write-Host 'Registering aphelion-bot-postgres...'
if (-not (Get-CimInstance Win32_Service -Filter "Name='aphelion-bot-postgres'")) {
    if ($PSCmdlet.ShouldProcess('aphelion-bot-postgres', 'pg_ctl register')) {
        New-Item -ItemType Directory -Force -Path $PgLogs | Out-Null
        $options = "-h 127.0.0.1 -p $Port -c max_connections=32 -c shared_buffers=32MB -c log_statement=none -c log_min_error_statement=panic " +
            "-c logging_collector=on -c log_directory=$($PgLogs -replace '\\', '/') -c log_rotation_size=10MB -c log_truncate_on_rotation=on"
        if ($PgLogs -match '\s') { throw 'Log path must not contain spaces' }
        & (Join-Path $PgRoot 'bin\pg_ctl.exe') register -N aphelion-bot-postgres -U 'NT SERVICE\aphelion-bot-postgres' -S demand -D $Data -w -o $options
        if ($LASTEXITCODE -ne 0) { throw "pg_ctl register failed ($LASTEXITCODE)" }
    }
} else { Write-Host '  = already registered' }

Write-Host 'Registering aphelion-bot-tunnel...'
if (-not (Get-CimInstance Win32_Service -Filter "Name='aphelion-bot-tunnel'")) {
    if ($PSCmdlet.ShouldProcess('aphelion-bot-tunnel', 'Install WinSW service')) {
        New-Item -ItemType Directory -Force -Path $TunnelDirectory, (Join-Path $InstallRoot 'logs\tunnel') | Out-Null
        $wrapper = Join-Path $TunnelDirectory 'aphelion-bot-tunnel.exe'
        Copy-Item -LiteralPath (Join-Path $InstallRoot 'services\core\aphelion-bot.exe') -Destination $wrapper
        @"
<service>
 <id>aphelion-bot-tunnel</id><name>Sophie staging tunnel</name>
 <description>Pinned cloudflared connector for the sophie-staging tunnel; Manual startup.</description>
 <executable>$Connector</executable>
 <arguments>tunnel --no-autoupdate --loglevel fatal --transport-loglevel fatal --metrics 127.0.0.1:38123 run --token-file "$TunnelToken"</arguments>
 <serviceaccount><domain>NT SERVICE</domain><user>aphelion-bot-tunnel</user></serviceaccount>
 <startmode>Manual</startmode><stoptimeout>10 sec</stoptimeout><onfailure action="none"/>
 <logpath>$(Join-Path $InstallRoot 'logs\tunnel')</logpath><log mode="roll-by-size"><sizeThreshold>1024</sizeThreshold><keepFiles>2</keepFiles></log>
</service>
"@ | Set-Content -LiteralPath (Join-Path $TunnelDirectory 'aphelion-bot-tunnel.xml') -Encoding utf8NoBOM
        & $wrapper install; if ($LASTEXITCODE -ne 0) { throw "WinSW install failed ($LASTEXITCODE)" }
    }
} else { Write-Host '  = already registered' }
if ($WhatIfPreference) { return }

$pgSid = Get-ServiceSid 'aphelion-bot-postgres'; $tunnelSid = Get-ServiceSid 'aphelion-bot-tunnel'
Write-Host 'Granting file access...'
foreach ($path in @('C:\Aphelion', $InstallRoot, (Join-Path $InstallRoot 'postgres'), $Staging, (Join-Path $InstallRoot 'logs'))) {
    Add-Grant $path $pgSid $metadata 'None'; Add-Grant $path $tunnelSid $metadata 'None'
}
Add-Grant $PgRoot $pgSid 'ReadAndExecute, Synchronize' $tree
Add-Grant $Data $pgSid 'FullControl' $tree
Add-Grant $PgLogs $pgSid 'Modify, Synchronize' $tree
Add-Grant $TunnelToken $tunnelSid 'Read, Synchronize' 'None'
Add-Grant (Join-Path $InstallRoot 'logs\tunnel') $tunnelSid 'Modify, Synchronize' $tree
Add-Grant $TunnelDirectory $tunnelSid 'ReadAndExecute, Synchronize' $tree
Write-Host 'Done. Neither account is granted the staging credential files.'
