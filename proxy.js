// 1. Listen for messages from the AI script (MAIN world).
window.addEventListener("message", (event) => {
  // Security check: only accept messages from our own window.
  if (event.source !== window || !event.data || event.data.type !== "GIST_FETCH_REQUEST") {
    return;
  }

  const { url, id } = event.data;

  // 2. Forward the request to the background script.
  chrome.runtime.sendMessage({ action: "FETCH_URL", url: url }, (response) => {

    let success = false;
    let html = null;
    let errorMessage = null;

    // Check 1: Did the extension report an error? (e.g. connection dropped)
    if (chrome.runtime.lastError) {
      errorMessage = chrome.runtime.lastError.message || "Runtime error in background script";
      console.error("NanoPeek Proxy Error:", errorMessage);
    }
    // Check 2: Did we get a response?
    else if (response) {
      success = !!response.success;
      html = response.html || null;
      errorMessage = response.error || null;
    }
    // Check 3: No response (empty response, no error set).
    else {
      errorMessage = "No response received from background script (Background might be dead).";
    }

    // 3. Send the response back to the AI script.
    window.postMessage({
      type: "GIST_FETCH_RESPONSE",
      id: id,
      success: success,
      html: html,
      error: errorMessage
    }, "*");
  });
});
