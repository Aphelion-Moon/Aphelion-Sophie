[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
# Read-only, deliberately omits hostnames, accounts, command lines and network addresses.
$sophieOs = Get-CimInstance Win32_OperatingSystem
$sophieCpu = Get-CimInstance Win32_Processor
$sophieVolumes = @(Get-Volume | Where-Object DriveLetter -in @('C', 'D') | ForEach-Object {
    [pscustomobject]@{
        Drive = $_.DriveLetter
        FileSystem = $_.FileSystem
        SizeGiB = [math]::Round($_.Size / 1GB, 2)
        FreeGiB = [math]::Round($_.SizeRemaining / 1GB, 2)
    }
})
$sophiePorts = @(Get-NetTCPConnection -State Listen | Where-Object LocalPort -in @(3000, 3306, 5432, 8080, 8081, 8082, 18080) | ForEach-Object {
    [pscustomobject]@{
        Port = $_.LocalPort
        Binding = if ($_.LocalAddress -in @('127.0.0.1', '::1')) { 'loopback' } else { 'non-loopback' }
    }
} | Sort-Object Port, Binding -Unique)
[pscustomobject]@{
    CollectedUtc = [DateTime]::UtcNow.ToString('o')
    OS = $sophieOs.Caption
    Build = $sophieOs.BuildNumber
    CPU = @($sophieCpu | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors)
    TotalMemoryGiB = [math]::Round($sophieOs.TotalVisibleMemorySize / 1MB, 2)
    AvailableMemoryGiB = [math]::Round($sophieOs.FreePhysicalMemory / 1MB, 2)
    Volumes = $sophieVolumes
    SelectedListeners = $sophiePorts
    IsBenchmark = $false
} | ConvertTo-Json -Depth 5
