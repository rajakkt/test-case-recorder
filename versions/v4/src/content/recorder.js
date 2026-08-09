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

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function textFromLabelElement(el) {
    if (!el) {
      return "";
    }
    const t = (el.innerText || el.textContent || "").trim();
    return t ? t.slice(0, 120) : "";
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  // Produces a concise label from an element's text. For small controls this is
  // just the text; for larger containers it prefers the element's own direct
  // text nodes, and finally truncates rather than returning a giant blob.
  function conciseText(element) {
    const full = normalizeText(element.innerText || element.textContent || "");
    if (!full) {
      return "";
    }
    if (full.length <= 80) {
      return full;
    }
    let direct = "";
    try {
      element.childNodes.forEach((node) => {
        if (node.nodeType === 3) {
          direct += node.textContent;
        }
      });
    } catch (error) {
      // ignore
    }
    direct = normalizeText(direct);
    if (direct && direct.length <= 80) {
      return direct;
    }
    return `${full.slice(0, 77)}...`;
  }

  // Climbs from the actual event target to the nearest interactive element
  // (link/button/tab/menu item/etc.) so labels reflect the control the user
  // clicked, not a large surrounding container.
  function resolveClickTarget(el) {
    if (!el || !el.closest) {
      return el;
    }
    const interactive = el.closest(
      'a[href], button, [role="button"], [role="link"], [role="tab"], [role="menuitem"], ' +
        '[role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="treeitem"], ' +
        '[role="checkbox"], [role="radio"], summary, label'
    );
    return interactive || el;
  }

  function getElementLabel(element) {
    if (!element || !element.getAttribute) {
      return "";
    }

    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) {
      return ariaLabel.trim();
    }

    const labelledby = element.getAttribute("aria-labelledby");
    if (labelledby) {
      try {
        const ref = element.ownerDocument.getElementById(labelledby);
        const t = textFromLabelElement(ref);
        if (t) {
          return t;
        }
      } catch (e) {}
    }

    if (element.id) {
      try {
        const forLabel = element.ownerDocument.querySelector(`label[for="${cssEscape(element.id)}"]`);
        const t = textFromLabelElement(forLabel);
        if (t) {
          return t;
        }
      } catch (e) {}
    }

    if (element.closest) {
      const wrap = element.closest("label");
      if (wrap && wrap !== element) {
        const t = textFromLabelElement(wrap);
        if (t) {
          return t;
        }
      }
    }

    if (element.innerText && element.innerText.trim()) {
      const text = conciseText(element);
      if (text) {
        return text;
      }
    }

    const placeholder = element.getAttribute("placeholder");
    if (placeholder && placeholder.trim()) {
      return placeholder.trim();
    }

    const title = element.getAttribute("title");
    if (title && title.trim()) {
      return title.trim();
    }

    const alt = element.getAttribute("alt");
    if (alt && alt.trim()) {
      return alt.trim();
    }

    const name = element.getAttribute("name");
    if (name) {
      return name;
    }

    if (element.tagName === "INPUT" && typeof element.value === "string" && element.value.trim()) {
      return element.value.trim().slice(0, 120);
    }

    return element.tagName ? element.tagName.toLowerCase() : "";
  }

  function getElementRole(element) {
    if (!element || !element.tagName) {
      return "element";
    }
    const tag = element.tagName.toLowerCase();
    const roleAttr = (element.getAttribute("role") || "").toLowerCase();
    const type = (element.getAttribute("type") || "").toLowerCase();

    if (roleAttr === "link" || (tag === "a" && element.getAttribute("href"))) {
      return "link";
    }
    if (roleAttr === "button" || tag === "button" || (tag === "input" && ["button", "submit", "reset", "image"].includes(type))) {
      return "button";
    }
    if (roleAttr === "checkbox" || (tag === "input" && type === "checkbox")) {
      return "checkbox";
    }
    if (roleAttr === "radio" || (tag === "input" && type === "radio")) {
      return "radio";
    }
    if (roleAttr === "listbox" || tag === "select") {
      return "select";
    }
    if (roleAttr === "textbox" || roleAttr === "combobox" || roleAttr === "searchbox" || tag === "textarea" || element.isContentEditable ||
      (tag === "input" && (type === "" || ["text", "search", "url", "number"].includes(type)))) {
      return "textbox";
    }
    return "element";
  }

  function isCheckable(target) {
    return target && target.tagName === "INPUT" && ["checkbox", "radio"].includes((target.type || "").toLowerCase());
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
      elementLabel,
      role: getElementRole(target)
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
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element) || shouldSkipEvent(rawTarget)) {
      return;
    }

    const target = resolveClickTarget(rawTarget);
    const step = buildBaseStep("click", target);
    if (step.role === "checkbox" || step.role === "radio") {
      step.checked = Boolean(target.checked);
    }
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

    if (target instanceof HTMLSelectElement) {
      if (!shouldRecordInputStep(target)) {
        return;
      }
      const opt = target.options[target.selectedIndex];
      const value = sanitizeInputValue(opt ? (opt.text || opt.value) : target.value);
      if (!value) {
        return;
      }
      const step = buildBaseStep("input", target);
      step.value = value;
      sendRecordedStep(step);
      return;
    }

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      if (isCheckable(target)) {
        return;
      }
      const value = sanitizeInputValue(target.value);
      if (!value) {
        return;
      }
      if (!shouldRecordInputStep(target)) {
        return;
      }
      const step = buildBaseStep("input", target);
      step.value = value;
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
      if (isCheckable(target)) {
        return;
      }
      const value = sanitizeInputValue(target.value);
      if (!value) {
        return;
      }
      if (!shouldRecordInputStep(target)) {
        return;
      }
      const step = buildBaseStep("input", target);
      step.value = value;
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

    if (message.type === "RECORDER_WAIT_IDLE") {
      // Resolve once the DOM has been quiet (no mutations) for a short
      // window, so screenshots are taken after content has rendered.
      const quietMs = Number.isFinite(message.quietMs) ? message.quietMs : 700;
      const maxWaitMs = Number.isFinite(message.maxWaitMs) ? message.maxWaitMs : 6000;
      waitForDomIdle(quietMs, maxWaitMs).then(() => sendResponse({ ok: true }));
      return true; // keep the message channel open for the async response
    }
  });

  function waitForDomIdle(quietMs, maxWaitMs) {
    return new Promise((resolve) => {
      let quietTimer = null;
      let settled = false;
      let hookTimer = null;
      const observers = [];
      const deadline = Date.now() + maxWaitMs;

      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        if (quietTimer) {
          clearTimeout(quietTimer);
        }
        if (hookTimer) {
          clearInterval(hookTimer);
        }
        observers.forEach((obs) => {
          try {
            obs.disconnect();
          } catch (error) {
            // ignore
          }
        });
        resolve();
      };

      // Collects the top document plus any same-origin iframe documents.
      const accessibleDocs = () => {
        const docs = [document];
        document.querySelectorAll("iframe").forEach((frame) => {
          try {
            if (frame.contentDocument) {
              docs.push(frame.contentDocument);
            }
          } catch (error) {
            // cross-origin: skip
          }
        });
        return docs;
      };

      // Detects a visible loading indicator (spinners, progress bars, busy
      // regions). A CSS-animated spinner doesn't mutate the DOM, so we must
      // explicitly wait for it to disappear before capturing.
      const hasLoadingIndicator = () => {
        const selector =
          '[aria-busy="true"], [role="progressbar"], [class*="busy-indicator" i], [class*="loading" i], [class*="spinner" i], [class*="loader" i]';
        for (const doc of accessibleDocs()) {
          let nodes;
          try {
            nodes = doc.querySelectorAll(selector);
          } catch (error) {
            continue;
          }
          for (const node of nodes) {
            try {
              const rect = node.getBoundingClientRect();
              if (rect.width <= 1 || rect.height <= 1) {
                continue;
              }
              const view = (node.ownerDocument && node.ownerDocument.defaultView) || window;
              const style = view.getComputedStyle(node);
              if (style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0") {
                return true;
              }
            } catch (error) {
              // ignore individual node errors
            }
          }
        }
        return false;
      };

      const tryFinish = () => {
        if (settled) {
          return;
        }
        // Keep waiting while a loading indicator is visible (until the cap).
        if (hasLoadingIndicator() && Date.now() < deadline) {
          armQuietTimer();
          return;
        }
        finish();
      };

      const armQuietTimer = () => {
        if (quietTimer) {
          clearTimeout(quietTimer);
        }
        quietTimer = setTimeout(tryFinish, quietMs);
      };

      const observeDoc = (doc) => {
        if (!doc) {
          return;
        }
        try {
          const obs = new MutationObserver(armQuietTimer);
          obs.observe(doc.documentElement || doc, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true
          });
          observers.push(obs);
        } catch (error) {
          // ignore
        }
      };

      // Watch iframes: reset the quiet timer whenever one finishes loading, and
      // observe same-origin iframe content so its rendering counts as activity.
      const hookIframes = () => {
        const frames = document.querySelectorAll("iframe");
        frames.forEach((frame) => {
          if (frame.__tcrHooked) {
            return;
          }
          frame.__tcrHooked = true;
          frame.addEventListener("load", armQuietTimer);
          let doc = null;
          try {
            doc = frame.contentDocument;
          } catch (error) {
            doc = null; // cross-origin: cannot observe content
          }
          if (doc) {
            if (doc.readyState !== "complete") {
              armQuietTimer();
            }
            observeDoc(doc);
          }
        });
      };

      observeDoc(document);

      try {
        hookIframes();
      } catch (error) {
        // ignore
      }
      // Re-hook iframes that appear later during loading.
      hookTimer = setInterval(() => {
        try {
          hookIframes();
        } catch (error) {
          // ignore
        }
      }, 300);

      // Hard cap so we never wait forever on pages with continuous activity.
      setTimeout(finish, maxWaitMs);
      armQuietTimer();
    });
  }


  document.addEventListener("click", onClick, true);
  document.addEventListener("change", onChange, true);
  document.addEventListener("focusout", onFocusOut, true);
  document.addEventListener("keydown", onKeydown, true);

  syncStateFromBackground();
})();