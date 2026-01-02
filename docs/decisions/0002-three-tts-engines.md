# Three TTS Engines with Graceful Fallback

- **Status**: Superseded by [ADR-0009](./0009-four-tts-engines.md)
- **Date**: 2025-01-01
- **Deciders**: Project founders

## Context

The core feature is converting EPUB text to speech. There's a tradeoff between:
- **Quality**: Neural TTS sounds natural; basic TTS sounds robotic
- **Speed**: Some engines are instant; others need model loading and inference time
- **Compatibility**: Not all devices support WebGPU; some have poor Web Speech API voices

No single TTS solution works well for all users and devices.

## Decision

Support **three TTS engines** with automatic recommendation based on device capabilities:

1. **Browser TTS** (Web Speech API)
   - Instant playback, no loading, no storage
   - Quality varies dramatically by OS/browser
   - Recommended when: no WebGPU, user wants instant start

2. **Kokoro** (Neural TTS via kokoro-js)
   - Best quality, natural-sounding voices
   - ~80MB model download, needs WebGPU for speed
   - Falls back to WASM (slow but works)
   - Recommended when: WebGPU available

3. **Piper** (Neural TTS via piper.wasm)
   - Good quality, fast even on CPU
   - Smaller models than Kokoro
   - Experimental, fewer voice options
   - Alternative when: Kokoro too slow, want better quality than Browser TTS

All engines are abstracted behind `ttsManager` with a common interface.

## Consequences

### Positive

- **Works everywhere**: Every user has at least Browser TTS as fallback
- **Best experience when possible**: Users with capable hardware get premium quality
- **User choice**: Power users can override the recommendation
- **Graceful degradation**: WebGPU → WASM → Browser TTS chain

### Negative

- **Complexity**: Three code paths to maintain and test
- **Inconsistent experience**: Audio quality varies between engines
- **Onboarding friction**: Users must choose or understand the recommendation
- **Cache invalidation**: Switching engines means regenerating cached audio

### Neutral

- Different engines have different voice options (not interchangeable)
- Kokoro model is fetched from CDN at runtime (offline-after-first-load)

## Alternatives Considered

### Alternative 1: Browser TTS Only

Rely entirely on Web Speech API.

**Rejected because:**
- Quality is terrible on many devices (especially older Android)
- No control over voice consistency
- Some browsers have broken implementations

### Alternative 2: Kokoro Only

Use only the neural TTS engine.

**Rejected because:**
- 80MB download before first playback is a poor first experience
- WASM fallback is too slow for real-time playback on weak devices
- Excludes users without WebGPU who want instant playback

### Alternative 3: Server-Side TTS

Run TTS on a backend server.

**Rejected because:**
- Violates local-first principle (see ADR-0001)
- Requires infrastructure and ongoing costs
- Adds latency and requires internet

## References

- [Kokoro-js](https://github.com/hexgrad/kokoro) - Neural TTS library
- [Piper](https://github.com/rhasspy/piper) - Fast local neural TTS
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) - Browser standard

