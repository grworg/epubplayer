# Web Workers for TTS Generation

- **Status**: Accepted
- **Date**: 2025-01-01
- **Deciders**: Project founders

## Context

Neural TTS (Kokoro, Piper) involves heavy computation:
- Loading ML models (~80MB for Kokoro)
- Running inference (can take seconds per chunk)
- Processing audio data

If this runs on the main thread, the UI freezes during generation. Users can't scroll, tap buttons, or see progress updates. This creates a terrible experience.

## Decision

Run all neural TTS model loading and inference in **Web Workers**. The main thread only sends text and receives audio blobs.

Architecture:
```
Main Thread                    Worker Thread
┌─────────────┐               ┌─────────────┐
│ ttsService  │──postMessage─▶│  ttsWorker  │
│             │               │             │
│ • Queues    │               │ • Loads     │
│   requests  │               │   kokoro-js │
│ • Handles   │◀─postMessage──│ • Runs      │
│   callbacks │               │   inference │
└─────────────┘               └─────────────┘
```

Key implementation details:
- Worker imports kokoro-js dynamically from CDN
- Requests are serialized (one inference at a time) to avoid OOM
- Audio blobs are transferred back via postMessage
- Errors are forwarded to main thread for UI handling

## Consequences

### Positive

- **Responsive UI**: Main thread stays free for scrolling, tapping, animations
- **Progress updates**: Can show loading/generation progress in real-time
- **Cancelable**: Can terminate worker or cancel requests without freezing
- **Memory isolation**: Worker crash doesn't take down the app

### Negative

- **Communication overhead**: Serializing messages and transferring blobs has cost
- **Debugging complexity**: Worker console logs need forwarding to main thread
- **No shared state**: Can't directly access main thread data from worker
- **Browser support**: Workers are well-supported but add complexity

### Neutral

- Worker code is bundled separately by Vite
- CDN imports in worker require network on first load

## Alternatives Considered

### Alternative 1: Main Thread Execution

Run TTS directly on main thread, accept UI freezes.

**Rejected because:**
- Completely breaks the user experience
- Can't show progress or cancel operations
- Browser may show "page unresponsive" dialogs

### Alternative 2: Web Assembly in Main Thread with Yielding

Use `requestIdleCallback` or chunked processing to yield to main thread.

**Rejected because:**
- ONNX Runtime (used by kokoro-js) doesn't support incremental inference
- Would require significant library modifications
- Still causes jank during computation bursts

### Alternative 3: Offscreen Canvas / AudioWorklet

Use other off-main-thread APIs.

**Rejected because:**
- AudioWorklet is for real-time audio processing, not generation
- OffscreenCanvas doesn't help with computation
- Web Workers are the right tool for CPU-bound work

## References

- [Using Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers) - MDN
- [Vite Worker Support](https://vitejs.dev/guide/features.html#web-workers) - Build configuration

