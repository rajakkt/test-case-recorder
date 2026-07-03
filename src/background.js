const STORAGE_KEY = "testCaseRecorderState";
const DEFAULT_EXPECTED_RESULT = "Action succeeds and the expected UI state is shown";
const MAX_SCREENSHOTS = 20;

const state = {
  isRecording: false,
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
  if (!persisted) {
    return;
  }
  Object.assign(state, persisted);
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

function stepDescription(step) {
  const descriptionParts = [normalizeAction(step)];
  if (step.elementLabel) {
    descriptionParts.push(`on \"${step.elementLabel}\"`);
  }
  if (step.selector) {
    descriptionParts.push(`(${step.selector})`);
  }
  return descriptionParts.join(" ").trim();
}

function stepDescriptionText(step) {
  const descriptionParts = [normalizeAction(step)];
  if (step.elementLabel) {
    descriptionParts.push(`on \"${step.elementLabel}\"`);
  }
  return descriptionParts.join(" ").trim();
}

function stepDescriptionViewerText(step) {
  const descriptionParts = [normalizeAction(step)];
  if (step.elementLabel) {
    descriptionParts.push(`on \"${step.elementLabel}\"`);
  }
  return descriptionParts.join(" ").trim();
}

function stepTestData(step) {
  if (step.action === "navigate") {
    return step.url || "";
  }
  return step.value || "";
}

function stepExpectedResult(step) {
  return step.expectedResult || DEFAULT_EXPECTED_RESULT;
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
      target: { tabId },
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
  if (!state.isRecording || !Number.isInteger(tabId)) {
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
  state.isRecording = true;
  state.sessionId = sessionId();
  state.startedAt = new Date().toISOString();
  state.steps = [];
  state.title = title || "";
  if (typeof segment === "string") {
    state.config.segment = segment.trim();
  }
  await injectRecorderInOpenTabs();
  await saveState();
  await notifyStateUpdated();
  await broadcast({
    type: "RECORDER_START",
    sessionId: state.sessionId
  });
}

async function stopRecording() {
  state.isRecording = false;
  await saveState();
  await notifyStateUpdated();
  await broadcast({
    type: "RECORDER_STOP"
  });
}

async function appendStep(step) {
  if (!state.isRecording) {
    return;
  }
  step.expectedResult = step.expectedResult || DEFAULT_EXPECTED_RESULT;
  const lastStep = state.steps[state.steps.length - 1];
  const sameAsLast =
    lastStep &&
    lastStep.action === step.action &&
    lastStep.selector === step.selector &&
    lastStep.path === step.path &&
    lastStep.value === step.value;

  if (sameAsLast) {
    return;
  }

  const screenshotCount = state.steps.filter((item) => Boolean(item.screenshotDataUrl)).length;
  if (!step.screenshotDataUrl && screenshotCount < MAX_SCREENSHOTS && Number.isInteger(step.tabId) && Number.isInteger(step.windowId) && step.action !== "api") {
    step.screenshotDataUrl = await captureStepScreenshot(step.tabId, step.windowId);
  }

  state.steps.push(step);
  await saveState();
  await notifyStateUpdated();
}

async function updateExpectedResult(stepIndex, expectedResult) {
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= state.steps.length) {
    return;
  }
  state.steps[stepIndex].expectedResult = expectedResult || DEFAULT_EXPECTED_RESULT;
  await saveState();
  await notifyStateUpdated();
}

async function setSegment(segment) {
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

function renderStepHtml(step, index) {
  const title = `${index + 1}. ${escapeHtml(normalizeAction(step))}`;
  const target = escapeHtml(step.elementLabel || step.selector || step.path || "");
  const description = escapeHtml(stepDescriptionViewerText(step));
  const expected = escapeHtml(step.expectedResult || DEFAULT_EXPECTED_RESULT);
  const testData = escapeHtml(stepTestData(step));
  const image = step.screenshotDataUrl
    ? `<img class=\"step-image\" src=\"${step.screenshotDataUrl}\" alt=\"Step ${index + 1} screenshot\" />`
    : "";

  return [
    "<section class=\"step\">",
    `  <h3>${title}</h3>`,
    target ? `  <p><strong>Target:</strong> ${target}</p>` : "",
    `  <p><strong>Description:</strong> ${description}</p>`,
    `  <p><strong>Test Data:</strong> ${testData || "N/A"}</p>`,
    `  <p><strong>Expected:</strong> ${expected}</p>`,
    image,
    "</section>"
  ]
    .filter(Boolean)
    .join("\n");
}

function toHtmlViewer() {
  const caseName = escapeHtml(state.title || `Recorded Case ${new Date().toISOString().slice(0, 10)}`);
  const objective = escapeHtml(state.config.objective || "Generated from Test Case Recorder browser session.");
  const precondition = escapeHtml(state.config.precondition || "User has access and required test data.");
  const stepsHtml = state.steps.map((step, index) => renderStepHtml(step, index)).join("\n");

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
    "    .step-image { margin-top: 8px; max-width: 420px; width: 100%; border: 1px solid #d9deea; border-radius: 8px; }",
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
    stepsHtml || "<p>No steps recorded.</p>",
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
  if (!state.isRecording) {
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

  if (message.type === "COMMAND_EXPORT") {
    const format = (message.format || "json").toLowerCase();
    let payload;
    if (format === "html") {
      payload = buildHtmlExport();
    } else if (format === "xml") {
      payload = buildXmlExport();
    } else {
      payload = buildJsonExport();
    }
    Promise.resolve(payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "COMMAND_CLEAR") {
    state.steps = [];
    saveState()
      .then(async () => {
        await notifyStateUpdated();
        sendResponse({ ok: true, state });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "COMMAND_GET_STATE") {
    sendResponse({ ok: true, state });
    return;
  }

  if (message.type === "COMMAND_UPDATE_EXPECTED_RESULT") {
    updateExpectedResult(message.stepIndex, message.expectedResult)
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