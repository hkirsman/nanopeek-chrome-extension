console.log("🚀 Tweetify AI (Language Aware): Valmis!");

// 1. Loome mulli (Tooltip)
const tooltip = document.createElement('div');
tooltip.id = 'gist-tooltip';
document.body.appendChild(tooltip);

let summarizerInstance = null;

// 2. AI Käivitamine
async function getSummarizer() {
    if (summarizerInstance) return summarizerInstance;

    try {
        if (!window.Summarizer) return null;

        const available = await window.Summarizer.availability();
        if (available === 'no') return null;

        console.log("⏳ Laen mudelit...");
        // Kasutame 'key-points', see töötab sinu versiooniga kõige paremini
        summarizerInstance = await window.Summarizer.create({
            type: 'key-points',
            format: 'plain-text',
            length: 'short'
        });

        console.log("✅ Mudel laetud!");
        return summarizerInstance;
    } catch (e) {
        console.error("AI Error:", e);
        return null;
    }
}

// 3. Teksti ja KEELE hankimine
async function fetchLinkText(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Network response was not ok");

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        // A) Tuvastame keele
        let lang = doc.documentElement.lang || 'et'; // Vaikimisi eesti
        // Puhastame (nt 'et-EE' -> 'et')
        lang = lang.split('-')[0].toLowerCase();

        console.log("🌍 Tuvastatud keel:", lang);

        // B) Leiame sisu
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

// 4. Peamine sündmus
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
        console.log("🤖 Analüüsin linki:", url);

        // Kuva laadija
        const rect = link.getBoundingClientRect();
        tooltip.style.top = `${window.scrollY + rect.bottom + 10}px`;
        tooltip.style.left = `${window.scrollX + rect.left}px`;
        tooltip.innerHTML = `<div class="gist-loading">✨ Loen artiklit...</div>`;
        tooltip.classList.add('visible');

        // Tõmba andmed
        const data = await fetchLinkText(url);

        if (!data) {
            tooltip.innerHTML = `<div class="gist-error">❌ Teksti ei leitud.</div>`;
            return;
        }

        const ai = await getSummarizer();
        if (ai) {
            try {
                // --- KEELE MAAGIA SIIN ---
                // Kuna Summarizer API on tihti inglisekeskne, siis me "petame" teda,
                // lisades teksti algusesse konkreetse käsu.

                let promptPrefix = "";
                if (data.lang === 'et') {
                    promptPrefix = "Kirjuta kokkuvõte eesti keeles. Tou välja peamised faktid:\n\n";
                    console.log("🇪🇪 Eesti keeles");
                } else {
                    promptPrefix = "Summarize this text in English:\n\n";
                    console.log("🇺🇸 Inglise keeles");
                }

                const inputText = promptPrefix + data.text;

                // Küsi AI-lt
                const summary = await ai.summarize(inputText);

                tooltip.innerHTML = `<span class="gist-title">AI Kokkuvõte (${data.lang}):</span>${summary}`;
            } catch (err) {
                tooltip.innerHTML = `<div class="gist-error">❌ AI Viga: ${err.message}</div>`;
            }
        } else {
             tooltip.innerHTML = `<div class="gist-error">❌ AI mudel ei käivitunud.</div>`;
        }

    }, 600);
});

document.addEventListener('mouseout', () => {
    clearTimeout(hoverTimeout);
    tooltip.classList.remove('visible');
});
