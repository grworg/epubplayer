/**
 * Transfer Protocol
 * 
 * Defines the wire protocol for P2P library transfers.
 * Includes versioning for backwards compatibility.
 */

// ============================================================================
// Protocol Version
// ============================================================================

export const PROTOCOL_VERSION = 1

/**
 * Capabilities that can be negotiated during handshake.
 * Future-proofing for features like bookmark sync, chunked transfers, etc.
 */
export type TransferCapability = 
  | 'books'           // Transfer EPUB files (always supported in v1)
  // Future capabilities:
  // | 'bookmarks'    // Transfer bookmarks
  // | 'positions'    // Transfer reading positions
  // | 'chunked'      // Support chunked large file transfers

// ============================================================================
// Book Manifest
// ============================================================================

/**
 * Metadata about a book, used for planning transfers without sending data.
 */
export interface BookManifest {
  id: string
  title: string
  author: string
  contentHash: string
  size: number
}

// ============================================================================
// Transfer Statistics
// ============================================================================

export interface TransferStats {
  booksTransferred: number
  booksSkipped: number
  totalBytes: number
  durationMs: number
}

// ============================================================================
// Error Codes
// ============================================================================

export type TransferErrorCode =
  | 'VERSION_MISMATCH'      // Protocol versions incompatible
  | 'CONNECTION_LOST'       // WebRTC connection dropped
  | 'TRANSFER_ABORTED'      // User cancelled
  | 'IMPORT_FAILED'         // Failed to import a book
  | 'TIMEOUT'               // Operation timed out
  | 'INVALID_MESSAGE'       // Received malformed message
  | 'UNEXPECTED_STATE'      // Message received in wrong state

// ============================================================================
// Message Types
// ============================================================================

/**
 * All messages that can be sent over the transfer connection.
 * Each message has a `type` discriminator for pattern matching.
 */
export type TransferMessage =
  // === Handshake Phase ===
  // Sender and receiver exchange versions and capabilities
  | {
      type: 'handshake'
      version: number
      capabilities: TransferCapability[]
    }
  | {
      type: 'handshake-ack'
      version: number
      compatible: boolean
      error?: string
    }

  // === Library Comparison Phase ===
  // Receiver sends hashes of books they already have
  | {
      type: 'library-manifest'
      hashes: string[]
    }
  // Sender responds with plan of what will be transferred
  | {
      type: 'transfer-plan'
      books: BookManifest[]
      skippedCount: number
      totalSize: number
    }
  | {
      type: 'transfer-plan-ack'
      accepted: boolean
    }

  // === Transfer Phase ===
  // Books are sent one at a time: start → data → end → ack
  | {
      type: 'book-start'
      index: number
      manifest: BookManifest
    }
  | {
      type: 'book-data'
      index: number
      data: ArrayBuffer
    }
  | {
      type: 'book-end'
      index: number
    }
  | {
      type: 'book-ack'
      index: number
      success: boolean
      error?: string
    }

  // === Completion Phase ===
  | {
      type: 'transfer-complete'
      stats: TransferStats
    }
  | {
      type: 'transfer-complete-ack'
    }

  // === Error ===
  | {
      type: 'error'
      code: TransferErrorCode
      message: string
    }

// ============================================================================
// Message Type Guards
// ============================================================================

export function isHandshakeMessage(msg: TransferMessage): msg is Extract<TransferMessage, { type: 'handshake' }> {
  return msg.type === 'handshake'
}

export function isHandshakeAckMessage(msg: TransferMessage): msg is Extract<TransferMessage, { type: 'handshake-ack' }> {
  return msg.type === 'handshake-ack'
}

export function isLibraryManifestMessage(msg: TransferMessage): msg is Extract<TransferMessage, { type: 'library-manifest' }> {
  return msg.type === 'library-manifest'
}

export function isTransferPlanMessage(msg: TransferMessage): msg is Extract<TransferMessage, { type: 'transfer-plan' }> {
  return msg.type === 'transfer-plan'
}

export function isBookDataMessage(msg: TransferMessage): msg is Extract<TransferMessage, { type: 'book-data' }> {
  return msg.type === 'book-data'
}

export function isErrorMessage(msg: TransferMessage): msg is Extract<TransferMessage, { type: 'error' }> {
  return msg.type === 'error'
}

// ============================================================================
// Protocol Constants
// ============================================================================

/** Timeout for handshake phase (ms) */
export const HANDSHAKE_TIMEOUT = 10_000

/** Timeout for waiting for peer connection (ms) */
export const CONNECTION_TIMEOUT = 5 * 60 * 1000 // 5 minutes

/** Timeout for individual book transfer (ms) */
export const BOOK_TRANSFER_TIMEOUT = 60_000

/** Delay between books to allow UI updates (ms) */
export const INTER_BOOK_DELAY = 100
