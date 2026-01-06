# Transfer Session Architecture

- **Status**: Accepted
- **Date**: 2026-01-06
- **Deciders**: Ben
- **Supersedes**: Partially supersedes implementation details from ADR-0011

## Context

The peer-to-peer library transfer feature (ADR-0011) was implemented with the right high-level approach (WebRTC via PeerJS) but poor internal architecture. A recent bug where connections were immediately aborted revealed fundamental design problems:

1. **UI components contain business logic**: `ShareLibraryPage.tsx` (540 lines) and `ReceiveLibraryPage.tsx` (580 lines) mix connection management, protocol handling, book import/export, state management, and rendering.

2. **Implicit state machine**: State types look like a state machine but transitions happen via scattered `setState()` calls with no validation. Nothing prevents invalid transitions.

3. **Race conditions handled with refs**: Multiple refs (`hasInitiatedConnectionRef`, `hashesReceivedResolveRef`, `completedCountRef`) work around async timing issues instead of proper state management.

4. **Promise-resolver-in-ref anti-pattern**: Storing promise resolvers in refs to coordinate async flows is fragile and hard to reason about.

5. **No protocol versioning**: If we change the message format, old and new app versions can't communicate.

6. **Untestable**: Business logic is inseparable from React components. Testing requires full browser environment.

7. **No acknowledgment protocol**: Sender doesn't know if receiver successfully imported each book.

The playback system (ADR-0007) demonstrates the right approach: an explicit state machine (`PlaybackStateMachine.ts`) with validated transitions, separated from UI components.

## Decision

Refactor the transfer feature into a layered architecture with clear separation of concerns, following the patterns established by the playback system.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         React UI Layer                                   │
│  ┌─────────────────────────┐    ┌─────────────────────────┐             │
│  │   ShareLibraryPage.tsx  │    │  ReceiveLibraryPage.tsx │             │
│  │   (thin, presentational)│    │  (thin, presentational) │             │
│  └───────────┬─────────────┘    └───────────┬─────────────┘             │
│              │                              │                            │
│  ┌───────────▼──────────────────────────────▼─────────────┐             │
│  │              useTransferSession.ts                      │             │
│  │         (React hook - connects service to UI)           │             │
│  └───────────────────────────┬─────────────────────────────┘             │
└──────────────────────────────┼───────────────────────────────────────────┘
                               │
┌──────────────────────────────┼───────────────────────────────────────────┐
│                    Service Layer                                         │
│                              │                                           │
│  ┌───────────────────────────▼───────────────────────────┐              │
│  │              TransferSession.ts                        │              │
│  │    (orchestrator - coordinates all components)         │              │
│  └──┬────────────────┬────────────────┬────────────────┬─┘              │
│     │                │                │                │                 │
│  ┌──▼──────────┐ ┌───▼────────┐ ┌─────▼─────┐ ┌───────▼───────┐        │
│  │  Transfer   │ │  Transfer  │ │  Book     │ │    Book       │        │
│  │  State      │ │  Transport │ │  Provider │ │    Importer   │        │
│  │  Machine    │ │            │ │           │ │               │        │
│  └─────────────┘ └─────┬──────┘ └───────────┘ └───────────────┘        │
│                        │                                                 │
│  ┌─────────────────────▼─────────────────────────────────┐              │
│  │              transferProtocol.ts                       │              │
│  │         (message types, versioning, constants)         │              │
│  └───────────────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────────────┘
                               │
┌──────────────────────────────┼───────────────────────────────────────────┐
│                   External Dependencies                                  │
│                              │                                           │
│  ┌───────────────────────────▼───────────────────────────┐              │
│  │                      PeerJS                            │              │
│  │              (WebRTC abstraction library)              │              │
│  └───────────────────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────────────┘
```

### Layer 1: Protocol Definition

**File**: `services/transfer/transferProtocol.ts`

Defines the wire protocol with versioning for future compatibility:

```typescript
export const PROTOCOL_VERSION = 1

export type TransferMessage =
  // Handshake (bidirectional)
  | { type: 'handshake'; version: number; capabilities: string[] }
  | { type: 'handshake-ack'; version: number; compatible: boolean }
  
  // Library comparison (receiver → sender)
  | { type: 'library-manifest'; hashes: string[] }
  
  // Transfer plan (sender → receiver)
  | { type: 'transfer-plan'; books: BookManifest[]; totalSize: number }
  | { type: 'transfer-plan-ack'; accepted: boolean }
  
  // Book transfer (sender → receiver)
  | { type: 'book-start'; index: number; manifest: BookManifest }
  | { type: 'book-data'; index: number; data: ArrayBuffer }
  | { type: 'book-end'; index: number }
  | { type: 'book-ack'; index: number; success: boolean; error?: string }
  
  // Completion
  | { type: 'transfer-complete'; stats: TransferStats }
  | { type: 'transfer-complete-ack' }
  
  // Errors
  | { type: 'error'; code: TransferErrorCode; message: string }

export interface BookManifest {
  id: string
  title: string
  author: string
  contentHash: string
  size: number
}

export type TransferErrorCode =
  | 'VERSION_MISMATCH'
  | 'CONNECTION_LOST'
  | 'TRANSFER_ABORTED'
  | 'IMPORT_FAILED'
  | 'TIMEOUT'
```

**Key features**:
- Version field in handshake enables graceful degradation
- Acknowledgment messages (`*-ack`) enable reliable delivery
- Error codes are enumerated for programmatic handling
- `BookManifest` separates metadata from data

### Layer 2: Transport Abstraction

**File**: `services/transfer/transferTransport.ts`

Abstracts the connection layer so sessions don't depend on PeerJS directly:

```typescript
export interface TransferTransport {
  /** 
   * Create a listening peer and return its ID
   * Resolves when registered with broker
   */
  listen(signal?: AbortSignal): Promise<{ peerId: string; waitForConnection: () => Promise<TransportConnection> }>
  
  /**
   * Connect to an existing peer
   */
  connect(peerId: string, signal?: AbortSignal): Promise<TransportConnection>
}

export interface TransportConnection {
  readonly peerId: string
  
  send(message: TransferMessage): void
  
  /** Subscribe to incoming messages */
  onMessage(handler: (message: TransferMessage) => void): () => void
  
  /** Subscribe to connection close */
  onClose(handler: () => void): () => void
  
  /** Subscribe to errors */
  onError(handler: (error: Error) => void): () => void
  
  close(): void
}
```

**Implementations**:
- `PeerJSTransport` - Production implementation using PeerJS
- `MockTransport` - For unit tests, simulates connection with direct function calls

### Layer 3: State Machine

**File**: `services/transfer/TransferStateMachine.ts`

Explicit state machine following the `PlaybackStateMachine` pattern:

```typescript
export type TransferStatus =
  | 'idle'
  | 'initializing'      // Creating peer
  | 'awaiting-peer'     // Sender: waiting for receiver to connect
  | 'connecting'        // Receiver: connecting to sender
  | 'handshaking'       // Exchanging version/capabilities
  | 'comparing'         // Exchanging library manifests
  | 'ready-to-transfer' // Transfer plan agreed
  | 'transferring'      // Books in flight
  | 'completing'        // Final acknowledgments
  | 'complete'          // Success
  | 'error'             // Terminal error state
  | 'cancelled'         // User cancelled

export interface TransferState {
  status: TransferStatus
  role: 'sender' | 'receiver' | null
  peerId: string | null
  remotePeerId: string | null
  
  // Transfer progress
  plan: TransferPlan | null
  currentBookIndex: number
  completedBooks: number
  
  // Error info
  error: TransferError | null
}

export type TransferAction =
  | { type: 'START_SENDER' }
  | { type: 'START_RECEIVER'; peerId: string }
  | { type: 'PEER_REGISTERED'; peerId: string }
  | { type: 'PEER_CONNECTED'; remotePeerId: string }
  | { type: 'HANDSHAKE_COMPLETE' }
  | { type: 'COMPARISON_COMPLETE'; plan: TransferPlan }
  | { type: 'START_TRANSFER' }
  | { type: 'BOOK_STARTED'; index: number }
  | { type: 'BOOK_COMPLETE'; index: number }
  | { type: 'TRANSFER_COMPLETE' }
  | { type: 'ERROR'; error: TransferError }
  | { type: 'CANCEL' }

const VALID_TRANSITIONS: Record<TransferStatus, TransferAction['type'][]> = {
  idle:              ['START_SENDER', 'START_RECEIVER'],
  initializing:      ['PEER_REGISTERED', 'ERROR', 'CANCEL'],
  'awaiting-peer':   ['PEER_CONNECTED', 'ERROR', 'CANCEL'],
  connecting:        ['PEER_CONNECTED', 'ERROR', 'CANCEL'],
  handshaking:       ['HANDSHAKE_COMPLETE', 'ERROR', 'CANCEL'],
  comparing:         ['COMPARISON_COMPLETE', 'ERROR', 'CANCEL'],
  'ready-to-transfer': ['START_TRANSFER', 'ERROR', 'CANCEL'],
  transferring:      ['BOOK_STARTED', 'BOOK_COMPLETE', 'TRANSFER_COMPLETE', 'ERROR', 'CANCEL'],
  completing:        ['TRANSFER_COMPLETE', 'ERROR'],
  complete:          [],  // Terminal
  error:             [],  // Terminal
  cancelled:         [],  // Terminal
}
```

**Key features**:
- Invalid transitions logged and rejected (fail-safe)
- Clear state diagram documents all valid flows
- Terminal states (`complete`, `error`, `cancelled`) have no outgoing transitions
- Progress tracking (`currentBookIndex`, `completedBooks`) in state

### Layer 4: Session Orchestrators

**File**: `services/transfer/TransferSession.ts`

Single class that orchestrates sender or receiver behavior based on role:

```typescript
export class TransferSession {
  private stateMachine: TransferStateMachine
  private transport: TransferTransport
  private connection: TransportConnection | null = null
  
  constructor(
    private role: 'sender' | 'receiver',
    private bookProvider: BookProvider,
    private bookImporter: BookImporter,
    transport?: TransferTransport  // Injectable for testing
  ) {
    this.stateMachine = new TransferStateMachine()
    this.transport = transport ?? new PeerJSTransport()
  }
  
  /** Get current state (for UI binding) */
  getState(): TransferState
  
  /** Subscribe to state changes */
  subscribe(callback: (state: TransferState) => void): () => void
  
  /** Start the session (sender: listen for peer, receiver: connect to peer) */
  async start(peerId?: string, signal?: AbortSignal): Promise<void>
  
  /** Cancel the session */
  cancel(): void
  
  /** Clean up resources */
  destroy(): void
}
```

**Internal flow (sender)**:
1. `start()` → dispatch `START_SENDER`
2. `transport.listen()` → dispatch `PEER_REGISTERED`
3. Wait for connection → dispatch `PEER_CONNECTED`
4. Send/receive handshake → dispatch `HANDSHAKE_COMPLETE`
5. Receive library manifest → dispatch `COMPARISON_COMPLETE`
6. Send books → dispatch `BOOK_STARTED`/`BOOK_COMPLETE`
7. All done → dispatch `TRANSFER_COMPLETE`

**Internal flow (receiver)**:
1. `start(peerId)` → dispatch `START_RECEIVER`
2. `transport.connect(peerId)` → dispatch `PEER_CONNECTED`
3. Exchange handshake → dispatch `HANDSHAKE_COMPLETE`
4. Send library manifest, receive plan → dispatch `COMPARISON_COMPLETE`
5. Receive and import books → dispatch `BOOK_STARTED`/`BOOK_COMPLETE`
6. All done → dispatch `TRANSFER_COMPLETE`

### Layer 5: Provider/Importer Interfaces

**File**: `services/transfer/bookProvider.ts`

```typescript
export interface TransferableBook {
  id: string
  title: string
  author: string
  contentHash: string
  size: number
}

export interface BookProvider {
  /** Get list of books available to transfer */
  getTransferableBooks(): Promise<TransferableBook[]>
  
  /** Get the EPUB blob for a specific book */
  getBookData(id: string): Promise<Blob>
}
```

**File**: `services/transfer/bookImporter.ts`

```typescript
export interface BookImporter {
  /** Get hashes of all books already in library */
  getExistingHashes(): Promise<string[]>
  
  /** Import a received book */
  importBook(manifest: BookManifest, data: Blob): Promise<{ success: boolean; error?: string }>
}
```

**Implementations** use existing repositories:

```typescript
// DefaultBookProvider.ts
export class DefaultBookProvider implements BookProvider {
  async getTransferableBooks(): Promise<TransferableBook[]> {
    const books = await bookRepository.getAll()
    return books
      .filter(b => b.epubBlob && b.epubBlob.size > 0)
      .map(b => ({
        id: b.id,
        title: b.title,
        author: b.author,
        contentHash: b.contentHash!,
        size: b.epubBlob!.size,
      }))
  }
  
  async getBookData(id: string): Promise<Blob> {
    const book = await bookRepository.get(id)
    return book.epubBlob!
  }
}
```

### Layer 6: React Integration

**File**: `features/transfer/useTransferSession.ts`

```typescript
export function useTransferSession(role: 'sender' | 'receiver') {
  const [state, setState] = useState<TransferState>(INITIAL_STATE)
  const sessionRef = useRef<TransferSession | null>(null)
  
  useEffect(() => {
    const session = new TransferSession(
      role,
      new DefaultBookProvider(),
      new DefaultBookImporter()
    )
    sessionRef.current = session
    
    const unsubscribe = session.subscribe(setState)
    
    return () => {
      unsubscribe()
      session.destroy()
    }
  }, [role])
  
  const start = useCallback((peerId?: string) => {
    sessionRef.current?.start(peerId)
  }, [])
  
  const cancel = useCallback(() => {
    sessionRef.current?.cancel()
  }, [])
  
  return { state, start, cancel }
}
```

**UI Components** become thin wrappers:

```typescript
// ShareLibraryPage.tsx (~100 lines instead of ~540)
export function ShareLibraryPage() {
  const { state, start, cancel } = useTransferSession('sender')
  
  useEffect(() => { start() }, [start])
  
  return (
    <TransferPageLayout onBack={cancel}>
      {state.status === 'awaiting-peer' && (
        <WaitingState peerId={state.peerId!} />
      )}
      {state.status === 'transferring' && (
        <TransferringState progress={state} />
      )}
      {state.status === 'complete' && (
        <CompleteState stats={state.plan!} />
      )}
      {state.status === 'error' && (
        <ErrorState error={state.error!} onRetry={start} />
      )}
    </TransferPageLayout>
  )
}
```

### Directory Structure

```
src/services/transfer/
├── index.ts                    # Public exports
├── transferProtocol.ts         # Message types, versioning
├── transferTransport.ts        # Transport interface
├── peerJSTransport.ts          # PeerJS implementation
├── TransferStateMachine.ts     # State machine
├── TransferSession.ts          # Session orchestrator
├── bookProvider.ts             # Provider interface + default impl
├── bookImporter.ts             # Importer interface + default impl
└── __tests__/
    ├── TransferStateMachine.test.ts
    ├── TransferSession.test.ts
    └── mockTransport.ts        # Test helper

src/features/transfer/
├── ShareLibraryPage.tsx        # Sender UI (thin)
├── ReceiveLibraryPage.tsx      # Receiver UI (thin)
├── useTransferSession.ts       # React hook
└── components/                 # Presentational components
    ├── WaitingState.tsx
    ├── TransferringState.tsx
    ├── CompleteState.tsx
    └── ErrorState.tsx
```

## Consequences

### Positive

- **Testable**: State machine and session can be unit tested with mock transport. No browser required.
- **Maintainable**: Each layer has single responsibility. Changes are localized.
- **Reliable**: Explicit state machine prevents invalid states and transitions.
- **Debuggable**: State transitions are logged. Easy to trace "how did we get here?"
- **Extensible**: 
  - Add bidirectional sync: new message types, minimal session changes
  - Add bookmark sync: new provider/importer implementations
  - Add chunked transfers: transport layer change only
- **Protocol-safe**: Version handshake enables graceful degradation between app versions.
- **Acknowledgments**: Sender knows if receiver successfully imported each book.

### Negative

- **More files**: ~10 new files vs 3 current files. More to navigate.
- **Learning curve**: Developers must understand the layer architecture.
- **Migration effort**: Significant refactor of working code.
- **Boilerplate**: More code than the "quick and dirty" approach.

### Neutral

- **Same external behavior**: UX unchanged; this is purely internal architecture.
- **Same dependencies**: Still uses PeerJS, no new libraries.
- **State machine is custom**: Like playback, we avoid XState to minimize bundle size.

## Alternatives Considered

### Alternative 1: Fix Current Code Incrementally

Extract just the problematic parts (message handling, state) without full restructure.

**Rejected because**: The fundamental problem is tight coupling. Incremental fixes would still leave business logic in components, just slightly better organized. The bug we fixed proves the current structure is too fragile.

### Alternative 2: Use XState for State Machine

Adopt the XState library for a formal, visual state machine.

**Rejected because**:
- ~15KB bundle size increase
- Learning curve for XState-specific concepts
- Project already has a working custom state machine pattern
- Can migrate later if complexity demands it

### Alternative 3: Use React Context Instead of Hook

Provide session via React Context instead of returning from hook.

**Rejected because**:
- Session is page-scoped, not app-scoped
- Hook is simpler and more explicit
- No benefit from sharing session across components

### Alternative 4: Bidirectional Sync from Start

Design for full two-way sync rather than one-directional transfer.

**Rejected because**:
- Significantly more complex protocol (conflict resolution, etc.)
- Current use case is "set up new device", not ongoing sync
- Protocol versioning allows adding this later
- YAGNI

## Migration Plan

1. **Phase 1**: Create new `services/transfer/` module alongside existing code
2. **Phase 2**: Implement and test `TransferStateMachine` in isolation
3. **Phase 3**: Implement `TransferSession` with mock transport tests
4. **Phase 4**: Implement `PeerJSTransport` matching current PeerJS usage
5. **Phase 5**: Create `useTransferSession` hook
6. **Phase 6**: Refactor `ShareLibraryPage` to use new hook (feature flag)
7. **Phase 7**: Refactor `ReceiveLibraryPage` to use new hook
8. **Phase 8**: Remove old code, remove feature flag

## References

- [ADR-0007: State Machine for Playback](./0007-playback-state-machine.md) — Pattern to follow
- [ADR-0011: Peer-to-Peer Library Transfer](./0011-peer-to-peer-library-transfer.md) — Original feature decision
- [PlaybackStateMachine.ts](../../src/features/player/PlaybackStateMachine.ts) — Reference implementation
- [Statecharts](https://statecharts.dev/) — State machine concepts
