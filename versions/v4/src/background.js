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
    projectKey: "",
    objective: "The recorded flow should complete successfully",
    precondition: "User has access and required test data.",
    folder: "Recorded/Chrome Extension",
    folderPath: "",
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

// Runs inside every frame (via chrome.scripting.executeScript). Resolves once
// the frame's DOM has been quiet for `quietMs` AND no loading indicator is
// visible, or when `maxWaitMs` elapses. Must be fully self-contained.
function domIdleWaiter(quietMs, maxWaitMs) {
  return new Promise((resolve) => {
    let quietTimer = null;
    let settled = false;
    let observer = null;
    const deadline = Date.now() + maxWaitMs;

    const hasLoadingIndicator = () => {
      const selector =
        '[aria-busy="true"], [role="progressbar"], [class*="busy-indicator" i], [class*="loading" i], [class*="spinner" i], [class*="loader" i]';
      let nodes;
      try {
        nodes = document.querySelectorAll(selector);
      } catch (error) {
        return false;
      }
      for (const node of nodes) {
        try {
          const rect = node.getBoundingClientRect();
          if (rect.width <= 1 || rect.height <= 1) {
            continue;
          }
          const style = getComputedStyle(node);
          if (style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0") {
            return true;
          }
        } catch (error) {
          // ignore individual nodes
        }
      }
      return false;
    };

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (quietTimer) {
        clearTimeout(quietTimer);
      }
      try {
        if (observer) {
          observer.disconnect();
        }
      } catch (error) {
        // ignore
      }
      resolve(true);
    };

    const tryFinish = () => {
      if (settled) {
        return;
      }
      if (hasLoadingIndicator() && Date.now() < deadline) {
        arm();
        return;
      }
      finish();
    };

    const arm = () => {
      if (quietTimer) {
        clearTimeout(quietTimer);
      }
      quietTimer = setTimeout(tryFinish, quietMs);
    };

    try {
      observer = new MutationObserver(arm);
      observer.observe(document.documentElement || document, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
    } catch (error) {
      // ignore
    }

    setTimeout(finish, maxWaitMs);
    arm();
  });
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

  // Wait for the DOM to settle in EVERY frame (including cross-origin app
  // iframes, e.g. the Infor portal), so screenshots aren't taken while a
  // busy-indicator/spinner is still showing.
  try {
    await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: domIdleWaiter,
        args: [800, 10000]
      }),
      delay(10500)
    ]);
  } catch (error) {
    // Fallback: ask the top frame via messaging (e.g. if injection is blocked).
    try {
      await Promise.race([
        chrome.tabs.sendMessage(
          tabId,
          { type: "RECORDER_WAIT_IDLE", quietMs: 800, maxWaitMs: 10000 },
          { frameId: 0 }
        ),
        delay(10500)
      ]);
    } catch (innerError) {
      // Content script not available; fall back to the fixed settle delay.
    }
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

  // Record the step immediately so recording stays responsive and no step is
  // lost when the user acts quickly. The screenshot is captured separately and
  // attached afterwards (see queueScreenshotCapture).
  safeStep.id = `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  state.steps.push(safeStep);
  await saveState();
  await notifyStateUpdated();

  const canCapture =
    !safeStep.screenshotDataUrl &&
    Number.isInteger(safeStep.tabId) &&
    Number.isInteger(safeStep.windowId) &&
    safeStep.action !== "api";
  if (canCapture) {
    queueScreenshotCapture(safeStep.id, safeStep.tabId, safeStep.windowId, safeStep.action);
  }
}

let screenshotQueue = Promise.resolve();

function queueScreenshotCapture(stepId, tabId, windowId, action) {
  // Serialize captures (captureVisibleTab is rate-limited) without blocking
  // step recording.
  screenshotQueue = screenshotQueue
    .then(() => captureAndAttachScreenshot(stepId, tabId, windowId, action))
    .catch(() => {});
  return screenshotQueue;
}

async function captureAndAttachScreenshot(stepId, tabId, windowId, action) {
  await ensureStateLoaded();
  const existing = state.steps.find((s) => s.id === stepId);
  if (!existing || existing.screenshotDataUrl) {
    return;
  }
  const screenshotCount = state.steps.filter((item) => Boolean(item.screenshotDataUrl)).length;
  if (screenshotCount >= MAX_SCREENSHOTS) {
    return;
  }

  const settleMs = action === "navigate" ? 1200 : 700;
  await waitForTabRender(tabId, settleMs);
  const dataUrl = await captureStepScreenshot(tabId, windowId);
  if (!dataUrl) {
    return;
  }

  const target = state.steps.find((s) => s.id === stepId);
  if (target && !target.screenshotDataUrl) {
    target.screenshotDataUrl = dataUrl;
    await saveState();
    await notifyStateUpdated();
  }
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

async function setConfig(patch) {
  await ensureStateLoaded();
  const allowed = [
    "projectKey",
    "folderPath",
    "segment",
    "uploadLabels",
    "zephyrFolderId",
    "zephyrStatusId",
    "zephyrPriorityId",
    "zephyrSegmentFieldId"
  ];
  for (const key of allowed) {
    if (patch && Object.prototype.hasOwnProperty.call(patch, key)) {
      const value = patch[key];
      state.config[key] = typeof value === "string" ? value.trim() : value;
    }
  }
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
    `  <td class=\"col-desc\">${description}</td>`,
    `  <td class=\"col-data\">${testData || "N/A"}</td>`,
    `  <td class=\"col-expected\">${expected}</td>`,
    `  <td class=\"col-shot\">${image}</td>`,
    "</tr>"
  ].join("\n");
}

function toHtmlViewer() {
  const caseName = escapeHtml(state.title || `Recorded Case ${new Date().toISOString().slice(0, 10)}`);
  const rowsHtml = state.steps.map((step, index) => renderStepRow(step, index)).join("\n");
  const stepsTable = state.steps.length
    ? [
        "    <table class=\"steps-table\">",
        "      <thead>",
        "        <tr><th class=\"col-index\">#</th><th class=\"col-desc\">Description</th><th class=\"col-data\">Test Data</th><th class=\"col-expected\">Expected Result</th><th class=\"col-shot\">Screenshot</th></tr>",
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
    "    @page { size: A4 landscape; margin: 12mm; }",
    "    body { font-family: Segoe UI, Arial, sans-serif; margin: 24px; background: #f6f7f9; color: #1f2430; }",
    "    .card { background: #fff; border: 1px solid #d9deea; border-radius: 10px; padding: 16px; margin-bottom: 12px; }",
    "    h1 { margin: 0 0 8px; }",
    "    h2 { margin: 0 0 12px; font-size: 16px; }",
    "    h3 { margin: 0 0 8px; font-size: 14px; }",
    "    p { margin: 6px 0; font-size: 13px; line-height: 1.4; }",
    "    .meta { display: grid; gap: 6px; }",
    "    .step { background: #fff; border: 1px solid #d9deea; border-radius: 10px; padding: 12px; margin-bottom: 10px; }",
    "    table.steps-table { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }",
    "    .steps-table th, .steps-table td { border: 1px solid #d9deea; padding: 8px; text-align: left; vertical-align: top; word-break: break-word; overflow-wrap: anywhere; }",
    "    .steps-table th { background: #eef1f6; }",
    "    .col-index { width: 30px; text-align: center; }",
    "    .col-desc { width: 160px; }",
    "    .col-data { width: 130px; }",
    "    .col-expected { width: 180px; }",
    "    .col-shot { width: 560px; }",
    "    .step-image { width: 100%; height: auto; display: block; border: 1px solid #d9deea; border-radius: 6px; }",
    "  </style>",
    "</head>",
    "<body>",
    "  <section class=\"card\">",
    `    <h1>${caseName}</h1>`,
    `    <p><strong>Recorded At:</strong> ${escapeHtml(state.startedAt || "")}</p>`,
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

// ---------------------------------------------------------------------------
// Zephyr Scale Cloud upload (uses the browser's own Zephyr session; no token)
// ---------------------------------------------------------------------------

const ZEPHYR_BACKEND = "https://app.tm4j.smartbear.com/backend";
const ZEPHYR_ORIGIN = "https://app.tm4j.smartbear.com";

function base64UrlDecode(segment) {
  let s = String(segment || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4 !== 0) {
    s += "=";
  }
  return atob(s);
}

function decodeJwtPayload(jwt) {
  const parts = String(jwt || "").split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch (error) {
    return null;
  }
}

function looksLikeJwt(value) {
  return typeof value === "string" && value.split(".").length === 3;
}

// Reads the current Zephyr web session (the `jwt` cookie) and derives the
// project/account context from it. No manual token entry required.
async function getZephyrSession() {
  if (!chrome.cookies || !chrome.cookies.getAll) {
    throw new Error("Cookies permission unavailable. Reload the extension.");
  }

  const cookies = await chrome.cookies.getAll({ url: ZEPHYR_ORIGIN, name: "jwt" });
  const candidate = cookies.find((c) => looksLikeJwt(c.value));
  if (!candidate || !candidate.value) {
    throw new Error("No Zephyr session found. Open Zephyr (app.tm4j.smartbear.com) in a tab, sign in, then try again.");
  }

  const jwt = candidate.value.trim().replace(/^(?:JWT|Bearer)\s+/i, "");
  const claims = decodeJwtPayload(jwt);
  if (!claims) {
    throw new Error("Could not read the Zephyr session token.");
  }

  if (claims.exp && Date.now() >= claims.exp * 1000) {
    throw new Error("Your Zephyr session has expired. Open Zephyr, refresh the page, then try again.");
  }

  const project = claims.context && claims.context.jira && claims.context.jira.project ? claims.context.jira.project : {};
  const projectId = project.id != null ? String(project.id) : "";
  const projectKey = project.key || "";
  const owner = claims.sub != null ? String(claims.sub) : "";

  if (!projectId) {
    throw new Error("Could not determine the Jira project from your Zephyr session.");
  }

  return { jwt, projectId, projectKey, owner, backend: ZEPHYR_BACKEND };
}

function zephyrHeaders(session, extra) {
  return Object.assign(
    {
      Authorization: `JWT ${session.jwt}`,
      "jira-project-id": session.projectId,
      accept: "application/json, text/plain, */*"
    },
    extra || {}
  );
}

async function getRichTextUploadDetails(session) {
  const res = await fetch(`${session.backend}/rest/tests/2.0/uploaddetails/richtextattachment`, {
    method: "GET",
    headers: zephyrHeaders(session)
  });
  if (!res.ok) {
    throw new Error(`Image signing failed (HTTP ${res.status}).`);
  }
  return res.json();
}

function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || "");
  if (!match) {
    return null;
  }
  const mime = match[1] || "image/jpeg";
  const isBase64 = Boolean(match[2]);
  const data = match[3];
  let bytes;
  if (isBase64) {
    const binary = atob(data);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(data));
  }
  const ext = mime.includes("png") ? "png" : mime.includes("gif") ? "gif" : "jpg";
  return { blob: new Blob([bytes], { type: mime }), mime, ext };
}

// Uploads one screenshot to Zephyr's rich-text (CloudFront/S3) store and
// returns an <img> tag that renders inline inside a rich-text field.
async function uploadInlineScreenshot(session, index, dataUrl) {
  const parsed = dataUrlToBlob(dataUrl);
  if (!parsed) {
    return "";
  }

  const details = await getRichTextUploadDetails(session);
  const fileName = `step-${String(index + 1).padStart(3, "0")}-screenshot.${parsed.ext}`;
  const key = `${details.keyPrefix}${Date.now()}-${fileName}`;

  const form = new FormData();
  form.append("key", key);
  form.append("success_action_status", "201");
  form.append("X-Requested-With", "xhr");
  form.append("Content-Type", parsed.mime);
  form.append("policy", details.policy);
  form.append("X-Amz-Credential", details.credential);
  form.append("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  form.append("X-Amz-Date", details.date);
  form.append("X-Amz-Signature", details.signature);
  form.append("X-Amz-Meta-user-account-id", session.owner);
  form.append("file", parsed.blob, fileName);

  const res = await fetch(details.bucketUrl, {
    method: "POST",
    headers: {
      Authorization: `JWT ${session.jwt}`,
      "jira-project-id": session.projectId,
      "atm-rest-base": session.backend
    },
    body: form
  });
  if (res.status !== 201 && !res.ok) {
    throw new Error(`Screenshot upload failed (HTTP ${res.status}).`);
  }

  const finalUrl = `${details.bucketUrl.replace(/\/$/, "")}/${key}`;
  return `<img src="${finalUrl}" style="width: 300px;" class="fr-fil fr-dib">`;
}

async function uploadStepScreenshots(session) {
  const map = {};
  for (let i = 0; i < state.steps.length; i += 1) {
    const dataUrl = state.steps[i] && state.steps[i].screenshotDataUrl;
    if (!dataUrl) {
      continue;
    }
    try {
      const html = await uploadInlineScreenshot(session, i, dataUrl);
      if (html) {
        map[i] = html;
      }
    } catch (error) {
      // Best effort: skip this image but continue the upload.
    }
  }
  return map;
}

function buildTestcaseBody(session, stepImageHtml) {
  const steps = state.steps.map((step, index) => {
    const expectedBase = stepExpectedResult(step);
    const img = stepImageHtml[index];
    const expectedResult = img ? `${escapeHtml(expectedBase)}<br/>${img}` : expectedBase;
    return {
      description: stepDescription(step),
      testData: stepTestData(step),
      expectedResult,
      index
    };
  });

  const body = {
    projectId: Number(session.projectId),
    name: state.title || `Recorded Case ${new Date().toISOString().slice(0, 10)}`,
    owner: session.owner,
    testScript: {
      stepByStepScript: {
        steps: steps.length ? steps : [{ description: "", expectedResult: "", index: 0 }]
      }
    }
  };

  const cfg = state.config || {};
  if (cfg.zephyrFolderId) {
    body.folderId = Number(cfg.zephyrFolderId);
  }
  if (cfg.zephyrStatusId) {
    body.statusId = Number(cfg.zephyrStatusId);
  }
  if (cfg.zephyrPriorityId) {
    body.priorityId = Number(cfg.zephyrPriorityId);
  }
  const labels = toLabelArray(cfg.uploadLabels);
  if (labels.length) {
    body.labels = labels;
  }

  return body;
}

function folderChildren(node) {
  const kids = (node && (node.children || node.folders || node.subFolders || node.items)) || [];
  return Array.isArray(kids) ? kids : [];
}

async function fetchTestCaseFolderTree(session) {
  const url = `${session.backend}/rest/tests/2.0/project/${encodeURIComponent(session.projectId)}/foldertree/testcase`;
  let res;
  try {
    res = await fetch(url, { headers: zephyrHeaders(session) });
  } catch (error) {
    throw new Error("Could not reach Zephyr to read the folder list.");
  }
  if (!res.ok) {
    throw new Error(`Could not read the folder list from Zephyr (HTTP ${res.status}).`);
  }
  return res.json();
}

// Flattens the folder tree into { id, segments } entries, where segments is the
// list of folder names from the top of the tree down to that folder.
function collectFolderPaths(nodes, prefixSegments, out) {
  for (const node of nodes) {
    if (!node || typeof node !== "object") {
      continue;
    }
    const name = node.name != null ? String(node.name).trim() : "";
    const segments = name ? prefixSegments.concat(name) : prefixSegments.slice();
    if (node.id != null && name) {
      out.push({ id: node.id, segments });
    }
    collectFolderPaths(folderChildren(node), segments, out);
  }
}

// Resolves a "/Parent/Child" folder path to its numeric folder id within the
// current project. Throws (aborting the upload) if the path does not exist, so
// a test case is never placed in an unintended folder.
async function resolveFolderId(session, folderPath) {
  const wantedSegments = String(folderPath || "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!wantedSegments.length) {
    return undefined;
  }
  const wantedKey = wantedSegments.map((s) => s.toLowerCase()).join("/");

  const tree = await fetchTestCaseFolderTree(session);
  let roots;
  if (Array.isArray(tree)) {
    roots = tree;
  } else if (folderChildren(tree).length) {
    roots = folderChildren(tree);
  } else if (tree && tree.id != null) {
    roots = [tree];
  } else {
    roots = [];
  }

  const all = [];
  collectFolderPaths(roots, [], all);

  // Exact match relative to the tree roots.
  for (const entry of all) {
    if (entry.segments.map((s) => s.toLowerCase()).join("/") === wantedKey) {
      return entry.id;
    }
  }
  // Tolerate a single virtual/root node above the real folders.
  for (const entry of all) {
    const segs = entry.segments.map((s) => s.toLowerCase());
    if (segs.length === wantedSegments.length + 1 && segs.slice(1).join("/") === wantedKey) {
      return entry.id;
    }
  }

  throw new Error(
    `Folder "${folderPath}" was not found in project ${session.projectKey}. ` +
      `Check the exact path (e.g. /Parent/Child), or clear the Folder path field to use the project root.`
  );
}

function customFieldId(field) {
  return field ? (field.id != null ? field.id : field.customFieldId) : undefined;
}

function customFieldName(field) {
  return String((field && (field.name || field.fieldName || field.label)) || "");
}

function customFieldIsRequired(field) {
  return Boolean(field && (field.required || field.isRequired || field.mandatory || field.requiredField));
}

function customFieldOptions(field) {
  const opts = field && (field.options || field.optionList || field.choices);
  return Array.isArray(opts) ? opts : [];
}

function customFieldOptionId(option) {
  return option ? (option.id != null ? option.id : option.optionId != null ? option.optionId : option.value) : undefined;
}

function customFieldOptionName(option) {
  return String((option && (option.name != null ? option.name : option.label != null ? option.label : option.value)) || "");
}

function buildCustomFieldValue(field, rawValue) {
  const id = customFieldId(field);
  const options = customFieldOptions(field);
  if (options.length) {
    // Dropdown / choice field: Zephyr encodes the selected option in
    // stringValue as "-<optionId>-" (not the display text).
    const match = options.find(
      (o) => customFieldOptionName(o).toLowerCase() === String(rawValue).trim().toLowerCase()
    );
    if (!match) {
      const names = options.map(customFieldOptionName).filter(Boolean).join(", ");
      throw new Error(
        `"${rawValue}" is not a valid option for "${customFieldName(field)}".` +
          (names ? ` Valid options: ${names}.` : "")
      );
    }
    return { customFieldId: id, stringValue: `-${customFieldOptionId(match)}-` };
  }
  // Free-text field.
  return { customFieldId: id, stringValue: String(rawValue) };
}

async function fetchTestCaseCustomFields(session) {
  const url = `${session.backend}/rest/tests/2.0/project/${encodeURIComponent(session.projectId)}/customfields/testcase`;
  const res = await fetch(url, { headers: zephyrHeaders(session) });
  if (!res.ok) {
    throw new Error(`Could not read custom fields from Zephyr (HTTP ${res.status}).`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : data.values || data.customFields || data.content || [];
}

// Picks the "default" reference item (status/priority), falling back to the
// lowest index, then the first entry.
function pickDefaultRef(list) {
  if (!Array.isArray(list) || !list.length) {
    return null;
  }
  const explicit = list.find((x) => x && (x.default === true || x.isDefault === true || x.defaultValue === true));
  if (explicit) {
    return explicit;
  }
  const sorted = [...list].sort((a, b) => (a && a.index != null ? a.index : 999) - (b && b.index != null ? b.index : 999));
  return sorted[0] || list[0];
}

function refId(ref) {
  return ref ? (ref.id != null ? ref.id : ref.statusId != null ? ref.statusId : ref.priorityId) : undefined;
}

async function fetchProjectRefList(session, resources) {
  for (const resource of resources) {
    const url = `${session.backend}/rest/tests/2.0/project/${encodeURIComponent(session.projectId)}/${resource}`;
    let res;
    try {
      res = await fetch(url, { headers: zephyrHeaders(session) });
    } catch (error) {
      continue;
    }
    if (!res.ok) {
      continue;
    }
    const data = await res.json();
    const list = Array.isArray(data) ? data : data.values || data.content || [];
    if (Array.isArray(list) && list.length) {
      return list;
    }
  }
  return [];
}

async function resolveDefaultStatusId(session) {
  const list = await fetchProjectRefList(session, ["testcasestatus"]);
  return refId(pickDefaultRef(list));
}

async function resolveDefaultPriorityId(session) {
  const list = await fetchProjectRefList(session, ["testcasepriority"]);
  return refId(pickDefaultRef(list));
}

// Builds the customFieldValues array. The Segment box value is mapped to the
// project's Segment field automatically (by name); an explicit field id in the
// advanced settings overrides that. Any required custom field left unfilled
// aborts the upload with a clear message instead of failing on the server.
async function buildCustomFieldValues(session) {
  const cfg = state.config || {};
  const segmentValue = (cfg.segment || "").trim();

  if (cfg.zephyrSegmentFieldId && segmentValue) {
    return [{ customFieldId: Number(cfg.zephyrSegmentFieldId), stringValue: segmentValue }];
  }

  let fields = [];
  try {
    fields = await fetchTestCaseCustomFields(session);
  } catch (error) {
    fields = [];
  }
  const list = Array.isArray(fields) ? fields : [];

  const values = [];
  const usedIds = new Set();

  if (segmentValue) {
    const required = list.filter(customFieldIsRequired);
    const target =
      list.find((f) => /segment/i.test(customFieldName(f))) ||
      (required.length === 1 ? required[0] : null);
    if (target) {
      values.push(buildCustomFieldValue(target, segmentValue));
      usedIds.add(String(customFieldId(target)));
    }
  }

  const missing = list
    .filter((f) => customFieldIsRequired(f) && !usedIds.has(String(customFieldId(f))))
    .map((f) => customFieldName(f) || `field ${customFieldId(f)}`);

  if (missing.length) {
    throw new Error(
      `Project ${session.projectKey} requires the custom field(s): ${missing.join(", ")}. ` +
        `Enter a value in the Segment box (used for the required field).`
    );
  }

  return values;
}

async function uploadToZephyr(options) {
  await ensureStateLoaded();
  if (!state.steps.length) {
    throw new Error("No recorded steps to upload.");
  }
  if (!state.title || !state.title.trim()) {
    throw new Error("Please enter a test case title before uploading.");
  }

  const session = await getZephyrSession();

  const includeScreenshots = !options || options.includeScreenshots !== false;
  const stepImageHtml = includeScreenshots ? await uploadStepScreenshots(session) : {};

  const body = buildTestcaseBody(session, stepImageHtml);

  // Resolve the folder path to a folder id so the test case lands in the
  // intended folder (not the project root).
  const folderPath = (state.config && state.config.folderPath ? state.config.folderPath : "").trim();
  if (folderPath) {
    body.folderId = await resolveFolderId(session, folderPath);
  }

  // Fill required custom fields (e.g. Segment) so the create call is accepted.
  const customFieldValues = await buildCustomFieldValues(session);
  if (customFieldValues.length) {
    body.customFieldValues = customFieldValues;
  }

  // Status and priority are required and per-project; resolve the project's
  // defaults unless the user set explicit IDs in the advanced settings.
  if (body.statusId == null) {
    const statusId = await resolveDefaultStatusId(session);
    if (statusId != null) {
      body.statusId = Number(statusId);
    }
  }
  if (body.priorityId == null) {
    const priorityId = await resolveDefaultPriorityId(session);
    if (priorityId != null) {
      body.priorityId = Number(priorityId);
    }
  }

  const res = await fetch(`${session.backend}/rest/tests/2.0/testcase`, {
    method: "POST",
    headers: zephyrHeaders(session, { "content-type": "application/json" }),
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = null;
  }

  if (!res.ok) {
    const parts = [];
    if (data && data.message) parts.push(data.message);
    if (data && data.error && data.error !== data.message) parts.push(data.error);
    if (data && data.errorCode) parts.push(`code=${data.errorCode}`);
    if (data && data.errorMessages) parts.push(JSON.stringify(data.errorMessages));
    if (data && data.errors) parts.push(JSON.stringify(data.errors));
    if (data && data.fieldErrors) parts.push(JSON.stringify(data.fieldErrors));
    if (data && data.details) parts.push(JSON.stringify(data.details));
    let detail = parts.join(" | ");
    if (!detail) {
      detail = (text || `HTTP ${res.status}`).slice(0, 800);
    }
    throw new Error(`Zephyr upload failed (HTTP ${res.status}): ${detail}`);
  }

  const key = (data && (data.key || data.testCaseKey)) || "";
  const id = (data && data.id) || "";
  return { key, id, projectKey: session.projectKey };
}

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

  if (message.type === "COMMAND_SET_CONFIG") {
    setConfig(message.patch || {})
      .then(() => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "COMMAND_UPLOAD") {
    uploadToZephyr({ includeScreenshots: message.includeScreenshots !== false })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});