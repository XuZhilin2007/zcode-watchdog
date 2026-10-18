# Register ZCodeWatchdog scheduled task (v3 architecture: truly windowless)
#   1) wscript.exe is a GUI-subsystem binary and never creates a console.
#      A generated VBS launcher starts node hidden (Run ..., 0, True) and
#      waits for it, so the task stays Running with zero visible windows.
#   2) 5-minute keepalive repetition trigger: if the process dies for any
#      reason the task returns to Ready and the next tick relaunches it
#      (MultipleInstances=IgnoreNew prevents duplicates while alive).
#   3) No 72-hour execution time limit; runs on batteries; catches up after sleep.
#   Note: the v1.0.2 approach (powershell -WindowStyle Hidden) still showed a
#   console window when launched from Task Scheduler and died when the window
#   was closed, so it was abandoned.
# Usage:   powershell -NoProfile -ExecutionPolicy Bypass -File install-task.ps1
# Uninstall: powershell -NoProfile -ExecutionPolicy Bypass -File uninstall-task.ps1

$node = (Get-Command node.exe -ErrorAction Stop).Source
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$mjs = Join-Path $dir "watchdog.mjs"
$vbs = Join-Path $dir "watchdog-hidden.vbs"

# Generate the machine-specific hidden launcher from the committed template.
$tmplPath = Join-Path $dir "watchdog-hidden.vbs.template"
$tmpl = Get-Content $tmplPath -Raw
Set-Content -Path $vbs -Value ($tmpl.Replace("__NODE__", $node).Replace("__MJS__", $mjs)) -Encoding ASCII

$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument ('"' + $vbs + '"')

$tLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$tKeepalive = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName "ZCodeWatchdog" -Action $action -Trigger @($tLogon, $tKeepalive) `
  -Settings $settings -Force -ErrorAction Stop | Out-Null
Start-ScheduledTask -TaskName "ZCodeWatchdog" -ErrorAction Stop
Write-Host "ZCodeWatchdog registered and started (wscript hidden / 5-min self-heal / logon autostart / no time limit)"
