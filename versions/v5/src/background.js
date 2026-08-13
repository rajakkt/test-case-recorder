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

function exportCaseName() {
  return state.title || `Recorded Case ${new Date().toISOString().slice(0, 10)}`;
}

// ---------------------------------------------------------------------------
// Word (.docx) export. Builds a real OOXML package (a ZIP) so screenshots embed
// as native pictures and table rows never split across a page. No external
// libraries: a minimal "store" (uncompressed) ZIP writer is included below.
// ---------------------------------------------------------------------------

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function concatBytes(list) {
  let total = 0;
  for (const a of list) {
    total += a.length;
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const a of list) {
    out.set(a, pos);
    pos += a.length;
  }
  return out;
}

// Produces a ZIP archive using the "store" (no compression) method.
function zipStore(entries) {
  const encoder = new TextEncoder();
  const u16 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
  const u32 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);

    const local = concatBytes([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0),
      nameBytes, data
    ]);
    localChunks.push(local);

    const central = concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(offset),
      nameBytes
    ]);
    centralChunks.push(central);

    offset += local.length;
  }

  const centralBytes = concatBytes(centralChunks);
  const end = concatBytes([
    u32(0x06054b50), u16(0), u16(0),
    u16(entries.length), u16(entries.length),
    u32(centralBytes.length), u32(offset), u16(0)
  ]);

  return concatBytes([concatBytes(localChunks), centralBytes, end]);
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function xmlEscape(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function docxTextCell(width, text, opts) {
  const bold = opts && opts.bold ? "<w:rPr><w:b/></w:rPr>" : "";
  const shd = opts && opts.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${opts.fill}"/>` : "";
  const align = opts && opts.align ? `<w:jc w:val="${opts.align}"/>` : "";
  const lines = String(text == null ? "" : text).split(/\r?\n/);
  const runs = lines
    .map((line, i) => `${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${xmlEscape(line)}</w:t>`)
    .join("");
  return (
    "<w:tc>" +
    `<w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shd}</w:tcPr>` +
    `<w:p><w:pPr>${align}</w:pPr><w:r>${bold}${runs}</w:r></w:p>` +
    "</w:tc>"
  );
}

function docxImageCell(width, media) {
  const drawing = media
    ? "<w:r><w:drawing>" +
      '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${media.cx}" cy="${media.cy}"/>` +
      '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
      `<wp:docPr id="${media.id}" name="Picture ${media.id}"/>` +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<pic:nvPicPr><pic:cNvPr id="${media.id}" name="Picture ${media.id}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${media.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${media.cx}" cy="${media.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      "</pic:pic></a:graphicData></a:graphic></wp:inline>" +
      "</w:drawing></w:r>"
    : "<w:r><w:t/></w:r>";
  return (
    "<w:tc>" +
    `<w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>` +
    `<w:p>${drawing}</w:p>` +
    "</w:tc>"
  );
}

async function buildWordExport() {
  const COLS = { index: 700, desc: 3400, data: 2500, expected: 3300, shot: 5498 };
  const EMU_PER_TWIP = 635;
  const EMU_PER_PX = 9525;
  const maxShotWidthEmu = (COLS.shot - 160) * EMU_PER_TWIP;

  const media = [];
  const rowsXml = [];

  for (let i = 0; i < state.steps.length; i += 1) {
    const step = state.steps[i];
    let cellMedia = null;
    const parsed = step.screenshotDataUrl ? dataUrlToBlob(step.screenshotDataUrl) : null;
    if (parsed && parsed.blob) {
      try {
        const bmp = await createImageBitmap(parsed.blob);
        const naturalW = bmp.width || 1;
        const naturalH = bmp.height || 1;
        if (bmp.close) {
          bmp.close();
        }
        let cx = naturalW * EMU_PER_PX;
        let cy = naturalH * EMU_PER_PX;
        if (cx > maxShotWidthEmu) {
          cy = Math.round((maxShotWidthEmu * naturalH) / naturalW);
          cx = maxShotWidthEmu;
        }
        const bytes = new Uint8Array(await parsed.blob.arrayBuffer());
        const id = media.length + 1;
        const ext = parsed.ext === "png" ? "png" : "jpg";
        const name = `image${String(id).padStart(3, "0")}.${ext}`;
        const rid = `rIdImg${id}`;
        media.push({ id, name, rid, bytes, cx, cy });
        cellMedia = { id, rid, cx, cy };
      } catch (error) {
        cellMedia = null;
      }
    }

    rowsXml.push(
      "<w:tr><w:trPr><w:cantSplit/></w:trPr>" +
        docxTextCell(COLS.index, String(i + 1), { align: "center" }) +
        docxTextCell(COLS.desc, stepDescriptionViewerText(step)) +
        docxTextCell(COLS.data, stepTestData(step) || "N/A") +
        docxTextCell(COLS.expected, step.expectedResult || DEFAULT_EXPECTED_RESULT) +
        docxImageCell(COLS.shot, cellMedia) +
        "</w:tr>"
    );
  }

  const headerRow =
    '<w:tr><w:trPr><w:tblHeader/></w:trPr>' +
    docxTextCell(COLS.index, "#", { bold: true, fill: "EEF1F6" }) +
    docxTextCell(COLS.desc, "Description", { bold: true, fill: "EEF1F6" }) +
    docxTextCell(COLS.data, "Test Data", { bold: true, fill: "EEF1F6" }) +
    docxTextCell(COLS.expected, "Expected Result", { bold: true, fill: "EEF1F6" }) +
    docxTextCell(COLS.shot, "Screenshot", { bold: true, fill: "EEF1F6" }) +
    "</w:tr>";

  const border = (tag) => `<w:${tag} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`;
  const table = state.steps.length
    ? "<w:tbl>" +
      '<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/>' +
      "<w:tblBorders>" +
      border("top") + border("left") + border("bottom") + border("right") +
      border("insideH") + border("insideV") +
      "</w:tblBorders></w:tblPr>" +
      `<w:tblGrid><w:gridCol w:w="${COLS.index}"/><w:gridCol w:w="${COLS.desc}"/><w:gridCol w:w="${COLS.data}"/><w:gridCol w:w="${COLS.expected}"/><w:gridCol w:w="${COLS.shot}"/></w:tblGrid>` +
      headerRow +
      rowsXml.join("") +
      "</w:tbl>"
    : "<w:p><w:r><w:t>No steps recorded.</w:t></w:r></w:p>";

  const title = xmlEscape(exportCaseName());
  const recordedAt = xmlEscape(state.startedAt || "");

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    "<w:body>" +
    `<w:p><w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">${title}</w:t></w:r></w:p>` +
    `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Recorded At: </w:t></w:r><w:r><w:t xml:space="preserve">${recordedAt}</w:t></w:r></w:p>` +
    table +
    '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>' +
    "</w:body></w:document>";

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="jpg" ContentType="image/jpeg"/>' +
    '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    "</Types>";

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships>";

  const docRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    media
      .map(
        (m) =>
          `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`
      )
      .join("") +
    "</Relationships>";

  const encoder = new TextEncoder();
  const entries = [
    { name: "[Content_Types].xml", data: encoder.encode(contentTypes) },
    { name: "_rels/.rels", data: encoder.encode(rootRels) },
    { name: "word/document.xml", data: encoder.encode(documentXml) },
    { name: "word/_rels/document.xml.rels", data: encoder.encode(docRels) }
  ];
  for (const m of media) {
    entries.push({ name: `word/media/${m.name}`, data: m.bytes });
  }

  const zipBytes = zipStore(entries);
  const filenameSafeDate = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    fileName: `zephyr-test-case-${filenameSafeDate}.docx`,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    base64: true,
    content: bytesToBase64(zipBytes)
  };
}

// Excel (.xlsx) export. A real OOXML spreadsheet built with the same ZIP
// writer, with each step's screenshot embedded as a floating picture anchored
// to the Screenshot column of its row.
function excelCellRef(colIndex, rowNumber) {
  let col = "";
  let n = colIndex + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return `${col}${rowNumber}`;
}

function excelInlineStringCell(ref, text, styleIndex) {
  const s = styleIndex ? ` s="${styleIndex}"` : "";
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

function excelNumberCell(ref, value, styleIndex) {
  const s = styleIndex ? ` s="${styleIndex}"` : "";
  return `<c r="${ref}"${s}><v>${value}</v></c>`;
}

async function buildExcelExport() {
  const SHOT_COL = 4; // zero-based column E
  const EMU_PER_PX = 9525;
  const EMU_PER_PT = 12700;
  const maxShotWidthPx = 440;

  const media = [];
  const rowsXml = [];

  // Header row (style 2 = bold, wrap, top).
  rowsXml.push(
    '<row r="1">' +
      ["#", "Description", "Test Data", "Expected Result", "Screenshot"]
        .map((h, c) => excelInlineStringCell(excelCellRef(c, 1), h, 2))
        .join("") +
      "</row>"
  );

  for (let i = 0; i < state.steps.length; i += 1) {
    const step = state.steps[i];
    const rowNumber = i + 2;
    let rowHeightPt = 0;

    const parsed = step.screenshotDataUrl ? dataUrlToBlob(step.screenshotDataUrl) : null;
    if (parsed && parsed.blob) {
      try {
        const bmp = await createImageBitmap(parsed.blob);
        const naturalW = bmp.width || 1;
        const naturalH = bmp.height || 1;
        if (bmp.close) {
          bmp.close();
        }
        let widthPx = naturalW;
        let heightPx = naturalH;
        if (widthPx > maxShotWidthPx) {
          heightPx = Math.round((maxShotWidthPx * naturalH) / naturalW);
          widthPx = maxShotWidthPx;
        }
        const cx = widthPx * EMU_PER_PX;
        const cy = heightPx * EMU_PER_PX;
        rowHeightPt = Math.round(cy / EMU_PER_PT) + 6;
        const bytes = new Uint8Array(await parsed.blob.arrayBuffer());
        const id = media.length + 1;
        const ext = parsed.ext === "png" ? "png" : "jpg";
        media.push({ id, name: `image${String(id).padStart(3, "0")}.${ext}`, bytes, cx, cy, drawingRow: rowNumber - 1 });
      } catch (error) {
        // skip image
      }
    }

    const cells =
      excelNumberCell(excelCellRef(0, rowNumber), i + 1, 1) +
      excelInlineStringCell(excelCellRef(1, rowNumber), stepDescriptionViewerText(step), 1) +
      excelInlineStringCell(excelCellRef(2, rowNumber), stepTestData(step) || "N/A", 1) +
      excelInlineStringCell(excelCellRef(3, rowNumber), step.expectedResult || DEFAULT_EXPECTED_RESULT, 1) +
      `<c r="${excelCellRef(SHOT_COL, rowNumber)}"/>`;

    const rowAttrs = rowHeightPt ? ` ht="${rowHeightPt}" customHeight="1"` : "";
    rowsXml.push(`<row r="${rowNumber}"${rowAttrs}>${cells}</row>`);
  }

  const hasImages = media.length > 0;

  const sheetXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    "<cols>" +
    '<col min="1" max="1" width="6" customWidth="1"/>' +
    '<col min="2" max="2" width="45" customWidth="1"/>' +
    '<col min="3" max="3" width="32" customWidth="1"/>' +
    '<col min="4" max="4" width="45" customWidth="1"/>' +
    '<col min="5" max="5" width="66" customWidth="1"/>' +
    "</cols>" +
    `<sheetData>${rowsXml.join("")}</sheetData>` +
    (hasImages ? '<drawing r:id="rIdDrawing1"/>' : "") +
    "</worksheet>";

  const drawingXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    media
      .map(
        (m) =>
          "<xdr:oneCellAnchor>" +
          `<xdr:from><xdr:col>${SHOT_COL}</xdr:col><xdr:colOff>19050</xdr:colOff><xdr:row>${m.drawingRow}</xdr:row><xdr:rowOff>19050</xdr:rowOff></xdr:from>` +
          `<xdr:ext cx="${m.cx}" cy="${m.cy}"/>` +
          "<xdr:pic>" +
          `<xdr:nvPicPr><xdr:cNvPr id="${m.id}" name="Picture ${m.id}"/><xdr:cNvPicPr/></xdr:nvPicPr>` +
          `<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId${m.id}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
          `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${m.cx}" cy="${m.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
          "</xdr:pic>" +
          "<xdr:clientData/>" +
          "</xdr:oneCellAnchor>"
      )
      .join("") +
    "</xdr:wsDr>";

  const drawingRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    media
      .map(
        (m) =>
          `<Relationship Id="rId${m.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${m.name}"/>`
      )
      .join("") +
    "</Relationships>";

  const sheetRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rIdDrawing1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>' +
    "</Relationships>";

  const workbookXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${xmlEscape(exportCaseName()).slice(0, 31) || "Test Case"}" sheetId="1" r:id="rId1"/></sheets>` +
    "</workbook>";

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    "</Relationships>";

  const stylesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="jpg" ContentType="image/jpeg"/>' +
    '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    (hasImages
      ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
      : "") +
    "</Types>";

  const encoder = new TextEncoder();
  const entries = [
    { name: "[Content_Types].xml", data: encoder.encode(contentTypes) },
    { name: "_rels/.rels", data: encoder.encode(rootRels) },
    { name: "xl/workbook.xml", data: encoder.encode(workbookXml) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(workbookRels) },
    { name: "xl/styles.xml", data: encoder.encode(stylesXml) },
    { name: "xl/worksheets/sheet1.xml", data: encoder.encode(sheetXml) }
  ];
  if (hasImages) {
    entries.push({ name: "xl/worksheets/_rels/sheet1.xml.rels", data: encoder.encode(sheetRels) });
    entries.push({ name: "xl/drawings/drawing1.xml", data: encoder.encode(drawingXml) });
    entries.push({ name: "xl/drawings/_rels/drawing1.xml.rels", data: encoder.encode(drawingRels) });
    for (const m of media) {
      entries.push({ name: `xl/media/${m.name}`, data: m.bytes });
    }
  }

  const zipBytes = zipStore(entries);
  const filenameSafeDate = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    fileName: `zephyr-test-case-${filenameSafeDate}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    base64: true,
    content: bytesToBase64(zipBytes)
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
        if (format === "word") {
          return buildWordExport();
        }
        if (format === "excel") {
          return buildExcelExport();
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