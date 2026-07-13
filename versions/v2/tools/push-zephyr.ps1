param(
  [Parameter(Mandatory = $false)]
  [string]$JsonPath,

  [Parameter(Mandatory = $false)]
  [string]$JsonFolderPath,

  [Parameter(Mandatory = $false)]
  [string]$Endpoint,

  [Parameter(Mandatory = $false)]
  [ValidateSet("bearer", "basic")]
  [string]$AuthType = "bearer",

  [Parameter(Mandatory = $false)]
  [string]$Token
)

$ErrorActionPreference = 'Stop'

function Load-DotEnv {
  param(
    [string]$Path
  )

  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -Path $Path)) {
    return @{}
  }

  $values = @{}
  foreach ($line in Get-Content -Path $Path) {
    $trimmed = $line.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith("#")) {
      continue
    }

    $parts = $trimmed -split "=", 2
    if ($parts.Count -ne 2) {
      continue
    }

    $key = $parts[0].Trim()
    $value = $parts[1].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    $values[$key] = $value
  }

  return $values
}

function Get-ValueOrDefault {
  param(
    [string]$Value,
    [string]$DefaultValue
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $DefaultValue
  }
  return $Value
}

function Ensure-Value {
  param(
    [string]$Value,
    [string]$Name
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "Missing required value: $Name"
  }

  return $Value
}

function Set-ObjectProperty {
  param(
    [object]$Target,
    [string]$Name,
    [object]$Value
  )

  if ($Target -is [hashtable]) {
    $Target[$Name] = $Value
    return
  }

  $existing = $Target.PSObject.Properties[$Name]
  if ($null -ne $existing) {
    $existing.Value = $Value
    return
  }

  $Target | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

function Remove-ObjectProperty {
  param(
    [object]$Target,
    [string]$Name
  )

  if ($null -eq $Target) {
    return
  }

  if ($Target -is [hashtable]) {
    if ($Target.ContainsKey($Name)) {
      $Target.Remove($Name) | Out-Null
    }
    return
  }

  $prop = $Target.PSObject.Properties[$Name]
  if ($null -ne $prop) {
    $Target.PSObject.Properties.Remove($Name)
  }
}

function Get-BoolFromEnv {
  param(
    [string]$Value,
    [bool]$DefaultValue
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $DefaultValue
  }

  switch -Regex ($Value.Trim().ToLowerInvariant()) {
    '^(1|true|yes|y|on)$' { return $true }
    '^(0|false|no|n|off)$' { return $false }
    default { return $DefaultValue }
  }
}

function Get-IntFromEnv {
  param(
    [string]$Value,
    [int]$DefaultValue,
    [int]$MinValue,
    [int]$MaxValue
  )

  $parsed = 0
  if ([string]::IsNullOrWhiteSpace($Value) -or -not [int]::TryParse($Value.Trim(), [ref]$parsed)) {
    return $DefaultValue
  }

  if ($parsed -lt $MinValue) {
    return $MinValue
  }

  if ($parsed -gt $MaxValue) {
    return $MaxValue
  }

  return $parsed
}

function Is-TransientAttachmentError {
  param(
    [string]$ErrorText
  )

  if ([string]::IsNullOrWhiteSpace($ErrorText)) {
    return $false
  }

  $text = $ErrorText.ToLowerInvariant()
  if ($text -match 'http\s*429' -or $text -match 'http\s*5\d\d') {
    return $true
  }

  if ($text -match '503' -or $text -match 'cloudfront' -or $text -match 'request could not be satisfied' -or $text -match 'too much traffic') {
    return $true
  }

  return $false
}

function Remove-EmbeddedImagesFromHtml {
  param(
    [string]$Text
  )

  if ([string]::IsNullOrWhiteSpace($Text)) {
    return $Text
  }

  # Drop inline base64 images to keep payload size/API validation within limits.
  $withoutDataImages = [regex]::Replace(
    $Text,
    '(?is)<img\b[^>]*src\s*=\s*["'']data:image\/[^"'']+["''][^>]*>',
    ''
  )

  return $withoutDataImages.Trim()
}

function Limit-TextLength {
  param(
    [string]$Text,
    [int]$MaxLength
  )

  if ($null -eq $Text) {
    return ""
  }

  $clean = $Text -replace '[\r\n]+', ' '
  $clean = $clean.Trim()
  if ($clean.Length -le $MaxLength) {
    return $clean
  }

  return $clean.Substring(0, $MaxLength) + "..."
}

function To-SafePlainText {
  param(
    [string]$Text,
    [int]$MaxLength,
    [string]$Fallback
  )

  if ($null -eq $Text) {
    return $Fallback
  }

  $clean = $Text
  $clean = [System.Net.WebUtility]::HtmlDecode($clean)
  $clean = [regex]::Replace($clean, '(?is)data:image\/[^;]+;base64,[A-Za-z0-9+/=]+', ' ')
  # Remove HTML tags first (<br>, <span>, etc.) so we send plain text to Zephyr step API.
  $clean = [regex]::Replace($clean, '(?is)<[^>]+>', ' ')
  # Remove non-printable / non-ASCII chars that can break payload validation.
  $clean = [regex]::Replace($clean, '[^\x20-\x7E\t\r\n]', ' ')
  $clean = $clean -replace '[\r\n]+', ' '
  $clean = [regex]::Replace($clean, '\s+', ' ').Trim()

  if ([string]::IsNullOrWhiteSpace($clean)) {
    $clean = $Fallback
  }

  if ($clean.Length -gt $MaxLength) {
    $clean = $clean.Substring(0, $MaxLength) + "..."
  }

  return $clean
}

function Get-PrimarySegmentValue {
  param(
    [object]$SourcePayload
  )

  $segmentFromEnv = Get-ValueOrDefault $envValues.ZEPHYR_SEGMENT ""
  if (-not [string]::IsNullOrWhiteSpace($segmentFromEnv)) {
    return $segmentFromEnv
  }

  $segmentFieldName = Get-ValueOrDefault $envValues.ZEPHYR_SEGMENT_FIELD_NAME "Segments "
  if ($SourcePayload.customFields) {
    $segmentField = $SourcePayload.customFields.PSObject.Properties[$segmentFieldName]
    if ($null -eq $segmentField -and $segmentFieldName -ne "Segments") {
      $segmentField = $SourcePayload.customFields.PSObject.Properties["Segments"]
    }
    if ($null -eq $segmentField -and $segmentFieldName -ne "Segments ") {
      $segmentField = $SourcePayload.customFields.PSObject.Properties["Segments "]
    }

    if ($null -ne $segmentField -and $segmentField.Value -and $segmentField.Value.Count -gt 0) {
      return [string]$segmentField.Value[0]
    }
  }

  return ""
}

function Extract-StepScreenshots {
  param(
    [object]$SourcePayload
  )

  $results = @()
  if (-not $SourcePayload.testScript -or -not $SourcePayload.testScript.steps) {
    return $results
  }

  for ($i = 0; $i -lt $SourcePayload.testScript.steps.Count; $i++) {
    $step = $SourcePayload.testScript.steps[$i]
    $dataUrl = ""
    if ($step.customFields -and $step.customFields.screenshotDataUrl) {
      $dataUrl = [string]$step.customFields.screenshotDataUrl
    }

    $results += [pscustomobject]@{
      Index = $i
      DataUrl = $dataUrl
    }
  }

  return $results
}

function Parse-DataUrlImage {
  param(
    [string]$DataUrl
  )

  if ([string]::IsNullOrWhiteSpace($DataUrl)) {
    return $null
  }

  $match = [regex]::Match($DataUrl, '^data:(?<mime>image\/[-+.a-zA-Z0-9]+);base64,(?<data>[A-Za-z0-9+/=]+)$')
  if (-not $match.Success) {
    return $null
  }

  $mime = $match.Groups['mime'].Value
  $base64 = $match.Groups['data'].Value
  $bytes = [Convert]::FromBase64String($base64)

  $ext = switch ($mime.ToLowerInvariant()) {
    'image/jpeg' { 'jpg' }
    'image/jpg' { 'jpg' }
    'image/png' { 'png' }
    'image/webp' { 'webp' }
    default { 'bin' }
  }

  return [pscustomobject]@{
    Mime = $mime
    Extension = $ext
    Bytes = $bytes
  }
}

function Upload-StepScreenshots {
  param(
    [string]$TestCaseKey,
    [array]$StepScreenshots
  )

  $enableScreenshotUpload = Get-BoolFromEnv -Value $envValues.ZEPHYR_UPLOAD_STEP_SCREENSHOTS -DefaultValue $true
  if (-not $enableScreenshotUpload) {
    return
  }

  $maxAttempts = Get-IntFromEnv -Value $envValues.ZEPHYR_STEP_SCREENSHOT_UPLOAD_RETRIES -DefaultValue 3 -MinValue 1 -MaxValue 10
  $baseDelayMs = Get-IntFromEnv -Value $envValues.ZEPHYR_STEP_SCREENSHOT_RETRY_DELAY_MS -DefaultValue 1200 -MinValue 200 -MaxValue 30000

  if (-not $StepScreenshots -or $StepScreenshots.Count -eq 0) {
    return
  }

  $stepsResponse = Invoke-RestMethod -Method Get -Uri "$Endpoint/$TestCaseKey/teststeps?startAt=0&maxResults=1000" -Headers $headers
  if (-not $stepsResponse -or -not $stepsResponse.values) {
    return
  }

  $uploadedCount = 0
  $stepValues = @($stepsResponse.values)
  $authHeader = @{
    "Authorization" = $headers["Authorization"]
  }

  for ($i = 0; $i -lt $StepScreenshots.Count; $i++) {
    if ($i -ge $stepValues.Count) {
      break
    }

    $shot = $StepScreenshots[$i]
    $parsed = Parse-DataUrlImage -DataUrl $shot.DataUrl
    if ($null -eq $parsed) {
      continue
    }

    $stepId = $stepValues[$i].id
    if ($null -eq $stepId) {
      continue
    }

    $fileName = "step-{0:D3}-screenshot.{1}" -f ($i + 1), $parsed.Extension
    $attachmentUri = "$Endpoint/$TestCaseKey/teststeps/$stepId/attachments/$fileName"
    $binaryHeaders = @{
      "Authorization" = $authHeader["Authorization"]
      "Content-Type" = $parsed.Mime
    }

    $uploaded = $false
    $lastError = ""
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
      try {
        Invoke-RestMethod -Method Put -Uri $attachmentUri -Headers $binaryHeaders -Body $parsed.Bytes | Out-Null
        $uploaded = $true
        $uploadedCount++
        break
      } catch {
        $lastError = Get-HttpErrorDetail -ErrorRecord $_
        $isTransient = Is-TransientAttachmentError -ErrorText $lastError

        if ($isTransient -and $attempt -lt $maxAttempts) {
          $delayMs = [Math]::Min($baseDelayMs * [Math]::Pow(2, $attempt - 1), 30000)
          Write-Host "   Warning: step screenshot upload failed for step $($i + 1) (attempt $attempt/$maxAttempts). Retrying in $([int]$delayMs) ms..."
          [System.Threading.Thread]::Sleep([int]$delayMs)
          continue
        }

        break
      }
    }

    if (-not $uploaded) {
      Write-Host "   Warning: step screenshot upload failed for step $($i + 1): $lastError"
    }
  }

  if ($uploadedCount -gt 0) {
    Write-Host "   Uploaded $uploadedCount step screenshot(s)"
  }
}

function ConvertFrom-JwtPayload {
  param(
    [string]$Jwt
  )

  if ([string]::IsNullOrWhiteSpace($Jwt)) {
    return $null
  }

  $parts = $Jwt.Split('.')
  if ($parts.Count -lt 2) {
    return $null
  }

  $p = $parts[1].Replace('-', '+').Replace('_', '/')
  switch ($p.Length % 4) {
    2 { $p += '==' }
    3 { $p += '=' }
    1 { $p += '===' }
  }

  try {
    $bytes = [Convert]::FromBase64String($p)
    return ([System.Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json)
  } catch {
    return $null
  }
}

function Get-RichTextUploadDetails {
  param(
    [string]$Backend,
    [string]$Jwt,
    [string]$ProjectId
  )

  $uri = "$($Backend.TrimEnd('/'))/rest/tests/2.0/uploaddetails/richtextattachment"
  $reqHeaders = @{
    Authorization = "JWT $Jwt"
    "jira-project-id" = $ProjectId
    "accept" = "application/json, text/plain, */*"
  }
  return Invoke-RestMethod -Method Get -Uri $uri -Headers $reqHeaders
}

function New-MultipartBody {
  param(
    [System.Collections.Specialized.OrderedDictionary]$Fields,
    [string]$FileName,
    [string]$FileMime,
    [byte[]]$FileBytes,
    [string]$Boundary
  )

  $sb = New-Object System.Text.StringBuilder
  foreach ($k in $Fields.Keys) {
    [void]$sb.Append("--$Boundary`r`n")
    [void]$sb.Append("Content-Disposition: form-data; name=`"$k`"`r`n`r`n")
    [void]$sb.Append("$($Fields[$k])`r`n")
  }
  [void]$sb.Append("--$Boundary`r`n")
  [void]$sb.Append("Content-Disposition: form-data; name=`"file`"; filename=`"$FileName`"`r`n")
  [void]$sb.Append("Content-Type: $FileMime`r`n`r`n")

  $enc = [System.Text.Encoding]::UTF8
  $prefixBytes = $enc.GetBytes($sb.ToString())
  $suffixBytes = $enc.GetBytes("`r`n--$Boundary--`r`n")

  $out = New-Object byte[] ($prefixBytes.Length + $FileBytes.Length + $suffixBytes.Length)
  [System.Buffer]::BlockCopy($prefixBytes, 0, $out, 0, $prefixBytes.Length)
  [System.Buffer]::BlockCopy($FileBytes, 0, $out, $prefixBytes.Length, $FileBytes.Length)
  [System.Buffer]::BlockCopy($suffixBytes, 0, $out, $prefixBytes.Length + $FileBytes.Length, $suffixBytes.Length)
  return ,$out
}

function Upload-InlineImages {
  param(
    [array]$StepScreenshots
  )

  $result = @{}
  if (-not $StepScreenshots -or $StepScreenshots.Count -eq 0) {
    return $result
  }

  $jwt = Get-ValueOrDefault $envValues.ZEPHYR_WEB_JWT ""
  if ([string]::IsNullOrWhiteSpace($jwt)) {
    throw "ZEPHYR_INLINE_IMAGE is enabled but ZEPHYR_WEB_JWT is not set. Paste a fresh browser JWT (valid ~15 min)."
  }
  $jwt = ($jwt.Trim() -replace '^(?i)(JWT|Bearer)\s+', '')

  $backend = Get-ValueOrDefault $envValues.ZEPHYR_TM4J_BACKEND "https://app.tm4j.smartbear.com/backend"
  $claims = ConvertFrom-JwtPayload -Jwt $jwt
  if ($null -eq $claims) {
    throw "Could not parse ZEPHYR_WEB_JWT."
  }

  $accountId = [string]$claims.sub
  $projectId = ""
  if ($claims.context -and $claims.context.jira -and $claims.context.jira.project) {
    $projectId = [string]$claims.context.jira.project.id
  }
  $projectId = Get-ValueOrDefault $envValues.ZEPHYR_JIRA_PROJECT_ID $projectId
  if ([string]::IsNullOrWhiteSpace($projectId)) {
    throw "Could not determine jira project id for inline image upload (set ZEPHYR_JIRA_PROJECT_ID)."
  }

  foreach ($shot in $StepScreenshots) {
    if ([string]::IsNullOrWhiteSpace($shot.DataUrl)) {
      continue
    }
    $parsed = Parse-DataUrlImage -DataUrl $shot.DataUrl
    if ($null -eq $parsed) {
      continue
    }

    try {
      $details = Get-RichTextUploadDetails -Backend $backend -Jwt $jwt -ProjectId $projectId
    } catch {
      $d = Get-HttpErrorDetail -ErrorRecord $_
      throw "Rich-text signing request failed (is ZEPHYR_WEB_JWT still valid? it expires ~15 min): $d"
    }

    $fileName = "step-{0:D3}-screenshot.{1}" -f ([int]$shot.Index + 1), $parsed.Extension
    $epoch = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
    $key = "$($details.keyPrefix)$epoch-$fileName"

    $fields = [ordered]@{
      key = $key
      success_action_status = "201"
      "X-Requested-With" = "xhr"
      "Content-Type" = $parsed.Mime
      policy = $details.policy
      "X-Amz-Credential" = $details.credential
      "X-Amz-Algorithm" = "AWS4-HMAC-SHA256"
      "X-Amz-Date" = $details.date
      "X-Amz-Signature" = $details.signature
      "X-Amz-Meta-user-account-id" = $accountId
    }

    $boundary = "----WebKitFormBoundary" + ([System.Guid]::NewGuid().ToString("N").Substring(0, 16))
    $body = New-MultipartBody -Fields $fields -FileName $fileName -FileMime $parsed.Mime -FileBytes $parsed.Bytes -Boundary $boundary

    $s3Headers = @{
      Authorization = "JWT $jwt"
      origin = "https://app.tm4j.smartbear.com"
      referer = "https://app.tm4j.smartbear.com/"
      "jira-project-id" = $projectId
      "atm-rest-base" = $backend
    }

    try {
      Invoke-WebRequest -UseBasicParsing -Method Post -Uri $details.bucketUrl -Headers $s3Headers -ContentType "multipart/form-data; boundary=$boundary" -Body $body | Out-Null
    } catch {
      $resp = $_.Exception.Response
      $code = if ($resp) { [int]$resp.StatusCode } else { 0 }
      if ($code -ne 201) {
        $d = Get-HttpErrorDetail -ErrorRecord $_
        throw "S3 image upload failed (HTTP $code): $d"
      }
    }

    $finalUrl = "$($details.bucketUrl.TrimEnd('/'))/$key"
    $result[[int]$shot.Index] = "<img src=""$finalUrl"" style=""width: 300px;"" class=""fr-fil fr-dib"">"
  }

  return $result
}

function Sanitize-PayloadForUpload {
  param(
    [object]$Payload
  )

  $stripEmbeddedImages = Get-BoolFromEnv -Value $envValues.ZEPHYR_STRIP_EMBEDDED_IMAGES -DefaultValue $true
  $stripStepCustomFields = Get-BoolFromEnv -Value $envValues.ZEPHYR_STRIP_STEP_CUSTOM_FIELDS -DefaultValue $true
  $stripStepScreenshotField = Get-BoolFromEnv -Value $envValues.ZEPHYR_STRIP_STEP_SCREENSHOT_FIELD -DefaultValue $true

  if (-not $Payload.testScript -or -not $Payload.testScript.steps) {
    return
  }

  foreach ($step in $Payload.testScript.steps) {
    if ($stripEmbeddedImages) {
      $step.description = Remove-EmbeddedImagesFromHtml -Text $step.description
      $step.expectedResult = Remove-EmbeddedImagesFromHtml -Text $step.expectedResult
    }

    if ($stripStepCustomFields) {
      Remove-ObjectProperty -Target $step -Name "customFields"
      continue
    }

    if ($stripStepScreenshotField -and $step.customFields) {
      Remove-ObjectProperty -Target $step.customFields -Name "screenshotDataUrl"
    }
  }
}

function Build-TestCaseCreatePayload {
  param(
    [object]$SourcePayload
  )

  $createPayload = [ordered]@{}
  $createPayload.projectKey = Get-ValueOrDefault $envValues.ZEPHYR_PROJECT_KEY $SourcePayload.projectKey
  $createPayload.name = Get-ValueOrDefault $envValues.ZEPHYR_NAME $SourcePayload.name

  $objective = Get-ValueOrDefault $envValues.ZEPHYR_OBJECTIVE $SourcePayload.objective
  if (-not [string]::IsNullOrWhiteSpace($objective)) {
    $createPayload.objective = $objective
  }

  $precondition = Get-ValueOrDefault $envValues.ZEPHYR_PRECONDITION $SourcePayload.precondition
  if (-not [string]::IsNullOrWhiteSpace($precondition)) {
    $createPayload.precondition = $precondition
  }

  $priorityName = Get-ValueOrDefault $envValues.ZEPHYR_PRIORITY $SourcePayload.priority
  if (-not [string]::IsNullOrWhiteSpace($priorityName)) {
    $createPayload.priorityName = $priorityName
  }

  $statusName = Get-ValueOrDefault $envValues.ZEPHYR_STATUS $SourcePayload.status
  if (-not [string]::IsNullOrWhiteSpace($statusName)) {
    $createPayload.statusName = $statusName
  }

  $folderIdValue = Get-ValueOrDefault $envValues.ZEPHYR_FOLDER_ID ""
  $folderValue = Get-ValueOrDefault $envValues.ZEPHYR_FOLDER ""
  if ([string]::IsNullOrWhiteSpace($folderValue)) {
    $folderValue = [string]$SourcePayload.folder
  }

  if (-not [string]::IsNullOrWhiteSpace($folderIdValue)) {
    $parsedFolderId = 0
    if ([int64]::TryParse($folderIdValue, [ref]$parsedFolderId)) {
      $createPayload.folderId = $parsedFolderId
    }
  } elseif (-not [string]::IsNullOrWhiteSpace($folderValue)) {
    $resolvedFolderId = Resolve-TestCaseFolderId -ProjectKey $createPayload.projectKey -FolderRef $folderValue
    if ($null -ne $resolvedFolderId) {
      $createPayload.folderId = $resolvedFolderId
    }
  }

  $labelsDefault = ""
  if ($SourcePayload.labels) {
    $labelsDefault = ($SourcePayload.labels -join ",")
  }
  $labelsValue = Get-ValueOrDefault $envValues.ZEPHYR_LABELS $labelsDefault
  $createPayload.labels = @($labelsValue -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ })

  $includeCustomFields = Get-BoolFromEnv -Value $envValues.ZEPHYR_INCLUDE_CUSTOM_FIELDS -DefaultValue $false
  if ($includeCustomFields -and $SourcePayload.customFields) {
    $createPayload.customFields = $SourcePayload.customFields
  }

  $segmentValue = Get-PrimarySegmentValue -SourcePayload $SourcePayload
  $segmentFieldName = Get-ValueOrDefault $envValues.ZEPHYR_SEGMENT_FIELD_NAME "Segments "
  if (-not [string]::IsNullOrWhiteSpace($segmentValue)) {
    if (-not $createPayload.Contains('customFields') -or -not $createPayload.customFields) {
      $createPayload.customFields = [pscustomobject]@{}
    }
    Set-ObjectProperty -Target $createPayload.customFields -Name $segmentFieldName -Value @($segmentValue)
  }

  return $createPayload
}

function Get-ZephyrApiBaseUrl {
  param(
    [string]$TestCasesEndpoint
  )

  if ([string]::IsNullOrWhiteSpace($TestCasesEndpoint)) {
    return ""
  }

  $base = $TestCasesEndpoint.TrimEnd('/')
  if ($base.ToLowerInvariant().EndsWith('/testcases')) {
    return $base.Substring(0, $base.Length - '/testcases'.Length)
  }
  return $base
}

function Get-AllTestCaseFolders {
  param(
    [string]$ProjectKey
  )

  $baseUrl = Get-ZephyrApiBaseUrl -TestCasesEndpoint $Endpoint
  if ([string]::IsNullOrWhiteSpace($baseUrl)) {
    return @()
  }

  $all = @()
  $startAt = 0
  $maxResults = 1000

  while ($true) {
    $uri = "{0}/folders?projectKey={1}&folderType=TEST_CASE&startAt={2}&maxResults={3}" -f $baseUrl, $ProjectKey, $startAt, $maxResults
    $response = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers

    if ($response -and $response.values) {
      $all += @($response.values)
    }

    if (-not $response -or $response.isLast -eq $true) {
      break
    }

    $startAt += $maxResults
  }

  return $all
}

function Resolve-TestCaseFolderId {
  param(
    [string]$ProjectKey,
    [string]$FolderRef
  )

  if ([string]::IsNullOrWhiteSpace($FolderRef)) {
    return $null
  }

  $trimmed = $FolderRef.Trim()
  $parsedNumericId = 0
  if ([int64]::TryParse($trimmed, [ref]$parsedNumericId)) {
    return $parsedNumericId
  }

  try {
    $folders = Get-AllTestCaseFolders -ProjectKey $ProjectKey
  } catch {
    Write-Host "   Warning: Failed to load folders for project $ProjectKey. Using default folder."
    return $null
  }

  if ($folders.Count -eq 0) {
    return $null
  }

  $segments = @($trimmed.Split('/') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if ($segments.Count -eq 0) {
    return $null
  }

  # Single-segment support (folder name only).
  if ($segments.Count -eq 1) {
    $named = @($folders | Where-Object { $_.name -eq $segments[0] })
    if ($named.Count -eq 1) {
      return [int64]$named[0].id
    }
  }

  # Path support like /Parent/Child.
  $roots = @($folders | Where-Object { ($null -eq $_.parentId) -or ([int64]$_.parentId -eq 0) })
  $currentCandidates = @($roots | Where-Object { $_.name -eq $segments[0] })

  for ($i = 1; $i -lt $segments.Count; $i++) {
    $nextCandidates = @()
    foreach ($candidate in $currentCandidates) {
      $nextCandidates += @(
        $folders | Where-Object {
          ([int64]$_.parentId -eq [int64]$candidate.id) -and ($_.name -eq $segments[$i])
        }
      )
    }
    $currentCandidates = @($nextCandidates)
  }

  if ($currentCandidates.Count -ge 1) {
    return [int64]$currentCandidates[0].id
  }

  Write-Host "   Warning: Folder '$FolderRef' not found in project $ProjectKey. Using default folder."
  return $null
}

function Build-TestStepsItems {
  param(
    [object]$SourcePayload,
    [hashtable]$StepImageHtml
  )

  $items = @()
  if (-not $SourcePayload.testScript -or -not $SourcePayload.testScript.steps) {
    return $items
  }

  for ($i = 0; $i -lt $SourcePayload.testScript.steps.Count; $i++) {
    $step = $SourcePayload.testScript.steps[$i]
    $stepIndex = 1
    if ($step.index -ne $null) {
      $stepIndex = [int]$step.index + 1
    }

    $expectedText = To-SafePlainText -Text ([string]$step.expectedResult) -MaxLength 300 -Fallback "Step completes successfully"

    if ($StepImageHtml -and $StepImageHtml.ContainsKey($i)) {
      $expectedText = "$expectedText$($StepImageHtml[$i])"
    }

    $inlineStep = [ordered]@{
      description = To-SafePlainText -Text ([string]$step.description) -MaxLength 300 -Fallback ("Step {0}" -f $stepIndex)
      testData = To-SafePlainText -Text ([string]$step.testData) -MaxLength 300 -Fallback "None"
      expectedResult = $expectedText
    }

    $items += [ordered]@{
      inline = $inlineStep
    }
  }

  return $items
}

function Build-StepPayloadVariants {
  param(
    [array]$Batch,
    [string]$Mode
  )

  $variants = @()

  # Variant 1: documented Zephyr Scale format (inline wrapper).
  $variants += [ordered]@{
    mode = $Mode
    items = $Batch
  }

  # Variant 2: direct item format used by some integrations.
  $directItems = @()
  foreach ($item in $Batch) {
    if ($item.inline) {
      $directItems += [ordered]@{
        description = [string]$item.inline.description
        testData = [string]$item.inline.testData
        expectedResult = [string]$item.inline.expectedResult
      }
    }
  }
  $variants += [ordered]@{
    mode = $Mode
    items = $directItems
  }

  # Variant 3: action/data/result aliases used by older payload shapes.
  $legacyItems = @()
  foreach ($item in $Batch) {
    if ($item.inline) {
      $legacyItems += [ordered]@{
        inline = [ordered]@{
          action = [string]$item.inline.description
          data = [string]$item.inline.testData
          result = [string]$item.inline.expectedResult
        }
      }
    }
  }
  $variants += [ordered]@{
    mode = $Mode
    items = $legacyItems
  }

  return $variants
}

function Build-PlainTextScriptFromStepItems {
  param(
    [array]$StepItems
  )

  $lines = @()
  $lineNo = 1
  foreach ($item in $StepItems) {
    if (-not $item.inline) {
      continue
    }

    $lines += "$lineNo. $([string]$item.inline.description)"
    if (-not [string]::IsNullOrWhiteSpace([string]$item.inline.testData)) {
      $lines += "   Test data: $([string]$item.inline.testData)"
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$item.inline.expectedResult)) {
      $lines += "   Expected: $([string]$item.inline.expectedResult)"
    }
    $lines += ""
    $lineNo++
  }

  $text = ($lines -join "`n").Trim()
  return Limit-TextLength -Text $text -MaxLength 30000
}

function Get-HttpErrorDetail {
  param(
    [object]$ErrorRecord
  )

  $message = $ErrorRecord.Exception.Message
  if ($ErrorRecord.ErrorDetails -and -not [string]::IsNullOrWhiteSpace($ErrorRecord.ErrorDetails.Message)) {
    $message = $ErrorRecord.ErrorDetails.Message
  }
  $responseBody = $null
  $statusCode = $null

  try {
    $response = $ErrorRecord.Exception.Response
    if ($null -ne $response) {
      if ($response.PSObject.Properties["StatusCode"]) {
        $statusCode = [int]$response.StatusCode
      }

      $stream = $response.GetResponseStream()
      if ($null -ne $stream) {
        $reader = New-Object System.IO.StreamReader($stream)
        $responseBody = $reader.ReadToEnd()
        $reader.Close()
        $stream.Close()
      }
    }
  } catch {
    # Fall back to the base exception message when response stream cannot be read.
  }

  if ([string]::IsNullOrWhiteSpace($responseBody)) {
    return $message
  }

  $snippet = $responseBody
  if ($snippet.Length -gt 2000) {
    $snippet = $snippet.Substring(0, 2000) + "... [truncated]"
  }

  if ($null -ne $statusCode) {
    return "HTTP ${statusCode}: $snippet"
  }

  return $snippet
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$hardcodedEnvPath = Join-Path (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $scriptRoot))) ".env"
$envValues = Load-DotEnv -Path $hardcodedEnvPath

if ([string]::IsNullOrWhiteSpace($JsonFolderPath)) {
  $JsonFolderPath = Get-ValueOrDefault $envValues.ZEPHYR_JSON_FOLDER ""
}

if ([string]::IsNullOrWhiteSpace($JsonPath) -and [string]::IsNullOrWhiteSpace($JsonFolderPath)) {
  $JsonPath = Get-ValueOrDefault $envValues.ZEPHYR_JSON_PATH ""
}

$jsonFiles = @()
if (-not [string]::IsNullOrWhiteSpace($JsonFolderPath)) {
  if (-not (Test-Path -Path $JsonFolderPath)) {
    throw "JSON folder not found: $JsonFolderPath"
  }
  $jsonFiles = Get-ChildItem -Path $JsonFolderPath -File -Filter "*.json" | Sort-Object Name
  if ($jsonFiles.Count -eq 0) {
    throw "No JSON files found in folder: $JsonFolderPath"
  }
} else {
  $JsonPath = Ensure-Value -Value $JsonPath -Name "JsonPath (or ZEPHYR_JSON_PATH in .env)"
  if (-not (Test-Path -Path $JsonPath)) {
    throw "JSON file not found: $JsonPath"
  }
  $jsonFiles = @(Get-Item -Path $JsonPath)
}

if ([string]::IsNullOrWhiteSpace($Endpoint)) {
  $Endpoint = Get-ValueOrDefault $envValues.ZEPHYR_ENDPOINT ""
}

$Endpoint = Ensure-Value -Value $Endpoint -Name "Endpoint (or ZEPHYR_ENDPOINT in .env)"

if ([string]::IsNullOrWhiteSpace($Token)) {
  $Token = Get-ValueOrDefault $envValues.ZEPHYR_TOKEN ""
}

$Token = Ensure-Value -Value $Token -Name "Token (or ZEPHYR_TOKEN in .env)"

if ([string]::IsNullOrWhiteSpace($AuthType)) {
  $AuthType = Get-ValueOrDefault $envValues.ZEPHYR_AUTH_TYPE "bearer"
}

$headers = @{
  "Content-Type" = "application/json"
}

if ($AuthType -eq "basic") {
  $headers["Authorization"] = "Basic $Token"
} else {
  $headers["Authorization"] = "Bearer $Token"
}

function Build-PayloadForUpload {
  param(
    [string]$FilePath
  )

  try {
    $raw = Get-Content -Path $FilePath -Raw
    $payload = $raw | ConvertFrom-Json
  } catch {
    throw "Failed to read JSON payload ($FilePath): $($_.Exception.Message)"
  }

  # Screenshot handling modes:
  #  - ZEPHYR_INLINE_IMAGE: upload to Zephyr's rich-text S3/CDN and embed a renderable <img> (needs ZEPHYR_WEB_JWT).
  #  - ZEPHYR_SCREENSHOT_IN_EXPECTED_RESULT: inline base64 (renders broken in Zephyr; kept for completeness).
  #  - otherwise: upload screenshots as step attachments (default).
  $inlineImage = Get-BoolFromEnv -Value $envValues.ZEPHYR_INLINE_IMAGE -DefaultValue $false
  $embedScreenshots = Get-BoolFromEnv -Value $envValues.ZEPHYR_SCREENSHOT_IN_EXPECTED_RESULT -DefaultValue $false

  $stepScreenshots = Extract-StepScreenshots -SourcePayload $payload
  $stepImageHtml = @{}
  $useAttachments = $false

  if ($inlineImage) {
    $stepImageHtml = Upload-InlineImages -StepScreenshots $stepScreenshots
  } elseif ($embedScreenshots) {
    foreach ($shot in $stepScreenshots) {
      if ([string]$shot.DataUrl -match '^data:image/') {
        $stepImageHtml[[int]$shot.Index] = "<br /><img src=""$([string]$shot.DataUrl)"" alt=""Step $([int]$shot.Index + 1) screenshot"" style=""max-width:600px;"" />"
      }
    }
  } else {
    $useAttachments = $true
  }

  Sanitize-PayloadForUpload -Payload $payload

  $createPayload = Build-TestCaseCreatePayload -SourcePayload $payload
  $stepItems = Build-TestStepsItems -SourcePayload $payload -StepImageHtml $stepImageHtml

  if ([string]::IsNullOrWhiteSpace($createPayload.projectKey)) {
    throw "Missing projectKey in payload and ZEPHYR_PROJECT_KEY is not set."
  }
  if ([string]::IsNullOrWhiteSpace($createPayload.name)) {
    throw "Missing test case name in payload and ZEPHYR_NAME is not set."
  }

  return [pscustomobject]@{
    CreatePayload = $createPayload
    StepItems = $stepItems
    StepScreenshots = $stepScreenshots
    UseAttachments = $useAttachments
  }
}

$success = @()
$failed = @()

Write-Host "Uploading $($jsonFiles.Count) test case file(s) to Zephyr..."
foreach ($file in $jsonFiles) {
  Write-Host "-> Uploading $($file.FullName)"
  try {
    $uploadArtifacts = Build-PayloadForUpload -FilePath $file.FullName
    $createPayloadRaw = ($uploadArtifacts.CreatePayload | ConvertTo-Json -Depth 100)
    $payloadBytes = [System.Text.Encoding]::UTF8.GetByteCount($createPayloadRaw)
    Write-Host "   Create payload size: $payloadBytes bytes"

    $response = $null
    try {
      $response = Invoke-RestMethod -Method Post -Uri $Endpoint -Headers $headers -Body $createPayloadRaw
    } catch {
      $createError = Get-HttpErrorDetail -ErrorRecord $_

      $missingCustomField = $null
      $missingFieldMatch = [regex]::Match($createError, "custom field '([^']+)' was not found")
      if ($missingFieldMatch.Success) {
        $missingCustomField = $missingFieldMatch.Groups[1].Value
      }

      if (-not [string]::IsNullOrWhiteSpace($missingCustomField)) {
        Write-Host "   Warning: Zephyr custom field '$missingCustomField' not found in this project. Retrying without it."
        if ($uploadArtifacts.CreatePayload.customFields) {
          Remove-ObjectProperty -Target $uploadArtifacts.CreatePayload.customFields -Name $missingCustomField
          $retryPayloadRaw = ($uploadArtifacts.CreatePayload | ConvertTo-Json -Depth 100)
          $response = Invoke-RestMethod -Method Post -Uri $Endpoint -Headers $headers -Body $retryPayloadRaw
        } else {
          throw
        }
      } elseif ($createError -match 'Invalid Payload') {
        Write-Host "   Retrying create with minimal payload (projectKey + name)..."
        $minimalCreatePayload = [ordered]@{
          projectKey = $uploadArtifacts.CreatePayload.projectKey
          name = $uploadArtifacts.CreatePayload.name
        }
        $minimalCreatePayloadRaw = ($minimalCreatePayload | ConvertTo-Json -Depth 20)
        $response = Invoke-RestMethod -Method Post -Uri $Endpoint -Headers $headers -Body $minimalCreatePayloadRaw
      } else {
        throw
      }
    }
    $testCaseKey = $response.key
    if ([string]::IsNullOrWhiteSpace($testCaseKey)) {
      throw "Create test case response did not include a test case key."
    }
    Write-Host "   Created test case: $testCaseKey"

    $stepItems = @($uploadArtifacts.StepItems)
    $stepScreenshots = @($uploadArtifacts.StepScreenshots)
    if ($stepItems.Count -gt 0) {
      $batchSize = 100
      $index = 0
      $firstBatch = $true
      $chosenVariant = 0
      $usedPlainScriptFallback = $false
      while ($index -lt $stepItems.Count) {
        $count = [Math]::Min($batchSize, $stepItems.Count - $index)
        $batch = @($stepItems[$index..($index + $count - 1)])
        $mode = if ($firstBatch) { "OVERWRITE" } else { "APPEND" }
        $stepEndpoint = "$Endpoint/$testCaseKey/teststeps"

        $uploaded = $false
        $lastStepError = "Unknown step upload error"

        if ($firstBatch) {
          $payloadVariants = Build-StepPayloadVariants -Batch $batch -Mode $mode
          for ($variantIndex = 0; $variantIndex -lt $payloadVariants.Count; $variantIndex++) {
            $variantPayloadRaw = ($payloadVariants[$variantIndex] | ConvertTo-Json -Depth 100)
            try {
              Invoke-RestMethod -Method Post -Uri $stepEndpoint -Headers $headers -Body $variantPayloadRaw | Out-Null
              $chosenVariant = $variantIndex
              $uploaded = $true
              if ($variantIndex -gt 0) {
                Write-Host "   Step payload fallback variant $($variantIndex + 1) used."
              }
              break
            } catch {
              $lastStepError = Get-HttpErrorDetail -ErrorRecord $_
            }
          }
        } else {
          $payloadVariants = Build-StepPayloadVariants -Batch $batch -Mode $mode
          $variantPayloadRaw = ($payloadVariants[$chosenVariant] | ConvertTo-Json -Depth 100)
          try {
            Invoke-RestMethod -Method Post -Uri $stepEndpoint -Headers $headers -Body $variantPayloadRaw | Out-Null
            $uploaded = $true
          } catch {
            $lastStepError = Get-HttpErrorDetail -ErrorRecord $_
          }
        }

        if (-not $uploaded) {
          $allowPlainScriptFallback = Get-BoolFromEnv -Value $envValues.ZEPHYR_FALLBACK_TO_PLAIN_SCRIPT -DefaultValue $true
          if ($allowPlainScriptFallback) {
            $plainText = "Auto-generated test script. Refer to exported recorder JSON for full step details."
            if (-not [string]::IsNullOrWhiteSpace($plainText)) {
              $scriptEndpoint = "$Endpoint/$testCaseKey/testscript"
              $scriptPayload = [ordered]@{
                type = "plain"
                text = $plainText
              }
              $scriptPayloadRaw = ($scriptPayload | ConvertTo-Json -Depth 20)
              try {
                Invoke-RestMethod -Method Post -Uri $scriptEndpoint -Headers $headers -Body $scriptPayloadRaw | Out-Null
                Write-Host "   Step upload rejected; plain test script fallback applied for $testCaseKey"
                $usedPlainScriptFallback = $true
                $uploaded = $true
                $index = $stepItems.Count
              } catch {
                $fallbackError = Get-HttpErrorDetail -ErrorRecord $_
                throw "Step upload failed for ${testCaseKey}: $lastStepError. Plain-script fallback also failed: $fallbackError"
              }
            }
          }
        }

        if (-not $uploaded) {
          throw "Step upload failed for ${testCaseKey}: $lastStepError"
        }

        $index += $count
        $firstBatch = $false
      }
      if (-not $usedPlainScriptFallback) {
        Write-Host "   Added $($stepItems.Count) step(s) to $testCaseKey"
        if ($uploadArtifacts.UseAttachments) {
          Upload-StepScreenshots -TestCaseKey $testCaseKey -StepScreenshots $stepScreenshots
        } else {
          Write-Host "   Screenshots embedded in expected result."
        }
      }
    }

    $success += [pscustomobject]@{
      File = $file.FullName
      Response = $response
      TestCaseKey = $testCaseKey
    }
  } catch {
    $errorDetail = Get-HttpErrorDetail -ErrorRecord $_
    $failed += [pscustomobject]@{
      File = $file.FullName
      Error = $errorDetail
    }
    Write-Host "   FAILED: $errorDetail"
  }
}

Write-Host "Upload summary: $($success.Count) succeeded, $($failed.Count) failed."

if ($success.Count -gt 0) {
  Write-Host "Successful uploads:"
  $success | ForEach-Object { Write-Host " - $($_.File) -> $($_.TestCaseKey)" }
}

if ($failed.Count -gt 0) {
  Write-Host "Failed uploads:"
  $failed | ForEach-Object { Write-Host " - $($_.File): $($_.Error)" }
  throw "One or more uploads failed."
}
