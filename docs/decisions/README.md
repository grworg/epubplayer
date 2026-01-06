# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the EPUB Player project.

## What is an ADR?

An Architecture Decision Record captures a significant architectural decision along with its context and consequences. ADRs help us:

- **Remember why** decisions were made (not just what)
- **Onboard new developers** quickly
- **Evaluate past decisions** when circumstances change
- **Avoid revisiting** settled debates without new information

## Index

| ID | Title | Status | Date |
|----|-------|--------|------|
| [ADR-0001](./0001-local-first-architecture.md) | Local-First Architecture | Accepted | 2025-01-01 |
| [ADR-0002](./0002-three-tts-engines.md) | Three TTS Engines with Graceful Fallback | Superseded | 2025-01-01 |
| [ADR-0003](./0003-web-workers-for-tts.md) | Web Workers for TTS Generation | Accepted | 2025-01-01 |
| [ADR-0004](./0004-sentence-boundary-chunking.md) | Sentence-Boundary Text Chunking | Accepted | 2025-01-01 |
| [ADR-0005](./0005-indexeddb-with-dexie.md) | IndexedDB with Dexie for Storage | Accepted | 2025-01-01 |
| [ADR-0006](./0006-two-tier-audio-cache.md) | Two-Tier Audio Cache Strategy | Accepted | 2025-01-01 |
| [ADR-0007](./0007-playback-state-machine.md) | State Machine for Playback | Accepted | 2025-01-01 |
| [ADR-0008](./0008-zustand-for-ui-state.md) | Zustand for UI State Management | Accepted | 2025-01-01 |
| [ADR-0009](./0009-four-tts-engines.md) | Four TTS Engines with Graceful Fallback | Accepted | 2025-01-01 |
| [ADR-0010](./0010-capability-based-tts-abstraction.md) | Capability-Based TTS Engine Abstraction | Accepted | 2025-01-01 |
| [ADR-0011](./0011-peer-to-peer-library-transfer.md) | Peer-to-Peer Library Transfer via WebRTC | Accepted | 2025-12-31 |
| [ADR-0012](./0012-supertonic-webgpu-memory-management.md) | Supertonic WebGPU Memory Management | Proposed | 2025-01-01 |
| [ADR-0013](./0013-structured-logging-system.md) | Structured Logging System | Accepted | 2025-12-31 |
| [ADR-0014](./0014-multi-book-context-switching.md) | Multi-Book Context Switching | Accepted | 2025-01-01 |
| [ADR-0015](./0015-internationalization-with-lingui.md) | Internationalization with Lingui | Accepted | 2026-01-05 |
| [ADR-0016](./0016-transfer-session-architecture.md) | Transfer Session Architecture | Accepted | 2026-01-06 |

## Creating a New ADR

1. Copy `template.md` to a new file named `XXXX-short-title.md`
2. Fill in the template sections
3. Add an entry to the index table above
4. Submit with your code changes in the same PR

## ADR Lifecycle

- **Proposed**: Under discussion, not yet decided
- **Accepted**: Decision has been made and is in effect
- **Deprecated**: No longer relevant (e.g., feature removed)
- **Superseded**: Replaced by a newer ADR (link to it)

ADRs are **immutable** once accepted. If a decision changes, create a new ADR that supersedes the old one rather than editing it. This preserves the historical record.

