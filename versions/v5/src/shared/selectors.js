(function () {
  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function nthOfTypeSelector(element) {
    const tagName = element.tagName.toLowerCase();
    if (!element.parentElement) {
      return tagName;
    }
    const siblings = Array.from(element.parentElement.children).filter(
      (node) => node.tagName === element.tagName
    );
    if (siblings.length <= 1) {
      return tagName;
    }
    const index = siblings.indexOf(element) + 1;
    return `${tagName}:nth-of-type(${index})`;
  }

  function getSelector(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    if (element.id) {
      return `#${cssEscape(element.id)}`;
    }

    const path = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE && path.length < 5) {
      let segment = current.tagName.toLowerCase();
      if (current.classList && current.classList.length > 0) {
        const stableClass = Array.from(current.classList).find(
          (name) => !/^(active|focus|hover|selected)$/.test(name)
        );
        if (stableClass) {
          segment += `.${cssEscape(stableClass)}`;
        }
      }
      if (!segment.includes(".")) {
        segment = nthOfTypeSelector(current);
      }
      path.unshift(segment);
      current = current.parentElement;
    }

    return path.join(" > ");
  }

  window.TestCaseRecorderSelectors = {
    getSelector
  };
})();