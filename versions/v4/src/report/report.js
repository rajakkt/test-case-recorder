const reportFrame = document.getElementById("reportFrame");
const printButton = document.getElementById("printButton");
const emptyState = document.getElementById("emptyState");

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

async function loadReport() {
  const response = await sendMessage({ type: "COMMAND_EXPORT", format: "html" });
  if (!response || !response.ok || !response.payload || !response.payload.content) {
    throw new Error((response && response.error) || "Failed to build report");
  }
  reportFrame.srcdoc = response.payload.content;
}

printButton.addEventListener("click", () => {
  if (reportFrame.contentWindow) {
    reportFrame.contentWindow.focus();
    reportFrame.contentWindow.print();
  } else {
    window.print();
  }
});

loadReport().catch((error) => {
  reportFrame.classList.add("hidden");
  emptyState.classList.remove("hidden");
  emptyState.textContent = error.message;
});
