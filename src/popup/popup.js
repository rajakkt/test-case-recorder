const titleInput = document.getElementById("title");
const segmentInput = document.getElementById("segment");
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
  const segment = state && state.config ? state.config.segment || "" : "";

  statusNode.textContent = isRecording ? "Recording..." : "Idle";
  stepCountNode.textContent = `${count} steps`;

  startBtn.disabled = isRecording;
  stopBtn.disabled = !isRecording;
  segmentInput.value = segment;

  renderSteps(state && state.steps ? state.steps : []);
}

function stepLabel(step, index) {
  const action = step.action || "action";
  const target = step.elementLabel || step.selector || step.path || "target";
  return `${index + 1}. ${action} - ${target}`;
}

function normalizeAction(step) {
  if (step.action === "click") {
    return "Click";
  }
  if (step.action === "navigate") {
    return "Navigate";
  }
  if (step.action === "input") {
    return "Type";
  }
  if (step.action === "submit") {
    return "Press Enter";
  }
  return step.action || "Action";
}

function getStepDescription(step) {
  if (step.descriptionOverride) {
    return step.descriptionOverride;
  }
  const parts = [normalizeAction(step)];
  if (step.elementLabel) {
    parts.push(`on "${step.elementLabel}"`);
  }
  return parts.join(" ").trim();
}

function getStepTestData(step) {
  if (step.testDataOverride) {
    return step.testDataOverride;
  }
  if (step.action === "navigate") {
    return step.url || "";
  }
  return step.value || "";
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

    const sourceNode = document.createElement("p");
    sourceNode.className = "step-data";
    sourceNode.textContent = `Source: ${step.path || step.url || ""}`;
    item.appendChild(sourceNode);

    if (step.screenshotDataUrl) {
      const preview = document.createElement("img");
      preview.className = "step-preview";
      preview.src = step.screenshotDataUrl;
      preview.alt = `Step ${index + 1} screenshot`;
      item.appendChild(preview);
    }

    const descriptionLabel = document.createElement("p");
    descriptionLabel.className = "step-field-label";
    descriptionLabel.textContent = "Description";
    item.appendChild(descriptionLabel);

    const descriptionInput = document.createElement("textarea");
    descriptionInput.value = getStepDescription(step);
    descriptionInput.className = "step-description";
    item.appendChild(descriptionInput);

    const testDataLabel = document.createElement("p");
    testDataLabel.className = "step-field-label";
    testDataLabel.textContent = "Test Data";
    item.appendChild(testDataLabel);

    const testDataInput = document.createElement("textarea");
    testDataInput.value = getStepTestData(step);
    testDataInput.className = "step-test-data";
    item.appendChild(testDataInput);

    const expectedLabel = document.createElement("p");
    expectedLabel.className = "step-field-label";
    expectedLabel.textContent = "Expected Result";
    item.appendChild(expectedLabel);

    const expectedInput = document.createElement("textarea");
    expectedInput.value = step.expectedResult || "Action succeeds and the expected UI state is shown";
    expectedInput.className = "step-expected";
    item.appendChild(expectedInput);

    const actions = document.createElement("div");
    actions.className = "step-actions";

    const saveButton = document.createElement("button");
    saveButton.className = "btn btn-primary";
    saveButton.textContent = "Save Step";
    saveButton.addEventListener("click", () => {
      onSaveStep(index, descriptionInput.value, testDataInput.value, expectedInput.value).catch((error) => {
        statusNode.textContent = error.message;
      });
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "btn btn-danger";
    deleteButton.textContent = "Delete Step";
    deleteButton.addEventListener("click", () => {
      onDeleteStep(index).catch((error) => {
        statusNode.textContent = error.message;
      });
    });

    actions.appendChild(saveButton);
    actions.appendChild(deleteButton);
    item.appendChild(actions);

    stepsListNode.appendChild(item);
  });
}

async function onSaveStep(stepIndex, description, testData, expectedResult) {
  const response = await sendMessage({
    type: "COMMAND_UPDATE_STEP",
    stepIndex,
    description: description.trim(),
    testData: testData.trim(),
    expectedResult: expectedResult.trim()
  });
  if (!response || !response.ok) {
    throw new Error((response && response.error) || "Step update failed");
  }
  updateUi(response.state);
  statusNode.textContent = `Updated step ${stepIndex + 1}`;
}

async function onDeleteStep(stepIndex) {
  const response = await sendMessage({
    type: "COMMAND_DELETE_STEP",
    stepIndex
  });
  if (!response || !response.ok) {
    throw new Error((response && response.error) || "Step delete failed");
  }
  updateUi(response.state);
  statusNode.textContent = `Deleted step ${stepIndex + 1}`;
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
    title: titleInput.value.trim(),
    segment: segmentInput.value.trim()
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

async function onSegmentChange() {
  const response = await sendMessage({
    type: "COMMAND_SET_SEGMENT",
    segment: segmentInput.value.trim()
  });
  if (!response || !response.ok) {
    throw new Error((response && response.error) || "Segment update failed");
  }
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
segmentInput.addEventListener("change", () => {
  onSegmentChange().catch((error) => {
    statusNode.textContent = error.message;
  });
});

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
