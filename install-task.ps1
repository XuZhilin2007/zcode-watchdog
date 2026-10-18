# 注册 ZCodeWatchdog 计划任务（v2 架构：杀不死版）
#   1) 隐藏窗口运行：powershell 常驻包裹 node，无可见控制台，无从手滑关闭
#   2) 5 分钟补位触发：进程死了任务回到 Ready，下一个 5 分钟周期自动拉起
#      （任务运行中时 MultipleInstances=IgnoreNew 保证不会重复起第二个）
#   3) 无 72 小时执行时限；电池供电也运行；睡醒后立即补跑
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File install-task.ps1
# 卸载: powershell -NoProfile -ExecutionPolicy Bypass -File uninstall-task.ps1

$node = (Get-Command node.exe -ErrorAction Stop).Source
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $dir "watchdog.mjs"

$argLine = "-NoProfile -WindowStyle Hidden -Command `"& '$node' '$script'`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argLine

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
Write-Host "ZCodeWatchdog 已注册并启动（隐藏窗口 / 5 分钟断链自愈 / 登录自启 / 无时限）"
