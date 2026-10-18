# 注册 ZCodeWatchdog 计划任务：开机自启、崩溃 1 分钟自动重启、无执行时限、与 ZCode 进程解耦
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File install-task.ps1
# 卸载: powershell -NoProfile -ExecutionPolicy Bypass -File uninstall-task.ps1

$node = (Get-Command node.exe -ErrorAction Stop).Source
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

$action = New-ScheduledTaskAction -Execute $node -Argument (Join-Path $dir "watchdog.mjs") -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew -StartWhenAvailable

Register-ScheduledTask -TaskName "ZCodeWatchdog" -Action $action -Trigger $trigger -Settings $settings -Force -ErrorAction Stop | Out-Null
Start-ScheduledTask -TaskName "ZCodeWatchdog" -ErrorAction Stop
Write-Host "ZCodeWatchdog 计划任务已注册并启动（登录自启 / 崩溃自动重启 / 无时限）"
