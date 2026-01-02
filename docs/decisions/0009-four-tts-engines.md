# Four TTS Engines with Graceful Fallback

- **Status**: Accepted
- **Date**: 2025-01-01
- **Deciders**: Project maintainers
- **Supersedes**: [ADR-0002](./0002-three-tts-engines.md)

## Context

The original three-engine strategy ([ADR-0002](./0002-three-tts-engines.md)) provided good coverage but had a gap:

- **Browser TTS**: Instant but inconsistent quality
- **Kokoro**: Best quality but slow on WASM (no WebGPU)
- **Piper**: Experimental, not fully working

Users without WebGPU (older phones, some browsers) were stuck choosing between poor Browser TTS quality or painfully slow Kokoro WASM inference. We needed a middle-ground option that provides neural TTS quality with fast performance on all devices.

## Decision

Add **Supertonic** as a fourth TTS engine, positioned between Browser TTS and Kokoro:

| Engine | When to use | Model Size | Quality | Speed |
|--------|-------------|------------|---------|-------|
| **Browser TTS** | Want instant playback | 0 | Varies | Instant |
| **Supertonic** | Want quality + speed on any device | ~260MB | High | Fast (167× RT) |
| **Piper** | Experimental alternative | ~20MB | Good | Fast |
| **Kokoro** | Have WebGPU, want best quality | ~80MB | Best | Fast (GPU) / Slow (CPU) |

### Supertonic Specifics

- **Architecture**: ONNX Runtime Web with 4 models (duration predictor, text encoder, vector estimator, vocoder)
- **Inference**: WebGPU with automatic WASM fallback — fast on both
- **Voices**: 10 pre-extracted voice styles (M1-M5, F1-F5)
- **Text handling**: Excellent built-in normalization for numbers, dates, abbreviations
- **Model source**: Fetched from HuggingFace at runtime

### Engine Recommendation Flow

```
Device has WebGPU? ──Yes──► Recommend Kokoro (best quality)
        │
        No
        ▼
Recommend Supertonic (fast + quality) ──► User can still choose Browser TTS for instant start
```

## Consequences

### Positive

- **Fills the gap**: Quality neural TTS that works fast on any device
- **Better default for non-WebGPU users**: ~260MB download is worth it vs. slow Kokoro WASM
- **Excellent text normalization**: Handles edge cases (2.3h, $50, etc.) better than other engines
- **10 voice options**: Good variety without overwhelming choice

### Negative

- **Four code paths**: Increased maintenance complexity
- **Large download**: ~260MB is significant on slow connections
- **Another CDN dependency**: Models fetched from HuggingFace
- **Cache fragmentation**: Each engine has separate audio cache

### Neutral

- Supertonic and Kokoro have different voice sets (not interchangeable)
- Piper remains experimental — may eventually be removed or graduated

## Implementation Notes

- `supertonicService.ts` follows the same pattern as `ttsService.ts` (Kokoro)
- `supertonicWorker.ts` runs ONNX inference off main thread
- Voice styles are loaded on-demand and cached
- Settings: `supertonicVoice` default is `'F1'`

## Alternatives Considered

### Alternative: Replace Piper with Supertonic

Remove Piper entirely since Supertonic fills a similar niche.

**Not chosen because:**
- Piper uses much smaller models (~20MB vs ~260MB)
- Piper may improve and become a viable lightweight option
- Removing it would break existing users' settings

### Alternative: Make Supertonic the default for everyone

Set Supertonic as default regardless of WebGPU.

**Not chosen because:**
- 260MB download before first play is friction
- Users with WebGPU should get Kokoro's superior quality
- Browser TTS is still valuable for "just want to try it" users

## References

- [Supertonic GitHub](https://github.com/supertone-inc/supertonic) — Source and documentation
- [Supertonic HuggingFace](https://huggingface.co/Supertone/supertonic) — Model weights
- [ADR-0002](./0002-three-tts-engines.md) — Original three-engine decision (superseded)

