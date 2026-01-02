# State Machine for Playback

- **Status**: Accepted
- **Date**: 2025-01-01
- **Deciders**: Project founders

## Context

Playback involves complex state transitions:
- Loading a book (async, can fail)
- Buffering audio (async, can be interrupted)
- Playing, pausing, seeking
- Handling errors gracefully
- Coordinating with background buffering

Ad-hoc state management leads to:
- Race conditions (user seeks while buffering)
- Invalid states (playing with no book loaded)
- Duplicate logic (multiple places checking "can I play?")
- Hard-to-debug issues (how did we get into this state?)

## Decision

Implement playback state as a **finite state machine** with explicit states and valid transitions.

States:
- `idle` - No book loaded
- `loading` - Book is being loaded
- `ready` - Book loaded, ready to play
- `playing` - Audio is playing
- `paused` - Playback paused, can resume
- `buffering` - Waiting for audio generation

Transitions are validated:
```
VALID_TRANSITIONS = {
  idle: ['LOAD_BOOK'],
  loading: ['LOADED', 'ERROR', 'UNLOAD'],
  ready: ['PLAY', 'UNLOAD', 'SEEK_CHUNK'],
  playing: ['PAUSE', 'BUFFER_NEEDED', 'CHUNK_ENDED', 'SEEK_CHUNK', 'STOP', 'ERROR'],
  paused: ['RESUME', 'STOP', 'UNLOAD', 'SEEK_CHUNK'],
  buffering: ['BUFFER_READY', 'PAUSE', 'STOP', 'ERROR'],
}
```

Invalid transitions are logged and ignored (fail-safe).

## Consequences

### Positive

- **Impossible states prevented**: Can't play without loading, can't pause when idle
- **Clear mental model**: State diagram documents all valid flows
- **Easier debugging**: Log shows state transitions, easy to trace issues
- **Centralized logic**: One place to understand playback state
- **Race condition handling**: Invalid transitions rejected cleanly

### Negative

- **Boilerplate**: More code than simple boolean flags
- **Learning curve**: Developers must understand the state machine
- **Rigidity**: Adding new features requires updating transition map

### Neutral

- State machine syncs to Zustand store for UI consumption
- Abort controller managed by state machine for cleanup

## Alternatives Considered

### Alternative 1: Boolean Flags

Use `isPlaying`, `isLoading`, `isPaused`, `isBuffering` booleans.

**Rejected because:**
- Easy to have invalid combinations (isPlaying && isPaused)
- No enforcement of valid transitions
- Business logic scattered across codebase

### Alternative 2: XState

Use the XState library for formal state machines.

**Rejected because:**
- Significant bundle size increase (~15KB)
- Learning curve for the library's concepts
- Our state machine is simple enough to implement directly
- Can migrate later if complexity grows

### Alternative 3: Redux-Style Reducer

Use a reducer function without explicit state machine.

**Rejected because:**
- Doesn't enforce valid transitions
- Still allows invalid state combinations
- State machine is a better fit for this problem

## References

- [Statecharts](https://statecharts.dev/) - State machine concepts
- Implementation in `PlaybackStateMachine.ts`

