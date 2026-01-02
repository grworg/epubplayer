# EPUB Player — Architecture Overview

This document provides a high-level overview of how the EPUB Player application is structured. For the reasoning behind architectural decisions, see the [Architecture Decision Records](./decisions/).

> **Note**: This is a living document. When making significant architectural changes, please update this documentation accordingly. See `.cursor/rules/architecture.mdc` for guidelines.

---

## Table of Contents

1. [Mission & Core Philosophy](#1-mission--core-philosophy)
2. [High-Level Architecture](#2-high-level-architecture)
3. [EPUB Import Pipeline](#3-epub-import-pipeline)
4. [TTS Engine Architecture](#4-tts-engine-architecture)
5. [Buffering System](#5-buffering-system)
6. [Playback System](#6-playback-system)
7. [Storage Architecture](#7-storage-architecture)
8. [Onboarding Flow](#8-onboarding-flow)
9. [Platform Integration](#9-platform-integration)
10. [Directory Structure](#10-directory-structure)

---

## 1. Mission & Core Philosophy

EPUB Player transforms EPUB ebooks into audiobooks using text-to-speech, all running locally in the browser.

**Core principles:**

- **Local-first privacy**: No server, no accounts — data stays on device ([ADR-0001](./decisions/0001-local-first-architecture.md))
- **Audible-level UX**: Fast resume, lock screen controls, background playback
- **Instant gratification**: Press play and hear audio quickly
- **Graceful degradation**: Works offline, adapts to device capabilities

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              USER INTERFACE                              │
│  Landing Page │ Library │ Now Playing │ Settings │ MiniPlayer           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          PLAYBACK ORCHESTRATION                          │
│  PlaybackController ─────► PlaybackStateMachine (ADR-0007)              │
│         │                                                                │
│         └──────────────► TTSBufferManager (background generation)       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            TTS LAYER (ADR-0009)                          │
│  Browser TTS ◄──► ttsManager ◄──► Supertonic/Kokoro/Piper (Web Worker)  │
│  (instant)                              (neural, ADR-0003)              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     STORAGE LAYER (ADR-0005, ADR-0006)                   │
│  IndexedDB: books │ sections │ audioChunks │ playbackState │ settings   │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key components:**

| Component | Purpose |
|-----------|---------|
| PlaybackController | Orchestrates playback, coordinates audio backends and buffering |
| PlaybackStateMachine | Enforces valid state transitions ([ADR-0007](./decisions/0007-playback-state-machine.md)) |
| TTSBufferManager | Background audio generation, keeps cache ahead of playback |
| ttsManager | Abstracts four TTS engines behind unified interface |
| playerStore | Zustand store for UI state ([ADR-0008](./decisions/0008-zustand-for-ui-state.md)) |

---

## 3. EPUB Import Pipeline

**Entry points:**
1. User uploads via file picker
2. Default book installed during onboarding

**Processing flow:**

```
File Input ──► parseEPUB() ──► Save to IndexedDB
                   │
                   ├── Extract metadata (title, author, ID)
                   ├── Extract cover image
                   └── Extract sections (spine items → plain text)
```

**Key design choices:**
- Text normalization at import time (consistent TTS quality)
- Original EPUB blob stored for potential re-export
- Text hash computed per section for cache keying

---

## 4. TTS Engine Architecture

Four engines with automatic recommendation ([ADR-0009](./decisions/0009-four-tts-engines.md)), abstracted behind a capability-based model ([ADR-0010](./decisions/0010-capability-based-tts-abstraction.md)):

| Engine | When to use | Tradeoffs |
|--------|-------------|-----------|
| Browser TTS | Default fallback | Instant, but quality varies by device |
| Supertonic | Quality + speed on any device | Fast neural TTS, ~260MB download |
| Piper | Want neural without GPU | Good quality, experimental |
| Kokoro | WebGPU available | Best quality, ~80MB model download |

**Capability-based abstraction** (see [ADR-0010](./decisions/0010-capability-based-tts-abstraction.md)):
- `TTSEngine` type defined once in `src/services/tts/types.ts`
- Engine registry in `ttsManager` declares capabilities (generatesBlobs, requiresInit, slowOnCPU)
- Consumers query capabilities instead of checking engine names
- Adding a new engine only requires updating `ttsManager.ts`

**Neural TTS runs in Web Workers** ([ADR-0003](./decisions/0003-web-workers-for-tts.md)) to keep UI responsive.

**Chunking** ([ADR-0004](./decisions/0004-sentence-boundary-chunking.md)):
- Text split at sentence boundaries (~300 chars target)
- Never splits mid-sentence
- Each chunk gets stable text hash for caching

---

## 5. Buffering System

**Browser TTS**: No buffering — speaks in real-time.

**Supertonic/Kokoro/Piper**: `TTSBufferManager` runs a background loop:

1. Check if TTS engine is ready
2. Check storage quota (pause if nearly full)
3. Compute target chunks based on buffer mode (minutes/chapter/book)
4. Find first uncached chunk in target
5. Generate it (or wait if already in-flight)
6. Save to IndexedDB, repeat

**Deduplication**: In-flight generation promises are shared between foreground playback and background buffering — no duplicate work.

---

## 6. Playback System

**State machine** ([ADR-0007](./decisions/0007-playback-state-machine.md)):

```
idle ──LOAD_BOOK──► loading ──LOADED──► ready ──PLAY──► playing
                                          ▲                │
                                          │           PAUSE│
                                     CHUNK_ENDED           ▼
                                          │            paused
                                          │                │
                                     ◄────┴────────────────┘
```

**Audio backends:**
- `BrowserTTSBackend`: Web Speech API with silent keepalive for Media Session
- `AudioBlobBackend`: HTMLAudioElement for pre-generated WAV blobs

**Resume behavior:**
- Position saved every second (debounced)
- On load, `timeInChunk` is restored and audio seeks to that position

---

## 7. Storage Architecture

**IndexedDB with Dexie** ([ADR-0005](./decisions/0005-indexeddb-with-dexie.md)):

| Table | Purpose |
|-------|---------|
| `books` | Metadata, cover blob, original EPUB |
| `sections` | Extracted text per chapter |
| `audioChunks` | Cached WAV blobs |
| `playbackStates` | Per-book position and settings |
| `bookmarks` | User bookmarks |
| `settings` | Key-value app settings |

**Two-tier audio cache** ([ADR-0006](./decisions/0006-two-tier-audio-cache.md)):
1. Position-specific: `bookId + section + chunk + voice + model + textHash`
2. Global text hash: `textHash + voice + model`

This enables cache reuse when re-importing books or when identical text appears in multiple places.

---

## 8. Onboarding Flow

```
Welcome ──► Engine Selection ──► Installing Sample Book ──► Library
              │
              └── Checks WebGPU, recommends appropriate engine
```

**What happens:**
1. Device capability check (WebGPU, Web Speech API)
2. Engine recommendation based on capabilities
3. Settings initialized with sensible defaults
4. Sample book (Alice in Wonderland) installed
5. `hasCompletedOnboarding` flag set

---

## 9. Platform Integration

**Media Session API:**
- Lock screen controls (play/pause, skip, chapter navigation)
- Background playback on mobile
- Cover art and metadata display

**PWA:**
- Service worker caches static assets
- Installable on mobile home screens
- Works offline after initial load

---

## 10. Directory Structure

```
src/
├── app/                       # App shell, routing
├── features/
│   ├── import/                # EPUB import
│   ├── library/               # Book list and detail views
│   ├── onboarding/            # First-run wizard
│   ├── player/                # Playback system
│   │   ├── audioBackends/     # TTS playback implementations
│   │   ├── PlaybackController.ts
│   │   ├── PlaybackStateMachine.ts
│   │   ├── TTSBufferManager.ts
│   │   └── playerStore.ts
│   ├── settings/              # User preferences
│   └── pwa/                   # Install prompt
├── services/
│   ├── epub/                  # EPUB parsing
│   ├── storage/               # IndexedDB repositories
│   ├── tts/                   # TTS engine services
│   └── defaultBooks/          # Sample book installation
└── ui/                        # Shared components, icons
```

---

## Related Documentation

- **[Architecture Decision Records](./decisions/)** — Why decisions were made
- **[Product Spec](../PRODUCT_SPEC.md)** — Feature requirements and UX goals
- **[Project Rules](../.cursor/rules/project.mdc)** — Development guidelines
