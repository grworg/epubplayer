# ADR-0014: Multi-Book Context Switching

- **Status**: Accepted
- **Date**: 2025-01-01
- **Deciders**: Project maintainers

## Context

The EPUB Player supports a library of multiple books, but the playback system was designed with single-book usage in mind. Users can:

1. Have Book A playing
2. Navigate to Book B's detail page
3. Click on a chapter in Book B

**Current Bug**: When clicking on Book B's chapter while Book A is playing, the app navigates to the "Now Playing" page but continues showing Book A instead of switching to Book B.

### Root Cause Analysis

The bug is in the state machine transition rules:

```typescript
const VALID_TRANSITIONS: Record<PlaybackStatus, PlaybackAction['type'][]> = {
  idle: ['LOAD_BOOK'],              // ← LOAD_BOOK only valid from 'idle'
  loading: ['LOADED', 'ERROR', 'UNLOAD'],
  ready: ['PLAY', 'UNLOAD', ...],   // ← Cannot LOAD_BOOK from 'ready'
  playing: ['PAUSE', 'STOP', ...],  // ← Cannot LOAD_BOOK from 'playing'
  paused: ['RESUME', 'STOP', 'UNLOAD', ...],
  buffering: ['BUFFER_READY', ...],
}
```

When switching books, `PlaybackController.loadBook()` does:

```typescript
// Step 1: Stop current playback
if (state.status === 'playing' || state.status === 'paused' || state.status === 'buffering') {
  this.audioBackend.stop()
  playbackStateMachine.dispatch({ type: 'STOP' })  // → Transitions to 'ready'
}

// Step 2: Try to load new book
if (!playbackStateMachine.dispatch({ type: 'LOAD_BOOK', bookId: book.id })) {
  log.warn('Failed to start loading book')
  return  // ← FAILS because 'ready' doesn't allow LOAD_BOOK!
}
```

The `STOP` action transitions to `ready` (book still loaded), but `LOAD_BOOK` is only valid from `idle`. The state machine rejects the transition, and the new book is never loaded.

### Scope of Multi-Book Issues

Beyond this immediate bug, multi-book support has broader implications:

1. **Resource Contention**: Two books could theoretically try to use TTS workers simultaneously
2. **Cache Confusion**: Audio cache is keyed by `bookId + sectionIndex + chunkIndex` which is correct, but buffer manager assumes single-book context
3. **State Pollution**: Settings like `speed` are saved per-book but loaded globally
4. **Background Buffering**: Buffer manager runs for one book; what happens when switching?

## Decision

### Immediate Fix: Allow Book Switching

Modify `PlaybackController.loadBook()` to properly unload the current book before loading a new one:

```typescript
async loadBook(book: Book): Promise<void> {
  const currentBookId = playbackStateMachine.getCurrentBookId()
  const state = playbackStateMachine.getState()
  
  // Same book already loaded? Skip
  if (currentBookId === book.id && state.status !== 'idle' && state.status !== 'loading') {
    return
  }

  // DIFFERENT book: must unload current first
  if (state.status !== 'idle') {
    this.audioBackend.stop()
    ttsBufferManager.stop()
    playbackStateMachine.dispatch({ type: 'UNLOAD' })  // → Goes to 'idle'
  }

  // Now LOAD_BOOK will succeed (we're in 'idle')
  if (!playbackStateMachine.dispatch({ type: 'LOAD_BOOK', bookId: book.id })) {
    return
  }
  
  // ... rest of loading logic
}
```

Also update valid transitions to allow `UNLOAD` from more states:

```typescript
const VALID_TRANSITIONS: Record<PlaybackStatus, PlaybackAction['type'][]> = {
  idle: ['LOAD_BOOK'],
  loading: ['LOADED', 'ERROR', 'UNLOAD'],
  ready: ['PLAY', 'UNLOAD', 'SEEK_CHUNK', 'ADVANCE_CHUNK', 'LOAD_BOOK'],  // Add LOAD_BOOK
  playing: ['PAUSE', 'BUFFER_NEEDED', 'CHUNK_ENDED', 'ADVANCE_CHUNK', 'SEEK_CHUNK', 'STOP', 'ERROR', 'UNLOAD'],  // Add UNLOAD
  paused: ['RESUME', 'STOP', 'UNLOAD', 'SEEK_CHUNK'],
  buffering: ['BUFFER_READY', 'PAUSE', 'STOP', 'ERROR', 'UNLOAD'],  // Add UNLOAD
}
```

### Design Principle: Single Active Book

The playback system maintains a **single active book** at any time. This is a deliberate constraint that simplifies:

- TTS worker management (one engine, one context)
- Buffer management (one book being buffered)
- Audio backend (one source of playback)
- Media Session API (one "now playing" item)

Multi-book "playlists" or parallel playback are explicitly out of scope.

### State Transitions for Book Switching

```
┌─────────────────────────────────────────────────────────┐
│                    Book A Playing                       │
│                                                         │
│  User clicks Book B chapter:                            │
│                                                         │
│  [playing] ──UNLOAD──> [idle] ──LOAD_BOOK──> [loading] │
│                                                         │
│  Resources cleaned up:                                  │
│  - Audio backend stopped                                │
│  - TTS buffer manager stopped                           │
│  - Abort signal triggered                               │
│  - Position saved for Book A                            │
└─────────────────────────────────────────────────────────┘
```

### Resource Cleanup Checklist

When switching books, the following must be cleaned up:

| Resource | Cleanup Action | Location |
|----------|----------------|----------|
| Audio playback | `audioBackend.stop()` | PlaybackController |
| TTS generation | `ttsBufferManager.stop()` | PlaybackController |
| In-flight requests | Abort signal triggered | PlaybackStateMachine |
| Position state | Save before unload | PlaybackController |
| Player store | Updated with new book | loadBook() |
| Media Session | Updated with new book | loadBook() |

## Consequences

### Positive

- **Fixes multi-book bug**: Users can switch between books reliably
- **Clean state transitions**: State machine enforces proper cleanup
- **Position preserved**: Each book's position is saved when switching away
- **Simple mental model**: One book active at a time

### Negative

- **Slight delay on switch**: Unloading + loading takes time
- **Buffered audio discarded**: Switching books loses any pre-buffered audio for the previous book
- **No quick resume**: Switching back to a book requires re-initializing TTS

### Neutral

- **State machine expanded**: More valid transitions to maintain
- **Must save position**: Book position should be saved before unload (already done)

## Alternatives Considered

### 1. Allow LOAD_BOOK from all states (simplest fix)

Just add `LOAD_BOOK` to all state transition lists.

**Rejected**: This would allow loading a book while audio is still playing, potentially causing resource conflicts. Explicit unload is cleaner.

### 2. Implicit unload in LOAD_BOOK reducer

Have the state machine automatically clean up when LOAD_BOOK is dispatched.

**Rejected**: This hides important side effects (stopping audio, saving position) inside the state machine reducer, violating the principle that reducers should be pure.

### 3. Multi-book context manager

Create a higher-level manager that can hold multiple book contexts and switch between them.

**Rejected for now**: Over-engineering for current use case. Users typically focus on one book at a time. Could be revisited if "quick switching" becomes a requested feature.

## Implementation Notes

1. **Test the fix** with these scenarios:
   - Book A playing → click Book B chapter → should switch to Book B
   - Book A paused → click Book B chapter → should switch to Book B
   - Book A buffering → click Book B chapter → should switch to Book B
   - Book A ready (loaded but not playing) → click Book B chapter → should switch

2. **Verify position saving** when switching books

3. **Add logging** for book switch events to aid debugging

4. **Consider UX**: Should we show a confirmation when switching away from a playing book? (Probably not needed for MVP)

