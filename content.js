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

/** Detect language from a document (and optional URL fallback). Returns normalized code (e.g. "en"). */
function getDetectedLang(doc, url, defaultLang = '') {
    const htmlLang = doc.documentElement.getAttribute('lang');
    const metaLocale = doc.querySelector('meta[property="og:locale"]')?.getAttribute('content');
    let lang = htmlLang || metaLocale || '';
    lang = (typeof lang === 'string' ? lang : '').split('-')[0].toLowerCase();
    if (!lang) lang = url ? getLangHintFromUrl(url) : '';
    if (!lang && defaultLang) lang = defaultLang;
    return lang || '';
}

function getLoadingMessage(lang) {
    if (lang === 'et') return 'Teen kokkuvõtet...';
    if (lang === 'fi') return 'Teen yhteenvedon...';
    return 'Summarizing...';
}

function getModalTitle(lang) {
    const code = (lang || '').toLowerCase().split('-')[0];
    if (code === 'et') return 'Lehe kokkuvõte';
    if (code === 'fi') return 'Sivun yhteenveto';
    if (code === 'de') return 'Seitenzusammenfassung';
    if (code === 'fr') return 'Résumé de la page';
    if (code === 'es') return 'Resumen de la página';
    if (code === 'sv') return 'Sidsammanfattning';
    return 'Page Summary';
}

/**
 * Article body selectors per domain.
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
 * Extracts text from ANY document object (current page or fetched HTML)
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
        return text.replace(/[ \t]+/g, ' ').slice(0, 20000);
    }
    return null;
}

/**
 * Robust Markdown Parser (Better than simple replace)
 */
function simpleMarkdown(text) {
    // 1. Handle Headers (### Header)
    let html = text
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // 2. Handle Bold (**text**)
    html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

    // 3. Handle Italics (*text*) - careful not to break lists
    html = html.replace(/(^|[^\\])\*([^\s\*].*?[^\s\*])\*/g, '$1<i>$2</i>');

    // 4. Handle Lists (* Item or - Item)
    html = html.replace(/^\s*[\-\*] /gm, '• ');

    return html;
}

// Helper to talk to proxy.js -> background.js
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

// ==========================================
// 2. AI & LOGIC
// ==========================================

function getSharedContextPrefix(lang) {
    const code = (lang || '').toLowerCase().split('-')[0];
    if (code === 'et') return 'Kui sisendkeel on eesti keel, tee kokkuvõte eesti keeles.';
    if (code === 'fi') return 'Jos syötekieli on suomi, tee yhteenveto suomeksi.';
    if (code === 'sv') return 'Om inmatningsspråket är svenska, sammanfatta på svenska.';
    if (code === 'no') return 'Hvis inndataspråket er norsk, oppsummer på norsk.';
    if (code === 'da') return 'Hvis inputsproget er dansk, opsummer på dansk.';
    if (code === 'nl') return 'Als de invoertaal Nederlands is, vat dan samen in het Nederlands.';
    if (code === 'de') return 'Wenn die Eingabesprache Deutsch ist, fassen Sie auf Deutsch zusammen.';
    if (code === 'fr') return 'Si la langue d\'entrée est le français, résumez en français.';
    if (code === 'es') return 'Si el idioma de entrada es el español, resume en español.';
    if (code === 'it') return 'Se la lingua di input è l\'italiano, riassumi in italiano.';
    return 'If the input language is not English, summarize in English.';
}

/** Map our lang code to Summarizer API supported output languages: en, es, ja. */
function getSummarizerOutputLanguage(lang) {
    const code = (lang || '').toLowerCase().split('-')[0];
    if (code === 'es') return 'es';
    if (code === 'ja') return 'ja';
    return 'en';
}

let summarizerByLang = {};

async function getSummarizer(linkTitle, lang) {
    const isQuestion = linkTitle && linkTitle.includes('?');
    const prefix = getSharedContextPrefix(lang);
    const sharedContext = isQuestion
        ? `${prefix} Answer the question briefly and concisely: ${linkTitle}`
        : prefix;

    // Use cached instance only if not a question
    if (!isQuestion && summarizerByLang[lang]) return summarizerByLang[lang];

    try {
        if (!window.Summarizer) return null;

        const outputLanguage = getSummarizerOutputLanguage(lang);

        console.log('sharedContext', sharedContext);
        const summarizer = await window.Summarizer.create({
            type: 'key-points',
            // Markdown looks better in page summary.
            format: 'markdown',
            // Medium is better for full pages.
            length: 'medium',
            sharedContext,
        });

        if (!isQuestion) {
            summarizerByLang[lang] = summarizer;
            console.log(`✅ Model loaded for lang: ${lang}`);
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

        const lang = getDetectedLang(doc, url);
        const text = extractTextFromDoc(doc, url);
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
                tooltip.innerHTML = `<span class="gist-title">NanoPeek (${data.lang.toUpperCase()})</span>`;
                const summaryContainer = document.createElement('div');
                summaryContainer.className = 'gist-summary';
                summaryContainer.textContent = summary;
                tooltip.appendChild(summaryContainer);
            } catch (err) {
                tooltip.innerHTML = '<div class="gist-error"></div>';
                const errorEl = tooltip.querySelector('.gist-error');
                if (errorEl) errorEl.textContent = `❌ AI Error: ${err.message}`;
            }
        } else {
            tooltip.innerHTML = '<div class="gist-error"></div>';
            const errorEl = tooltip.querySelector('.gist-error');
            if (errorEl) errorEl.textContent = '❌ AI model unavailable.';
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

// Create the Modal for page summary (ARIA: dialog, labelledby, focus trap, Escape)
const modal = document.createElement('div');
modal.id = 'nano-page-modal';
modal.setAttribute('role', 'dialog');
modal.setAttribute('aria-modal', 'true');
modal.setAttribute('aria-labelledby', 'nano-modal-title');
modal.setAttribute('aria-hidden', 'true');
modal.innerHTML = `
    <div class="nano-modal-content">
        <div class="nano-header">
            <h3 id="nano-modal-title">Page Summary</h3>
            <button id="nano-close-btn" type="button" aria-label="Close">&times;</button>
        </div>
        <div id="nano-modal-body"></div>
    </div>
`;
document.body.appendChild(modal);

const closeBtn = document.getElementById('nano-close-btn');

function getModalFocusables() {
    return Array.from(modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
}

function closeModal() {
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');
    pageBtn.focus();
}

document.addEventListener('keydown', (e) => {
    if (!modal.classList.contains('visible')) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
        return;
    }
    if (e.key !== 'Tab' || !modal.contains(document.activeElement)) return;
    const focusables = getModalFocusables();
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey) {
        if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
        }
    } else {
        if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
});

// Run page summary (shared by click and keyboard activation)
async function openPageSummary() {
    const output = document.getElementById('nano-modal-body');
    modal.classList.add('visible');
    modal.setAttribute('aria-hidden', 'false');
    output.innerHTML = '<div class="gist-loading">Reading page content...</div>';
    closeBtn.focus();

    // 1. Get Text from CURRENT document
    const text = extractTextFromDoc(document, window.location.href);

    if (!text) {
        output.innerHTML = '<div class="gist-error">Could not find main article content on this page.</div>';
        return;
    }

    const pageLang = getDetectedLang(document, window.location.href, 'en');
    document.getElementById('nano-modal-title').textContent = getModalTitle(pageLang);

    output.innerHTML = `<div class="gist-loading">${getLoadingMessage(pageLang)}</div>`;

    const ai = await getSummarizer(document.title, pageLang);

    if (ai) {
        try {
            // 3. Summarize
            const summary = await ai.summarize(text);

            // Use the robust markdown parser
            const formatted = simpleMarkdown(summary);

            output.innerHTML = `<div style="white-space: pre-wrap; line-height: 1.6;">${formatted}</div>`;
        } catch (err) {
            output.innerHTML = '<div class="gist-error"></div>';
            const errorEl = output.querySelector('.gist-error');
            if (errorEl) errorEl.textContent = `AI Error: ${err.message}`;
        }
    } else {
        output.innerHTML = '<div class="gist-error"></div>';
        const errorEl = output.querySelector('.gist-error');
        if (errorEl) errorEl.textContent = 'AI not available.';
    }
}

pageBtn.addEventListener('click', () => openPageSummary());

pageBtn.addEventListener('keydown', (e) => {
    if (!pageBtn.contains(e.target)) return;
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPageSummary();
    }
});

closeBtn.addEventListener('click', () => closeModal());

modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
});
