# test-case-recorder

Chrome Extension MVP that records manual browser actions and exports Zephyr-ready test case files with screenshots.

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
- `ZEPHYR_LABELS`

`.env` is already added to [.gitignore](.gitignore), so your secrets stay local.

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
