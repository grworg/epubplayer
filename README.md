# EPUB Player

**Turn your EPUBs into audiobooks with neural text-to-speech — entirely in your browser.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## What is this?

EPUB Player is a free, open-source Progressive Web App (PWA) that transforms your EPUB ebooks into audiobooks using AI-powered text-to-speech. Everything runs locally in your browser — your books never leave your device.

**No accounts. No uploads. No subscriptions. Just your books, as audio.**

### Features

- 📚 **Import any EPUB** — drag and drop or select files
- 🎙️ **Neural TTS** — natural-sounding voices via Kokoro (WebGPU/WASM)
- 🔒 **100% local** — your books never leave your device
- 📱 **Works everywhere** — phone, tablet, desktop
- ✈️ **Offline support** — listen anywhere after first load
- ⏱️ **Full audiobook controls** — bookmarks, speed control, sleep timer
- 🎨 **Lock screen controls** — Media Session API integration
- 💾 **Audio caching** — generated audio is saved for instant replay

### TTS Engines

| Engine | Quality | Speed | Requirements |
|--------|---------|-------|--------------|
| **Kokoro** | ★★★★★ | Moderate | WebGPU (best) or WASM fallback |
| **Supertonic** | ★★★★☆ | Fast | WebGPU |
| **Piper** | ★★★☆☆ | Fast | WASM |
| **Browser TTS** | ★★☆☆☆ | Instant | Built-in (varies by device) |

---

## Try It

**[→ Try EPUB Player](https://epubplayer.app)** *(coming soon)*

Or run it locally:

```bash
# Clone the repository
git clone https://github.com/grworg/epubplayer.git
cd epubplayer

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Development

### Prerequisites

- Node.js 18+
- npm 9+

### Commands

```bash
npm run dev          # Start dev server
npm run dev:host     # Start dev server accessible on LAN (for phone testing)
npm run build        # Production build
npm run preview      # Preview production build
npm run typecheck    # TypeScript check
npm run lint         # ESLint
npm run format       # Prettier
npm run test         # Run unit tests
npm run test:e2e     # Run Playwright e2e tests
```

### Testing on Mobile

For the best mobile debugging experience with WebGPU:

1. Connect your phone via USB
2. Enable USB debugging on the phone
3. Open `chrome://inspect/#devices` on desktop Chrome
4. Enable port forwarding: `localhost:5173` → `127.0.0.1:5173`
5. Open `http://localhost:5173` on your phone

This keeps the origin as `localhost`, which is required for WebGPU to work.

---

## Architecture

EPUB Player is built with:

- **React 19** + TypeScript
- **Vite** (with PWA plugin)
- **Tailwind CSS v4**
- **Zustand** (state management)
- **Dexie** (IndexedDB wrapper)
- **Web Workers** (TTS generation off main thread)

### Project Structure

```
src/
├── app/              # App shell, routing
├── features/         # Feature modules
│   ├── library/      # Book library & import
│   ├── player/       # Playback, buffering, audio backends
│   ├── settings/     # User preferences
│   └── ...
├── services/
│   ├── storage/      # IndexedDB repositories
│   ├── tts/          # TTS engines, workers
│   └── epub/         # EPUB parsing
└── ui/               # Shared components, icons
```

For detailed architecture documentation, see [docs/architecture.md](docs/architecture.md).

For the reasoning behind design decisions, see the [Architecture Decision Records](docs/decisions/).

---

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) before submitting a PR.

### Quick Start for Contributors

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-thing`
3. Make your changes
4. Run checks: `npm run typecheck && npm run lint`
5. Commit with a clear message
6. Push and open a Pull Request

---

## Privacy

EPUB Player is designed with privacy as a core principle:

- **No accounts** — nothing to sign up for
- **No server** — the app is purely client-side
- **No uploads** — your books stay on your device
- **No analytics** — we don't track you
- **No ads** — ever

Your data is stored in your browser's IndexedDB and never transmitted anywhere.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [Kokoro TTS](https://github.com/hexgrad/kokoro) — Neural text-to-speech model
- [epub.js](https://github.com/futurepress/epub.js) — EPUB parsing
- [Dexie.js](https://dexie.org/) — IndexedDB wrapper

---

<p align="center">
  Made with ❤️ for audiobook lovers everywhere
</p>
