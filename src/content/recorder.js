(function () {
  if (globalThis.__testCaseRecorderInitialized) {
    return;
  }
  globalThis.__testCaseRecorderInitialized = true;

  const STATE = {
    isRecording: false,
    sessionId: null,
    suppressUntil: 0
  };

  const LAST_INPUT_EVENTS = new WeakMap();

  function nowIso() {
    return new Date().toISOString();
  }

  function getPagePath() {
    return `${location.pathname}${location.search}${location.hash}`;
  }

  function getElementLabel(element) {
    if (!element) {
      return "";
    }
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) {
      return ariaLabel.trim();
    }
    if (element.innerText && element.innerText.trim()) {
      return element.innerText.trim().slice(0, 120);
    }
    const placeholder = element.getAttribute("placeholder");
    if (placeholder) {
      return placeholder.trim();
    }
    const name = element.getAttribute("name");
    if (name) {
      return name;
    }
    return element.tagName.toLowerCase();
  }

  function sanitizeInputValue(value) {
    if (!value) {
      return "";
    }
    const stringValue = String(value);
    if (stringValue.length > 80) {
      return `${stringValue.slice(0, 77)}...`;
    }
    return stringValue;
  }

  function shouldSkipEvent(target) {
    const sensitiveInput =
      target &&
      target.tagName === "INPUT" &&
      ["password", "email", "tel"].includes((target.type || "").toLowerCase());
    return sensitiveInput;
  }

  function sendRecordedStep(step) {
    chrome.runtime.sendMessage({
      type: "RECORDED_STEP",
      payload: step
    });
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          resolve(response || null);
        });
      } catch (error) {
        resolve(null);
      }
    });
  }

  function buildBaseStep(action, target) {
    const selectorApi = window.TestCaseRecorderSelectors;
    const selector = selectorApi ? selectorApi.getSelector(target) : "";
    const elementLabel = getElementLabel(target);

    return {
      ts: nowIso(),
      url: location.href,
      path: getPagePath(),
      action,
      selector,
      elementLabel
    };
  }

  function shouldRecordInputStep(target) {
    const value = sanitizeInputValue(target.value);
    const lastEntry = LAST_INPUT_EVENTS.get(target);
    const now = Date.now();

    if (lastEntry && lastEntry.value === value && now - lastEntry.at < 300) {
      return false;
    }

    LAST_INPUT_EVENTS.set(target, {
      value,
      at: now
    });
    return true;
  }

  function onClick(event) {
    if (!STATE.isRecording || Date.now() < STATE.suppressUntil) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element) || shouldSkipEvent(target)) {
      return;
    }

    const step = buildBaseStep("click", target);
    sendRecordedStep(step);
  }

  function onChange(event) {
    if (!STATE.isRecording || Date.now() < STATE.suppressUntil) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element) || shouldSkipEvent(target)) {
      return;
    }

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      if (!shouldRecordInputStep(target)) {
        return;
      }
      const step = buildBaseStep("input", target);
      step.value = sanitizeInputValue(target.value);
      sendRecordedStep(step);
    }
  }

  function onFocusOut(event) {
    if (!STATE.isRecording || Date.now() < STATE.suppressUntil) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element) || shouldSkipEvent(target)) {
      return;
    }

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      if (!shouldRecordInputStep(target)) {
        return;
      }
      const step = buildBaseStep("input", target);
      step.value = sanitizeInputValue(target.value);
      sendRecordedStep(step);
    }
  }

  function onKeydown(event) {
    if (!STATE.isRecording || Date.now() < STATE.suppressUntil) {
      return;
    }
    if (event.key !== "Enter") {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element) || shouldSkipEvent(target)) {
      return;
    }
    const step = buildBaseStep("submit", target);
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      step.value = sanitizeInputValue(target.value);
    }
    sendRecordedStep(step);
  }

  function startRecording(sessionId) {
    STATE.isRecording = true;
    STATE.sessionId = sessionId;
    STATE.suppressUntil = Date.now() + 500;
  }

  function stopRecording() {
    STATE.isRecording = false;
    STATE.sessionId = null;
  }

  async function syncStateFromBackground() {
    const response = await sendMessage({ type: "COMMAND_GET_STATE" });
    if (!response || !response.ok || !response.state) {
      return;
    }
    if (response.state.isRecording) {
      startRecording(response.state.sessionId || null);
    } else {
      stopRecording();
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) {
      return;
    }

    if (message.type === "RECORDER_START") {
      startRecording(message.sessionId || null);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "RECORDER_STOP") {
      stopRecording();
      sendResponse({ ok: true });
      return;
    }
  });

  document.addEventListener("click", onClick, true);
  document.addEventListener("change", onChange, true);
  document.addEventListener("focusout", onFocusOut, true);
  document.addEventListener("keydown", onKeydown, true);

  syncStateFromBackground();
})();