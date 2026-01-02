# Structured Logging System

- **Status**: Accepted
- **Date**: 2025-12-31
- **Deciders**: Ben, Claude

## Context

The EPUB Player codebase has grown organically and now contains **261 console.log/warn/error calls across 29 files**. These logs are inconsistent:

- **Ad-hoc prefixes**: `[Supertonic]`, `[TTS]`, `[Playback]`, `[PlaybackController]`, `[StateMachine]`, `[EPUB Parser]`, `[Transfer:Sender]`, etc.
- **No runtime filtering**: Can't disable TTS logs when debugging playback
- **No verbosity levels**: Everything is either logged or not
- **Workers pipe logs separately**: Workers use `postMessage` to send logs back, handled inconsistently
- **Existing partial solution**: `services/logging/logStore.ts` captures all console output but lacks subsystem filtering

This makes debugging painful:

1. **TTS subsystem floods the console** when buffering is active, making playback debugging difficult
2. **No way to focus on one subsystem** without commenting out code
3. **Different developers use different prefix styles**, making grepping inconsistent
4. **No structured data** for eventual remote logging or telemetry

### Identified Subsystems

From analyzing the codebase, these are the logical subsystems:

| Subsystem | Current Prefixes | Files |
|-----------|------------------|-------|
| `tts` | `[Supertonic]`, `[TTS]`, `[Kokoro]`, `[Piper]`, `[Worker]` | ttsManager, ttsService, supertonicService, workers |
| `playback` | `[Playback]`, `[PlaybackController]`, `[StateMachine]` | PlaybackController, PlaybackStateMachine |
| `buffer` | `(custom timer)` | TTSBufferManager |
| `audio` | `[BrowserTTSBackend]`, `[AudioBlobBackend]`, `[SilentKeepalive]` | Audio backends |
| `media` | `[MediaSession]` | MediaSessionManager |
| `epub` | `[EPUB Parser]` | parser.ts |
| `storage` | (none currently) | Repositories, db |
| `transfer` | `[Transfer:Sender]`, `[Transfer:Receiver]` | P2P transfer pages |
| `library` | (none currently) | useLibrary, useBook |
| `import` | (none currently) | useImportEPUB |
| `debug` | `[Debug]` | debug.ts utilities |
| `app` | `[log]` | General app logging |

## Decision

Implement a **structured logging system** with the following design:

### 1. Logger Factory

Create loggers scoped to subsystems:

```typescript
// services/logging/logger.ts
import { createLogger } from '@/services/logging'

const log = createLogger('playback')

log.debug('Attempting to load book', { bookId })
log.info('Book loaded', { title: book.title })
log.warn('Invalid transition', { from: state, action })
log.error('Playback failed', error)
```

### 2. Log Levels

Four levels with clear semantics:

| Level | Use For | When to Use |
|-------|---------|-------------|
| `debug` | Verbose internal state | Loop iterations, cache hits, detailed flow |
| `info` | Key events | Book loaded, playback started, chunk generated |
| `warn` | Recoverable issues | Fallback triggered, retry needed, deprecation |
| `error` | Failures | Exceptions, unrecoverable states |

### 3. Runtime Filtering

Two filtering mechanisms controlled via settings or `window.logConfig`:

```typescript
// Subsystem filter - completely disable/enable subsystems
window.logConfig.setSubsystems({
  tts: false,      // Disable TTS logs
  playback: true,  // Enable playback logs
  '*': true,       // Default: enable all others
})

// Level filter - minimum level to display
window.logConfig.setLevel('info') // Only info, warn, error (no debug)
```

### 4. Structured Output

Logs include metadata automatically:

```
[12:34:56.789] [playback] [INFO] Book loaded { title: "Alice in Wonderland" }
```

Components:
- **Timestamp**: Millisecond precision, time-only for console (full for export)
- **Subsystem**: Always present, filterable
- **Level**: Uppercase for visibility
- **Message**: Human-readable
- **Data**: Optional structured data (object), pretty-printed

### 5. Worker Integration

Workers get their own logger that posts structured messages:

```typescript
// In worker
import { createWorkerLogger } from '@/services/logging/workerLogger'

const log = createWorkerLogger('tts')
log.info('Starting inference', { text: text.substring(0, 50) })
// Posts: { type: 'log', subsystem: 'tts', level: 'info', ... }
```

Main thread service receives and routes to unified logging:

```typescript
// In ttsService.ts
worker.onmessage = (e) => {
  if (e.data.type === 'log') {
    logFromWorker(e.data) // Routes to main logger
  }
}
```

### 6. Integration with LogStore

All logs flow through `logStore` with enhanced metadata:

```typescript
interface LogEntry {
  id: string
  ts: number
  level: 'debug' | 'info' | 'warn' | 'error'
  subsystem: string      // NEW: Required subsystem
  message: string
  data?: unknown         // NEW: Structured data
}
```

The existing DebugLogsPage gets subsystem filter dropdown.

### 7. Configuration Persistence

Filters are stored in `localStorage` for persistence across sessions:

```typescript
localStorage.setItem('logConfig', JSON.stringify({
  subsystems: { tts: false },
  level: 'info'
}))
```

And accessible via Settings page or browser console.

### 8. Log Export for User Support

The Debug Logs page (`/app/logs`) includes an **Export Logs** button that generates a timestamped text file with:
- Full log history with timestamps, subsystems, and levels
- User agent and export timestamp header
- Format suitable for sharing with developers

This enables users to capture and share logs when reporting issues, without any remote logging infrastructure.

### API Summary

```typescript
// Creating a logger
const log = createLogger('subsystem-name')

// Logging methods
log.debug(message, data?)
log.info(message, data?)
log.warn(message, data?)
log.error(message, data?)

// Runtime control (window.logConfig)
logConfig.setLevel('debug' | 'info' | 'warn' | 'error')
logConfig.setSubsystems({ subsystem: boolean, '*': boolean })
logConfig.enable('subsystem')
logConfig.disable('subsystem')
logConfig.enableAll()
logConfig.disableAll()

// For workers
const log = createWorkerLogger('subsystem')
```

## Consequences

### Positive

- **Focus debugging**: Disable `tts` logs when debugging `playback`
- **Consistent format**: All logs follow same pattern, easy to grep
- **Structured data**: Objects logged properly, not `[object Object]`
- **Single source of truth**: All config in one place
- **Easy log export**: Users can export logs for support issues
- **Gradual migration**: Can convert files one at a time
- **Works in workers**: Same API, routed through postMessage
- **Zero cost when disabled**: Subsystem check before any formatting

### Negative

- **Migration effort**: 261 call sites to update (can be gradual)
- **Import overhead**: Every file needs `import { createLogger }`
- **Learning curve**: Team needs to know subsystem names
- **Bundle size**: Small increase (~1KB minified)

### Neutral

- Existing `logStore` and `DebugLogsPage` are enhanced, not replaced
- Console still receives logs (for browser DevTools)
- Production builds could strip `debug` level entirely via build flag

## Alternatives Considered

### Alternative 1: Just Use console.log with Conventions

Continue using `console.log('[Subsystem]', ...)` with documented conventions.

**Rejected because:**
- No runtime filtering possible
- No enforcement of conventions
- Workers still need special handling
- No structured data support

### Alternative 2: Use an Existing Library (loglevel, pino, winston)

Adopt a popular logging library.

**Rejected because:**
- Most are designed for Node.js, not browsers
- Bundle size concerns (pino: 15KB, winston: 70KB+)
- Don't handle worker postMessage pattern
- Our needs are simple enough for custom solution
- Can always wrap later if needed

### Alternative 3: Build-Time Removal Only

Use Vite's `define` to strip logs in production.

**Rejected because:**
- Doesn't help with local development (the main pain point)
- Still no subsystem filtering
- Loses logs in production (sometimes useful for support)

### Alternative 4: Browser Console Filtering

Just use Chrome's console filter feature.

**Rejected because:**
- Doesn't work consistently across browsers
- Can't filter by custom categories
- Doesn't help with structured data
- Workers show as separate source

## Implementation Plan

### Phase 1: Core Infrastructure
1. Create `services/logging/logger.ts` with `createLogger`, `logConfig`
2. Create `services/logging/workerLogger.ts` for workers
3. Enhance `logStore.ts` with subsystem field
4. Update `DebugLogsPage.tsx` with subsystem filter

### Phase 2: Migrate High-Value Files
1. PlaybackController, PlaybackStateMachine
2. TTSBufferManager
3. ttsManager, supertonicService
4. Workers (ttsWorker, supertonicWorker, piperWorker)

### Phase 3: Migrate Remaining Files
1. Audio backends
2. EPUB parser
3. Transfer pages
4. Library/import hooks

### Phase 4: Polish
1. Add subsystem filter to Settings page
2. Document subsystem names in architecture docs
3. Add build flag for stripping debug logs in production

## References

- Existing logging: `src/services/logging/logStore.ts`
- Debug UI: `src/features/debug/DebugLogsPage.tsx`
- Worker log pattern: `src/services/tts/ttsWorker.ts` (lines 176-178)
- [loglevel](https://github.com/pimterry/loglevel) - Inspiration for API
- [debug](https://github.com/debug-js/debug) - Inspiration for namespacing

