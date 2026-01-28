// 1. Kuula AI skripti (MAIN world)
window.addEventListener("message", (event) => {
  // Kontrollime, et sõnum on ikka meilt endalt
  if (event.source !== window || !event.data || event.data.type !== "GIST_FETCH_REQUEST") {
    return;
  }

  const { url, id } = event.data;

  // 2. Saada päring taustale (Background)
  chrome.runtime.sendMessage({ action: "FETCH_URL", url: url }, (response) => {

    // 3. Saada vastus tagasi AI skriptile
    window.postMessage({
      type: "GIST_FETCH_RESPONSE",
      id: id,
      success: response && response.success,
      html: response ? response.html : null,
      error: response ? response.error : "Unknown error"
    }, "*");
  });
});
