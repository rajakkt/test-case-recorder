# test-case-recorder

Chrome Extension MVP that records manual browser actions and exports Zephyr-ready test case files with screenshots.

## Versions

- Version 1 (repo root: `manifest.json`, `src/`) — the original recorder and export.
- Version 2 (`versions/v2/`) — adds a combined Record/Stop button with a live recording indicator, per-step edit (pencil) and delete (x) controls, per-step screenshot show/hide, a printable PDF report (table view), a one-click "Copy Zephyr Image Token" helper, and an updated uploader with screenshot handling modes (attachments or inline images).
- Version 3 (`versions/v3/`) — builds on Version 2 with higher-quality capture: records inside iframes/frames, generates clearer role-aware step descriptions and expected results, produces proper "Navigate to …" steps, filters out redundant SPA re-navigation noise, and waits for the page to finish rendering before taking each screenshot.
- Version 4 (`versions/v4/`) — adds one-click **upload to Zephyr directly from the extension** using your existing browser session (the Zephyr `jwt` cookie). No API token, no `.env`, and no PowerShell required. Enter a title and optional folder path; the extension auto-resolves the folder, status, priority, and required custom fields for the current project, and embeds screenshots inline in each step's Expected Result.
- Version 5 (`versions/v5/`) — everything in Version 4 plus **export the test case as a Word document (.docx)** or an **Excel document (.xlsx)** from the Export menu, both with screenshots embedded.

Load whichever version you want as an unpacked extension (see below).

## What it does

- Starts/stops recording from the extension popup.
- Captures user interactions:
	- Click events
	- Input/change events (excluding sensitive fields)
	- Enter key submits
	- Navigation events when pages finish loading
- Captures up to 20 low-quality screenshots and includes them in exported step metadata.
- Exports Zephyr-style JSON with step descriptions, expected results, test data, and screenshot metadata.
- Exports an HTML viewer report for easy review/sharing of captured steps.

The extension focuses only on recording and export. Zephyr upload is handled by a separate tool.

## Project structure

- `manifest.json`: Extension configuration (Manifest V3)
- `src/background.js`: Session state, step aggregation, JSON export
- `src/content/recorder.js`: In-page event capture
- `src/shared/selectors.js`: CSS selector generation helper
- `src/popup/popup.html`: Popup markup
- `src/popup/popup.css`: Popup styles
- `src/popup/popup.js`: Popup behavior and command wiring
- `tools/push-zephyr.ps1`: PowerShell uploader for Zephyr
- `versions/v2/`: Version 2 of the extension and uploader (see below)
- `versions/v3/`: Version 3 of the extension and uploader (see below)
- `versions/v4/`: Version 4 of the extension with built-in Zephyr upload (see below)
- `versions/v5/`: Version 5 of the extension with Word/Excel export (see below)

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the project folder.

## Usage

1. Open popup and enter test case title.
2. Click Start.
3. Perform manual test flow in browser tabs.
4. Click Stop.
5. Choose export type from the dropdown: `JSON` or `HTML Viewer`.
6. Export runs immediately after selection.

### Separate Zephyr upload tool

Zephyr upload is intentionally separated from the extension UI.

Use [tools/push-zephyr.ps1](tools/push-zephyr.ps1) to push an exported JSON file:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\push-zephyr.ps1 \
	-JsonPath "C:\path\to\zephyr-test-case.json" \
	-Endpoint "https://api.zephyrscale.smartbear.com/v2/testcases" \
	-AuthType bearer \
	-Token "YOUR_TOKEN"
```

Batch upload (folder mode):

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\push-zephyr.ps1 \
	-JsonFolderPath "C:\path\to\exported-json-folder"
```

The uploader is now zero-prompt. It only reads values from the command line, from `.env`, or from the JSON file itself.

You can also create a local `.env` file from [.env.example](.env.example) and run the tool fully unattended:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\push-zephyr.ps1 -EnvPath ".\.env"
```

Create the `.env` file from the example like this:

1. Copy [.env.example](.env.example) to `.env` in the project root.
2. Fill in `ZEPHYR_JSON_PATH`, `ZEPHYR_ENDPOINT`, `ZEPHYR_AUTH_TYPE`, and `ZEPHYR_TOKEN`.
3. Optional: set the metadata defaults if you want the uploader to prefill values.

Example PowerShell command:

```powershell
Copy-Item .\.env.example .\.env
```

Required `.env` variables:

- `ZEPHYR_JSON_PATH`: exported JSON file to upload
- `ZEPHYR_ENDPOINT`: Zephyr test case API endpoint
- `ZEPHYR_AUTH_TYPE`: `bearer` or `basic`
- `ZEPHYR_TOKEN`: auth token

Optional batch variable:

- `ZEPHYR_JSON_FOLDER`: folder containing multiple JSON files to upload one by one.

If `-JsonPath` is omitted, the tool reads `ZEPHYR_JSON_PATH` from `.env`.

Optional metadata defaults:

- `ZEPHYR_PROJECT_KEY`
- `ZEPHYR_NAME`
- `ZEPHYR_OBJECTIVE`
- `ZEPHYR_PRECONDITION`
- `ZEPHYR_PRIORITY`
- `ZEPHYR_STATUS`
- `ZEPHYR_FOLDER`
- `ZEPHYR_SEGMENT`
- `ZEPHYR_SEGMENT_FIELD_NAME`: exact Zephyr custom field name for segment (keep quotes if it has a trailing space, e.g. `"Segments "`).
- `ZEPHYR_LABELS`

Screenshot handling (Version 2 uploader, `versions/v2/tools/push-zephyr.ps1`):

- Default: screenshots are uploaded as step attachments.
- `ZEPHYR_UPLOAD_STEP_SCREENSHOTS` (default `true`): toggle attachment upload.
- `ZEPHYR_STEP_SCREENSHOT_UPLOAD_RETRIES` (default `3`) and `ZEPHYR_STEP_SCREENSHOT_RETRY_DELAY_MS` (default `1200`): retry transient upload failures (e.g. CloudFront 503).

Inline images in Expected Result (Version 2 uploader, optional):

- `ZEPHYR_INLINE_IMAGE` (default `false`): when `true`, screenshots are uploaded to Zephyr's rich-text image store and embedded inline in the step Expected Result so they render in Zephyr.
- `ZEPHYR_WEB_JWT`: a fresh Zephyr web session token (use the "Copy Zephyr Image Token" button). Short-lived (~15 min); a `JWT `/`Bearer ` prefix is auto-stripped.
- `ZEPHYR_TM4J_BACKEND` (default `https://app.tm4j.smartbear.com/backend`): Zephyr backend base used to request the image upload signature.
- Note: inline base64 images are not supported by Zephyr (they render broken), so this signed-upload flow is used instead. It relies on Zephyr's internal rich-text upload path and may change; if the token expires you'll get a clear error—grab a fresh token and rerun.

`.env` is already added to [.gitignore](.gitignore), so your secrets stay local. Keep `ZEPHYR_WEB_JWT` local — it is a session token.

### DevTools mode

You can also run the recorder inside browser DevTools:

1. Open any page and launch Chrome DevTools (F12).
2. Click the `Test Recorder` tab in DevTools.
3. Use the same Start/Stop/Export flow from inside the panel.

### Side Panel mode

You can open the recorder as a browser side panel (right side):

1. Reload the unpacked extension.
2. Click the extension action icon.
3. The `Test Case Recorder` side panel opens and stays visible while you browse.

## Version 2 features (`versions/v2`)

Version 2 is a self-contained copy under `versions/v2`. Load `versions/v2` as the unpacked extension to use it.

Recorder UI:

- Single Record button that toggles Start/Stop, with a live "Recording..." indicator.
- Per-step editing: click the pencil icon (top-right of a step) to edit Description, Test Data, and Expected Result; changes auto-save.
- Per-step delete: click the x icon to remove a step.
- Each step's screenshot is hidden by default with a "Show screenshot" toggle.

Export:

- Export JSON and Export HTML Viewer (steps rendered as a table).
- Export PDF (Open Report): opens the report in a new tab; use the browser's Save as PDF.

Zephyr image token helper:

- "Copy Zephyr Image Token" copies the short-lived Zephyr rich-text token (from the `app.tm4j.smartbear.com` `jwt` cookie) to the clipboard, to paste into `ZEPHYR_WEB_JWT` in `.env`.
- Requires being logged into Zephyr in a browser tab. The token is short-lived (~15 min).

## Version 3 features (`versions/v3`)

Version 3 is a self-contained copy under `versions/v3`. Load `versions/v3` as the unpacked extension to use it. It keeps all Version 2 features and adds the following capture-quality improvements.

Capture quality:

- Frame-aware recording: actions performed inside iframes and nested frames are captured (content script runs in all frames).
- Role-aware descriptions and expected results: steps are phrased based on the element's role (link, button, checkbox, radio, dropdown, text field), producing clearer text such as `Click "Search"`, `Enter "…" in the "Search" field`, or `Select "…" from the "Status" dropdown`.
- Better element labels: labels are resolved from `aria-label`, `aria-labelledby`, associated `<label>`, placeholder, title, alt, name, and value.
- Checkbox/radio handling: checked/unchecked state is captured on click; redundant change events are skipped.
- Search comboboxes (`role="combobox"`/`"searchbox"`) are treated as text fields instead of dropdowns, so they no longer produce empty `Select "" …` steps.

Navigation and noise reduction:

- Navigations generate proper `Navigate to "<page title>"` steps with a matching page-loaded expected result.
- Redundant SPA re-navigations are suppressed: navigations that only change the query/hash of the same page, and navigations that are side-effects of a click/input (fired within a short window), are filtered out.
- Empty-value input and dropdown steps are skipped to reduce noise.
- Step appends are serialized so rapid concurrent events cannot create duplicate steps.

Screenshot timing:

- Before each screenshot, the recorder waits for the tab to reach `complete` and for the page DOM to go quiet (no mutations for ~700ms, capped at ~6s) before capturing, so screenshots reflect fully rendered content instead of a loading state.

## Version 4 features (`versions/v4`)

Version 4 is a self-contained copy under `versions/v4`. Load `versions/v4` as the unpacked extension to use it. It keeps all Version 3 features and adds **built-in upload to Zephyr Scale Cloud** — removing the separate PowerShell uploader, `.env`, and API tokens for the common case.

One-click upload:

- A green **Upload to Zephyr** button (cloud icon) in the recorder toolbar creates the test case and its steps in Zephyr in a single action.
- Authentication uses your **existing browser session** — the extension reads the Zephyr `jwt` cookie from `app.tm4j.smartbear.com` and derives the project, project key, and owner from it. You never paste a token.
- The test case is created in whatever **project your Zephyr session is currently on**, so it can't land in a random project.
- Screenshots are uploaded to Zephyr's rich-text store and embedded inline in each step's Expected Result (best-effort: a failed image never blocks the upload).
- On success the status shows the new test case key (e.g. `Uploaded to Zephyr as TEGE-T123`).

Automatic per-project setup (no IDs to look up):

- **Folder path** — enter a path like `/CSD/zephyr-uploader` in the popup and the extension resolves it to the correct folder in the current project. Leave it blank to create in the project root. If the path doesn't exist, the upload aborts instead of placing the test case in the wrong folder.
- **Status and Priority** — the project's default status and priority are resolved and applied automatically.
- **Required custom fields (e.g. Segment)** — the project's custom fields are read automatically. Type the value in the **Segment** box and it is sent to the project's Segment field, whether it is free text or a dropdown (dropdown values are matched to an option by name). If a required custom field is left empty, the upload aborts with a message naming the field.

Requirements:

- Be signed in to Zephyr in a browser tab (keep it open/recently refreshed — the session token is short-lived, ~15 min).
- Enter a **test case title** before uploading.

How it works (internal API, no token):

- Reads the session `jwt` cookie via the `cookies` permission and calls Zephyr's internal web API the same way the Zephyr web app does:
  - Create: `POST /backend/rest/tests/2.0/testcase`
  - Folders: `GET /backend/rest/tests/2.0/project/{projectId}/foldertree/testcase`
  - Custom fields: `GET /backend/rest/tests/2.0/project/{projectId}/customfields/testcase`
  - Status / Priority: `GET /backend/rest/tests/2.0/project/{projectId}/testcasestatus` and `/testcasepriority`
  - Inline images: `GET /backend/rest/tests/2.0/uploaddetails/richtextattachment` then a signed upload to the rich-text store.
- These are internal endpoints and may change if SmartBear updates their app; if uploads start failing, re-capture the relevant request and update the mapping.
- The PowerShell uploader is still included under `versions/v4/tools` for advanced/batch scenarios, but is no longer required.

## Version 5 features (`versions/v5`)

Version 5 is a self-contained copy under `versions/v5`. Load `versions/v5` as the unpacked extension to use it. It keeps all Version 4 features and adds two document export options to the **Export** menu:

- **Export Word (.docx)** — a real Word document (Office Open XML) with the steps table (#, Description, Test Data, Expected Result) and each step's **screenshot embedded as a native picture**. Opens directly in Microsoft Word (landscape). Table rows don't split across pages and the header repeats on each page. No "format and extension" warning.
- **Export Excel (.xlsx)** — a real Excel workbook (Office Open XML) with the step data columns (#, Description, Test Data, Expected Result) and each step's **screenshot embedded** as a floating picture anchored to the Screenshot column of its row. Opens directly in Microsoft Excel with no "format and extension" warning.

Both downloads use the same **Export** button/menu as JSON/HTML/PDF and save via the browser's download prompt.

## Export format

The exported JSON is generated in a Zephyr Scale style shape:

```json
{
	"projectKey": "DEMO",
	"name": "Checkout flow works",
	"objective": "Generated from Test Case Recorder browser session.",
	"testScript": {
		"type": "STEP_BY_STEP",
		"steps": [
			{
				"index": 1,
				"description": "Click on \"Sign In\" (#login-btn)",
				"testData": "",
				"expectedResult": "Action succeeds and the expected UI state is shown"
			}
		]
	}
}
```

## Notes for Zephyr integration

Zephyr products differ by API. This MVP exports a neutral JSON shape aligned with step-based test cases. To integrate directly:

- Zephyr Scale Cloud: map fields to the `POST /testcases` payload.
- Zephyr Squad / Jira plugin flows: transform this JSON into the endpoint-specific schema.

## All Todos Completed

- Screenshot capture per step implemented.
- Separate Zephyr uploader tool implemented via PowerShell script.
- Recorder scope finalized to page actions only (no API call capture).
- Recorder script auto-injection on start/navigation implemented for reliable click/action capture.
- Live step updates in popup/side panel implemented while recording progresses.
- Export dropdown implemented with JSON and HTML viewer options.
