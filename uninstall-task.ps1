# 停止并删除 ZCodeWatchdog 计划任务
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File uninstall-task.ps1

Stop-ScheduledTask -TaskName "ZCodeWatchdog" -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "ZCodeWatchdog" -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "ZCodeWatchdog 计划任务已删除"
