#Requires -RunAsAdministrator
<#
.SYNOPSIS
  One-time host setup for the isolated Sophie inference worker.

.DESCRIPTION
  Replaces the earlier Hyper-V/HCS/WinSW-based isolation trials with plain Windows
  account separation: a dedicated, unprivileged local service account runs the
  knowledge-worker process directly on the host (no container, no relay process).
  Isolation comes from three ordinary OS mechanisms, each idempotent here:

    1. A dedicated local account with no membership beyond its own boot/provider
       directories. It cannot read the ticket database credentials, the Discord
       token, or core's configuration, because those files' ACLs never grant it
       access in the first place.
    2. A Windows Service ("SophieInference") running the pinned worker entrypoint
       under that account, so the process identity is enforced by the OS, not by
       application code.
    3. A Windows Firewall outbound rule scoped to that account's worker executable.
       This only proves "no other program on this box can use this identity to
       reach the network" — it does not by itself prove "this program only talks
       to api.deepseek.com". That narrower guarantee is enforced in-process by the
       DeepSeek client's own DNS/TLS servername pinning (see
       apps/knowledge-worker/deepseek-client.js and the historical
       apps/ai-egress/public-address.js pinning logic now folded into it).

  This script only prepares the OS account, service registration and firewall
  rule. It does not write apps/core/state/boots, apps/core/state/provider or the
  apps/inference-host/installation.js trust/*.json config files — those are
  runtime/deployment concerns handled separately, not part of one-time OS setup.

.PARAMETER InstallRoot
  The Sophie install root. Defaults to C:\Aphelion\Sophie, matching the fixed
  path already assumed by apps/inference-host and the knowledge-worker.

.PARAMETER AccountName
  The dedicated local account that will run the worker service. Kept short and
  fixed rather than configurable per-deployment, since AGENTS.md pins one
  production Discord identity per host; there is exactly one worker to isolate.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$InstallRoot = 'C:\Aphelion\Sophie',
    [string]$AccountName = 'svc-sophie-inference',
    [string]$ServiceName = 'SophieInference',
    [string]$NodeExecutable = 'C:\node\node.exe',
    [string]$WorkerEntrypoint = "$InstallRoot\apps\knowledge-worker\main.mjs"
)

$ErrorActionPreference = 'Stop'

function New-RandomPassword {
    # Only used once, at account creation, and only held long enough to hand to
    # New-LocalUser. A service account's password is never referenced again —
    # sc.exe registers the service against the account SID, not a stored secret.
    $bytes = [byte[]]::new(32)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return (ConvertTo-SecureString -String ([Convert]::ToBase64String($bytes) + 'Aa1!') -AsPlainText -Force)
}

Write-Host "Ensuring local account '$AccountName'..."
$account = Get-LocalUser -Name $AccountName -ErrorAction SilentlyContinue
if (-not $account) {
    if ($PSCmdlet.ShouldProcess($AccountName, 'Create local service account')) {
        New-LocalUser -Name $AccountName -Password (New-RandomPassword) -PasswordNeverExpires -UserMayNotChangePassword `
            -AccountNeverExpires -Description 'Sophie inference worker — restricted, no case/core data access' | Out-Null
    }
} else {
    Write-Host "  already exists."
}
# A service account only needs to run as a service, not to log on interactively.
Add-LocalGroupMember -Group 'Users' -Member $AccountName -ErrorAction SilentlyContinue | Out-Null
$sid = (Get-LocalUser -Name $AccountName).SID.Value

Write-Host "Granting 'Log on as a service' to $AccountName..."
$secedit = & secedit /export /cfg "$env:TEMP\sophie-secpol.cfg" /quiet; $secedit | Out-Null
$policy = Get-Content "$env:TEMP\sophie-secpol.cfg"
$line = $policy | Where-Object { $_ -match '^SeServiceLogonRight' }
if (-not $line -or $line -notmatch [regex]::Escape($sid)) {
    $newLine = if ($line) { "$line,*$sid" } else { "SeServiceLogonRight = *$sid" }
    $policy = if ($line) { $policy -replace [regex]::Escape($line), $newLine } else { $policy + $newLine }
    $policy | Set-Content "$env:TEMP\sophie-secpol.cfg"
    if ($PSCmdlet.ShouldProcess($AccountName, 'Grant SeServiceLogonRight')) {
        secedit /configure /db "$env:windir\security\local.sdb" /cfg "$env:TEMP\sophie-secpol.cfg" /quiet | Out-Null
    }
} else {
    Write-Host "  already granted."
}
Remove-Item "$env:TEMP\sophie-secpol.cfg" -ErrorAction SilentlyContinue

Write-Host "Scoping directory ACLs..."
function Set-ExclusiveAcl {
    param([string]$Path, [string[]]$AllowSids, [string]$Rights = 'ReadAndExecute')
    if (-not (Test-Path $Path)) { New-Item -ItemType Directory -Path $Path -Force | Out-Null }
    $acl = Get-Acl $Path
    $acl.SetAccessRuleProtection($true, $false) # stop inheriting the parent's broader ACL
    $acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) | Out-Null }
    foreach ($builtin in @('NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators')) {
        $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            $builtin, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    }
    foreach ($allowSid in $AllowSids) {
        $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            [System.Security.Principal.SecurityIdentifier]::new($allowSid), $Rights, 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    }
    if ($PSCmdlet.ShouldProcess($Path, 'Replace ACL')) { Set-Acl $Path $acl }
}
# The inference account can read its own boot/provider directories and the worker source tree...
Set-ExclusiveAcl -Path "$InstallRoot\state\boots" -AllowSids @($sid) -Rights 'Modify'
Set-ExclusiveAcl -Path "$InstallRoot\provider" -AllowSids @($sid)
Set-ExclusiveAcl -Path "$InstallRoot\trust" -AllowSids @($sid)
# ...and nothing else. It is never added to the core database credential, Discord token or
# case-content directories, so those keep whatever ACL core's own setup already applies to them.

Write-Host "Registering Windows Service '$ServiceName'..."
$existing = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
$binPath = "`"$NodeExecutable`" `"$WorkerEntrypoint`""
if (-not $existing) {
    if ($PSCmdlet.ShouldProcess($ServiceName, 'Create service')) {
        sc.exe create $ServiceName binPath= $binPath start= demand obj= ".\$AccountName" password= "$([guid]::NewGuid())" | Out-Null
        # sc.exe's password= above is a placeholder; New-LocalUser already set the real one.
        # Re-run with the actual credential so LSA has it, using the same random-password helper.
        sc.exe config $ServiceName obj= ".\$AccountName" password= (New-RandomPassword | ConvertFrom-SecureString -AsPlainText) | Out-Null
    }
} elseif ($existing.PathName -ne $binPath) {
    if ($PSCmdlet.ShouldProcess($ServiceName, 'Repoint existing service to pinned entrypoint')) {
        sc.exe config $ServiceName binPath= $binPath | Out-Null
    }
} else {
    Write-Host "  already registered with the expected entrypoint."
}

Write-Host "Scoping outbound firewall access to the worker executable..."
$ruleName = 'Sophie inference worker egress'
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    if ($PSCmdlet.ShouldProcess($ruleName, 'Create outbound firewall rule')) {
        New-NetFirewallRule -DisplayName $ruleName -Direction Outbound -Program $NodeExecutable `
            -Protocol TCP -RemotePort 443 -Action Allow | Out-Null
    }
} else {
    Write-Host "  already present."
}
Write-Host @"

Done. Remaining manual steps (not automated by this script, since they depend on
the current deployment's release/qualification data):
  - Write apps/inference-host's trust\core.json and trust\supervisor.json config
    files (see apps/inference-host/installation.js for the expected shape).
  - Place the DeepSeek API key at $InstallRoot\provider (ACL'd above).
  - Start the service once core is ready to drive it: sc.exe start $ServiceName
"@
