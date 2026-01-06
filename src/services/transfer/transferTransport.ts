/**
 * Transfer Transport Interface
 * 
 * Abstracts the underlying connection mechanism (PeerJS/WebRTC).
 * Enables testing with mock implementations.
 */

import type { TransferMessage } from './transferProtocol'

// ============================================================================
// Transport Connection Interface
// ============================================================================

/**
 * Represents an established connection to a peer.
 * Provides methods to send/receive messages and manage lifecycle.
 */
export interface TransportConnection {
  /** The peer ID of the remote peer */
  readonly remotePeerId: string
  
  /** Send a message to the connected peer */
  send(message: TransferMessage): void
  
  /** Subscribe to incoming messages. Returns unsubscribe function. */
  onMessage(handler: (message: TransferMessage) => void): () => void
  
  /** Subscribe to connection close. Returns unsubscribe function. */
  onClose(handler: () => void): () => void
  
  /** Subscribe to connection errors. Returns unsubscribe function. */
  onError(handler: (error: Error) => void): () => void
  
  /** Close the connection */
  close(): void
}

// ============================================================================
// Listener Handle Interface
// ============================================================================

/**
 * Handle returned when starting to listen for connections.
 * Used by sender to wait for receiver to connect.
 */
export interface ListenerHandle {
  /** The peer ID that others can connect to */
  readonly peerId: string
  
  /** Wait for an incoming connection */
  waitForConnection(): Promise<TransportConnection>
  
  /** Stop listening and clean up */
  close(): void
}

// ============================================================================
// Transport Interface
// ============================================================================

/**
 * Transport abstraction for P2P connections.
 * 
 * Two modes of operation:
 * - listen(): Create a peer and wait for incoming connections (sender mode)
 * - connect(): Connect to an existing peer (receiver mode)
 */
export interface TransferTransport {
  /**
   * Start listening for incoming connections.
   * Creates a peer ID that others can connect to.
   * 
   * @param signal - AbortSignal to cancel the operation
   * @returns Handle with peer ID and method to wait for connection
   */
  listen(signal?: AbortSignal): Promise<ListenerHandle>
  
  /**
   * Connect to an existing peer.
   * 
   * @param peerId - The peer ID to connect to
   * @param signal - AbortSignal to cancel the operation
   * @returns Established connection
   */
  connect(peerId: string, signal?: AbortSignal): Promise<TransportConnection>
}
