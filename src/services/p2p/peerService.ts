/**
 * P2P Service - Handles WebRTC connections via PeerJS
 * 
 * Uses the free PeerJS cloud broker for signaling. Book data transfers
 * directly peer-to-peer without touching any server.
 */

import Peer from 'peerjs'
import type { DataConnection } from 'peerjs'

// Peer ID format: epub-XXXXXX (6 uppercase alphanumeric chars)
const PEER_ID_PREFIX = 'epub-'
const PEER_ID_LENGTH = 6

// Logging helper with timestamps
function log(context: 'Sender' | 'Receiver' | 'P2P', message: string, data?: unknown) {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12)
  const prefix = `[${timestamp}] [P2P:${context}]`
  if (data !== undefined) {
    console.log(prefix, message, data)
  } else {
    console.log(prefix, message)
  }
}

function logError(context: 'Sender' | 'Receiver' | 'P2P', message: string, error?: unknown) {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12)
  const prefix = `[${timestamp}] [P2P:${context}]`
  console.error(prefix, message, error)
}

/**
 * Generate a random 6-character alphanumeric code
 */
function generatePeerId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Removed ambiguous chars (0,O,1,I)
  const array = new Uint8Array(PEER_ID_LENGTH)
  crypto.getRandomValues(array)
  return PEER_ID_PREFIX + Array.from(array, (byte) => chars[byte % chars.length]).join('')
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
    return normalized.toLowerCase().replace('epub-', PEER_ID_PREFIX)
  }
  return PEER_ID_PREFIX + normalized
}

export interface PeerServiceState {
  status: 'idle' | 'creating' | 'waiting' | 'connecting' | 'connected' | 'error'
  peerId?: string
  error?: string
}

export type TransferMessage =
  // Deduplication handshake (receiver → sender)
  | { type: 'my-books'; hashes: string[] }
  // Transfer messages (sender → receiver)
  | { type: 'book-count'; count: number; skipped: number }
  | { type: 'book-start'; id: string; title: string; author: string; size: number; contentHash: string }
  | { type: 'book-data'; data: ArrayBuffer }
  | { type: 'book-complete'; id: string }
  | { type: 'all-complete' }
  | { type: 'error'; message: string }

/**
 * Create a new peer and wait for a connection (sender mode)
 */
export async function createPeerAndWait(
  onStateChange: (state: PeerServiceState) => void,
  onMessage: (message: TransferMessage) => void,
  signal?: AbortSignal
): Promise<{ peer: Peer; connection: DataConnection } | null> {
  const peerId = generatePeerId()
  
  log('Sender', `Creating peer with ID: ${peerId}`)
  onStateChange({ status: 'creating', peerId })
  
  return new Promise((resolve) => {
    const peer = new Peer(peerId, {
      debug: 0, // Minimal PeerJS internal logging
    })
    
    let resolved = false
    
    const cleanup = () => {
      if (!resolved) {
        log('Sender', 'Cleaning up peer connection')
        resolved = true
        peer.destroy()
        resolve(null)
      }
    }
    
    signal?.addEventListener('abort', () => {
      log('Sender', 'Connection aborted by signal')
      cleanup()
    })
    
    peer.on('open', (id) => {
      log('Sender', `✓ Peer registered with broker, ID: ${id}`)
      log('Sender', 'Waiting for receiver to connect...')
      onStateChange({ status: 'waiting', peerId: id })
    })
    
    peer.on('connection', (conn) => {
      log('Sender', `Incoming connection from: ${conn.peer}`)
      
      conn.on('open', () => {
        log('Sender', '✓ DataChannel open - connection established!')
        onStateChange({ status: 'connected', peerId })
        if (!resolved) {
          resolved = true
          resolve({ peer, connection: conn })
        }
      })
      
      conn.on('data', (data) => {
        const msg = data as TransferMessage
        log('Sender', `Received message: ${msg.type}`)
        onMessage(msg)
      })
      
      conn.on('error', (err) => {
        logError('Sender', 'Connection error:', err)
        onStateChange({ status: 'error', peerId, error: err.message })
      })
      
      conn.on('close', () => {
        log('Sender', 'Connection closed by receiver')
      })
    })
    
    peer.on('error', (err) => {
      logError('Sender', `Peer error (type: ${err.type}):`, err.message)
      onStateChange({ status: 'error', peerId, error: err.message })
      cleanup()
    })
    
    peer.on('disconnected', () => {
      log('Sender', 'Disconnected from broker (will attempt reconnect)')
    })
    
    // Timeout after 5 minutes
    setTimeout(() => {
      if (!resolved) {
        log('Sender', 'Connection timeout after 5 minutes')
        onStateChange({ status: 'error', peerId, error: 'Connection timeout' })
        cleanup()
      }
    }, 5 * 60 * 1000)
  })
}

/**
 * Connect to an existing peer (receiver mode)
 * Includes retry logic for peer-unavailable errors (broker propagation delay)
 */
export async function connectToPeer(
  targetPeerId: string,
  onStateChange: (state: PeerServiceState) => void,
  onMessage: (message: TransferMessage) => void,
  signal?: AbortSignal,
  maxRetries: number = 3
): Promise<{ peer: Peer; connection: DataConnection } | null> {
  const fullPeerId = toFullPeerId(targetPeerId)
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      log('Receiver', 'Connection aborted by signal')
      return null
    }
    
    log('Receiver', `Attempting to connect to peer: ${fullPeerId} (attempt ${attempt}/${maxRetries})`)
    onStateChange({ status: 'connecting' })
    
    const result = await attemptConnection(fullPeerId, onStateChange, onMessage, signal)
    
    if (result.success) {
      return result.connection
    }
    
    // If it's a peer-unavailable error and we have retries left, wait and retry
    if (result.errorType === 'peer-unavailable' && attempt < maxRetries) {
      const backoffMs = attempt * 1500 // 1.5s, 3s, 4.5s backoff
      log('Receiver', `Peer not found, retrying in ${backoffMs}ms...`)
      await new Promise(r => setTimeout(r, backoffMs))
      continue
    }
    
    // For other errors or final attempt, fail
    return null
  }
  
  return null
}

/**
 * Single connection attempt (internal helper)
 */
async function attemptConnection(
  fullPeerId: string,
  onStateChange: (state: PeerServiceState) => void,
  onMessage: (message: TransferMessage) => void,
  signal?: AbortSignal
): Promise<{ success: true; connection: { peer: Peer; connection: DataConnection } } | { success: false; errorType?: string }> {
  return new Promise((resolve) => {
    // Generate a random ID for the receiver
    const receiverId = generatePeerId() + '-recv'
    log('Receiver', `Creating receiver peer with ID: ${receiverId}`)
    
    const peer = new Peer(receiverId, {
      debug: 0,
    })
    
    let resolved = false
    
    const cleanup = (errorType?: string) => {
      if (!resolved) {
        log('Receiver', 'Cleaning up peer connection')
        resolved = true
        peer.destroy()
        resolve({ success: false, errorType })
      }
    }
    
    const abortHandler = () => {
      log('Receiver', 'Connection aborted by signal')
      cleanup('aborted')
    }
    
    signal?.addEventListener('abort', abortHandler, { once: true })
    
    peer.on('open', (id) => {
      log('Receiver', `✓ Registered with broker as: ${id}`)
      log('Receiver', `Initiating connection to sender: ${fullPeerId}`)
      
      const conn = peer.connect(fullPeerId, {
        reliable: true,
      })
      
      conn.on('open', () => {
        log('Receiver', '✓ DataChannel open - connected to sender!')
        onStateChange({ status: 'connected' })
        if (!resolved) {
          resolved = true
          signal?.removeEventListener('abort', abortHandler)
          resolve({ success: true, connection: { peer, connection: conn } })
        }
      })
      
      conn.on('data', (data) => {
        const msg = data as TransferMessage
        log('Receiver', `Received message: ${msg.type}`, 
          msg.type === 'book-start' ? `(${msg.title})` : 
          msg.type === 'book-count' ? `(${msg.count} books)` :
          msg.type === 'book-data' ? `(${(msg.data.byteLength / 1024).toFixed(1)} KB)` : ''
        )
        onMessage(msg)
      })
      
      conn.on('error', (err) => {
        logError('Receiver', 'Connection error:', err)
        onStateChange({ status: 'error', error: err.message })
        cleanup('connection-error')
      })
      
      conn.on('close', () => {
        log('Receiver', 'Connection closed by sender')
      })
    })
    
    peer.on('error', (err) => {
      logError('Receiver', `Peer error (type: ${err.type}):`, err.message)
      // Provide user-friendly error messages
      let errorMessage = err.message
      if (err.type === 'peer-unavailable') {
        errorMessage = 'Could not find the other device. Make sure the code is correct and the Share Library page is open.'
        log('Receiver', 'Hint: The sender peer ID may have expired or the Share Library page was closed')
      } else if (err.type === 'network') {
        errorMessage = 'Network error. Check your internet connection.'
      }
      onStateChange({ status: 'error', error: errorMessage })
      cleanup(err.type)
    })
    
    peer.on('disconnected', () => {
      log('Receiver', 'Disconnected from broker')
    })
    
    // Timeout after 30 seconds for connection
    setTimeout(() => {
      if (!resolved) {
        log('Receiver', 'Connection timeout after 30 seconds')
        onStateChange({ status: 'error', error: 'Connection timeout. Make sure the other device has Share Library open.' })
        cleanup('timeout')
      }
    }, 30 * 1000)
  })
}

/**
 * Send a message over a data connection
 */
export function sendMessage(connection: DataConnection, message: TransferMessage): void {
  log('Sender', `Sending message: ${message.type}`,
    message.type === 'book-start' ? `(${message.title})` :
    message.type === 'book-count' ? `(${message.count} books)` :
    message.type === 'book-data' ? `(${(message.data.byteLength / 1024).toFixed(1)} KB)` : ''
  )
  connection.send(message)
}

/**
 * Send a blob in chunks (for large files)
 */
export async function sendBlob(connection: DataConnection, blob: Blob): Promise<void> {
  log('Sender', `Converting blob to ArrayBuffer (${(blob.size / 1024).toFixed(1)} KB)`)
  const buffer = await blob.arrayBuffer()
  sendMessage(connection, { type: 'book-data', data: buffer })
}

