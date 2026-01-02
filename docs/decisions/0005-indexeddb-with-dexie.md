# IndexedDB with Dexie for Storage

- **Status**: Accepted
- **Date**: 2025-01-01
- **Deciders**: Project founders

## Context

The app needs to store several types of data locally:
- **Book metadata**: Title, author, cover images (~KB each)
- **Book content**: Full EPUB files (~MB each)
- **Generated audio**: WAV blobs (~MB per chunk, potentially GB total)
- **Playback state**: Position, speed, voice settings (~KB)
- **User data**: Bookmarks, settings (~KB)

Browser storage options:
- **localStorage**: Synchronous, 5-10MB limit, strings only
- **sessionStorage**: Lost on tab close
- **IndexedDB**: Async, large capacity, supports blobs
- **Cache API**: Designed for HTTP responses, not structured data
- **OPFS**: New API, limited browser support, complex

## Decision

Use **IndexedDB** as the storage layer, with **Dexie.js** as a wrapper library.

Dexie provides:
- Promise-based API (cleaner than raw IndexedDB callbacks)
- TypeScript support with typed tables
- Schema versioning and migrations
- Compound indexes for efficient queries
- Simpler transaction handling

Schema design:
- `books` table: metadata + cover blob + original EPUB
- `sections` table: extracted text per chapter
- `audioChunks` table: cached WAV blobs with composite keys
- `playbackStates` table: per-book playback position
- `bookmarks` table: user bookmarks
- `settings` table: key-value app settings

## Consequences

### Positive

- **Large capacity**: Can store GBs of audio (quota varies by browser)
- **Blob support**: Native storage of audio blobs without base64 encoding
- **Indexed queries**: Fast lookups by book, section, chunk
- **Async API**: Doesn't block main thread
- **Durable**: Survives page refresh, browser restart
- **Dexie benefits**: Much nicer API than raw IndexedDB

### Negative

- **Async complexity**: All storage operations return promises
- **Quota uncertainty**: Browser can evict data if storage is low
- **No cross-origin access**: Data stuck in one origin
- **Debugging**: IndexedDB inspection tools are mediocre
- **Dependency**: Dexie adds ~15KB to bundle

### Neutral

- Schema migrations require version bumps and careful handling
- Compound indexes add storage overhead but enable fast queries

## Alternatives Considered

### Alternative 1: localStorage

Use localStorage for everything, base64-encode blobs.

**Rejected because:**
- 5-10MB limit is far too small for audio cache
- Synchronous API blocks main thread
- Base64 encoding inflates size by 33%

### Alternative 2: Raw IndexedDB

Use IndexedDB directly without a wrapper.

**Rejected because:**
- Callback-based API is painful to use
- No TypeScript support
- Manual transaction management is error-prone
- Dexie is battle-tested and small

### Alternative 3: OPFS (Origin Private File System)

Use the new file system API for large files.

**Rejected because:**
- Limited browser support (no Firefox until recently)
- More complex API
- Less mature tooling
- IndexedDB is sufficient for our needs

### Alternative 4: SQLite via WASM

Use sql.js or similar for a full relational database.

**Rejected because:**
- Overkill for our data model
- Adds significant bundle size
- Blob storage in SQLite is awkward
- IndexedDB is purpose-built for this use case

## References

- [Dexie.js](https://dexie.org/) - IndexedDB wrapper
- [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) - MDN
- [Storage for the Web](https://web.dev/storage-for-the-web/) - Quota and eviction

