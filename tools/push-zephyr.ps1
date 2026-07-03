param(
  [Parameter(Mandatory = $true)]
  [string]$JsonPath,

  [Parameter(Mandatory = $false)]
  [string]$Endpoint,

  [Parameter(Mandatory = $false)]
  [ValidateSet("bearer", "basic")]
  [string]$AuthType = "bearer",

  [Parameter(Mandatory = $false)]
  [string]$Token
)

if (-not (Test-Path -Path $JsonPath)) {
  throw "JSON file not found: $JsonPath"
}

function Read-Value {
  param(
    [string]$Label,
    [string]$CurrentValue
  )

  if ([string]::IsNullOrWhiteSpace($CurrentValue)) {
    return Read-Host "$Label"
  }

  $value = Read-Host "$Label [$CurrentValue]"
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $CurrentValue
  }
  return $value
}

$payloadRaw = Get-Content -Path $JsonPath -Raw
$payload = $payloadRaw | ConvertFrom-Json -Depth 100

Write-Host "Provide Zephyr metadata for this push (press Enter to keep defaults from file)."

$payload.projectKey = Read-Value -Label "Project key" -CurrentValue $payload.projectKey
$payload.name = Read-Value -Label "Test case name" -CurrentValue $payload.name
$payload.objective = Read-Value -Label "Objective" -CurrentValue $payload.objective
$payload.precondition = Read-Value -Label "Precondition" -CurrentValue $payload.precondition
$payload.priority = Read-Value -Label "Priority" -CurrentValue $payload.priority
$payload.status = Read-Value -Label "Status" -CurrentValue $payload.status
$payload.folder = Read-Value -Label "Folder path" -CurrentValue $payload.folder

$segmentDefault = ""
if ($payload.customFields -and $payload.customFields.Segments -and $payload.customFields.Segments.Count -gt 0) {
  $segmentDefault = [string]$payload.customFields.Segments[0]
}
$segmentValue = Read-Value -Label "Segment" -CurrentValue $segmentDefault
if (-not $payload.customFields) {
  $payload | Add-Member -NotePropertyName customFields -NotePropertyValue @{}
}
$payload.customFields.Segments = @($segmentValue)

$labelsDefault = ""
if ($payload.labels) {
  $labelsDefault = ($payload.labels -join ",")
}
$labelsValue = Read-Value -Label "Labels (comma separated)" -CurrentValue $labelsDefault
$payload.labels = @($labelsValue -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ })

if ([string]::IsNullOrWhiteSpace($Endpoint)) {
  $Endpoint = Read-Host "Zephyr API endpoint (example: https://api.zephyrscale.smartbear.com/v2/testcases)"
}

if ([string]::IsNullOrWhiteSpace($Token)) {
  $Token = Read-Host "Auth token"
}

$payloadRaw = $payload | ConvertTo-Json -Depth 100
$headers = @{
  "Content-Type" = "application/json"
}

if ($AuthType -eq "basic") {
  $headers["Authorization"] = "Basic $Token"
} else {
  $headers["Authorization"] = "Bearer $Token"
}

Write-Host "Uploading test case JSON to Zephyr endpoint..."
$response = Invoke-RestMethod -Method Post -Uri $Endpoint -Headers $headers -Body $payloadRaw

Write-Host "Upload complete. Server response:"
$response | ConvertTo-Json -Depth 10
