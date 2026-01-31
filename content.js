console.log("🚀 Tweetify AI (Language Aware + Bridge): Ready!");

// Language hint from URL when HTML/meta don't specify (e.g. .ee → et, .fi → fi).
function getLangHintFromUrl(url) {
    const hostname = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } })();
    if (hostname.endsWith('.ee')) return 'et';
    if (hostname.endsWith('.fi')) return 'fi';
    return 'en';
}

function getLoadingMessage(lang) {
    if (lang === 'et') return 'Teen kokkuvõtet...';
    if (lang === 'fi') return 'Teen yhteenvedon...';
    return 'Summarizing article...';
}

// Helper to talk to proxy.js -> background.js
function fetchViaBackground(url) {
    return new Promise((resolve, reject) => {
        const requestId = Math.random().toString(36).substring(7);
        // Store the timeout ID.
        let timeoutId;

        const listener = (event) => {
            // Check if the message is for us
            if (event.source !== window || !event.data || event.data.type !== "GIST_FETCH_RESPONSE") return;
            if (event.data.id !== requestId) return;

            // RESPONSE RECEIVED: Clean up everything
            // Don't wait for the timeout anymore.
            clearTimeout(timeoutId);
            // Remove the listener.
            window.removeEventListener("message", listener);

            event.data.success ? resolve(event.data.html) : reject(new Error(event.data.error));
        };

        // Make the listener ready
        window.addEventListener("message", listener);

        // Send the request
        window.postMessage({ type: "GIST_FETCH_REQUEST", url: url, id: requestId }, "*");

        // SAFETY CHECK: If the response doesn't come in 5 seconds, terminate the process
        timeoutId = setTimeout(() => {
            console.log("Timeout: Server didn't respond in 5 seconds.");
            // Remove the listener, to avoid memory leaks.
            window.removeEventListener("message", listener);
            reject(new Error("Timeout: Server didn't respond in 5 seconds."));
        }, 5000);
    });
}

const tooltip = document.createElement('div');
tooltip.id = 'gist-tooltip';
document.body.appendChild(tooltip);

let summarizerInstance = null;

// 2. AI initialization.
async function getSummarizer() {
    if (summarizerInstance) return summarizerInstance;

    try {
        if (!window.Summarizer) return null;

        const available = await window.Summarizer.availability();
        if (available === 'no') return null;

        console.log("⏳ Loading model...");
        // We use 'key-points', which works best with your version
        summarizerInstance = await window.Summarizer.create({
            type: 'key-points',
            format: 'plain-text',
            length: 'short'
        });

        console.log("✅ Model loaded!");
        return summarizerInstance;
    } catch (e) {
        console.error("AI Error:", e);
        return null;
    }
}

// 3. Fetching text and language.
async function fetchLinkText(url) {
    try {
        // Use bridge instead of direct fetch to bypass CORS issue.
        const html = await fetchViaBackground(url);

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        // A) Detect language: html lang, then meta tags, then URL hint (.ee/.fi), then default
        const rawHtmlLang = doc.documentElement.getAttribute('lang');
        const metaLocale = doc.querySelector('meta[property="og:locale"]')?.getAttribute('content');
        const metaLang = doc.querySelector('meta[http-equiv="content-language"]')?.getAttribute('content');

        let lang = rawHtmlLang || metaLocale || metaLang || '';
        lang = (typeof lang === 'string' ? lang : '').split('-')[0].toLowerCase();
        if (!lang) lang = getLangHintFromUrl(url);

        const selectors = [
            '.article-body__item',
            '.article-body',
            '.c-article-body',
            'article',
            '.post-content',
            'main',
            'body'
        ];

        let text = "";

        // --- STRATEGY 1: Ekspress / Delfi (Fragmented Layout) ---
        // Only on Delfi domains: article body is split into <div class="fragment-html"> blocks.
        const hostname = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } })();
        const isDelfiDomain = hostname === 'ekspress.delfi.ee' || hostname.endsWith('.delfi.ee');
        if (isDelfiDomain) {
            const fragments = Array.from(doc.querySelectorAll('.fragment-html'));
            if (fragments.length > 0) {
                console.log("✅ Found Ekspress Delfi fragments:", fragments.length);
                text = fragments
                    .map(frag => frag.innerText)
                    .join(' ');
            }
        }

        // --- STRATEGY 2: Standard Container Search (Fallback) ---
        // If Strategy 1 didn't work, look for standard containers.
        if (!text) {
            const selectors = [
                '.article-body__item',
                '.article-body',
                '.c-article-body',     // Postimees
                '.rus-article-body',   // Rus.Delfi
                '.col-article',        // Generic wrapper often used in Delfi
                'article',
                '.post-content',
                'main',
                'body'
            ];

            for (const selector of selectors) {
                const container = doc.querySelector(selector);
                if (container) {
                    // If it's a container, grab all paragraphs.
                    const paragraphs = Array.from(container.querySelectorAll('p'));
                    if (paragraphs.length > 2) {
                        text = paragraphs.map(p => p.innerText).join(' ');
                        break;
                    }
                    // Fallback: just take the container text.
                    else if (container.innerText.length > 200) {
                        text = container.innerText;
                        break;
                    }
                }
            }
        }

        // @TODO: Remove this after testing or add debug mode.
        console.log("Text found:", text);

        if (text) {
            // Clean up whitespace (remove double spaces/newlines) and limit length
            text = text.replace(/\s+/g, ' ').slice(0, 2500);
            return { text, lang };
        }
        return null;

    } catch (e) {
        console.error("Fetch Error:", e);
        return null;
    }
}

// 4. Main hover event.
let hoverTimeout;
let closeTimeout;

// Help to decide "is the mouse over the tooltip?" when the close timer fires
// and avoid hiding the tooltip while you're still on it.
let lastMouseX = 0;
let lastMouseY = 0;
document.addEventListener('mousemove', (e) => { lastMouseX = e.clientX; lastMouseY = e.clientY; }, { passive: true });

// 1. Mouse over link -> Start opening.
document.addEventListener('mouseover', (e) => {
    // If mouse is on tooltip, do nothing (keep it open).
    if (tooltip.contains(e.target)) return;

    const link = e.target.closest('a');

    // If not a link or Shift not held (shift only needed to open).
    if (!link || !e.shiftKey) {
        return;
    }

    // If we moved to a new link, cancel the previous close.
    clearTimeout(closeTimeout);
    clearTimeout(hoverTimeout);

    hoverTimeout = setTimeout(async () => {
        const url = link.href;
        console.log("🤖 Analyzing link:", url);

        // Position tooltip.
        const rect = link.getBoundingClientRect();
        tooltip.style.top = `${window.scrollY + rect.bottom + 4}px`;
        tooltip.style.left = `${window.scrollX + rect.left}px`;

        // Loading message.
        tooltip.innerHTML = `<div class="gist-loading">✨ ${getLoadingMessage(getLangHintFromUrl(url))}</div>`;
        tooltip.classList.add('visible');

        // Fetch data.
        const data = await fetchLinkText(url);

        if (!data) {
            tooltip.innerHTML = `<div class="gist-error">❌ No readable text found.</div>`;
            return;
        }

        const ai = await getSummarizer();
        if (ai) {
            try {
                // --- LANGUAGE PROMPT MAGIC ---
                // Since the Summarizer API is often English-centric, we "nudge" it
                // by adding a clear instruction at the start of the text.

                let promptPrefix = "";
                if (data.lang === 'et') {
                    promptPrefix = "Kirjuta kokkuvõte EESTI KEELES. Too välja peamised faktid:\n\n";
                } else if (data.lang === 'fi') {
                    promptPrefix = "Kirjoita yhteenveto SUOMEKSI. Korosta tärkeimmät faktit:\n\n";
                } else {
                    promptPrefix = "Summarize this text in English:\n\n";
                }

                const inputText = promptPrefix + data.text;
                // Ask the AI for a summary.
                const summary = await ai.summarize(inputText);
                const langDisplay = data.lang.toUpperCase();

                tooltip.innerHTML = `<span class="gist-title">NanoPeek (${langDisplay})</span>${summary}`;
            } catch (err) {
                tooltip.innerHTML = `<div class="gist-error">❌ AI Error: ${err.message}</div>`;
            }
        } else {
             tooltip.innerHTML = `<div class="gist-error">❌ AI model did not start.</div>`;
        }
    }, 600); // 600ms peab hoidma shift+hover
});

// 2. Mouse leaves (from link OR tooltip).
document.addEventListener('mouseout', (e) => {
    const target = e.target;
    // Where did the mouse go?
    const related = e.relatedTarget;

    // Check: Is mouse still in our system (link or tooltip)?
    const isInsideLink = target.closest('a');
    const isInsideTooltip = tooltip.contains(target);

    // Where did the mouse move to?
    const goingToTooltip = related && tooltip.contains(related);
    const goingToLink = related && related.closest('a');

    // IF:
    // 1. Left link -> onto tooltip (keep open).
    if (isInsideLink && goingToTooltip) {
        clearTimeout(closeTimeout);
        return;
    }

    // 2. Left tooltip -> back onto link (keep open).
    if (isInsideTooltip && goingToLink) {
        clearTimeout(closeTimeout);
        return;
    }

    // 3. Moved INSIDE tooltip from one element to another (keep open).
    if (isInsideTooltip && goingToTooltip) {
        return;
    }

    // OTHERWISE: Close (with short delay).
    // Don't open a new one if one was in progress.
    clearTimeout(hoverTimeout);

    closeTimeout = setTimeout(() => {
        const r = tooltip.getBoundingClientRect();
        const overTooltip = lastMouseX >= r.left && lastMouseX <= r.right && lastMouseY >= r.top && lastMouseY <= r.bottom;
        if (!overTooltip) tooltip.classList.remove('visible');
    }, 400);
});

// Keep tooltip open when mouse is on it; re-show if it was already closed.
tooltip.addEventListener('mouseenter', () => {
    clearTimeout(closeTimeout);
    tooltip.classList.add('visible');
});
