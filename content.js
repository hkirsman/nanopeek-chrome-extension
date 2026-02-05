console.log("👁️ NanoPeek: Ready!");

// ==========================================
// 1. CONFIG & HELPERS
// ==========================================

// Language hint from URL
function getLangHintFromUrl(url) {
    const hostname = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } })();
    if (hostname.endsWith('.ee')) return 'et';
    if (hostname.endsWith('.fi')) return 'fi';
    return 'en';
}

function getLoadingMessage(lang) {
    if (lang === 'et') return 'Teen kokkuvõtet...';
    if (lang === 'fi') return 'Teen yhteenvedon...';
    return 'Summarizing...';
}

/**
 * Article body selectors per domain.
 * NOTE: This is your "Lightweight Readability" replacement.
 */
function getSelectorsForDomain(hostname) {
    const h = (hostname || '').toLowerCase();
    if (h === 'postimees.ee' || h.endsWith('.postimees.ee')) {
        return ['article:first-of-type .article-body .article-body__item'];
    }
    if (h === 'delfi.ee' || h.endsWith('.delfi.ee')) {
        return ['div.article:first-of-type .fragment-html'];
    }
    // Generic fallbacks
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

/**
 * REFACTORED: Extracts text from ANY document object (current page or fetched HTML)
 */
function extractTextFromDoc(doc, url) {
    let text = "";
    const hostname = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } })();
    const selectors = getSelectorsForDomain(hostname);

    for (const selector of selectors) {
        const containers = Array.from(doc.querySelectorAll(selector));
        if (containers.length === 0) continue;

        // Strategy 1: Look for paragraphs
        const paragraphs = containers.flatMap(container =>
            Array.from(container.querySelectorAll('p'))
        );
        if (paragraphs.length > 2) {
            text = paragraphs.map(p => p.innerText).join('\n\n');
            break;
        }

        // Strategy 2: Raw text if paragraphs fail
        const fullText = containers.map(c => c.innerText).join('\n\n');
        if (fullText.length > 200) {
            text = fullText;
            break;
        }
    }

    if (text) {
        // Cleanup: Collapse multiple spaces, limit length
        // @TODO: Check how to split this for the summarizer.
        return text.replace(/[ \t]+/g, ' ').slice(0, 20000); // Increased limit slightly
    }
    return null;
}

// Helper to talk to proxy.js -> background.js (Existing code)
function fetchViaBackground(url) {
    return new Promise((resolve, reject) => {
        const requestId = Math.random().toString(36).substring(7);
        let timeoutId;

        const listener = (event) => {
            if (event.source !== window || !event.data || event.data.type !== "GIST_FETCH_RESPONSE") return;
            if (event.data.id !== requestId) return;
            clearTimeout(timeoutId);
            window.removeEventListener("message", listener);
            event.data.success ? resolve(event.data.html) : reject(new Error(event.data.error));
        };

        window.addEventListener("message", listener);
        window.postMessage({ type: "GIST_FETCH_REQUEST", url: url, id: requestId }, "*");
        timeoutId = setTimeout(() => {
            window.removeEventListener("message", listener);
            reject(new Error("Timeout: Server didn't respond."));
        }, 5000);
    });
}

const tooltip = document.createElement('div');
tooltip.id = 'gist-tooltip';
document.body.appendChild(tooltip);

/**
 * Build shared-context prefix from detected language so the model summarizes in that language.
 *
 * @todo Not quite sure if this is working as expected. More testing needed.
 */
function getSharedContextPrefix(lang) {
    const code = (lang || '').toLowerCase().split('-')[0];
    if (code === 'et') return 'If the input language is Estonian, summarize in Estonian.';
    if (code === 'fi') return 'If the input language is Finnish, summarize in Finnish.';
    if (code === 'sv') return 'If the input language is Swedish, summarize in Swedish.';
    if (code === 'no') return 'If the input language is Norwegian, summarize in Norwegian.';
    if (code === 'da') return 'If the input language is Danish, summarize in Danish.';
    if (code === 'nl') return 'If the input language is Dutch, summarize in Dutch.';
    if (code === 'de') return 'If the input language is German, summarize in German.';
    if (code === 'fr') return 'If the input language is French, summarize in French.';
    if (code === 'es') return 'If the input language is Spanish, summarize in Spanish.';
    if (code === 'it') return 'If the input language is Italian, summarize in Italian.';
    return 'Summarize in English.';
}

let summarizerByLang = {};

// 2. AI initialization. Pass linkTitle when the link is a question (title contains '?') to amend sharedContext. Pass lang to set language-specific instruction.
async function getSummarizer(linkTitle, lang) {
    const isQuestion = linkTitle && linkTitle.includes('?');
    const prefix = getSharedContextPrefix(lang);
    const sharedContext = isQuestion
        ? `${prefix} Answer the question briefly and concisely: ${linkTitle}`
        : prefix;

    if (!isQuestion && summarizerByLang[lang]) return summarizerByLang[lang];

    try {
        if (!window.Summarizer) return null;
        const available = await window.Summarizer.availability();
        if (available === 'no') return null;

        const summarizer = await window.Summarizer.create({
            type: 'key-points',
            format: 'markdown', // Markdown looks better in page summary
            length: 'medium',   // Medium is better for full pages
            sharedContext
        });

        if (!isQuestion) {
            summarizerByLang[lang] = summarizer;
            console.log("✅ Model loaded!");
        }
        return summarizer;
    } catch (e) {
        console.error("AI Error:", e);
        return null;
    }
}

// Fetch content for LINK HOVER
async function fetchLinkText(url) {
    try {
        const html = await fetchViaBackground(url);
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        // Detect Language
        const rawHtmlLang = doc.documentElement.getAttribute('lang');
        const metaLocale = doc.querySelector('meta[property="og:locale"]')?.getAttribute('content');
        let lang = rawHtmlLang || metaLocale || '';
        lang = lang.split('-')[0].toLowerCase();
        if (!lang) lang = getLangHintFromUrl(url);

        // Extract Text using the Refactored Function
        const text = extractTextFromDoc(doc, url);

        console.log("fetchLinkText -> extractTextFromDoc:", text);

        return text ? { text, lang } : null;
    } catch (e) {
        console.error("Fetch Error:", e);
        return null;
    }
}

// ==========================================
// 3. UI: TOOLTIP (Hover)
// ==========================================

let hoverTimeout, closeTimeout;
let lastMouseX = 0, lastMouseY = 0;

document.addEventListener('mousemove', (e) => { lastMouseX = e.clientX; lastMouseY = e.clientY; }, { passive: true });

document.addEventListener('mouseover', (e) => {
    if (tooltip.contains(e.target)) return;
    const link = e.target.closest('a');
    if (!link || !e.shiftKey) return;

    clearTimeout(closeTimeout);
    clearTimeout(hoverTimeout);

    hoverTimeout = setTimeout(async () => {
        const url = link.href;
        const linkTitle = link.textContent?.trim() || link.getAttribute('title');

        const rect = link.getBoundingClientRect();
        tooltip.style.top = `${window.scrollY + rect.bottom + 4}px`;
        tooltip.style.left = `${window.scrollX + rect.left}px`;
        tooltip.innerHTML = `<div class="gist-loading">✨ ${getLoadingMessage(getLangHintFromUrl(url))}</div>`;
        tooltip.classList.add('visible');

        const data = await fetchLinkText(url);
        if (!data) {
            tooltip.innerHTML = `<div class="gist-error">❌ No readable text found.</div>`;
            return;
        }

        const ai = await getSummarizer(linkTitle, data.lang);
        if (ai) {
            try {
                const summary = await ai.summarize(data.text);
                tooltip.innerHTML = `<span class="gist-title">NanoPeek (${data.lang.toUpperCase()})</span>${summary}`;
            } catch (err) {
                tooltip.innerHTML = `<div class="gist-error">❌ AI Error: ${err.message}</div>`;
            }
        }
    }, 600);
});

document.addEventListener('mouseout', (e) => {
    const target = e.target;
    const related = e.relatedTarget;
    const isInsideLink = target.closest('a');
    const isInsideTooltip = tooltip.contains(target);
    const goingToTooltip = related && tooltip.contains(related);
    const goingToLink = related && related.closest('a');

    if ((isInsideLink && goingToTooltip) || (isInsideTooltip && goingToLink) || (isInsideTooltip && goingToTooltip)) {
        clearTimeout(closeTimeout);
        return;
    }

    clearTimeout(hoverTimeout);
    closeTimeout = setTimeout(() => {
        const r = tooltip.getBoundingClientRect();
        const overTooltip = lastMouseX >= r.left && lastMouseX <= r.right && lastMouseY >= r.top && lastMouseY <= r.bottom;
        if (!overTooltip) tooltip.classList.remove('visible');
    }, 400);
});

// ==========================================
// 4. UI: PAGE SUMMARY BUTTON
// ==========================================

// Create the floating button (accessible: role, aria-label, tabindex, keyboard)
const pageBtn = document.createElement('div');
pageBtn.id = 'nano-page-btn';
pageBtn.setAttribute('role', 'button');
pageBtn.setAttribute('aria-label', 'Summarize this page');
pageBtn.setAttribute('tabindex', '0');
pageBtn.title = 'Summarize this page';
pageBtn.innerHTML = '<span>✨</span>';
document.body.appendChild(pageBtn);

// Create the Modal for page summary
const modal = document.createElement('div');
modal.id = 'nano-page-modal';
modal.innerHTML = `
    <div class="nano-modal-content">
        <div class="nano-header">
            <h3>Page Summary</h3>
            <button id="nano-close-btn">&times;</button>
        </div>
        <div id="nano-modal-body"></div>
    </div>
`;
document.body.appendChild(modal);

// Run page summary (shared by click and keyboard activation)
async function openPageSummary() {
    const output = document.getElementById('nano-modal-body');
    modal.classList.add('visible');
    output.innerHTML = '<div class="gist-loading">Reading page content...</div>';

    // 1. Get Text from CURRENT document
    // We pass document and current URL
    const text = extractTextFromDoc(document, window.location.href);

    console.log("pageBtn.addEventListener -> extractTextFromDoc:", text);

    if (!text) {
        output.innerHTML = '<div class="gist-error">Could not find main article content on this page.</div>';
        return;
    }

    output.innerHTML = `<div class="gist-loading">${getLoadingMessage('en')}</div>`;

    // 2. Get AI
    const ai = await getSummarizer(document.title);

    if (ai) {
        try {
            // 3. Summarize
            // Streaming is nicer for long page summaries if available, but let's stick to await for now
            const summary = await ai.summarize(text);

            // Convert simple markdown to HTML for display (optional, or just use pre-wrap)
            // Simple, intentionally limited formatter: the AI is instructed to only use
            // **bold** text and `*` bullet lists in its output. Other markdown elements
            // (headings, links, code blocks, etc.) are not expected and will be shown as plain text.
            const formatted = summary
                .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
                .replace(/^\* /gm, '• ');

            output.innerHTML = `<div style="white-space: pre-wrap; line-height: 1.6;">${formatted}</div>`;
        } catch (err) {
            output.innerHTML = `<div class="gist-error">AI Error: ${err.message}</div>`;
        }
    } else {
        output.innerHTML = `<div class="gist-error">AI not available.</div>`;
    }
}

pageBtn.addEventListener('click', () => openPageSummary());

pageBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPageSummary();
    }
});

// Close Modal Logic
document.getElementById('nano-close-btn').addEventListener('click', () => {
    modal.classList.remove('visible');
});

modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('visible');
});
