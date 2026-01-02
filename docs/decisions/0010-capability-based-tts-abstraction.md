# Capability-Based TTS Engine Abstraction

- **Status**: Accepted
- **Date**: 2025-01-01
- **Deciders**: Project maintainers

## Context

When adding Supertonic as the fourth TTS engine ([ADR-0009](./0009-four-tts-engines.md)), we discovered that the `TTSEngine` type was defined in **four separate places**:

1. `src/services/tts/ttsManager.ts` — canonical definition
2. `src/features/player/PlaybackController.ts` — local copy
3. `src/features/player/TTSBufferManager.ts` — local copy (subset)
4. `src/services/storage/settingsRepository.ts` — inline in interface

Adding a new engine required updating all four files. We missed two, causing runtime errors.

Additionally, consumers like `PlaybackController` contain brittle checks like:

```typescript
if (engine === 'kokoro' || engine === 'piper' || engine === 'supertonic') {
  // Start buffer manager...
}
```

This pattern:
- Requires updating multiple files when adding engines
- Leaks engine implementation details to consumers
- Creates tight coupling between PlaybackController and specific engines
- Makes it easy to forget a case

## Decision

Adopt a **capability-based abstraction** for TTS engines:

### 1. Single Source of Truth for Types

Define `TTSEngine` and related types in one place (`src/services/tts/types.ts`) and import everywhere else.

### 2. Engine Capabilities Model

Each engine declares its capabilities:

```typescript
interface TTSEngineCapabilities {
  /** Pre-generates audio blobs (vs real-time streaming) */
  generatesBlobs: boolean
  
  /** Needs async initialization (model loading) */
  requiresInit: boolean
  
  /** Slow on CPU/WASM (should warn users) */
  slowOnCPU: boolean
}
```

### 3. Engine Registry

`ttsManager` maintains a registry of engines with their metadata and capabilities:

```typescript
const ENGINE_REGISTRY: Record<TTSEngine, TTSEngineInfo> = {
  browser: {
    id: 'browser',
    name: 'Browser (Instant)',
    capabilities: { generatesBlobs: false, requiresInit: false, slowOnCPU: false },
    // ...
  },
  supertonic: {
    id: 'supertonic', 
    name: 'Supertonic (Fast & Quality)',
    capabilities: { generatesBlobs: true, requiresInit: true, slowOnCPU: false },
    // ...
  },
  // ...
}
```

### 4. Capability-Based Decisions

Consumers query capabilities instead of checking engine names:

```typescript
// Before (brittle):
if (engine === 'kokoro' || engine === 'piper' || engine === 'supertonic')

// After (capability-based):
if (ttsManager.getEngineCapabilities(engine).generatesBlobs)
```

## Consequences

### Positive

- **Single source of truth**: Adding an engine only requires updating `ttsManager.ts`
- **Loose coupling**: PlaybackController doesn't know engine names, only capabilities
- **Type safety**: TypeScript catches missing cases at compile time
- **Self-documenting**: Capabilities make engine behavior explicit
- **Extensible**: New capabilities can be added without changing consumers

### Negative

- **Indirection**: One more level to understand (capabilities vs direct checks)
- **Migration effort**: Need to update existing code to use new pattern

### Neutral

- Capability queries are slightly more verbose than direct name checks
- Engine registry centralizes what was previously distributed

## Implementation

### File Changes

1. **Create** `src/services/tts/types.ts`:
   - `TTSEngine` type
   - `TTSEngineCapabilities` interface
   - `TTSEngineInfo` interface

2. **Update** `src/services/tts/ttsManager.ts`:
   - Import types from `types.ts`
   - Add `ENGINE_REGISTRY` with all engines
   - Add `getEngineInfo()` and capability helper methods
   - Update `getAvailableEngines()` to use registry

3. **Update** `src/services/tts/index.ts`:
   - Re-export types from `types.ts`

4. **Update** `src/features/player/PlaybackController.ts`:
   - Remove local `TTSEngine` type
   - Import from `@/services/tts`
   - Replace engine name checks with capability checks

5. **Update** `src/features/player/TTSBufferManager.ts`:
   - Remove local `TTSEngine` type
   - Import from `@/services/tts`

6. **Update** `src/services/storage/settingsRepository.ts`:
   - Import `TTSEngine` type
   - Use in `Settings` interface

7. **Update** `src/features/settings/SettingsPage.tsx`:
   - Use imported `TTSEngine` type for casts

## Alternatives Considered

### Alternative 1: Just Import Types Everywhere

Share the type but keep engine-name checks.

**Rejected because:**
- Still requires updating multiple check sites when adding engines
- Doesn't address the coupling problem

### Alternative 2: Full Plugin Architecture

Engines register themselves dynamically with a plugin interface.

**Rejected because:**
- Overkill for 4 engines
- Adds complexity without proportional benefit
- Could revisit if engine count grows significantly

## References

- [ADR-0009](./0009-four-tts-engines.md) — Four TTS Engines (motivated this refactor)
- [ADR-0002](./0002-three-tts-engines.md) — Original three-engine decision

