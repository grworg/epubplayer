# ADR-0012: Supertonic WebGPU Memory Management

**Status**: Proposed  
**Date**: 2025-01-01  
**Supersedes**: None

## Context

The Supertonic TTS engine uses a 4-model ONNX pipeline for text-to-speech:

1. **Duration Predictor** - predicts phoneme durations
2. **Text Encoder** - encodes text into embeddings  
3. **Vector Estimator** - iterative denoising (5 steps)
4. **Vocoder** - converts latent representation to audio

When using the WebGPU execution provider, audio quality degrades after 3-4 chunks. The first chunks sound clear, then audio becomes progressively muffled/broken until it's unintelligible. This doesn't occur with WASM.

### Root Cause Analysis

After investigation, we identified several issues with GPU tensor lifecycle management:

#### Issue 1: Tensor Reuse Across Sessions
The same tensor objects are passed to multiple `session.run()` calls:
- `textIdsTensor` used in dpSession AND textEncSession
- `textMaskTensor` used in dpSession, textEncSession, AND 5x in vectorEstSession loop
- Style tensors (`style.dp`, `style.ttl`) used indefinitely

With WebGPU, this is problematic because:
- GPU buffers may be recycled between operations
- Async operations may not complete before reuse
- Buffer state becomes inconsistent

#### Issue 2: Missing Explicit GPU→CPU Transfer
Code uses `Array.from(tensor.data)` instead of `await tensor.getData()`. The ONNX Runtime docs specify that output tensors should use `getData()` to ensure proper synchronization of GPU→CPU transfer.

#### Issue 3: No Tensor Disposal
The denoising loop creates 3 tensors per iteration × 5 iterations = 15 tensors per inference. Plus session output tensors. None are disposed. GPU memory fills up rapidly.

#### Issue 4: Persistent Style Tensors
Style tensors are created once at voice load and never refreshed or disposed. If their GPU state becomes corrupted, all subsequent inferences produce garbage.

## Decision

We will implement proper WebGPU tensor lifecycle management:

### 1. Fresh Tensors Per Session
Create new tensor objects for each `session.run()` call instead of reusing:

```typescript
// Before (problematic)
const textIdsTensor = new ort.Tensor(...)
await dpSession.run({ text_ids: textIdsTensor })
await textEncSession.run({ text_ids: textIdsTensor })  // Reused!

// After (correct)
const textIdsTensor1 = new ort.Tensor(...)
await dpSession.run({ text_ids: textIdsTensor1 })
textIdsTensor1.dispose()

const textIdsTensor2 = new ort.Tensor(...)  // Fresh tensor
await textEncSession.run({ text_ids: textIdsTensor2 })
textIdsTensor2.dispose()
```

### 2. Proper Data Extraction
Use `getData()` for output tensors:

```typescript
// Before
const duration = Array.from(dpOutputs.duration.data as Float32Array)

// After
const durationData = await dpOutputs.duration.getData()
const duration = Array.from(durationData as Float32Array)
dpOutputs.duration.dispose()
```

### 3. Immediate Disposal
Dispose tensors as soon as their data is extracted or they're no longer needed.

### 4. Style Tensor Refresh
Either:
- Recreate style tensors for each inference, OR
- Implement a tensor pool with periodic refresh

## Consequences

### Positive
- Audio quality should remain consistent across many chunks
- GPU memory usage stays bounded
- Proper synchronization between GPU operations

### Negative  
- Slightly more CPU overhead creating/disposing tensors
- More verbose code
- Potential performance impact from frequent tensor creation

### Neutral
- Following ONNX Runtime's documented best practices
- Pattern matches other production WebGPU applications

## Alternatives Considered

### A. Force WASM Only
Pros: Works reliably, no memory management issues
Cons: Too slow on mobile devices, can't keep up with playback

### B. Session Pool/Restart
Restart ONNX sessions periodically to clear GPU state.
Cons: High latency during restart, doesn't address root cause

### C. IO Binding
Use ONNX Runtime's IO binding to keep data on GPU.
Cons: More complex, may not address the reuse issue

## Implementation Notes

The fix involves refactoring `inferSingle()` in `supertonicWorker.ts` to:

1. Track all created tensors
2. Use `getData()` for output extraction  
3. Dispose tensors immediately after use
4. Never reuse a tensor across session calls
5. Optionally recreate style tensors per-inference

Testing should verify:
- First chunk quality matches later chunks
- Memory usage stays stable over 20+ chunks
- No degradation over extended playback sessions

