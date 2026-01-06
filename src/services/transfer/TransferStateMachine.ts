/**
 * Transfer State Machine
 * 
 * Single source of truth for transfer session state.
 * Prevents invalid state transitions and race conditions.
 * 
 * Follows the pattern established by PlaybackStateMachine.
 */

import { createLogger } from '@/services/logging'
import type { BookManifest, TransferStats, TransferErrorCode } from './transferProtocol'

const log = createLogger('transfer')

// ============================================================================
// Types
// ============================================================================

export type TransferStatus =
  | 'idle'              // No transfer in progress
  | 'initializing'      // Creating peer connection
  | 'awaiting-peer'     // Sender: waiting for receiver to connect
  | 'connecting'        // Receiver: connecting to sender
  | 'handshaking'       // Exchanging version/capabilities
  | 'comparing'         // Exchanging library manifests
  | 'transferring'      // Books in flight
  | 'completing'        // Final acknowledgments
  | 'complete'          // Success - terminal state
  | 'error'             // Failed - terminal state
  | 'cancelled'         // User cancelled - terminal state

export type TransferRole = 'sender' | 'receiver'

export interface TransferPlan {
  books: BookManifest[]
  skippedCount: number
  totalSize: number
}

export interface TransferError {
  code: TransferErrorCode
  message: string
}

export interface TransferState {
  status: TransferStatus
  role: TransferRole | null
  
  // Connection info
  peerId: string | null
  remotePeerId: string | null
  
  // Transfer progress
  plan: TransferPlan | null
  currentBookIndex: number
  completedBooks: number
  
  // Results
  stats: TransferStats | null
  error: TransferError | null
}

export type TransferAction =
  | { type: 'START_SENDER' }
  | { type: 'START_RECEIVER'; peerId: string }
  | { type: 'PEER_REGISTERED'; peerId: string }
  | { type: 'PEER_CONNECTED'; remotePeerId: string }
  | { type: 'HANDSHAKE_COMPLETE' }
  | { type: 'PLAN_READY'; plan: TransferPlan }
  | { type: 'TRANSFER_STARTED' }
  | { type: 'BOOK_STARTED'; index: number }
  | { type: 'BOOK_COMPLETE'; index: number }
  | { type: 'TRANSFER_COMPLETE'; stats: TransferStats }
  | { type: 'ERROR'; error: TransferError }
  | { type: 'CANCEL' }
  | { type: 'RESET' }

type StateChangeCallback = (state: TransferState, prevState: TransferState) => void

// ============================================================================
// Valid Transitions Map
// ============================================================================

const VALID_TRANSITIONS: Record<TransferStatus, TransferAction['type'][]> = {
  'idle':           ['START_SENDER', 'START_RECEIVER'],
  'initializing':   ['PEER_REGISTERED', 'ERROR', 'CANCEL'],
  'awaiting-peer':  ['PEER_CONNECTED', 'ERROR', 'CANCEL'],
  'connecting':     ['PEER_CONNECTED', 'ERROR', 'CANCEL'],
  'handshaking':    ['HANDSHAKE_COMPLETE', 'ERROR', 'CANCEL'],
  'comparing':      ['PLAN_READY', 'ERROR', 'CANCEL'],
  'transferring':   ['BOOK_STARTED', 'BOOK_COMPLETE', 'TRANSFER_COMPLETE', 'ERROR', 'CANCEL'],
  'completing':     ['TRANSFER_COMPLETE', 'ERROR'],
  'complete':       ['RESET'],  // Terminal, only reset allowed
  'error':          ['RESET'],  // Terminal, only reset allowed
  'cancelled':      ['RESET'],  // Terminal, only reset allowed
}

// ============================================================================
// Initial State
// ============================================================================

const INITIAL_STATE: TransferState = {
  status: 'idle',
  role: null,
  peerId: null,
  remotePeerId: null,
  plan: null,
  currentBookIndex: -1,
  completedBooks: 0,
  stats: null,
  error: null,
}

// ============================================================================
// State Machine Class
// ============================================================================

export class TransferStateMachine {
  private state: TransferState = { ...INITIAL_STATE }
  private listeners = new Set<StateChangeCallback>()
  
  /**
   * Get current state (immutable copy)
   */
  getState(): Readonly<TransferState> {
    return { ...this.state }
  }
  
  /**
   * Get current status
   */
  getStatus(): TransferStatus {
    return this.state.status
  }
  
  /**
   * Check if an action is valid from current state
   */
  can(actionType: TransferAction['type']): boolean {
    return VALID_TRANSITIONS[this.state.status]?.includes(actionType) ?? false
  }
  
  /**
   * Dispatch an action to transition state
   * Returns true if transition was valid, false otherwise
   */
  dispatch(action: TransferAction): boolean {
    // RESET is special - always allowed to return to idle
    if (action.type === 'RESET') {
      const prevState = { ...this.state }
      this.state = { ...INITIAL_STATE }
      log.debug('State reset to idle')
      this.notifyListeners(prevState)
      return true
    }
    
    // Check if transition is valid
    if (!this.can(action.type)) {
      log.warn('Invalid state transition', {
        action: action.type,
        currentState: this.state.status,
        validActions: VALID_TRANSITIONS[this.state.status],
      })
      return false
    }
    
    const prevState = { ...this.state }
    
    // Apply transition
    this.state = this.reduce(this.state, action)
    
    log.debug('State transition', { 
      from: prevState.status, 
      to: this.state.status, 
      action: action.type 
    })
    
    // Notify listeners
    this.notifyListeners(prevState)
    
    return true
  }
  
  /**
   * Subscribe to state changes
   * Returns unsubscribe function
   */
  subscribe(callback: StateChangeCallback): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }
  
  /**
   * Reducer - pure function that computes next state
   */
  private reduce(state: TransferState, action: TransferAction): TransferState {
    switch (action.type) {
      case 'START_SENDER':
        return {
          ...state,
          status: 'initializing',
          role: 'sender',
        }
        
      case 'START_RECEIVER':
        return {
          ...state,
          status: 'connecting',
          role: 'receiver',
          remotePeerId: action.peerId, // We know who we're connecting to
        }
        
      case 'PEER_REGISTERED':
        return {
          ...state,
          status: 'awaiting-peer',
          peerId: action.peerId,
        }
        
      case 'PEER_CONNECTED':
        return {
          ...state,
          status: 'handshaking',
          remotePeerId: action.remotePeerId,
        }
        
      case 'HANDSHAKE_COMPLETE':
        return {
          ...state,
          status: 'comparing',
        }
        
      case 'PLAN_READY':
        return {
          ...state,
          status: 'transferring',
          plan: action.plan,
          currentBookIndex: -1,
          completedBooks: 0,
        }
        
      case 'TRANSFER_STARTED':
        return {
          ...state,
          status: 'transferring',
        }
        
      case 'BOOK_STARTED':
        return {
          ...state,
          currentBookIndex: action.index,
        }
        
      case 'BOOK_COMPLETE':
        return {
          ...state,
          completedBooks: state.completedBooks + 1,
        }
        
      case 'TRANSFER_COMPLETE':
        return {
          ...state,
          status: 'complete',
          stats: action.stats,
        }
        
      case 'ERROR':
        return {
          ...state,
          status: 'error',
          error: action.error,
        }
        
      case 'CANCEL':
        return {
          ...state,
          status: 'cancelled',
        }
        
      case 'RESET':
        return { ...INITIAL_STATE }
        
      default:
        return state
    }
  }
  
  private notifyListeners(prevState: TransferState): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state, prevState)
      } catch (err) {
        log.error('State listener error', err)
      }
    }
  }
  
  // ============================================================================
  // Helper Methods
  // ============================================================================
  
  isIdle(): boolean {
    return this.state.status === 'idle'
  }
  
  isTerminal(): boolean {
    return ['complete', 'error', 'cancelled'].includes(this.state.status)
  }
  
  isActive(): boolean {
    return !this.isIdle() && !this.isTerminal()
  }
  
  isSender(): boolean {
    return this.state.role === 'sender'
  }
  
  isReceiver(): boolean {
    return this.state.role === 'receiver'
  }
  
  getProgress(): { current: number; total: number } {
    const total = this.state.plan?.books.length ?? 0
    return {
      current: this.state.completedBooks,
      total,
    }
  }
  
  getCurrentBook(): BookManifest | null {
    if (this.state.currentBookIndex < 0 || !this.state.plan) {
      return null
    }
    return this.state.plan.books[this.state.currentBookIndex] ?? null
  }
}
