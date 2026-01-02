# Zustand for UI State Management

- **Status**: Accepted
- **Date**: 2025-01-01
- **Deciders**: Project founders

## Context

The UI needs to react to playback state changes:
- Current book, section, chunk position
- Play/pause/buffering status
- Playback speed, volume
- Error messages

React's built-in state (useState, useContext) has limitations:
- Context causes re-renders of all consumers
- Prop drilling is tedious for deeply nested components
- No built-in persistence

We need a state management solution that:
- Enables selective subscriptions (only re-render affected components)
- Integrates well with React
- Is simple to use and understand
- Optionally persists state

## Decision

Use **Zustand** for UI state management.

The `playerStore` holds:
- Current book metadata
- Playback status (synced from state machine)
- Position (section, chunk, time)
- Speed, volume
- Buffer progress
- Error state

Components subscribe to specific slices:
```typescript
const isPlaying = usePlayerStore((s) => s.isPlaying)
const speed = usePlayerStore((s) => s.speed)
```

Zustand's `persist` middleware saves select fields to localStorage for session continuity.

## Consequences

### Positive

- **Selective subscriptions**: Components only re-render when their slice changes
- **Simple API**: Just functions, no boilerplate
- **Small bundle**: ~1KB gzipped
- **Works outside React**: Can read/write from PlaybackController
- **Built-in persistence**: Easy to save/restore state
- **No providers**: No context wrapper needed

### Negative

- **Another dependency**: Adds to bundle (though small)
- **Global state**: Easy to overuse for things that should be local
- **Learning curve**: Different from Redux patterns

### Neutral

- State machine is source of truth; Zustand is a view layer cache
- Playback logic stays in PlaybackController, not in store

## Alternatives Considered

### Alternative 1: React Context

Use React Context for shared state.

**Rejected because:**
- All consumers re-render on any state change
- No built-in persistence
- Verbose for multiple contexts

### Alternative 2: Redux Toolkit

Use Redux with RTK for state management.

**Rejected because:**
- Much larger bundle size (~11KB)
- More boilerplate (slices, actions, selectors)
- Overkill for our state complexity

### Alternative 3: Jotai

Use Jotai for atomic state management.

**Considered but:**
- Similar benefits to Zustand
- Zustand's API felt more intuitive for our team
- Either would work; chose Zustand for familiarity

### Alternative 4: No Library (Custom)

Build custom pub/sub state management.

**Rejected because:**
- Reinventing the wheel
- Zustand is well-tested and tiny
- Would end up with similar patterns anyway

## References

- [Zustand](https://github.com/pmndrs/zustand) - Library repository
- [Zustand Documentation](https://docs.pmnd.rs/zustand/getting-started/introduction)
- Implementation in `playerStore.ts`

