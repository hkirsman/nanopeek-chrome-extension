console.log("👁️ NanoPeek: Ready!");

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

/**
 * Article body selectors per domain. Fallback to default list.
 */
function getSelectorsForDomain(hostname) {
    const h = (hostname || '').toLowerCase();
    if (h === 'postimees.ee' || h.endsWith('.postimees.ee')) {
        return ['article:first-of-type .article-body .article-body__item'];
    }
    if (h === 'delfi.ee' || h.endsWith('.delfi.ee')) {
        return ['div.article:first-of-type .fragment-html'];
    }
    return [
        '.article-body__item',
        '.article-body',
        '.c-article-body',
        '.rus-article-body',
        '.col-article',
        'article',
        '.post-content',
        'main',
        'body'
    ];
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

const BASE_SHARED_CONTEXT = 'Summarize in the same language as the input. If the text is in Estonian, respond in Estonian. If Finnish, respond in Finnish. Otherwise respond in English.';

let summarizerInstance = null;

// 2. AI initialization. Pass linkTitle when the link is a question (title contains '?') to amend sharedContext.
async function getSummarizer(linkTitle) {
    const isQuestion = linkTitle && linkTitle.includes('?');
    const sharedContext = isQuestion
        ? `${BASE_SHARED_CONTEXT} Answer the question short and concise: ${linkTitle}`
        : BASE_SHARED_CONTEXT;

    if (!isQuestion && summarizerInstance) return summarizerInstance;

    try {
        if (!window.Summarizer) return null;

        const available = await window.Summarizer.availability();
        if (available === 'no') return null;

        if (!isQuestion) console.log("⏳ Loading model...");
        const summarizer = await window.Summarizer.create({
            type: 'key-points',
            format: 'plain-text',
            length: 'short',
            sharedContext
        });

        if (!isQuestion) {
            summarizerInstance = summarizer;
            console.log("✅ Model loaded!");
        }

        console.log("Shared context:", sharedContext);

        return summarizer;
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

        let text = "";
        const hostname = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } })();

        const selectors = getSelectorsForDomain(hostname);
        // @TODO: Remove this after testing or add debug mode.
        console.log("🔍 Using selectors:", selectors);

        for (const selector of selectors) {
            const containers = Array.from(doc.querySelectorAll(selector));
            if (containers.length === 0) continue;

            // Collect all <p> from every matched container (handles many .article-body__item etc.)
            const paragraphs = containers.flatMap(container =>
                Array.from(container.querySelectorAll('p'))
            );
            if (paragraphs.length > 2) {
                text = paragraphs.map(p => p.innerText).join('\n\n');
                break;
            }
            const fullText = containers.map(c => c.innerText).join('\n\n');
            if (fullText.length > 200) {
                text = fullText;
                break;
            }
        }

        if (text) {
            // @TODO: Remove this after testing or add debug mode.
            console.log("✅ Text found:", text);
            // Collapse multiple spaces/tabs to one space; leave line breaks as-is
            text = text.replace(/[ \t]+/g, ' ').slice(0, 2500);
            // @TODO: Remove this after testing or add debug mode.
            console.log("✅ Text after cleanup:", text);
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
        const linkTitle = link.textContent?.trim() || link.getAttribute('title') || '(no title)';

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

        const ai = await getSummarizer(linkTitle);
        if (ai) {
            try {
                const summary = await ai.summarize(data.text);
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
