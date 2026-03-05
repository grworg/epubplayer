# KittenTTS as Lightweight TTS Engine

- **Status**: Accepted
- **Date**: 2026-03-02
- **Deciders**: Project maintainers

## Context

The app currently offers TTS engines spanning a spectrum from instant-but-mediocre (Browser TTS) to high-quality-but-heavy (Supertonic at ~260MB, Kokoro at ~80MB). There is a significant gap between these tiers:

- **Browser TTS**: Instant, zero download, but quality varies wildly across devices and is often robotic.
- **Supertonic/Kokoro**: Excellent quality, but require large model downloads (80-260MB) and may be slow or unavailable on low-end devices without WebGPU.

Users on mobile or bandwidth-constrained environments want better-than-browser quality without committing to a massive download. A lightweight neural TTS option would serve this middle ground.

## Decision

Integrate **KittenTTS Nano v0.1** as a new engine tier called "Kitten (Light)":

- **Model**: `KittenML/kitten-tts-nano-0.1` from HuggingFace
- **Size**: ~24MB total (15M parameters, quantized ONNX)
- **Runtime**: ONNX Runtime Web via WASM — no GPU required
- **Voices**: 8 pre-built voices (4 male, 4 female)
- **Output**: 24kHz audio
- **Phonemization**: `phonemizer` npm package (eSpeak NG via WASM)
- **License**: Apache-2.0

The integration follows the established Service + Worker + Registry pattern (see ADR-0010):
- `kittenWorker.ts` handles ONNX inference in a Web Worker
- `kittenService.ts` manages worker lifecycle and request tracking
- Plugs into `ttsManager.ts` via the capability-based ENGINE_REGISTRY

## Consequences

### Positive

- Fills the quality/size gap between Browser TTS and Supertonic/Kokoro
- ~24MB download vs ~80-260MB for other neural engines — 3-10x smaller
- WASM-only inference works reliably on any device without GPU
- Follows established patterns — no new architectural concepts needed
- English-focused quality is good for the primary use case

### Negative

- English only — no multilingual support (unlike Kokoro's 8 languages)
- Newer model (released Aug 2025) with less battle-testing than Kokoro or Piper
- Quality is good but not on par with Supertonic or Kokoro for longer passages
- Depends on external CDN for phonemizer WASM and model files

### Neutral

- Adds a sixth engine to the registry — UI complexity grows slightly but follows existing patterns
- Voice embeddings loaded from the reference web demo's GitHub repo (stable but third-party)

## Alternatives Considered

### Alternative 1: Upgrade Piper (existing but broken)

Piper is already integrated but non-functional. Fixing Piper would fill a similar niche (~20MB models). However, Piper's sherpa-onnx WASM dependency has proven fragile in the browser, and KittenTTS has a proven browser reference implementation.

### Alternative 2: Sherpa-ONNX Kokoro WASM

Sherpa-ONNX v1.12.28 added Kokoro TTS support, which could theoretically run via WASM in the browser. However, it's unconfirmed whether this works in the web assembly build, and the total download would still be much larger than KittenTTS.

### Alternative 3: Wait for Orpheus TTS 150M

Orpheus TTS by Canopy Labs has planned 150M-parameter variants that could be excellent quality in a small package. However, these haven't shipped yet and have no ONNX exports. KittenTTS is available and proven now.

## References

- KittenTTS GitHub: https://github.com/KittenML/KittenTTS
- HuggingFace model: https://huggingface.co/KittenML/kitten-tts-nano-0.1
- Browser reference implementation: https://github.com/clowerweb/kitten-tts-web-demo
- phonemizer npm package: https://www.npmjs.com/package/phonemizer
- ADR-0010: Capability-Based TTS Engine Abstraction
