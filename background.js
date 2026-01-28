// Kuulame soove "proxy" skriptilt
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "FETCH_URL") {

    fetch(request.url)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(html => {
        sendResponse({ success: true, html: html });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });

    return true; // See on vajalik async vastuse jaoks!
  }
});
