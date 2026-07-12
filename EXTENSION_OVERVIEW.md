# Test Case Recorder Extension Overview

## Purpose

Test Case Recorder is a Chrome extension that captures manual browser test actions and converts them into exportable test case artifacts.

The extension is focused on recording and export.
Upload to Zephyr is handled by a separate PowerShell script.

## Core Capabilities

- Start and stop a recording session from popup, side panel, or DevTools panel
- Capture page-level user actions during manual testing
- Capture screenshots per step (up to configured limit in extension state)
- View captured steps live while recording
- Edit captured step content before export
- Delete captured steps before export
- Export as JSON (Zephyr-style test case payload)
- Export as HTML Viewer report
- Keep recording state in extension storage so sessions survive service worker restarts

## Actions Captured

The recorder captures these interaction types:

- Click actions
- Input/change actions
- Enter key submit actions
- Navigation completion actions

Sensitive input types are skipped:

- password
- email
- tel

## Step Data Collected

Each step can include:

- Timestamp
- Current URL
- Path (pathname + query + hash)
- Action type
- Selector
- Element label
- Input value (when relevant)
- Expected result
- Screenshot data URL (if captured)

## Sanitization and Text Safety

The extension sanitizes step text to avoid raw HTML and oversized embedded image strings in exported step fields.

Sanitization behavior includes:

- HTML entity decode for common entities
- HTML tag removal for exported step text
- Embedded data-image text removal from step text fields
- Whitespace normalization

This is applied both when storing/editing steps and during export formatting.

## Editing and Deleting Captured Steps

The steps panel supports per-step editing and deletion.

For each step, you can edit:

- Description
- Test Data
- Expected Result

You can also:

- Save a step after edits
- Delete a step entirely

Saved edits are persisted and used by all exports.

## Export Formats

### JSON Export

The JSON export includes:

- Test case metadata (project key, title, objective, precondition, priority, status, folder, labels)
- Optional segment custom field
- Step-by-step script with:
  - description
  - testData
  - expectedResult
  - step custom fields containing source URL, path, timestamp, screenshot data

### HTML Viewer Export

The HTML viewer export includes:

- Test case summary details
- Rendered step list
- Step screenshots for visual review

## UI Surfaces

The same recorder UI is available in three places:

- Extension popup
- Browser side panel
- DevTools panel

## Session and State Behavior

State is stored in Chrome local extension storage.

Stored session data includes:

- Recording status
- Session id
- Start time
- Title
- Segment
- Captured steps and edits

The background service worker ensures state is loaded before handling commands/events to avoid empty exports after worker restart.

## Limits and Defaults

- Default expected result text is applied when not provided
- Step screenshots are captured up to an internal max count
- Duplicate consecutive steps are filtered using action/selector/path/value comparison

## Zephyr Upload Integration (Separate Tool)

The extension does not push directly to Zephyr.
Use the uploader script under tools:

- tools/push-zephyr.ps1

Uploader responsibilities include:

- Reading exported JSON files
- Applying metadata defaults from .env
- Resolving folder mappings
- Creating test cases
- Uploading steps
- Uploading step screenshot attachments
- Retrying transient attachment failures (for example CloudFront 503)

## Typical Workflow

1. Open popup/side panel/devtools panel
2. Enter title and optional segment
3. Start recording
4. Perform manual test flow in browser tabs
5. Stop recording
6. Edit/delete steps as needed
7. Export JSON or HTML Viewer
8. Run tools/push-zephyr.ps1 to upload JSON to Zephyr

## Project Files Involved

- manifest.json
- src/content/recorder.js
- src/background.js
- src/popup/popup.html
- src/popup/popup.js
- src/popup/popup.css
- src/sidepanel/panel.html
- src/devtools/panel.html
- tools/push-zephyr.ps1
- .env and .env.example
