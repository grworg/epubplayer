/**
 * PeerJS Transport Implementation
 * 
 * Implements the TransferTransport interface using PeerJS for WebRTC connections.
 */

import Peer from 'peerjs'
import type { DataConnection } from 'peerjs'
import { createLogger } from '@/services/logging'
import type { TransferMessage } from './transferProtocol'
import { CONNECTION_TIMEOUT } from './transferProtocol'
import type { TransferTransport, TransportConnection, ListenerHandle } from './transferTransport'

const log = createLogger('transfer')

// ============================================================================
// Peer ID Generation
// ============================================================================

const PEER_ID_PREFIX = 'epub-'
const PEER_ID_LENGTH = 6

/** Characters used for peer IDs (ambiguous chars removed: 0,O,1,I) */
const PEER_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * Generate a random peer ID like "epub-A7X2K9"
 */
function generatePeerId(): string {
  const array = new Uint8Array(PEER_ID_LENGTH)
  crypto.getRandomValues(array)
  const code = Array.from(array, (byte) => PEER_ID_CHARS[byte % PEER_ID_CHARS.length]).join('')
  return PEER_ID_PREFIX + code
}

/**
 * Extract the short code from a full peer ID
 */
export function getShortCode(peerId: string): string {
  return peerId.replace(PEER_ID_PREFIX, '')
}

/**
 * Convert a short code back to a full peer ID
 */
export function toFullPeerId(shortCode: string): string {
  const normalized = shortCode.toUpperCase().trim()
  if (normalized.startsWith(PEER_ID_PREFIX.toUpperCase())) {
    return PEER_ID_PREFIX + normalized.slice(PEER_ID_PREFIX.length)
  }
  return PEER_ID_PREFIX + normalized
}

// ============================================================================
// PeerJS Connection Wrapper
// ============================================================================

/**
 * Wraps a PeerJS DataConnection to implement TransportConnection
 */
class PeerJSConnection implements TransportConnection {
  private messageHandlers = new Set<(message: TransferMessage) => void>()
  private closeHandlers = new Set<() => void>()
  private errorHandlers = new Set<(error: Error) => void>()
  private _connection: DataConnection
  private _peer: Peer
  
  constructor(connection: DataConnection, peer: Peer) {
    this._connection = connection
    this._peer = peer
    
    // Wire up PeerJS events to our handlers
    this._connection.on('data', (data) => {
      const message = data as TransferMessage
      log.debug('Received message', { type: message.type })
      for (const handler of this.messageHandlers) {
        try {
          handler(message)
        } catch (err) {
          log.error('Message handler error', err)
        }
      }
    })
    
    this._connection.on('close', () => {
      log.info('Connection closed')
      for (const handler of this.closeHandlers) {
        try {
          handler()
        } catch (err) {
          log.error('Close handler error', err)
        }
      }
    })
    
    this._connection.on('error', (err) => {
      log.error('Connection error', err)
      for (const handler of this.errorHandlers) {
        try {
          handler(err)
        } catch (e) {
          log.error('Error handler error', e)
        }
      }
    })
  }
  
  get remotePeerId(): string {
    return this._connection.peer
  }
  
  send(message: TransferMessage): void {
    log.debug('Sending message', { type: message.type })
    this._connection.send(message)
  }
  
  onMessage(handler: (message: TransferMessage) => void): () => void {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }
  
  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler)
    return () => this.closeHandlers.delete(handler)
  }
  
  onError(handler: (error: Error) => void): () => void {
    this.errorHandlers.add(handler)
    return () => this.errorHandlers.delete(handler)
  }
  
  close(): void {
    log.info('Closing connection')
    this._connection.close()
    this._peer.destroy()
  }
}

// ============================================================================
// PeerJS Listener Handle
// ============================================================================

/**
 * Wraps a PeerJS Peer in listening mode
 */
class PeerJSListenerHandle implements ListenerHandle {
  private connectionPromise: Promise<TransportConnection> | null = null
  private connectionResolver: ((conn: TransportConnection) => void) | null = null
  private connectionRejecter: ((err: Error) => void) | null = null
  private closed = false
  private _peer: Peer
  private _peerId: string
  
  constructor(peer: Peer, peerId: string, signal?: AbortSignal) {
    this._peer = peer
    this._peerId = peerId
    
    // Set up the connection listener
    this.connectionPromise = new Promise((resolve, reject) => {
      this.connectionResolver = resolve
      this.connectionRejecter = reject
    })
    
    this._peer.on('connection', (conn) => {
      if (this.closed) {
        conn.close()
        return
      }
      
      log.info('Incoming connection', { from: conn.peer })
      
      conn.on('open', () => {
        log.info('Connection established', { peer: conn.peer })
        if (this.connectionResolver && !this.closed) {
          const wrappedConnection = new PeerJSConnection(conn, this._peer)
          this.connectionResolver(wrappedConnection)
          this.connectionResolver = null
          this.connectionRejecter = null
        }
      })
      
      conn.on('error', (err) => {
        log.error('Connection error during setup', err)
        if (this.connectionRejecter && !this.closed) {
          this.connectionRejecter(err)
          this.connectionResolver = null
          this.connectionRejecter = null
        }
      })
    })
    
    this._peer.on('error', (err) => {
      log.error('Peer error', err)
      if (this.connectionRejecter && !this.closed) {
        this.connectionRejecter(err)
        this.connectionResolver = null
        this.connectionRejecter = null
      }
    })
    
    // Handle abort signal
    signal?.addEventListener('abort', () => {
      this.close()
      if (this.connectionRejecter) {
        this.connectionRejecter(new Error('Connection aborted'))
        this.connectionResolver = null
        this.connectionRejecter = null
      }
    })
    
    // Set up timeout
    setTimeout(() => {
      if (this.connectionRejecter && !this.closed) {
        log.warn('Connection timeout')
        this.connectionRejecter(new Error('Connection timeout'))
        this.connectionResolver = null
        this.connectionRejecter = null
        this.close()
      }
    }, CONNECTION_TIMEOUT)
  }
  
  get peerId(): string {
    return this._peerId
  }
  
  async waitForConnection(): Promise<TransportConnection> {
    if (!this.connectionPromise) {
      throw new Error('Listener already used or closed')
    }
    return this.connectionPromise
  }
  
  close(): void {
    if (this.closed) return
    this.closed = true
    log.info('Closing listener')
    this._peer.destroy()
  }
}

// ============================================================================
// PeerJS Transport
// ============================================================================

/**
 * PeerJS implementation of TransferTransport
 */
export class PeerJSTransport implements TransferTransport {
  async listen(signal?: AbortSignal): Promise<ListenerHandle> {
    const peerId = generatePeerId()
    log.info('Creating listener peer', { peerId })
    
    return new Promise((resolve, reject) => {
      const peer = new Peer(peerId, { debug: 0 })
      
      const handleAbort = () => {
        peer.destroy()
        reject(new Error('Listen aborted'))
      }
      
      signal?.addEventListener('abort', handleAbort, { once: true })
      
      peer.on('open', (id) => {
        log.info('Registered with broker', { peerId: id })
        signal?.removeEventListener('abort', handleAbort)
        resolve(new PeerJSListenerHandle(peer, id, signal))
      })
      
      peer.on('error', (err) => {
        log.error('Failed to create listener peer', err)
        signal?.removeEventListener('abort', handleAbort)
        reject(err)
      })
    })
  }
  
  async connect(peerId: string, signal?: AbortSignal): Promise<TransportConnection> {
    const fullPeerId = toFullPeerId(peerId)
    const receiverId = generatePeerId() + '-recv'
    
    log.info('Connecting to peer', { target: fullPeerId, as: receiverId })
    
    return new Promise((resolve, reject) => {
      let resolved = false
      
      const peer = new Peer(receiverId, { debug: 0 })
      
      const cleanup = (error?: Error) => {
        if (resolved) return
        resolved = true
        peer.destroy()
        if (error) {
          reject(error)
        }
      }
      
      const handleAbort = () => {
        log.info('Connect aborted')
        cleanup(new Error('Connection aborted'))
      }
      
      signal?.addEventListener('abort', handleAbort, { once: true })
      
      peer.on('open', () => {
        log.info('Registered with broker, connecting...', { target: fullPeerId })
        
        const conn = peer.connect(fullPeerId, { reliable: true })
        
        conn.on('open', () => {
          if (resolved) return
          log.info('Connected to peer', { peer: fullPeerId })
          resolved = true
          signal?.removeEventListener('abort', handleAbort)
          resolve(new PeerJSConnection(conn, peer))
        })
        
        conn.on('error', (err) => {
          log.error('Connection error', err)
          signal?.removeEventListener('abort', handleAbort)
          cleanup(err)
        })
      })
      
      peer.on('error', (err) => {
        log.error('Peer error', err)
        signal?.removeEventListener('abort', handleAbort)
        
        // Provide user-friendly error messages
        let errorMessage = err.message
        if (err.type === 'peer-unavailable') {
          errorMessage = 'Could not find the other device. Make sure the code is correct and Share Library is open.'
        } else if (err.type === 'network') {
          errorMessage = 'Network error. Check your internet connection.'
        }
        
        cleanup(new Error(errorMessage))
      })
      
      // Timeout
      setTimeout(() => {
        if (!resolved) {
          log.warn('Connect timeout')
          signal?.removeEventListener('abort', handleAbort)
          cleanup(new Error('Connection timeout'))
        }
      }, 30_000)
    })
  }
}

// ============================================================================
// Default Export
// ============================================================================

/**
 * Get the default transport implementation
 */
export function createTransport(): TransferTransport {
  return new PeerJSTransport()
}
