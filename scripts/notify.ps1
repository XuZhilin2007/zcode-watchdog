$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($payload.message.Length -gt 300) { exit 1 }
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $icon = New-Object System.Windows.Forms.NotifyIcon
  try {
    $icon.Icon = [System.Drawing.SystemIcons]::Information
    $icon.Visible = $true
    $icon.ShowBalloonTip(8000, 'ZCode Watchdog', [string]$payload.message, [System.Windows.Forms.ToolTipIcon]::Info)
    Start-Sleep -Seconds 10
  } finally { $icon.Dispose() }
} catch { exit 1 }
