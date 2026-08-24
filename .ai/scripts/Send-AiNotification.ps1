[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Status,
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$Message,
    [ValidateSet('min', 'low', 'default', 'high', 'max')][string]$Priority = 'default',
    [string]$Tags,
    [switch]$DryRun
)

$topic = [Environment]::GetEnvironmentVariable('GYMFLOW_NTFY_TOPIC')
if ([string]::IsNullOrWhiteSpace($topic)) { Write-Output 'NOT_CONFIGURED'; exit 0 }
$baseUrl = [Environment]::GetEnvironmentVariable('GYMFLOW_NTFY_URL')
if ([string]::IsNullOrWhiteSpace($baseUrl)) { $baseUrl = 'https://ntfy.sh' }
if ($DryRun) { Write-Output 'CONFIGURED'; exit 0 }

try {
    $uri = $baseUrl.TrimEnd('/') + '/' + [Uri]::EscapeDataString($topic)
    $headers = @{ Title = $Title; Priority = $Priority }
    if (-not [string]::IsNullOrWhiteSpace($Tags)) { $headers.Tags = $Tags }
    # Windows PowerShell 5 can otherwise negotiate an obsolete TLS version.
    $previousSecurityProtocol = [Net.ServicePointManager]::SecurityProtocol
    [Net.ServicePointManager]::SecurityProtocol = $previousSecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    try {
        Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $Message -ContentType 'text/plain; charset=utf-8' -TimeoutSec 10 -ErrorAction Stop | Out-Null
    }
    finally {
        [Net.ServicePointManager]::SecurityProtocol = $previousSecurityProtocol
    }
    Write-Output 'SENT'
} catch {
    Write-Output 'FAILED'
}
