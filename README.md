# 👁️ NanoPeek - Chrome AI Link Previews

**NanoPeek** is a lightweight Chrome Extension that generates instant
3-bullet-point summaries of news articles when you hover over a link.

It runs **100% locally** using Chrome's built-in **Gemini Nano** model.
No API keys, no cloud subscriptions, and complete privacy.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Chrome](https://img.shields.io/badge/Chrome-Canary%2FDev-red)
![AI](https://img.shields.io/badge/Model-Gemini%20Nano-purple)

## ✨ Features

*   **⚡ Zero Latency:** Uses `window.ai` / `window.Summarizer` (Gemini Nano)directly in the browser.
*   **🔒 Private:** No browsing history is sent to external servers (OpenAI/Anthropic).
*   **🌍 Language Aware:** Automatically detects if an article is in **Estonian** or **English** and summarizes in the correct language.
*   **🌉 Cross-Origin Support:** Custom "Bridge" architecture allows fetching summaries from any domain (works on Delfi, ERR, Postimees, CNN, etc.).
*   **⌨️ Intent-Based:** Triggers only when holding `Shift` + Hover (prevents annoyance).

## 🛠️ Prerequisites

Because this uses Chrome's experimental Built-in AI, you need a version of Chrome that supports it (currently **Chrome Canary** or **Dev** recommended).

1.  Open `chrome://flags`
2.  Enable the following flags:
    *   `#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement**
    *   `#prompt-api-for-gemini-nano` → **Enabled**
    *   `#summarization-api-for-gemini-nano` → **Enabled**
3.  Relaunch Chrome.
4.  Go to `chrome://components`, find **Optimization Guide On Device Model**, and ensure it is updated/downloaded (approx. 1.5GB).

## 📦 Installation

1.  **Clone this repository:**
    ```bash
    git clone https://github.com/yourusername/nanopeek.git
    ```
2.  Open Chrome and go to `chrome://extensions`.
3.  Enable **Developer mode** (top right toggle).
4.  Click **Load unpacked**.
5.  Select the `nanopeek` folder.

## 🚀 Usage

1.  Go to a news site (e.g., [err.ee](https://err.ee) or [delfi.ee](https://delfi.ee)).
2.  Hold the **Shift** key.
3.  **Hover** your mouse over a news headline.
4.  Wait ~600ms for the "✨ Reading article..." tooltip to appear.

## 🏗️ Architecture

This extension uses a specific architecture to bypass CORS (Cross-Origin Resource Sharing) restrictions while maintaining security:

*   **`content.js` (Main World):** Handles UI (Tooltip), detects `Shift` key, and communicates with the AI model (`window.Summarizer`).
*   **`proxy.js` (Isolated World):** Acts as a middleman between the web page and the extension background.
*   **`background.js`:** Performs the actual `fetch()` request to external news sites to retrieve article HTML.

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.

---
*Built with <3 in Estonia.*
