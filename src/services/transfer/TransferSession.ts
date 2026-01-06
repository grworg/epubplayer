/**
 * Transfer Session
 * 
 * Orchestrates a complete transfer session (sender or receiver).
 * Coordinates the state machine, transport, and book provider/importer.
 */

import { createLogger } from '@/services/logging'
import {
  PROTOCOL_VERSION,
  HANDSHAKE_TIMEOUT,
  INTER_BOOK_DELAY,
  type TransferMessage,
  type BookManifest,
  type TransferStats,
  type TransferCapability,
} from './transferProtocol'
import type { TransferTransport, TransportConnection, ListenerHandle } from './transferTransport'
import { createTransport } from './peerJSTransport'
import { TransferStateMachine, type TransferState, type TransferRole } from './TransferStateMachine'
import { createBookProvider, type BookProvider } from './bookProvider'
import { createBookImporter, type BookImporter } from './bookImporter'

const log = createLogger('transfer')

// ============================================================================
// Types
// ============================================================================

export interface TransferSessionOptions {
  /** Custom transport (for testing) */
  transport?: TransferTransport
  /** Custom book provider (for testing) */
  bookProvider?: BookProvider
  /** Custom book importer (for testing) */
  bookImporter?: BookImporter
}

type StateChangeCallback = (state: TransferState) => void

// ============================================================================
// Transfer Session Class
// ============================================================================

export class TransferSession {
  private readonly stateMachine: TransferStateMachine
  private readonly transport: TransferTransport
  private readonly bookProvider: BookProvider
  private readonly bookImporter: BookImporter
  private readonly role: TransferRole
  
  private abortController: AbortController | null = null
  private connection: TransportConnection | null = null
  private listenerHandle: ListenerHandle | null = null
  
  // Track transfer start time for stats
  private transferStartTime: number = 0
  private totalBytesTransferred: number = 0
  
  // Store books to transfer (sender only)
  private booksToTransfer: BookManifest[] = []
  
  constructor(
    role: TransferRole,
    options: TransferSessionOptions = {}
  ) {
    this.role = role
    this.stateMachine = new TransferStateMachine()
    this.transport = options.transport ?? createTransport()
    this.bookProvider = options.bookProvider ?? createBookProvider()
    this.bookImporter = options.bookImporter ?? createBookImporter()
  }
  
  // ============================================================================
  // Public API
  // ============================================================================
  
  /**
   * Get current state
   */
  getState(): TransferState {
    return this.stateMachine.getState()
  }
  
  /**
   * Subscribe to state changes
   */
  subscribe(callback: StateChangeCallback): () => void {
    return this.stateMachine.subscribe((state) => callback(state))
  }
  
  /**
   * Start the transfer session
   * @param targetPeerId - For receiver: the peer ID to connect to
   */
  async start(targetPeerId?: string): Promise<void> {
    // Create abort controller for this session
    this.abortController = new AbortController()
    const signal = this.abortController.signal
    
    try {
      if (this.role === 'sender') {
        await this.runSenderFlow(signal)
      } else {
        if (!targetPeerId) {
          throw new Error('Receiver requires target peer ID')
        }
        await this.runReceiverFlow(targetPeerId, signal)
      }
    } catch (err) {
      if (signal.aborted) {
        // Cancelled, not an error
        return
      }
      
      const message = err instanceof Error ? err.message : 'Unknown error'
      log.error('Session failed', { error: message })
      this.stateMachine.dispatch({
        type: 'ERROR',
        error: { code: 'CONNECTION_LOST', message },
      })
    }
  }
  
  /**
   * Cancel the session
   */
  cancel(): void {
    log.info('Cancelling session')
    this.abortController?.abort()
    this.stateMachine.dispatch({ type: 'CANCEL' })
    this.cleanup()
  }
  
  /**
   * Clean up and reset for potential reuse
   */
  destroy(): void {
    this.abortController?.abort()
    this.cleanup()
    this.stateMachine.dispatch({ type: 'RESET' })
  }
  
  // ============================================================================
  // Sender Flow
  // ============================================================================
  
  private async runSenderFlow(signal: AbortSignal): Promise<void> {
    // Start sender
    this.stateMachine.dispatch({ type: 'START_SENDER' })
    
    // Listen for connections
    log.info('Starting sender, listening for connections...')
    this.listenerHandle = await this.transport.listen(signal)
    
    this.stateMachine.dispatch({ 
      type: 'PEER_REGISTERED', 
      peerId: this.listenerHandle.peerId 
    })
    
    // Wait for receiver to connect
    log.info('Waiting for receiver...', { peerId: this.listenerHandle.peerId })
    this.connection = await this.listenerHandle.waitForConnection()
    
    if (signal.aborted) return
    
    this.stateMachine.dispatch({ 
      type: 'PEER_CONNECTED', 
      remotePeerId: this.connection.remotePeerId 
    })
    
    // Set up message handler
    this.setupMessageHandler(signal)
    
    // Perform handshake (sender initiates)
    await this.senderHandshake(signal)
    
    if (signal.aborted) return
    
    // Wait for library manifest from receiver
    log.info('Waiting for receiver library manifest...')
    const receiverHashes = await this.waitForLibraryManifest(signal)
    
    if (signal.aborted) return
    
    // Compare libraries and create transfer plan
    await this.createTransferPlan(receiverHashes, signal)
    
    if (signal.aborted) return
    
    // Transfer books
    await this.transferBooks(signal)
  }
  
  private async senderHandshake(signal: AbortSignal): Promise<void> {
    if (!this.connection) throw new Error('No connection')
    
    // Send handshake
    this.connection.send({
      type: 'handshake',
      version: PROTOCOL_VERSION,
      capabilities: ['books'] as TransferCapability[],
    })
    
    // Wait for ack
    const ack = await this.waitForMessage('handshake-ack', HANDSHAKE_TIMEOUT, signal)
    
    if (!ack.compatible) {
      throw new Error(ack.error || 'Incompatible protocol version')
    }
    
    log.info('Handshake complete')
    this.stateMachine.dispatch({ type: 'HANDSHAKE_COMPLETE' })
  }
  
  private async waitForLibraryManifest(signal: AbortSignal): Promise<Set<string>> {
    const msg = await this.waitForMessage('library-manifest', 30_000, signal)
    return new Set(msg.hashes)
  }
  
  private async createTransferPlan(receiverHashes: Set<string>, signal: AbortSignal): Promise<void> {
    if (!this.connection || signal.aborted) return
    
    // Get our books
    const ourBooks = await this.bookProvider.getTransferableBooks()
    
    // Filter to books receiver doesn't have
    const newBooks = ourBooks.filter(b => !receiverHashes.has(b.contentHash))
    const skippedCount = ourBooks.length - newBooks.length
    
    log.info('Transfer plan', { 
      total: ourBooks.length, 
      new: newBooks.length, 
      skipped: skippedCount 
    })
    
    // Store for transfer
    this.booksToTransfer = newBooks
    
    // Calculate total size
    const totalSize = newBooks.reduce((sum, b) => sum + b.size, 0)
    
    // Send plan
    this.connection.send({
      type: 'transfer-plan',
      books: newBooks,
      skippedCount,
      totalSize,
    })
    
    // Wait for ack
    const ack = await this.waitForMessage('transfer-plan-ack', 10_000, signal)
    
    if (!ack.accepted) {
      throw new Error('Receiver rejected transfer plan')
    }
    
    this.stateMachine.dispatch({
      type: 'PLAN_READY',
      plan: { books: newBooks, skippedCount, totalSize },
    })
    
    this.transferStartTime = Date.now()
    this.totalBytesTransferred = 0
  }
  
  private async transferBooks(signal: AbortSignal): Promise<void> {
    if (!this.connection || signal.aborted) return
    
    const books = this.booksToTransfer
    
    if (books.length === 0) {
      // No books to transfer
      this.completeTransfer(0)
      return
    }
    
    for (let i = 0; i < books.length; i++) {
      if (signal.aborted) return
      
      const manifest = books[i]
      
      this.stateMachine.dispatch({ type: 'BOOK_STARTED', index: i })
      
      // Send book start
      this.connection.send({
        type: 'book-start',
        index: i,
        manifest,
      })
      
      // Get and send book data
      const blob = await this.bookProvider.getBookData(manifest.id)
      const buffer = await blob.arrayBuffer()
      
      this.connection.send({
        type: 'book-data',
        index: i,
        data: buffer,
      })
      
      this.totalBytesTransferred += buffer.byteLength
      
      // Send book end
      this.connection.send({
        type: 'book-end',
        index: i,
      })
      
      // Wait for ack
      const ack = await this.waitForMessage('book-ack', 60_000, signal)
      
      if (!ack.success) {
        log.warn('Book import failed on receiver', { 
          title: manifest.title, 
          error: ack.error 
        })
        // Continue with next book
      }
      
      this.stateMachine.dispatch({ type: 'BOOK_COMPLETE', index: i })
      
      // Small delay between books
      if (i < books.length - 1) {
        await new Promise(r => setTimeout(r, INTER_BOOK_DELAY))
      }
    }
    
    this.completeTransfer(books.length)
  }
  
  private completeTransfer(booksTransferred: number): void {
    if (!this.connection) return
    
    const durationMs = Date.now() - this.transferStartTime
    const plan = this.stateMachine.getState().plan
    
    const stats: TransferStats = {
      booksTransferred,
      booksSkipped: plan?.skippedCount ?? 0,
      totalBytes: this.totalBytesTransferred,
      durationMs,
    }
    
    this.connection.send({
      type: 'transfer-complete',
      stats,
    })
    
    // Wait a moment for the message to send, then complete
    setTimeout(() => {
      this.stateMachine.dispatch({ type: 'TRANSFER_COMPLETE', stats })
    }, 100)
  }
  
  // ============================================================================
  // Receiver Flow
  // ============================================================================
  
  private async runReceiverFlow(targetPeerId: string, signal: AbortSignal): Promise<void> {
    // Start receiver
    this.stateMachine.dispatch({ type: 'START_RECEIVER', peerId: targetPeerId })
    
    // Connect to sender
    log.info('Connecting to sender...', { peerId: targetPeerId })
    this.connection = await this.transport.connect(targetPeerId, signal)
    
    if (signal.aborted) return
    
    this.stateMachine.dispatch({ 
      type: 'PEER_CONNECTED', 
      remotePeerId: this.connection.remotePeerId 
    })
    
    // Set up message handler
    this.setupMessageHandler(signal)
    
    // Wait for handshake from sender
    await this.receiverHandshake(signal)
    
    if (signal.aborted) return
    
    // Send our library manifest
    await this.sendLibraryManifest()
    
    if (signal.aborted) return
    
    // Wait for transfer plan
    await this.waitForTransferPlan(signal)
    
    if (signal.aborted) return
    
    // Receive books (handled by message handler)
    await this.receiveBooks(signal)
  }
  
  private async receiverHandshake(signal: AbortSignal): Promise<void> {
    if (!this.connection) throw new Error('No connection')
    
    // Wait for handshake from sender
    const handshake = await this.waitForMessage('handshake', HANDSHAKE_TIMEOUT, signal)
    
    // Check compatibility
    const compatible = handshake.version === PROTOCOL_VERSION
    
    // Send ack
    this.connection.send({
      type: 'handshake-ack',
      version: PROTOCOL_VERSION,
      compatible,
      error: compatible ? undefined : `Version mismatch: got ${handshake.version}, need ${PROTOCOL_VERSION}`,
    })
    
    if (!compatible) {
      throw new Error(`Incompatible protocol version: ${handshake.version}`)
    }
    
    log.info('Handshake complete')
    this.stateMachine.dispatch({ type: 'HANDSHAKE_COMPLETE' })
  }
  
  private async sendLibraryManifest(): Promise<void> {
    if (!this.connection) return
    
    const hashes = await this.bookImporter.getExistingHashes()
    log.info('Sending library manifest', { bookCount: hashes.length })
    
    this.connection.send({
      type: 'library-manifest',
      hashes,
    })
  }
  
  private async waitForTransferPlan(signal: AbortSignal): Promise<void> {
    if (!this.connection || signal.aborted) return
    
    const plan = await this.waitForMessage('transfer-plan', 30_000, signal)
    
    log.info('Received transfer plan', { 
      books: plan.books.length, 
      skipped: plan.skippedCount,
      totalSize: plan.totalSize 
    })
    
    // Always accept the plan
    this.connection.send({
      type: 'transfer-plan-ack',
      accepted: true,
    })
    
    this.stateMachine.dispatch({
      type: 'PLAN_READY',
      plan: {
        books: plan.books,
        skippedCount: plan.skippedCount,
        totalSize: plan.totalSize,
      },
    })
    
    this.transferStartTime = Date.now()
    this.totalBytesTransferred = 0
  }
  
  private async receiveBooks(signal: AbortSignal): Promise<void> {
    const plan = this.stateMachine.getState().plan
    if (!plan || !this.connection) return
    
    if (plan.books.length === 0) {
      // No books to receive, wait for complete
      await this.waitForMessage('transfer-complete', 10_000, signal)
      this.handleTransferComplete()
      return
    }
    
    // Books are received via message handler
    // Wait for transfer-complete message
    const complete = await this.waitForMessage('transfer-complete', 5 * 60_000, signal)
    
    this.totalBytesTransferred = complete.stats.totalBytes
    this.handleTransferComplete()
  }
  
  private handleTransferComplete(): void {
    const durationMs = Date.now() - this.transferStartTime
    const state = this.stateMachine.getState()
    
    const stats: TransferStats = {
      booksTransferred: state.completedBooks,
      booksSkipped: state.plan?.skippedCount ?? 0,
      totalBytes: this.totalBytesTransferred,
      durationMs,
    }
    
    // Send ack if we have a connection
    this.connection?.send({ type: 'transfer-complete-ack' })
    
    this.stateMachine.dispatch({ type: 'TRANSFER_COMPLETE', stats })
  }
  
  // ============================================================================
  // Message Handling
  // ============================================================================
  
  private messageHandlers = new Map<string, (msg: TransferMessage) => void>()
  private pendingBook: { manifest: BookManifest; data: ArrayBuffer | null } | null = null
  
  private setupMessageHandler(signal: AbortSignal): void {
    if (!this.connection) return
    
    const unsubscribe = this.connection.onMessage((msg) => {
      if (signal.aborted) return
      
      // Check for pending message waiters
      const handler = this.messageHandlers.get(msg.type)
      if (handler) {
        handler(msg)
        return
      }
      
      // Handle book transfer messages (receiver only)
      if (this.role === 'receiver') {
        this.handleReceiverMessage(msg)
      }
    })
    
    // Also handle connection close
    this.connection.onClose(() => {
      if (!signal.aborted && this.stateMachine.isActive()) {
        this.stateMachine.dispatch({
          type: 'ERROR',
          error: { code: 'CONNECTION_LOST', message: 'Connection closed unexpectedly' },
        })
      }
    })
    
    this.connection.onError((err) => {
      if (!signal.aborted && this.stateMachine.isActive()) {
        this.stateMachine.dispatch({
          type: 'ERROR',
          error: { code: 'CONNECTION_LOST', message: err.message },
        })
      }
    })
    
    // Clean up on abort
    signal.addEventListener('abort', unsubscribe, { once: true })
  }
  
  private async handleReceiverMessage(msg: TransferMessage): Promise<void> {
    if (!this.connection) return
    
    switch (msg.type) {
      case 'book-start':
        log.info('Receiving book', { title: msg.manifest.title, index: msg.index })
        this.pendingBook = { manifest: msg.manifest, data: null }
        this.stateMachine.dispatch({ type: 'BOOK_STARTED', index: msg.index })
        break
        
      case 'book-data':
        if (this.pendingBook) {
          this.pendingBook.data = msg.data
          this.totalBytesTransferred += msg.data.byteLength
        }
        break
        
      case 'book-end':
        if (this.pendingBook && this.pendingBook.data) {
          const { manifest, data } = this.pendingBook
          const blob = new Blob([data], { type: 'application/epub+zip' })
          
          const result = await this.bookImporter.importBook(manifest, blob)
          
          this.connection.send({
            type: 'book-ack',
            index: msg.index,
            success: result.success,
            error: result.error,
          })
          
          if (result.success) {
            this.stateMachine.dispatch({ type: 'BOOK_COMPLETE', index: msg.index })
          }
          
          this.pendingBook = null
        }
        break
        
      case 'error':
        log.error('Error from sender', { code: msg.code, message: msg.message })
        this.stateMachine.dispatch({
          type: 'ERROR',
          error: { code: msg.code, message: msg.message },
        })
        break
    }
  }
  
  /**
   * Wait for a specific message type
   */
  private waitForMessage<T extends TransferMessage['type']>(
    type: T,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<Extract<TransferMessage, { type: T }>> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('Aborted'))
        return
      }
      
      const timeoutId = setTimeout(() => {
        this.messageHandlers.delete(type)
        reject(new Error(`Timeout waiting for ${type}`))
      }, timeoutMs)
      
      const abortHandler = () => {
        clearTimeout(timeoutId)
        this.messageHandlers.delete(type)
        reject(new Error('Aborted'))
      }
      
      signal.addEventListener('abort', abortHandler, { once: true })
      
      this.messageHandlers.set(type, (msg) => {
        clearTimeout(timeoutId)
        signal.removeEventListener('abort', abortHandler)
        this.messageHandlers.delete(type)
        resolve(msg as Extract<TransferMessage, { type: T }>)
      })
    })
  }
  
  // ============================================================================
  // Cleanup
  // ============================================================================
  
  private cleanup(): void {
    this.connection?.close()
    this.connection = null
    this.listenerHandle?.close()
    this.listenerHandle = null
    this.messageHandlers.clear()
    this.pendingBook = null
    this.booksToTransfer = []
  }
}
