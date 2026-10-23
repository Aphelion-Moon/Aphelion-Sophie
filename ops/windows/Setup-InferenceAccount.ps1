#Requires -RunAsAdministrator
#Requires -Version 7
<#
.SYNOPSIS
  Registers Sophie's AI worker as its own WinSW service under a virtual service account and scopes its
  file and network access. The worker runs alongside core and connects to it by itself; there is no
  supervisor service (owner decision, 12 October 2026). Supports -WhatIf.

.DESCRIPTION
  Follows the layout already present on the staging host: pinned WinSW 2.12.0 wrappers under
  services\<role>, the pinned Node runtime under package\runtime, hashed source under package\source,
  NT SERVICE\<id> virtual accounts and explicit protected ACLs on every Sophie directory.

  What it changes (each step is idempotent and reported):
    1. services\worker\aphelion-bot-ai-worker.{exe,xml}: a byte-identical copy of the existing wrapper
       (hash-checked against the other three) running package\source\apps\knowledge-worker\main.mjs
       as NT SERVICE\aphelion-bot-ai-worker, Manual start (started with core), restarted by WinSW if it exits.
       A worker registered under the earlier supervisor-era configuration is upgraded in place.
    2. File access for the worker SID, added without removing existing entries:
         C:\Aphelion, Sophie, package, trust, services list/traverse/read-attributes, this folder only
                                                     (the missing ancestor metadata access is what made
                                                     the 28 September relay trial fail with lstat EPERM)
         package\runtime, package\source              read and execute, inherited
         services\worker                              read and execute, inherited (WinSW and its XML)
         logs\worker                                  modify (WinSW writes logs as the service account)
       provider\ is replaced with a protected ACL: SYSTEM, Administrators and the worker (read) only.
       The worker SID never receives core.json, the core database or the Discord token.
    3. Per-role trust files, when present: trust\core.json readable only by aphelion-bot,
       trust\worker.json readable only by aphelion-bot-ai-worker. Without protected ACLs each role could
       read the other's file through inherited trust directory entries.
    4. Service DACL on aphelion-bot-ai-worker: SYSTEM and Administrators only (the supervisor-era grant is removed).
    5. Outbound firewall block rules for the worker service: every TCP port except 443, all UDP,
       ICMPv4/ICMPv6. Loopback is not filtered by Windows Firewall, so the authenticated
       127.0.0.1 inference channel to core keeps working. The Mistral transport additionally refuses
       any non-public IPv4 answer in process (apps/knowledge-worker/http-transport.js).

  It does not start, stop or remove any service, write trust\*.json, place the provider key or change the core
  wrapper. Retiring a supervisor service is a separate deployment step. Qualification (whoami/icacls/firewall
  denial evidence) is a separate recorded step.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$InstallRoot = 'C:\Aphelion\Sophie',
    [string]$WrapperSha256 = '9DBA15B5CC15F9F51190BC8D35BFEB3F870276FDB53902D1CB7B95DC502F603F'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ServiceId = 'aphelion-bot-ai-worker'
$CoreId = 'aphelion-bot'
$Node = Join-Path $InstallRoot 'package\runtime\node.exe'
$Source = Join-Path $InstallRoot 'package\source'
$Entrypoint = Join-Path $Source 'apps\knowledge-worker\main.mjs'
$ServiceDirectory = Join-Path $InstallRoot 'services\worker'
$Wrapper = Join-Path $ServiceDirectory "$ServiceId.exe"
$LogDirectory = Join-Path $InstallRoot 'logs\worker'

function Get-ServiceSid([string]$Id) {
    ([System.Security.Principal.NTAccount]::new('NT SERVICE', $Id)).Translate([System.Security.Principal.SecurityIdentifier]).Value
}

function Add-Grant {
    param([string]$Path, [string]$Sid, [System.Security.AccessControl.FileSystemRights]$Rights,
          [System.Security.AccessControl.InheritanceFlags]$Inheritance)
    $acl = Get-Acl -LiteralPath $Path
    $identity = [System.Security.Principal.SecurityIdentifier]::new($Sid)
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($identity, $Rights, $Inheritance, 'None', 'Allow')
    $existing = @($acl.Access | Where-Object {
        $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq $Sid -and
        $_.AccessControlType -eq 'Allow' -and $_.InheritanceFlags -eq $Inheritance -and
        ($_.FileSystemRights -band $Rights) -eq $Rights })
    if ($existing.Count -gt 0) { Write-Host "  = $Path"; return }
    $acl.AddAccessRule($rule)
    if ($PSCmdlet.ShouldProcess($Path, "Grant $Rights to $Sid")) { Set-Acl -LiteralPath $Path -AclObject $acl; Write-Host "  + $Path" }
}

function Set-ProtectedAcl {
    param([string]$Path, [hashtable]$Grants, [System.Security.AccessControl.InheritanceFlags]$Inheritance)
    $acl = [System.Security.AccessControl.FileSecurity]::new()
    if ((Get-Item -LiteralPath $Path) -is [System.IO.DirectoryInfo]) { $acl = [System.Security.AccessControl.DirectorySecurity]::new() }
    $acl.SetAccessRuleProtection($true, $false)
    $all = @{ 'S-1-5-18' = 'FullControl'; 'S-1-5-32-544' = 'FullControl' } + $Grants
    # Sorted: hashtable order is randomized per PowerShell 7 process, and reruns must write byte-identical ACLs.
    foreach ($sid in ($all.Keys | Sort-Object)) {
        $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            [System.Security.Principal.SecurityIdentifier]::new($sid), $all[$sid], $Inheritance, 'None', 'Allow'))
    }
    if ($PSCmdlet.ShouldProcess($Path, 'Replace with protected ACL')) { Set-Acl -LiteralPath $Path -AclObject $acl; Write-Host "  * $Path" }
}

# 'current' when the wrapper already has the reviewed configuration, 'legacy' when it has the reviewed supervisor-era one
# (Manual, no failure restart), which this script upgrades. Anything else stops for operator review.
# Since 23 October 2026 the service may also start at boot (owner approval: "Set services to restart at reboot"); the
# wrapper file keeps its reviewed Manual startmode, which only applies when the wrapper registers the service.
function Assert-WorkerService {
    param($Registration, [xml]$Configuration, [string]$ExpectedWrapperHash)
    if ($Registration.StartName -ne "NT SERVICE\$ServiceId" -or
        $Registration.PathName -notin @($Wrapper, "`"$Wrapper`"") -or $Registration.StartMode -notin @('Manual', 'Auto')) {
        throw 'Existing worker service registration differs from the reviewed configuration; repair requires operator review.'
    }
    if ($ExpectedWrapperHash -ne $WrapperSha256) { throw 'Existing worker wrapper hash mismatch' }
    $service = $Configuration.service
    if ($service.id -ne $ServiceId -or $service.executable -ne $Node -or
        $service.arguments -ne "`"$Entrypoint`"" -or $service.workingdirectory -ne $Source -or
        $service.serviceaccount.domain -ne 'NT SERVICE' -or $service.serviceaccount.user -ne $ServiceId -or
        $service.startmode -ne 'Manual' -or $service.stoptimeout -ne '10 sec' -or
        $service.stopparentprocessfirst -ne 'true' -or @($service.onfailure).Count -ne 1) {
        throw 'Existing worker wrapper configuration differs from the reviewed configuration; repair requires operator review.'
    }
    if ($service.onfailure.action -eq 'restart' -and $service.onfailure.delay -eq '10 sec') { return 'current' }
    if ($service.onfailure.action -eq 'none') { return 'legacy' }
    throw 'Existing worker failure action differs from the reviewed configuration; repair requires operator review.'
}

function Assert-WorkerFirewallRule {
    param($Existing, $Port, $ServiceFilter, $Application, $Address, $Interface, $InterfaceType, [hashtable]$Expected)
    $remotePorts = if ($Expected.ContainsKey('RemotePort')) { $Expected.RemotePort } else { @('Any') }
    if ($Existing.Enabled -ne 'True' -or $Existing.Direction -ne 'Outbound' -or $Existing.Action -ne 'Block' -or
        $Existing.Profile -ne 'Any' -or $ServiceFilter.Service -ne $ServiceId -or $Port.Protocol -ne $Expected.Protocol -or
        $Port.LocalPort -ne 'Any' -or (Compare-Object @($Port.RemotePort) @($remotePorts)) -or
        $Application.Program -ne 'Any' -or $Application.Package -notin @($null, '', 'Any') -or
        $Address.LocalAddress -ne 'Any' -or $Address.RemoteAddress -ne 'Any' -or
        $Interface.InterfaceAlias -ne 'Any' -or $InterfaceType.InterfaceType -ne 'Any') {
        throw "Existing firewall rule differs from the reviewed scope: $($Expected.Name). Repair requires operator review."
    }
}

$rules = @(
    @{ Name = 'Sophie AI worker block TCP except 443'; Protocol = 'TCP'; RemotePort = @('1-442', '444-65535') },
    @{ Name = 'Sophie AI worker block UDP'; Protocol = 'UDP' },
    @{ Name = 'Sophie AI worker block ICMPv4'; Protocol = 'ICMPv4' },
    @{ Name = 'Sophie AI worker block ICMPv6'; Protocol = 'ICMPv6' }
)

Write-Host 'Checking preconditions...'
foreach ($path in @($Node, $Entrypoint, (Join-Path $InstallRoot 'provider'), (Join-Path $InstallRoot 'trust'))) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing $path" }
}
$wrappers = @('core\aphelion-bot.exe') | ForEach-Object { Join-Path $InstallRoot "services\$_" }
foreach ($existing in $wrappers) {
    if ((Get-FileHash -LiteralPath $existing -Algorithm SHA256).Hash -ne $WrapperSha256) { throw "Wrapper hash mismatch: $existing" }
}
$coreSid = Get-ServiceSid $CoreId

# Validate existing objects before any writes. A familiar display name is not evidence of the rule's scope.
$registered = Get-CimInstance Win32_Service -Filter "Name='$ServiceId'"
$registration = $null
if ($registered) {
    $configuration = [xml](Get-Content -LiteralPath (Join-Path $ServiceDirectory "$ServiceId.xml") -Raw)
    $registration = Assert-WorkerService $registered $configuration (Get-FileHash -LiteralPath $Wrapper -Algorithm SHA256).Hash
    if ($registration -eq 'legacy' -and $registered.State -ne 'Stopped') { throw 'Stop the worker service before upgrading its configuration.' }
}
foreach ($rule in $rules) {
    $existingRules = @(Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue)
    if ($existingRules.Count -gt 1) { throw "Ambiguous firewall rule: $($rule.Name)" }
    if ($existingRules.Count -eq 1) {
        $existing = $existingRules[0]
        Assert-WorkerFirewallRule $existing ($existing | Get-NetFirewallPortFilter) ($existing | Get-NetFirewallServiceFilter) `
            ($existing | Get-NetFirewallApplicationFilter) ($existing | Get-NetFirewallAddressFilter) `
            ($existing | Get-NetFirewallInterfaceFilter) ($existing | Get-NetFirewallInterfaceTypeFilter) $rule
    }
}

$workerXml = @"
<service>
 <id>$ServiceId</id><name>Sophie AI worker</name>
 <description>Mistral inference worker. Runs alongside Sophie core and connects to it; Manual startup, restarted if it exits.</description>
 <executable>$Node</executable>
 <arguments>"$Entrypoint"</arguments>
 <workingdirectory>$Source</workingdirectory>
 <serviceaccount><domain>NT SERVICE</domain><user>$ServiceId</user></serviceaccount>
 <startmode>Manual</startmode><stoptimeout>10 sec</stoptimeout><stopparentprocessfirst>true</stopparentprocessfirst>
 <onfailure action="restart" delay="10 sec"/>
 <env name="NODE_OPTIONS" value=""/><env name="NODE_PATH" value=""/>
 <env name="HTTP_PROXY" value=""/><env name="HTTPS_PROXY" value=""/><env name="ALL_PROXY" value=""/>
 <logpath>$LogDirectory</logpath><log mode="roll-by-size"><sizeThreshold>1024</sizeThreshold><keepFiles>2</keepFiles></log>
</service>
"@

Write-Host "Registering $ServiceId..."
if (-not $registered) {
    if ($PSCmdlet.ShouldProcess($ServiceDirectory, 'Create wrapper directory and configuration')) {
        New-Item -ItemType Directory -Force -Path $ServiceDirectory, $LogDirectory | Out-Null
        Copy-Item -LiteralPath $wrappers[0] -Destination $Wrapper
        if ((Get-FileHash -LiteralPath $Wrapper -Algorithm SHA256).Hash -ne $WrapperSha256) { throw 'Copied wrapper hash mismatch' }
        $workerXml | Set-Content -LiteralPath (Join-Path $ServiceDirectory "$ServiceId.xml") -Encoding utf8NoBOM
    }
    if ($PSCmdlet.ShouldProcess($ServiceId, 'Install WinSW service')) {
        & $Wrapper install
        if ($LASTEXITCODE -ne 0) { throw "WinSW install failed ($LASTEXITCODE)" }
    }
} else {
    Write-Host "  = already registered as $($registered.StartName) ($($registered.PathName))"
    if ($registered.StartName -ne "NT SERVICE\$ServiceId") { throw "Unexpected service account $($registered.StartName)" }
    if ($registration -eq 'legacy' -and $PSCmdlet.ShouldProcess($ServiceId, 'Upgrade supervisor-era wrapper configuration (restart on failure)')) {
        $workerXml | Set-Content -LiteralPath (Join-Path $ServiceDirectory "$ServiceId.xml") -Encoding utf8NoBOM
        Write-Host '  * upgraded wrapper configuration'
    }
}
# WinSW 2.12 has no refresh command: the restart policy and description are applied to the SCM directly (idempotent).
if ($PSCmdlet.ShouldProcess($ServiceId, 'Set SCM restart-on-failure actions and description')) {
    & sc.exe failure $ServiceId reset= 86400 actions= restart/10000/restart/10000/restart/10000 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "sc.exe failure failed ($LASTEXITCODE)" }
    & sc.exe description $ServiceId 'Mistral inference worker. Runs alongside Sophie core and connects to it; Manual startup, restarted if it exits.' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "sc.exe description failed ($LASTEXITCODE)" }
}
if ($WhatIfPreference -and -not $registered) { Write-Host 'WhatIf: the remaining steps need the registered service SID.'; return }
$workerSid = Get-ServiceSid $ServiceId

Write-Host 'Granting worker file access...'
$metadata = [System.Security.AccessControl.FileSystemRights]'ListDirectory, ReadAttributes, ReadExtendedAttributes, Traverse, ReadPermissions, Synchronize'
foreach ($path in @('C:\Aphelion', $InstallRoot, (Join-Path $InstallRoot 'package'), (Join-Path $InstallRoot 'trust'), (Join-Path $InstallRoot 'logs'), (Join-Path $InstallRoot 'services'))) {
    Add-Grant -Path $path -Sid $workerSid -Rights $metadata -Inheritance 'None'
}
foreach ($path in @((Join-Path $InstallRoot 'package\runtime'), $Source, $ServiceDirectory)) {
    Add-Grant -Path $path -Sid $workerSid -Rights 'ReadAndExecute, Synchronize' -Inheritance 'ContainerInherit, ObjectInherit'
}
# Files with their own protected ACLs (Node's runtime licence notices, for example) do not inherit the grants above, but
# the worker verifies every package file against the manifest when it starts.
foreach ($file in Get-ChildItem -LiteralPath (Join-Path $InstallRoot 'package') -Recurse -File -Force | Where-Object { (Get-Acl -LiteralPath $_.FullName).AreAccessRulesProtected }) {
    Add-Grant -Path $file.FullName -Sid $workerSid -Rights 'Read, Synchronize' -Inheritance 'None'
}
if (Test-Path -LiteralPath $LogDirectory) {
    Add-Grant -Path $LogDirectory -Sid $workerSid -Rights 'Modify, Synchronize' -Inheritance 'ContainerInherit, ObjectInherit'
}
Set-ProtectedAcl -Path (Join-Path $InstallRoot 'provider') -Grants @{ $workerSid = 'Read, Synchronize' } -Inheritance 'ContainerInherit, ObjectInherit'

Write-Host 'Restricting per-role trust files...'
# Preference epochs are independent of the staging database and its restore bundles.
# Provisioning is explicit; neither this setup nor the runtime recreates a lost journal.
$preferenceDirectory = Join-Path $InstallRoot 'preferences'
if (Test-Path -LiteralPath $preferenceDirectory) {
    Set-ProtectedAcl -Path $preferenceDirectory -Grants @{ $coreSid = 'Modify, Synchronize' } -Inheritance 'ContainerInherit, ObjectInherit'
}
foreach ($role in @(@{ File = 'core.json'; Sid = $coreSid }, @{ File = 'worker.json'; Sid = $workerSid })) {
    $path = Join-Path $InstallRoot "trust\$($role.File)"
    if (Test-Path -LiteralPath $path) { Set-ProtectedAcl -Path $path -Grants @{ $role.Sid = 'Read, Synchronize' } -Inheritance 'None' }
    else { Write-Host "  - $path not written yet; rerun after writing it" }
}

Write-Host 'Restricting control of the worker service to SYSTEM and Administrators...'
# No other identity starts or stops the worker; the supervisor-era grant is removed.
$sddl = 'D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)'
if ($PSCmdlet.ShouldProcess($ServiceId, "sc.exe sdset $sddl")) {
    & sc.exe sdset $ServiceId $sddl | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "sc.exe sdset failed ($LASTEXITCODE)" }
}

Write-Host 'Scoping worker egress...'
foreach ($rule in $rules) {
    if (Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue) { Write-Host "  = $($rule.Name)"; continue }
    $arguments = @{ DisplayName = $rule.Name; Direction = 'Outbound'; Action = 'Block'; Service = $ServiceId; Protocol = $rule.Protocol; Profile = 'Any' }
    if ($rule.ContainsKey('RemotePort')) { $arguments.RemotePort = $rule.RemotePort }
    if ($PSCmdlet.ShouldProcess($rule.Name, 'Create outbound block rule')) { New-NetFirewallRule @arguments | Out-Null; Write-Host "  + $($rule.Name)" }
}

Write-Host @"

Done. Readback before qualification:
  icacls "$InstallRoot\trust" "$InstallRoot\trust\worker.json" "$InstallRoot\provider"
  sc.exe qc $ServiceId ; sc.exe sdshow $ServiceId
  Get-NetFirewallRule -DisplayName 'Sophie AI worker*' | Get-NetFirewallServiceFilter
Remaining operator steps: docs/ai-test-guild-runbook.md
"@
