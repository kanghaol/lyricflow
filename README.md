# lyricflow
> A lightweight, cross-tab Chrome Extension built with **Manifest V3** that synchronizes real-time, timed Spotify lyrics as a customizable floating overlay across any active browser tab.

---

## 🌟 Key Features

* **⏱️ Synchronized Time-Synced Lyrics:** Automatically syncs track progress with the **LRCLIB API** to display live, scrolling `.lrc` lyrics.
* **📌 Cross-Tab Floating Overlay:** View synchronized lyrics anywhere on the web without keeping the Spotify Web Player tab in focus.
* **🛡️ Shadow DOM Isolation:** Encapsulates styles within a Web Component boundary, preventing third-party website CSS from clashing with the extension UI.
* **⚡ Caching Pipeline:** Leverages an **In-Memory Cache**, **`chrome.storage.local`**, and fallback REST requests to minimize API network usage and deliver instantaneous rendering.
* **🔄 SPA Navigation Tracking:** Uses a JavaScript `MutationObserver` to track Spotify's Single Page Application state changes dynamically without page reloads.
* **⏳ Request Debouncing:** Features a 1.5-second debounce buffer to handle fast scrubbing and song skipping gracefully.

---

## 🔗 Links & Resources


* 🌐 **Chrome Web Store:** [Chrome Extension Link](https://chromewebstore.google.com/detail/lyricflow/onfinbognhiboggdmbpohjgfnddpnnen?authuser=0&hl=en)
* 🌐 **Edge Web Store:** [Edge Extension Link](https://microsoftedge.microsoft.com/addons/detail/lyricflow/jjoibnmdijpjkfndlbgboilkchncjkcb)
