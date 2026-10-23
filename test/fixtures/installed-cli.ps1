[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$env:ZWD_HOME = $payload.home
$arguments = @($payload.arguments)
& $payload.shim @arguments
exit $LASTEXITCODE
