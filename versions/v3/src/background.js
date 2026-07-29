const STORAGE_KEY = "testCaseRecorderState";
const DEFAULT_EXPECTED_RESULT = "Action succeeds and the expected UI state is shown";
const MAX_SCREENSHOTS = 20;

const state = {
  isRecording: false,
  isPaused: false,
  sessionId: null,
  startedAt: null,
  title: "",
  steps: [],
  config: {
    projectKey: "DEMO",
    objective: "The recorded flow should complete successfully",
    precondition: "User has access and required test data.",
    folder: "Recorded/Chrome Extension",
    labels: "Recorded,ChromeExtension",
    priority: "Normal",
    status: "Draft",
    segment: ""
  }
};

let stateLoaded = false;

function sessionId() {
  return `session-${Date.now()}`;
}

async function saveState() {
  await chrome.storage.local.set({
    [STORAGE_KEY]: state
  });
}

async function notifyStateUpdated() {
  try {
    await chrome.runtime.sendMessage({
      type: "STATE_UPDATED",
      state
    });
  } catch (error) {
    // No UI listeners open.
  }
}

async function loadState() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const persisted = data[STORAGE_KEY];
  stateLoaded = true;
  if (!persisted) {
    return;
  }
  Object.assign(state, persisted);
}

async function ensureStateLoaded() {
  if (stateLoaded) {
    return;
  }
  await loadState();
}

function normalizeAction(step) {
  if (step.action === "click") {
    return "Click";
  }
  if (step.action === "input") {
    return "Type";
  }
  if (step.action === "submit") {
    return "Press Enter";
  }
  if (step.action === "navigate") {
    return "Navigate";
  }
  return step.action || "Action";
}

function toLabelArray(labels) {
  return String(labels || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toPlainStepText(value, fallback = "") {
  const raw = String(value == null ? "" : value);
  if (!raw) {
    return fallback;
  }

  const decoded = raw
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  const noTags = decoded
    .replace(/<[^>]+>/g, " ")
    .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return noTags || fallback;
}

function friendlyLabel(step) {
  const label = (step && step.elementLabel ? String(step.elementLabel) : "").trim();
  if (label) {
    return label;
  }
  if (step && step.role && step.role !== "element") {
    return step.role;
  }
  return "element";
}

function stepDescriptionCore(step) {
  const label = friendlyLabel(step);
  const value = step && step.value != null ? String(step.value) : "";
  const role = (step && step.role) || "element";

  switch (step.action) {
    case "navigate":
      return `Navigate to \"${label}\"`;
    case "input":
      if (role === "select") {
        return `Select \"${value}\" from the \"${label}\" dropdown`;
      }
      return `Enter \"${value}\" in the \"${label}\" field`;
    case "submit":
      return `Press Enter in the \"${label}\" field`;
    case "click":
      if (role === "button") {
        return `Click the \"${label}\" button`;
      }
      if (role === "link") {
        return `Click the \"${label}\" link`;
      }
      if (role === "checkbox") {
        return `${step.checked ? "Check" : "Uncheck"} the \"${label}\" checkbox`;
      }
      if (role === "radio") {
        return `Select the \"${label}\" option`;
      }
      return `Click \"${label}\"`;
    default:
      return `${normalizeAction(step)} on \"${label}\"`;
  }
}

function generateExpectedResult(step) {
  const label = friendlyLabel(step);
  const value = step && step.value != null ? String(step.value) : "";
  const role = (step && step.role) || "element";

  switch (step.action) {
    case "navigate":
      return `The \"${label}\" page is displayed successfully.`;
    case "input":
      if (role === "select") {
        return `\"${value}\" is selected in the \"${label}\" dropdown.`;
      }
      return `\"${value}\" is entered in the \"${label}\" field.`;
    case "submit":
      return "The form is submitted and the resulting page is displayed.";
    case "click":
      if (role === "button") {
        return `The \"${label}\" action is performed and the resulting screen is displayed.`;
      }
      if (role === "link") {
        return `The \"${label}\" link opens the expected page.`;
      }
      if (role === "checkbox") {
        return `The \"${label}\" checkbox is ${step.checked ? "checked" : "unchecked"}.`;
      }
      if (role === "radio") {
        return `The \"${label}\" option is selected.`;
      }
      return `The expected result after clicking \"${label}\" is displayed.`;
    default:
      return DEFAULT_EXPECTED_RESULT;
  }
}

function stepDescription(step) {
  const override = toPlainStepText(step && step.descriptionOverride ? step.descriptionOverride : "", "");
  if (override) {
    return override;
  }

  return toPlainStepText(stepDescriptionCore(step), "Action");
}

function stepDescriptionText(step) {
  return stepDescription(step);
}

function stepDescriptionViewerText(step) {
  return stepDescription(step);
}

function stepTestData(step) {
  const override = toPlainStepText(step && step.testDataOverride ? step.testDataOverride : "", "");
  if (override) {
    return override;
  }

  if (step.action === "navigate") {
    return toPlainStepText(step.url || "", "");
  }
  return toPlainStepText(step.value || "", "");
}

function stepExpectedResult(step) {
  return toPlainStepText(step.expectedResult || DEFAULT_EXPECTED_RESULT, DEFAULT_EXPECTED_RESULT);
}

function sanitizeRecordedStep(step) {
  const source = step || {};
  return {
    ...source,
    url: toPlainStepText(source.url || "", ""),
    path: toPlainStepText(source.path || "", ""),
    selector: toPlainStepText(source.selector || "", ""),
    elementLabel: toPlainStepText(source.elementLabel || "", ""),
    value: toPlainStepText(source.value || "", ""),
    expectedResult: toPlainStepText(source.expectedResult ? source.expectedResult : generateExpectedResult(source), DEFAULT_EXPECTED_RESULT),
    descriptionOverride: toPlainStepText(source.descriptionOverride || "", ""),
    testDataOverride: toPlainStepText(source.testDataOverride || "", "")
  };
}

function toZephyrJson() {
  const steps = state.steps.map((step, index) => {
    return {
      index,
      description: stepDescription(step),
      testData: stepTestData(step),
      expectedResult: stepExpectedResult(step),
      customFields: {
        sourceUrl: step.url || "",
        path: step.path || "",
        timestamp: step.ts || "",
        screenshotDataUrl: step.screenshotDataUrl || ""
      }
    };
  });

  const labels = toLabelArray(state.config.labels);
  const customFields = {};
  if (state.config.segment) {
    customFields.Segments = [state.config.segment];
  }

  return {
    projectKey: state.config.projectKey || "DEMO",
    name: state.title || `Recorded Case ${new Date().toISOString().slice(0, 10)}`,
    objective: state.config.objective || "Generated from Test Case Recorder browser session.",
    precondition: state.config.precondition || "User has access and required test data.",
    priority: state.config.priority || "Normal",
    status: state.config.status || "Draft",
    folder: state.config.folder || "Recorded/Chrome Extension",
    labels,
    customFields,
    testScript: {
      type: "steps",
      steps
    },
    meta: {
      sessionId: state.sessionId,
      startedAt: state.startedAt,
      exportedAt: new Date().toISOString(),
      extension: "test-case-recorder"
    }
  };
}

function safeCdata(value) {
  const text = String(value == null ? "" : value).replace(/\]\]>/g, "]]]]><![CDATA[>");
  return `<![CDATA[${text}]]>`;
}

function buildXmlSteps() {
  return state.steps
    .map((step, index) => {
      return [
        `          <step index="${index}">`,
        "            <customFields/>",
        `            <description>${safeCdata(stepDescription(step))}</description>`,
        `            <expectedResult>${safeCdata(stepExpectedResult(step))}</expectedResult>`,
        `            <testData>${safeCdata(stepTestData(step))}</testData>`,
        "          </step>"
      ].join("\n");
    })
    .join("\n");
}

function toZephyrXml() {
  const now = new Date().toISOString().replace("T", " ").replace("Z", " UTC");
  const xmlProjectKey = String(state.config.projectKey || "DEMO").replace(/[<>&\"]/g, "");
  const xmlFolder = String(state.config.folder || "Recorded/Chrome Extension").replace(/[\"]/g, "");
  const labels = toLabelArray(state.config.labels)
    .map((label) => `        <label>${safeCdata(label)}</label>`)
    .join("\n");
  const segmentXml = state.config.segment
    ? [
        "        <customField name=\"Segments \" type=\"MULTI_CHOICE_SELECT_LIST\">",
        `          <value>${safeCdata(state.config.segment)}</value>`,
        "        </customField>"
      ].join("\n")
    : "";

  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
    "<project>",
    "  <projectId>0</projectId>",
    `  <projectKey>${xmlProjectKey}</projectKey>`,
    `  <exportDate>${now}</exportDate>`,
    "  <folders>",
    `    <folder fullPath=\"${xmlFolder}\" index=\"0\"/>`,
    "  </folders>",
    "  <testCases>",
    "    <testCase id=\"0\" key=\"REC-LOCAL\">",
    "      <attachments/>",
    "      <confluencePageLinks/>",
    "      <createdBy>Test Case Recorder</createdBy>",
    `      <createdOn>${now}</createdOn>`,
    "      <customFields>",
    segmentXml || "        <customField name=\"Segments \" type=\"MULTI_CHOICE_SELECT_LIST\"><value><![CDATA[]]></value></customField>",
    "      </customFields>",
    `      <folder>${safeCdata(state.config.folder || "Recorded/Chrome Extension")}</folder>`,
    "      <issues/>",
    "      <labels>",
    labels || "        <label><![CDATA[Recorded]]></label>",
    "      </labels>",
    `      <name>${safeCdata(state.title || `Recorded Case ${new Date().toISOString().slice(0, 10)}`)}</name>`,
    `      <objective>${safeCdata(state.config.objective || "Generated from Test Case Recorder browser session.")}</objective>`,
    "      <owner>local-recorder</owner>",
    `      <priority>${safeCdata(state.config.priority || "Normal")}</priority>`,
    `      <status>${safeCdata(state.config.status || "Draft")}</status>`,
    "      <parameters/>",
    "      <testDataWrapper/>",
    "      <testScript type=\"steps\">",
    "        <steps>",
    buildXmlSteps(),
    "        </steps>",
    "      </testScript>",
    "    </testCase>",
    "  </testCases>",
    "</project>"
  ].join("\n");
}

async function captureStepScreenshot(tabId, windowId) {
  if (!Number.isInteger(tabId) || !Number.isInteger(windowId)) {
    return "";
  }
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
      format: "jpeg",
      quality: 45
    });
    return typeof dataUrl === "string" ? dataUrl : "";
  } catch (error) {
    return "";
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTabRender(tabId, settleMs) {
  // Wait until the tab reports "complete", then allow the page to paint.
  const deadline = Date.now() + 4000;
  try {
    while (Date.now() < deadline) {
      const tab = await chrome.tabs.get(tabId);
      if (!tab || tab.status === "complete") {
        break;
      }
      await delay(150);
    }
  } catch (error) {
    // Tab may have been closed; fall through to the settle delay.
  }

  // Ask the page to signal when the DOM has stopped mutating, so the
  // screenshot reflects fully rendered content (important for SPAs that
  // load data asynchronously after the tab reports "complete").
  try {
    await Promise.race([
      chrome.tabs.sendMessage(
        tabId,
        { type: "RECORDER_WAIT_IDLE", quietMs: 700, maxWaitMs: 6000 },
        { frameId: 0 }
      ),
      delay(6500)
    ]);
  } catch (error) {
    // Content script not available; fall back to the fixed settle delay.
  }

  await delay(settleMs);
}

async function broadcast(message) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url || tab.url.startsWith("chrome://")) {
      continue;
    }
    try {
      await chrome.tabs.sendMessage(tab.id, message);
    } catch (error) {
      // Ignore tabs where content script is unavailable.
    }
  }
}

function canInjectToUrl(url) {
  if (!url) {
    return false;
  }
  return url.startsWith("http://") || url.startsWith("https://");
}

async function ensureRecorderInjected(tabId) {
  if (!Number.isInteger(tabId)) {
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["src/shared/selectors.js", "src/content/recorder.js"]
    });
  } catch (error) {
    // Ignore pages where injection is not allowed.
  }
}

async function injectRecorderInOpenTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !canInjectToUrl(tab.url)) {
      continue;
    }
    await ensureRecorderInjected(tab.id);
  }
}

async function syncRecordingToTab(tabId) {
  if (!state.isRecording || state.isPaused || !Number.isInteger(tabId)) {
    return;
  }
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "RECORDER_START",
      sessionId: state.sessionId
    });
  } catch (error) {
    // Ignore tabs where content script is unavailable.
  }
}

async function startRecording(title, segment) {
  await ensureStateLoaded();
  state.isRecording = true;
  state.isPaused = false;
  state.sessionId = sessionId();
  state.startedAt = new Date().toISOString();
  state.steps = [];
  state.title = title || "";
  if (typeof segment === "string") {
    state.config.segment = segment.trim();
  }
  await saveState();
  await notifyStateUpdated();
  await broadcast({
    type: "RECORDER_START",
    sessionId: state.sessionId
  });
  await injectRecorderInOpenTabs();
}

async function stopRecording() {
  await ensureStateLoaded();
  state.isRecording = false;
  state.isPaused = false;
  await saveState();
  await notifyStateUpdated();
  await broadcast({
    type: "RECORDER_STOP"
  });
}

async function pauseRecording() {
  await ensureStateLoaded();
  if (!state.isRecording) {
    return;
  }
  state.isPaused = true;
  await saveState();
  await notifyStateUpdated();
  // Tell content scripts to stop capturing while paused; the session and
  // already-captured steps are preserved.
  await broadcast({
    type: "RECORDER_STOP"
  });
}

async function resumeRecording() {
  await ensureStateLoaded();
  if (!state.isRecording) {
    return;
  }
  state.isPaused = false;
  await saveState();
  await notifyStateUpdated();
  await broadcast({
    type: "RECORDER_START",
    sessionId: state.sessionId
  });
  await injectRecorderInOpenTabs();
}

function normalizeNavUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url || "";
  }
}

function isNoiseNavigation(navStep, lastStep) {
  if (!lastStep) {
    return false;
  }

  // Suppress navigations that are side-effects of a user action (click/input)
  // that already produced its own step within a short window.
  if (lastStep.action === "click" || lastStep.action === "input") {
    const navTime = Date.parse(navStep.ts);
    const lastTime = Date.parse(lastStep.ts);
    if (Number.isFinite(navTime) && Number.isFinite(lastTime) && navTime - lastTime < 2500) {
      return true;
    }
  }

  // Suppress repeated navigations to the same page (only query/hash changed).
  const lastNav = [...state.steps].reverse().find((item) => item.action === "navigate");
  if (lastNav && normalizeNavUrl(lastNav.url) === normalizeNavUrl(navStep.url)) {
    return true;
  }

  return false;
}

let appendStepQueue = Promise.resolve();

function appendStep(step) {
  // Serialize appends so that dedup checks and pushes are atomic. Screenshot
  // capture is async (seconds), so without this two rapid events could both
  // pass the dedup check before either pushes, producing duplicate steps.
  appendStepQueue = appendStepQueue.then(() => appendStepInternal(step)).catch(() => {});
  return appendStepQueue;
}

async function appendStepInternal(step) {
  await ensureStateLoaded();
  if (!state.isRecording || state.isPaused) {
    return;
  }
  const safeStep = sanitizeRecordedStep(step);
  const lastStep = state.steps[state.steps.length - 1];
  const sameAsLast =
    lastStep &&
    lastStep.action === safeStep.action &&
    lastStep.selector === safeStep.selector &&
    lastStep.path === safeStep.path &&
    lastStep.value === safeStep.value;

  if (sameAsLast) {
    return;
  }

  if (safeStep.action === "navigate" && isNoiseNavigation(safeStep, lastStep)) {
    return;
  }

  const screenshotCount = state.steps.filter((item) => Boolean(item.screenshotDataUrl)).length;
  if (!safeStep.screenshotDataUrl && screenshotCount < MAX_SCREENSHOTS && Number.isInteger(safeStep.tabId) && Number.isInteger(safeStep.windowId) && safeStep.action !== "api") {
    const settleMs = safeStep.action === "navigate" ? 1200 : 700;
    await waitForTabRender(safeStep.tabId, settleMs);
    safeStep.screenshotDataUrl = await captureStepScreenshot(safeStep.tabId, safeStep.windowId);
  }

  state.steps.push(safeStep);
  await saveState();
  await notifyStateUpdated();
}

async function updateExpectedResult(stepIndex, expectedResult) {
  await ensureStateLoaded();
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= state.steps.length) {
    return;
  }
  state.steps[stepIndex].expectedResult = toPlainStepText(expectedResult || DEFAULT_EXPECTED_RESULT, DEFAULT_EXPECTED_RESULT);
  await saveState();
  await notifyStateUpdated();
}

async function updateStep(stepIndex, patch) {
  await ensureStateLoaded();
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= state.steps.length) {
    return;
  }

  const step = state.steps[stepIndex];
  if (!patch) {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "description")) {
    step.descriptionOverride = toPlainStepText(patch.description, "");
  }

  if (Object.prototype.hasOwnProperty.call(patch, "testData")) {
    step.testDataOverride = toPlainStepText(patch.testData, "");
  }

  if (Object.prototype.hasOwnProperty.call(patch, "expectedResult")) {
    step.expectedResult = toPlainStepText(patch.expectedResult || DEFAULT_EXPECTED_RESULT, DEFAULT_EXPECTED_RESULT);
  }

  await saveState();
  await notifyStateUpdated();
}

async function deleteStep(stepIndex) {
  await ensureStateLoaded();
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= state.steps.length) {
    return;
  }

  state.steps.splice(stepIndex, 1);
  await saveState();
  await notifyStateUpdated();
}

async function setSegment(segment) {
  await ensureStateLoaded();
  state.config.segment = typeof segment === "string" ? segment.trim() : "";
  await saveState();
  await notifyStateUpdated();
}

function buildJsonExport() {
  const payload = toZephyrJson();
  const filenameSafeDate = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    fileName: `zephyr-test-case-${filenameSafeDate}.json`,
    mimeType: "application/json",
    content: JSON.stringify(payload, null, 2)
  };
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderStepRow(step, index) {
  const description = escapeHtml(stepDescriptionViewerText(step));
  const expected = escapeHtml(step.expectedResult || DEFAULT_EXPECTED_RESULT);
  const testData = escapeHtml(stepTestData(step));
  const image = step.screenshotDataUrl
    ? `<img class=\"step-image\" src=\"${step.screenshotDataUrl}\" alt=\"Step ${index + 1} screenshot\" />`
    : "&mdash;";

  return [
    "<tr>",
    `  <td class=\"col-index\">${index + 1}</td>`,
    `  <td>${description}</td>`,
    `  <td>${testData || "N/A"}</td>`,
    `  <td>${expected}</td>`,
    `  <td class=\"col-shot\">${image}</td>`,
    "</tr>"
  ].join("\n");
}

function toHtmlViewer() {
  const caseName = escapeHtml(state.title || `Recorded Case ${new Date().toISOString().slice(0, 10)}`);
  const objective = escapeHtml(state.config.objective || "Generated from Test Case Recorder browser session.");
  const precondition = escapeHtml(state.config.precondition || "User has access and required test data.");
  const rowsHtml = state.steps.map((step, index) => renderStepRow(step, index)).join("\n");
  const stepsTable = state.steps.length
    ? [
        "    <table class=\"steps-table\">",
        "      <thead>",
        "        <tr><th class=\"col-index\">#</th><th>Description</th><th>Test Data</th><th>Expected Result</th><th class=\"col-shot\">Screenshot</th></tr>",
        "      </thead>",
        "      <tbody>",
        rowsHtml,
        "      </tbody>",
        "    </table>"
      ].join("\n")
    : "<p>No steps recorded.</p>";

  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "  <meta charset=\"UTF-8\" />",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
    `  <title>${caseName}</title>`,
    "  <style>",
    "    body { font-family: Segoe UI, Arial, sans-serif; margin: 24px; background: #f6f7f9; color: #1f2430; }",
    "    .card { background: #fff; border: 1px solid #d9deea; border-radius: 10px; padding: 16px; margin-bottom: 12px; }",
    "    h1 { margin: 0 0 8px; }",
    "    h2 { margin: 0 0 12px; font-size: 16px; }",
    "    h3 { margin: 0 0 8px; font-size: 14px; }",
    "    p { margin: 6px 0; font-size: 13px; line-height: 1.4; }",
    "    .meta { display: grid; gap: 6px; }",
    "    .step { background: #fff; border: 1px solid #d9deea; border-radius: 10px; padding: 12px; margin-bottom: 10px; }",
    "    table.steps-table { width: 100%; border-collapse: collapse; font-size: 13px; }",
    "    .steps-table th, .steps-table td { border: 1px solid #d9deea; padding: 8px; text-align: left; vertical-align: top; }",
    "    .steps-table th { background: #eef1f6; }",
    "    .col-index { width: 36px; text-align: center; }",
    "    .col-shot { width: 240px; }",
    "    .step-image { max-width: 220px; width: 100%; border: 1px solid #d9deea; border-radius: 6px; }",
    "  </style>",
    "</head>",
    "<body>",
    "  <section class=\"card\">",
    `    <h1>${caseName}</h1>`,
    "    <div class=\"meta\">",
    `      <p><strong>Project Key:</strong> ${escapeHtml(state.config.projectKey || "DEMO")}</p>`,
    `      <p><strong>Objective:</strong> ${objective}</p>`,
    `      <p><strong>Precondition:</strong> ${precondition}</p>`,
    `      <p><strong>Recorded At:</strong> ${escapeHtml(state.startedAt || "")}</p>`,
    "    </div>",
    "  </section>",
    "  <section class=\"card\">",
    "    <h2>Steps</h2>",
    stepsTable,
    "  </section>",
    "</body>",
    "</html>"
  ].join("\n");
}

function buildHtmlExport() {
  const payload = toHtmlViewer();
  const filenameSafeDate = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    fileName: `zephyr-test-case-viewer-${filenameSafeDate}.html`,
    mimeType: "text/html",
    content: payload
  };
}

function buildXmlExport() {
  const xmlPayload = toZephyrXml();
  const filenameSafeDate = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    fileName: `zephyr-test-case-${filenameSafeDate}.xml`,
    mimeType: "application/xml",
    content: xmlPayload
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  await loadState();
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await loadState();
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  await ensureStateLoaded();
  if (!state.isRecording || state.isPaused) {
    return;
  }
  if (changeInfo.status !== "complete") {
    return;
  }
  if (!tab.url || tab.url.startsWith("chrome://")) {
    return;
  }

  await ensureRecorderInjected(tabId);

  await appendStep({
    ts: new Date().toISOString(),
    action: "navigate",
    url: tab.url,
    path: (() => {
      try {
        const parsed = new URL(tab.url);
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      } catch {
        return "";
      }
    })(),
    selector: "",
    elementLabel: tab.title || "",
    tabId,
    windowId: tab.windowId
  });

  await syncRecordingToTab(tabId);
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await ensureStateLoaded();
  await syncRecordingToTab(activeInfo.tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  if (message.type === "RECORDED_STEP") {
    appendStep({
      ...(message.payload || {}),
      tabId: sender && sender.tab ? sender.tab.id : undefined,
      windowId: sender && sender.tab ? sender.tab.windowId : undefined
    })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "COMMAND_START") {
    startRecording(message.title, message.segment)
      .then(() => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "COMMAND_STOP") {
    stopRecording()
      .then(() => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "COMMAND_PAUSE") {
    pauseRecording()
      .then(() => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "COMMAND_RESUME") {
    resumeRecording()
      .then(() => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "COMMAND_EXPORT") {
    Promise.resolve()
      .then(() => ensureStateLoaded())
      .then(() => {
        const format = (message.format || "json").toLowerCase();
        if (format === "html") {
          return buildHtmlExport();
        }
        if (format === "xml") {
          return buildXmlExport();
        }
        return buildJsonExport();
      })
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "COMMAND_CLEAR") {
    Promise.resolve()
      .then(() => ensureStateLoaded())
      .then(() => {
        state.steps = [];
        return saveState();
      })
      .then(async () => {
        await notifyStateUpdated();
        sendResponse({ ok: true, state });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "COMMAND_GET_STATE") {
    ensureStateLoaded()
      .then(() => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "COMMAND_UPDATE_EXPECTED_RESULT") {
    updateExpectedResult(message.stepIndex, message.expectedResult)
      .then(() => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "COMMAND_UPDATE_STEP") {
    updateStep(message.stepIndex, {
      description: message.description,
      testData: message.testData,
      expectedResult: message.expectedResult
    })
      .then(() => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "COMMAND_DELETE_STEP") {
    deleteStep(message.stepIndex)
      .then(() => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "COMMAND_SET_SEGMENT") {
    setSegment(message.segment)
      .then(() => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});