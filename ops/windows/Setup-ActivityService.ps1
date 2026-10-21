#Requires -RunAsAdministrator
#Requires -Version 7
<#
.SYNOPSIS
  Registers the Shuttle Activity's closed screen as a Manual service under its own virtual account, alongside the
  aphelion-bot services. Supports -WhatIf; idempotent. Nothing is started.

.DESCRIPTION
  aphelion-bot-activity  apps/activity/closed-host.mjs on 127.0.0.1:<Port> with Sophie's pinned Node runtime, as
                         NT SERVICE\aphelion-bot-activity. It serves onboarding.a13.info's "not boarding yet" page
                         and the pinned Cozette font, and holds no Discord token, database access or member data.

  The service runs from its own copy of five committed files under <InstallRoot>\activity\source, never from the git
  checkout or the hash-verified core package. The copy is refused if any of those files has uncommitted changes or
  the font does not match its pin; a manifest records each file's SHA-256 and the source commit. The account gets
  metadata/traverse access on the ancestors it walks, execute access to the Node runtime and its own files, and
  write access to its own log directory only.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$InstallRoot = 'C:\Aphelion\Sophie',
    [string]$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
    [int]$Port = 38124,
    [string]$WrapperSha256 = '9DBA15B5CC15F9F51190BC8D35BFEB3F870276FDB53902D1CB7B95DC502F603F'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Id = 'aphelion-bot-activity'
$Runtime = Join-Path $InstallRoot 'package\runtime'
$Node = Join-Path $Runtime 'node.exe'
$Destination = Join-Path $InstallRoot 'activity\source'
$ServiceDirectory = Join-Path $InstallRoot 'services\activity'
$Logs = Join-Path $InstallRoot 'logs\activity'
$Files = @('apps/activity/closed-host.js', 'apps/activity/closed-host.mjs', 'apps/activity/closed.html',
    'apps/activity/fonts/CozetteVector.woff2', 'legal/DEPENDENCIES.json')

function Get-ServiceSid([string]$Name) {
    ([System.Security.Principal.NTAccount]::new('NT SERVICE', $Name)).Translate([System.Security.Principal.SecurityIdentifier]).Value
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

Write-Host 'Checking the source files...'
$dirty = & git -C $SourceRoot status --porcelain -- @Files
if ($LASTEXITCODE -ne 0) { throw 'git status failed' }
if ($dirty) { throw "Uncommitted changes in the closed-screen files:`n$dirty" }
$commit = (& git -C $SourceRoot rev-parse HEAD).Trim()
$pin = (Get-Content -LiteralPath (Join-Path $SourceRoot 'legal\DEPENDENCIES.json') -Raw | ConvertFrom-Json).activityFont
$fontHash = (Get-FileHash -LiteralPath (Join-Path $SourceRoot ($pin.path -replace '/', '\')) -Algorithm SHA256).Hash.ToLowerInvariant()
if ($fontHash -ne $pin.sha256) { throw 'Activity font does not match its pin' }
if ((Get-FileHash -LiteralPath (Join-Path $InstallRoot 'services\core\aphelion-bot.exe') -Algorithm SHA256).Hash -ne $WrapperSha256) { throw 'Wrapper hash mismatch' }
if (-not (Test-Path -LiteralPath $Node)) { throw "Pinned Node runtime missing: $Node" }

Write-Host "Copying the closed screen from $commit..."
$manifest = [ordered]@{ schemaVersion = 1; service = $Id; sourceCommit = $commit; copiedAt = (Get-Date).ToUniversalTime().ToString('o'); files = @() }
foreach ($file in $Files) {
    $from = Join-Path $SourceRoot ($file -replace '/', '\'); $to = Join-Path $Destination ($file -replace '/', '\')
    if ($PSCmdlet.ShouldProcess($to, 'Copy')) {
        New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null
        Copy-Item -LiteralPath $from -Destination $to -Force
        $sourceHash = (Get-FileHash -LiteralPath $from -Algorithm SHA256).Hash.ToLowerInvariant()
        $copiedHash = (Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($sourceHash -ne $copiedHash) { throw "Copy mismatch: $file" }
        $manifest.files += [ordered]@{ path = $file; sha256 = $copiedHash }
        Write-Host "  + $file"
    }
}
if (-not $WhatIfPreference) { $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $InstallRoot 'activity\manifest.json') -Encoding utf8NoBOM }

Write-Host "Registering $Id..."
if (-not (Get-CimInstance Win32_Service -Filter "Name='$Id'")) {
    if ($PSCmdlet.ShouldProcess($Id, 'Install WinSW service')) {
        New-Item -ItemType Directory -Force -Path $ServiceDirectory, $Logs | Out-Null
        $wrapper = Join-Path $ServiceDirectory "$Id.exe"
        Copy-Item -LiteralPath (Join-Path $InstallRoot 'services\core\aphelion-bot.exe') -Destination $wrapper
        @"
<service>
 <id>$Id</id><name>Sophie Activity closed screen</name>
 <description>Shuttle Activity "not boarding yet" page for onboarding.a13.info on 127.0.0.1:$Port; Manual startup.</description>
 <executable>$Node</executable>
 <arguments>"$(Join-Path $Destination 'apps\activity\closed-host.mjs')" --port $Port</arguments>
 <workingdirectory>$Destination</workingdirectory>
 <serviceaccount><domain>NT SERVICE</domain><user>$Id</user></serviceaccount>
 <startmode>Manual</startmode><stoptimeout>10 sec</stoptimeout><stopparentprocessfirst>true</stopparentprocessfirst>
 <onfailure action="none"/>
 <env name="NODE_OPTIONS" value=""/><env name="NODE_PATH" value=""/>
 <env name="HTTP_PROXY" value=""/><env name="HTTPS_PROXY" value=""/><env name="ALL_PROXY" value=""/>
 <logpath>$Logs</logpath><log mode="roll-by-size"><sizeThreshold>1024</sizeThreshold><keepFiles>2</keepFiles></log>
</service>
"@ | Set-Content -LiteralPath (Join-Path $ServiceDirectory "$Id.xml") -Encoding utf8NoBOM
        & $wrapper install; if ($LASTEXITCODE -ne 0) { throw "WinSW install failed ($LASTEXITCODE)" }
    }
} else { Write-Host '  = already registered' }
if ($WhatIfPreference) { return }

$sid = Get-ServiceSid $Id
Write-Host 'Granting file access...'
foreach ($path in @('C:\Aphelion', $InstallRoot, (Join-Path $InstallRoot 'package'), (Join-Path $InstallRoot 'activity'), (Join-Path $InstallRoot 'logs'), (Join-Path $InstallRoot 'services'))) {
    Add-Grant $path $sid $metadata 'None'
}
Add-Grant $Runtime $sid 'ReadAndExecute, Synchronize' $tree
# Runtime files such as node.exe carry their own protected ACLs (one explicit entry per service account), so the
# folder grant does not reach them; grant each protected file directly.
foreach ($file in Get-ChildItem -LiteralPath $Runtime -File -Recurse) {
    if ((Get-Acl -LiteralPath $file.FullName).AreAccessRulesProtected) { Add-Grant $file.FullName $sid 'ReadAndExecute, Synchronize' 'None' }
}
Add-Grant $Destination $sid 'ReadAndExecute, Synchronize' $tree
Add-Grant $ServiceDirectory $sid 'ReadAndExecute, Synchronize' $tree
Add-Grant $Logs $sid 'Modify, Synchronize' $tree
Write-Host "Done. $Id is registered (Manual) and not started; it has no access to staging credentials or the core package source."
