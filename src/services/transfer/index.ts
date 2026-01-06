/**
 * Transfer Service
 * 
 * P2P library transfer using WebRTC.
 * See ADR-0011 (high-level) and ADR-0016 (architecture) for details.
 */

// Protocol
export {
  PROTOCOL_VERSION,
  HANDSHAKE_TIMEOUT,
  CONNECTION_TIMEOUT,
  BOOK_TRANSFER_TIMEOUT,
  INTER_BOOK_DELAY,
  type TransferMessage,
  type BookManifest,
  type TransferStats,
  type TransferErrorCode,
  type TransferCapability,
} from './transferProtocol'

// Transport
export {
  type TransferTransport,
  type TransportConnection,
  type ListenerHandle,
} from './transferTransport'

export {
  PeerJSTransport,
  createTransport,
  getShortCode,
  toFullPeerId,
} from './peerJSTransport'

// State Machine
export {
  TransferStateMachine,
  type TransferStatus,
  type TransferRole,
  type TransferState,
  type TransferAction,
  type TransferPlan,
  type TransferError,
} from './TransferStateMachine'

// Session
export {
  TransferSession,
  type TransferSessionOptions,
} from './TransferSession'

// Book Provider/Importer
export {
  type BookProvider,
  DefaultBookProvider,
  createBookProvider,
} from './bookProvider'

export {
  type BookImporter,
  type ImportResult,
  DefaultBookImporter,
  createBookImporter,
} from './bookImporter'
