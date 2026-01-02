# Two-Tier Audio Cache Strategy

- **Status**: Accepted
- **Date**: 2025-01-01
- **Deciders**: Project founders

## Context

Generated audio is expensive (seconds of GPU/CPU time per chunk) and storage is limited. We need a caching strategy that:
- Avoids regenerating audio unnecessarily
- Handles re-imports of the same book
- Works when the same text appears in multiple places
- Invalidates correctly when voice/model changes

The naive approach (cache by book+section+chunk) fails when:
- User re-imports a book (new book ID)
- Same quote appears in multiple chapters
- EPUB structure changes but text is identical

## Decision

Implement a **two-tier cache lookup** for audio chunks:

**Tier 1: Position-Specific**
```
Key: bookId + sectionIndex + chunkIndex + voiceId + modelConfig + textHash
```
Exact match for a specific position in a specific book.

**Tier 2: Global Text Hash**
```
Key: textHash + voiceId + modelConfig
```
Finds any cached audio for identical text, regardless of position.

Lookup order:
1. Try position-specific lookup first (fast, common case)
2. Fall back to text-hash lookup if no hit
3. If found via text-hash, audio is reused (no copy made)

## Consequences

### Positive

- **Re-import reuse**: Deleting and re-importing a book reuses all cached audio
- **Cross-position reuse**: Repeated quotes/phrases share cached audio
- **Correct invalidation**: Voice/model changes produce different hashes, no stale audio
- **Storage efficiency**: Don't store duplicate audio for identical text

### Negative

- **Two index lookups**: Slightly slower miss path (rare in practice)
- **Index overhead**: Compound index on `[textHash+voiceId+modelConfig]` adds storage
- **Complexity**: More code than single-key cache

### Neutral

- Text hash is computed at import time (already needed for chunking)
- Position-specific entries still created (enables per-book cache management)

## Alternatives Considered

### Alternative 1: Position-Only Cache

Cache only by `bookId + section + chunk + voice + model + textHash`.

**Rejected because:**
- Re-importing a book regenerates everything
- Same text in different positions = duplicate audio
- Wastes storage and generation time

### Alternative 2: Text-Hash-Only Cache

Cache only by `textHash + voice + model`, ignore position.

**Rejected because:**
- Can't delete cache for a specific book
- Storage management becomes global-only
- Harder to reason about cache size per book

### Alternative 3: Content-Addressable Storage

Hash the audio blob itself and deduplicate at storage level.

**Rejected because:**
- Same text with same settings produces same audio (deterministic)
- Hashing the blob is more expensive than hashing text
- Doesn't help with the re-import problem

## References

- Implementation in `audioChunkRepository.getWithFallback()`
- Compound index defined in `db.ts` schema v2

