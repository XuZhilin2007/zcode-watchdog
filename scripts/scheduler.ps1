param([Parameter(Mandatory=$true)][ValidateSet('install','remove','inspect')][string]$Action)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($request.task -notmatch '^ZCodeWatchdogV2-[a-f0-9]{12}$') { throw 'Invalid task name' }
  if (-not [IO.Path]::IsPathRooted($request.home)) { throw 'Invalid data path' }
  if ($Action -eq 'remove') {
    $task = Get-ScheduledTask -TaskName $request.task -ErrorAction SilentlyContinue
    if ($null -ne $task) {
      # Runtime desired=stopped is committed before this script is called.
      Unregister-ScheduledTask -TaskName $request.task -Confirm:$false
    }
    Write-Output 'removed'
  } elseif ($Action -eq 'inspect') {
    $task = Get-ScheduledTask -TaskName $request.task -ErrorAction SilentlyContinue
    if ($null -eq $task) { Write-Output 'not installed' } else { Write-Output ([string]$task.State) }
  } else {
    if (-not (Test-Path -LiteralPath $request.launcher -PathType Leaf)) { throw 'Launcher missing' }
    $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $actionSpec = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\wscript.exe') -Argument ('//B "' + $request.launcher + '"')
    $logon = New-ScheduledTaskTrigger -AtLogOn -User $user
    $repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $request.task -Action $actionSpec -Trigger @($logon,$repeat) -Settings $settings -Principal $principal -Force | Out-Null
    # Registration deliberately does not start the task.
    Write-Output 'installed'
  }
  exit 0
} catch {
  [Console]::Error.WriteLine('Scheduled task operation failed. Check permissions and Windows Script Host.')
  exit 1
}
