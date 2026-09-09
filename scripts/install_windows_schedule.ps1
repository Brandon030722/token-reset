# -Executable must point to monitor\TiboMonitorHelper.exe, not the GUI TiboMonitor.exe.
param([switch]$Remove, [string]$Executable)
$ErrorActionPreference = "Stop"
$TaskName = "TiboResetMonitor"
if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    exit
}
$ProjectDir = Split-Path $PSScriptRoot -Parent
$DataDir = Join-Path $env:USERPROFILE ".tibo-reset"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
if ($Executable) {
    $RunnerPath = (Resolve-Path $Executable).Path
    $Prefix = ""
} else {
    $RunnerPath = (Get-Command python).Source
    $Prefix = "-m monitor "
}
$Arguments = $Prefix + '--once --config "' + $DataDir + '\monitor.config.json" --state "' + $DataDir + '\state.sqlite3" --output "' + $DataDir + '\data"'
$Action = New-ScheduledTaskAction -Execute $RunnerPath -Argument $Arguments -WorkingDirectory $ProjectDir
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15)
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Public RSS monitoring every 15 minutes" -Force | Out-Null
Write-Output "Installed for current user; computer must be awake and session available."
