console.log("🚀 Tweetify AI (Language Aware): Ready!");

// 1. Create the tooltip bubble.
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
        const response = await fetch(url);
        if (!response.ok) throw new Error("Network response was not ok");

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        // A) Detect language
        let lang = doc.documentElement.lang || 'et'; // Default to Estonian
        // Normalize (e.g. 'et-EE' -> 'et')
        lang = lang.split('-')[0].toLowerCase();

        console.log("🌍 Detected language:", lang);

        // B) Find main content
        const selectors = ['article', '.article-body', '.post-content', 'main', 'body'];
        let text = "";

        for (const selector of selectors) {
            const element = doc.querySelector(selector);
            if (element && element.innerText.length > 200) {
                text = element.innerText
                        .replace(/\s+/g, ' ')
                        .slice(0, 2500);
                break;
            }
        }

        if (!text) return null;

        return { text, lang }; // Tagastame nüüd objekti!

    } catch (e) {
        console.error("Fetch Error:", e);
        return null;
    }
}

// 4. Main hover event.
let hoverTimeout;

document.addEventListener('mouseover', (e) => {
    const link = e.target.closest('a');

    if (!link || !e.shiftKey) {
        tooltip.classList.remove('visible');
        clearTimeout(hoverTimeout);
        return;
    }

    clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(async () => {
        const url = link.href;
        console.log("🤖 Analyzing link:", url);

        // Show loading state.
        const rect = link.getBoundingClientRect();
        tooltip.style.top = `${window.scrollY + rect.bottom + 10}px`;
        tooltip.style.left = `${window.scrollX + rect.left}px`;
        tooltip.innerHTML = `<div class="gist-loading">✨ Reading article...</div>`;
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
                    promptPrefix = "Write a summary in Estonian. Highlight the key facts:\n\n";
                    console.log("🇪🇪 In Estonian");
                } else {
                    promptPrefix = "Summarize this text in English:\n\n";
                    console.log("🇺🇸 In English");
                }

                const inputText = promptPrefix + data.text;

                // Ask the AI for a summary.
                const summary = await ai.summarize(inputText);

                tooltip.innerHTML = `<span class="gist-title">AI Summary (${data.lang}):</span>${summary}`;
            } catch (err) {
                tooltip.innerHTML = `<div class="gist-error">❌ AI Error: ${err.message}</div>`;
            }
        } else {
             tooltip.innerHTML = `<div class="gist-error">❌ AI model did not start.</div>`;
        }

    }, 600);
});

document.addEventListener('mouseout', () => {
    clearTimeout(hoverTimeout);
    tooltip.classList.remove('visible');
});
