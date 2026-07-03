const titleInput = document.getElementById("title");
const exportButton = document.getElementById("exportButton");
const exportMenu = document.getElementById("exportMenu");
const statusNode = document.getElementById("status");
const stepCountNode = document.getElementById("stepCount");
const stepsListNode = document.getElementById("stepsList");

const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const clearBtn = document.getElementById("clear");

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function updateUi(state) {
  const isRecording = Boolean(state && state.isRecording);
  const count = Array.isArray(state && state.steps) ? state.steps.length : 0;

  statusNode.textContent = isRecording ? "Recording..." : "Idle";
  stepCountNode.textContent = `${count} steps`;

  startBtn.disabled = isRecording;
  stopBtn.disabled = !isRecording;

  renderSteps(state && state.steps ? state.steps : []);
}

function stepLabel(step, index) {
  const action = step.action || "action";
  const target = step.elementLabel || step.selector || step.path || "target";
  return `${index + 1}. ${action} - ${target}`;
}

function buildStepDataText(step) {
  if (step.action === "input") {
    return `Entered: ${step.value || "(empty)"}`;
  }
  if (step.action === "navigate") {
    return `URL: ${step.url || ""}`;
  }
  if (step.value) {
    return `Data: ${step.value}`;
  }
  return "";
}

function renderSteps(steps) {
  stepsListNode.innerHTML = "";
  if (!steps.length) {
    const empty = document.createElement("p");
    empty.className = "step-item-title";
    empty.textContent = "No recorded steps yet.";
    stepsListNode.appendChild(empty);
    return;
  }

  steps.forEach((step, index) => {
    const item = document.createElement("div");
    item.className = "step-item";

    const title = document.createElement("p");
    title.className = "step-item-title";
    title.textContent = stepLabel(step, index);

    item.appendChild(title);

    const stepData = buildStepDataText(step);
    if (stepData) {
      const dataNode = document.createElement("p");
      dataNode.className = "step-data";
      dataNode.textContent = stepData;
      item.appendChild(dataNode);
    }

    if (step.screenshotDataUrl) {
      const preview = document.createElement("img");
      preview.className = "step-preview";
      preview.src = step.screenshotDataUrl;
      preview.alt = `Step ${index + 1} screenshot`;
      item.appendChild(preview);
    }

    const textarea = document.createElement("textarea");
    textarea.value = step.expectedResult || "Action succeeds and the expected UI state is shown";
    textarea.setAttribute("data-step-index", String(index));
    textarea.addEventListener("change", onExpectedResultChange);
    item.appendChild(textarea);

    stepsListNode.appendChild(item);
  });
}

async function onExpectedResultChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement)) {
    return;
  }
  const stepIndex = Number.parseInt(target.dataset.stepIndex || "", 10);
  if (Number.isNaN(stepIndex)) {
    return;
  }

  const response = await sendMessage({
    type: "COMMAND_UPDATE_EXPECTED_RESULT",
    stepIndex,
    expectedResult: target.value.trim()
  });
  if (!response || !response.ok) {
    throw new Error((response && response.error) || "Update expected result failed");
  }
}

async function refreshState() {
  const response = await sendMessage({ type: "COMMAND_GET_STATE" });
  if (!response || !response.ok) {
    throw new Error((response && response.error) || "Failed to load state");
  }
  updateUi(response.state);
}

async function onStartClick() {
  const response = await sendMessage({
    type: "COMMAND_START",
    title: titleInput.value.trim()
  });
  if (!response || !response.ok) {
    throw new Error((response && response.error) || "Start failed");
  }
  updateUi(response.state);
}

async function onStopClick() {
  const response = await sendMessage({ type: "COMMAND_STOP" });
  if (!response || !response.ok) {
    throw new Error((response && response.error) || "Stop failed");
  }
  updateUi(response.state);
}

async function onClearClick() {
  const response = await sendMessage({ type: "COMMAND_CLEAR" });
  if (!response || !response.ok) {
    throw new Error((response && response.error) || "Clear failed");
  }
  updateUi(response.state);
}

async function downloadFromPayload(payload) {
  if (!payload || !payload.content || !payload.fileName || !payload.mimeType) {
    throw new Error("Invalid export payload");
  }

  const blob = new Blob([payload.content], { type: payload.mimeType });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({
      url,
      filename: payload.fileName,
      saveAs: true
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

async function onExportClick(format) {
  const response = await sendMessage({
    type: "COMMAND_EXPORT",
    format
  });
  if (!response || !response.ok) {
    throw new Error((response && response.error) || "Export failed");
  }
  await downloadFromPayload(response.payload);
  statusNode.textContent = `Exported ${format.toUpperCase()}`;
}

function bind(button, handler) {
  button.addEventListener("click", async () => {
    try {
      statusNode.textContent = "Working...";
      await handler();
    } catch (error) {
      statusNode.textContent = error.message;
    }
  });
}

bind(startBtn, onStartClick);
bind(stopBtn, onStopClick);
bind(clearBtn, onClearClick);

exportButton.addEventListener("click", () => {
  exportMenu.classList.toggle("hidden");
});

exportMenu.querySelectorAll(".export-option").forEach((button) => {
  button.addEventListener("click", () => {
    const format = button.getAttribute("data-format") || "json";
    exportMenu.classList.add("hidden");
    onExportClick(format).catch((error) => {
      statusNode.textContent = error.message;
    });
  });
});

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }
  if (!event.target.closest(".export-menu")) {
    exportMenu.classList.add("hidden");
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "STATE_UPDATED" || !message.state) {
    return;
  }
  updateUi(message.state);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshState().catch((error) => {
      statusNode.textContent = error.message;
    });
  }
});

refreshState().catch((error) => {
  statusNode.textContent = error.message;
});
