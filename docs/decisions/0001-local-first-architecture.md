# Local-First Architecture

- **Status**: Accepted
- **Date**: 2025-01-01
- **Deciders**: Project founders

## Context

EPUB Player needs to store books, generated audio, playback state, and user preferences. The question is whether to use a traditional client-server architecture with cloud storage, or a local-first approach where all data stays on the device.

Users of audiobook apps expect:
- Reliable offline access (subway, airplane, areas with poor connectivity)
- Privacy (book choices can be sensitive)
- Fast performance (no network latency)
- Control over their data

## Decision

Adopt a **local-first architecture** where all data is stored on the user's device using browser storage APIs. No server backend, no user accounts, no data uploaded to the cloud.

Specifically:
- Book files (EPUB blobs) stored in IndexedDB
- Generated audio cached in IndexedDB
- Playback state and settings in IndexedDB
- App delivered as a PWA with offline capability via Service Worker

## Consequences

### Positive

- **Privacy by design**: User book choices and listening habits never leave their device
- **Works offline**: Full functionality without internet after initial app load
- **No infrastructure costs**: No servers to run, scale, or secure
- **Low latency**: All reads/writes are local
- **User owns their data**: No account lock-in, no service shutdown risk
- **Simpler architecture**: No API layer, authentication, or sync logic

### Negative

- **No cross-device sync**: Users can't continue on another device without manual export/import
- **Storage limits**: Browser storage quotas vary (typically 50-80% of free disk space, but can be evicted)
- **No backup by default**: If user clears browser data, everything is lost
- **No collaborative features**: Can't share highlights, notes, or progress with others

### Neutral

- Model download (Kokoro ~80MB) happens once and is cached, but requires initial internet
- Large audio caches may hit storage quotas on devices with limited space

## Alternatives Considered

### Alternative 1: Traditional Cloud Backend

Store books and progress on a server, sync across devices.

**Rejected because:**
- Requires user accounts (friction, privacy concerns)
- Significant infrastructure cost and complexity
- Most users have their EPUBs locally anyway
- Sync conflicts are hard to resolve for audiobook progress

### Alternative 2: Hybrid (Local-First with Optional Cloud Sync)

Keep local-first as primary, offer optional cloud backup/sync.

**Deferred for now because:**
- Adds significant complexity
- Can be added later without changing the core architecture
- Want to validate the local-first experience first

## References

- [Local-First Software](https://www.inkandswitch.com/local-first/) - Ink & Switch essay
- [PWA Storage](https://web.dev/storage-for-the-web/) - Web.dev guide

