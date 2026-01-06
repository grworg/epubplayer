# Peer-to-Peer Library Transfer via WebRTC

- **Status**: Accepted (implementation details superseded by [ADR-0016](./0016-transfer-session-architecture.md))
- **Date**: 2025-12-31
- **Deciders**: Ben

## Context

EPUB Player is a local-first application where all user data (books, audio cache, settings) lives in the browser's IndexedDB. This provides excellent privacy but creates a sync problem: users who start on their laptop want to continue on their phone, but there's no way to transfer their library without manually re-uploading each EPUB.

Traditional solutions would involve:
1. **User accounts + cloud storage** — Contradicts our local-first, no-server philosophy
2. **Export/import files** — Cumbersome; users must email themselves files or use cloud drives
3. **Browser sync** — Only works within same browser family, requires accounts

We need a solution that:
- Requires no accounts or persistent server infrastructure
- Works across different browsers/devices
- Feels magical — ideally one-click/scan
- Preserves privacy — book content never touches a server
- **Costs nothing** — No paid signaling infrastructure

## Decision

Implement peer-to-peer library transfer using **WebRTC DataChannels** with **PeerJS** and its free public cloud broker for signaling.

### Why PeerJS

**PeerJS** provides the best balance of simplicity, reliability, and cost:
- **Free forever**: Public broker at `0.peerjs.com` with no usage limits
- **Zero infrastructure**: No servers to deploy or maintain
- **Simple API**: Create peer → connect → send data
- **Battle-tested**: Widely used, well-documented
- **Handles complexity**: ICE servers, NAT traversal, connection management

The free broker only handles signaling (connection setup) — actual book data transfers peer-to-peer without touching any server.

### Architecture Overview

```
┌──────────────┐                                  ┌──────────────┐
│    SENDER    │                                  │   RECEIVER   │
│   (laptop)   │                                  │   (phone)    │
└──────┬───────┘                                  └──────┬───────┘
       │                                                 │
       │ 1. "Share Library" → Generate peer ID           │
       │    Display QR code with peer ID                 │
       │                                                 │
       │         ┌────────────────────┐                  │
       │────────►│   PeerJS Broker    │◄─────────────────│
       │         │   (free, public,   │  2. Scan QR /    │
       │         │    0.peerjs.com)   │     enter code   │
       │         └─────────┬──────────┘                  │
       │                   │                             │
       │◄─────────── SDP + ICE exchange ───────────────►│
       │                                                 │
       │══════════ Direct P2P Connection ══════════════►│
       │              (no server involved)               │
       │                                                 │
       │  3. Send book count                             │
       │  4. Transfer EPUB blobs one by one ───────────►│
       │                                                 │
       │                                   5. Import via │
       │                                      parseEPUB  │
```

### User Experience Flow

**Sender (device with books):**
1. Click the "Send to Device" icon in the library header (phone icon)
   - Or: Settings → "Share Library"
2. See a page with:
   - Friendly explanation of what's happening
   - Large QR code containing the peer ID
   - 6-character code for manual entry
   - Status: "Waiting for your other device..."
3. Once connected, see transfer progress with book titles
4. When complete, celebration and option to transfer to another device

**Receiver (new device):**
1. Entry points:
   - Onboarding: "Already have books?" button
   - Empty library: "Import from another device" card
   - Library header: "Send to Device" icon (same as sender, detects empty library)
2. Either:
   - Scan QR code → auto-opens app with peer ID
   - Type 6-character code manually
3. See connection status, then watch books arrive one by one
4. Books appear in library immediately as they complete

### Technical Components

#### 1. P2P Service (`services/p2p/peerService.ts`)

Thin wrapper around PeerJS:

```typescript
interface PeerService {
  // Create a peer with auto-generated short ID
  createPeer(): Promise<{ peerId: string; peer: Peer }>
  
  // Wait for incoming connection
  waitForConnection(peer: Peer): Promise<DataConnection>
  
  // Connect to an existing peer
  connectToPeer(targetPeerId: string): Promise<DataConnection>
  
  // Cleanup
  destroy(): void
}
```

#### 2. Transfer Protocol

Simple JSON messages over DataChannel:

```typescript
type TransferMessage =
  | { type: 'book-count'; count: number }
  | { type: 'book-start'; id: string; title: string; author: string; size: number }
  | { type: 'book-data'; data: ArrayBuffer }  // EPUB blob
  | { type: 'book-complete'; id: string }
  | { type: 'all-complete' }
  | { type: 'error'; message: string }
```

#### 3. Feature Module (`features/transfer/`)

```
features/transfer/
├── ShareLibraryPage.tsx    # Sender: QR code, waiting, progress
├── ReceiveLibraryPage.tsx  # Receiver: code entry, progress
└── useP2PTransfer.ts       # Hook managing transfer state
```

#### 4. Entry Points

| Location | Element | Action |
|----------|---------|--------|
| Library header | Phone icon (next to settings) | → `/app/share-library` |
| Onboarding | "Already have books?" button | → `/app/receive-library` |
| Empty library | "Import from another device" card | → `/app/receive-library` |
| Settings | "Share Library" menu item | → `/app/share-library` |

### Routes

```typescript
'/app/share-library'              // Sender: QR + waiting + progress
'/app/receive-library'            // Receiver: code entry + progress  
'/app/receive-library?peer=XXXX'  // Deep link from QR scan
```

### Scope

**MVP (this implementation):**
- ✅ Transfer EPUB files between devices
- ✅ QR code + manual code entry
- ✅ Progress indication per book
- ✅ Works cross-browser

**Future (not in scope):**
- ❌ Bookmarks and playback positions
- ❌ Settings sync
- ❌ Multi-receiver support
- ❌ Incremental/delta sync

The protocol is designed to allow adding bookmarks/positions later without breaking changes.

## Consequences

### Positive

- **Completely free** — PeerJS broker costs nothing
- **No accounts required** — Stays true to local-first philosophy
- **No book data on servers** — EPUB content transfers directly P2P
- **Works cross-browser** — Chrome ↔ Safari ↔ Firefox all work
- **Fast on same network** — WebRTC uses LAN when possible
- **Magical UX** — Scan QR, watch books appear
- **Zero maintenance** — No infrastructure to manage

### Negative

- **Depends on PeerJS service** — If their broker goes down, transfers fail (but can fall back to alternatives)
- **Both devices must be online simultaneously** — Unlike cloud sync
- **Network complexity** — May fail behind strict corporate firewalls
- **Mobile browser limitations** — Camera access requires HTTPS

### Neutral

- **Transfers EPUB blobs only** — Audio cache not transferred (keeps it fast, avoids voice/quality mismatches)
- **One-directional** — This is a "copy to new device" operation, not ongoing sync

## Alternatives Considered

### Alternative 1: Cloud Storage Integration

**Why rejected**: Requires accounts, contradicts local-first philosophy, adds complexity.

### Alternative 2: Export to ZIP

**Why rejected**: Clunky UX, manual file transfer required. Could be added as power-user fallback.

### Alternative 3: Pure QR Code (No Server)

**Why rejected**: SDP offers too large for QR, would need awkward two-way scanning.

### Alternative 4: Self-Hosted Signaling

**Why rejected**: Requires infrastructure costs and maintenance. PeerJS is free and reliable.

### Alternative 5: Cloudflare Workers

**Why rejected**: Still requires deployment and monitoring. PeerJS broker is simpler.

## Implementation Notes

### Dependencies

```json
{
  "peerjs": "^1.5.4",
  "qrcode.react": "^4.0.1"
}
```

### Peer ID Format

6 uppercase alphanumeric characters for easy verbal communication:
- Generated using `crypto.getRandomValues()`
- Prefixed with `epub-` to namespace in PeerJS broker
- Example: `epub-A7X2K9`

### Error Handling

- Connection timeout after 60 seconds
- Auto-retry on transient failures
- Clear error messages for common issues (offline, blocked, etc.)

## References

- [PeerJS Documentation](https://peerjs.com/docs/)
- [PeerJS GitHub](https://github.com/peers/peerjs)
- [WebRTC API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [Local-First Software Principles](https://www.inkandswitch.com/local-first/)
