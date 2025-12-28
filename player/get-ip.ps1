# Get your local IP address for network access
Write-Host "Finding your local IP address..." -ForegroundColor Cyan
Write-Host ""

$ipAddresses = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.IPAddress -notlike "127.*" -and 
    $_.IPAddress -notlike "169.254.*" -and
    $_.InterfaceAlias -notlike "*Loopback*"
} | Select-Object IPAddress, InterfaceAlias

if ($ipAddresses) {
    Write-Host "Your local IP address(es):" -ForegroundColor Green
    Write-Host ""
    foreach ($ip in $ipAddresses) {
        Write-Host "  $($ip.IPAddress) - $($ip.InterfaceAlias)" -ForegroundColor Yellow
        Write-Host "  Access URL: http://$($ip.IPAddress):8000" -ForegroundColor Cyan
        Write-Host ""
    }
    Write-Host "Use this IP address on other devices to access the game!" -ForegroundColor Green
} else {
    Write-Host "Could not find a local IP address. Make sure you're connected to a network." -ForegroundColor Red
}

Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")


