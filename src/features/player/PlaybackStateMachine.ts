/**
 * Playback State Machine
 * 
 * Single source of truth for playback state.
 * Prevents invalid state transitions and race conditions.
 */

import { createLogger } from '@/services/logging'
import { usePlayerStore } from './playerStore'

const log = createLogger('playback')

// ============================================================================
// Types
// ============================================================================

export type PlaybackStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'buffering'

export interface PlaybackState {
  status: PlaybackStatus
  bookId: string | null
  sectionIndex: number
  chunkIndex: number
  error: string | null
}

export type PlaybackAction =
  | { type: 'LOAD_BOOK'; bookId: string }
  | { type: 'LOADED' }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'UNLOAD' }
  | { type: 'BUFFER_NEEDED' }
  | { type: 'BUFFER_READY' }
  | { type: 'CHUNK_ENDED' }
  | { type: 'ADVANCE_CHUNK'; sectionIndex: number; chunkIndex: number }
  | { type: 'SEEK_CHUNK'; sectionIndex: number; chunkIndex: number }
  | { type: 'ERROR'; error: string }
  | { type: 'CLEAR_ERROR' }

type StateChangeCallback = (state: PlaybackState, prevState: PlaybackState) => void

// ============================================================================
// Valid Transitions Map
// ============================================================================

const VALID_TRANSITIONS: Record<PlaybackStatus, PlaybackAction['type'][]> = {
  idle: ['LOAD_BOOK'],
  loading: ['LOADED', 'ERROR', 'UNLOAD'],
  ready: ['PLAY', 'UNLOAD', 'SEEK_CHUNK', 'ADVANCE_CHUNK'],
  playing: ['PAUSE', 'BUFFER_NEEDED', 'CHUNK_ENDED', 'ADVANCE_CHUNK', 'SEEK_CHUNK', 'STOP', 'ERROR', 'UNLOAD'],
  paused: ['RESUME', 'STOP', 'UNLOAD', 'SEEK_CHUNK'],
  buffering: ['BUFFER_READY', 'PAUSE', 'STOP', 'ERROR', 'UNLOAD'],
}

// ============================================================================
// State Machine
// ============================================================================

const INITIAL_STATE: PlaybackState = {
  status: 'idle',
  bookId: null,
  sectionIndex: 0,
  chunkIndex: 0,
  error: null,
}

class PlaybackStateMachine {
  private state: PlaybackState = { ...INITIAL_STATE }

  private listeners: Set<StateChangeCallback> = new Set()
  private _abortController: AbortController | null = null

  /**
   * Get current state (immutable copy)
   */
  getState(): Readonly<PlaybackState> {
    return { ...this.state }
  }

  /**
   * Get current status
   */
  getStatus(): PlaybackStatus {
    return this.state.status
  }

  /**
   * Check if an action is valid from current state
   */
  can(actionType: PlaybackAction['type']): boolean {
    return VALID_TRANSITIONS[this.state.status]?.includes(actionType) ?? false
  }

  /**
   * Get abort signal for current operation
   * Creates a new AbortController if needed
   */
  get abortSignal(): AbortSignal {
    if (!this._abortController) {
      this._abortController = new AbortController()
    }
    return this._abortController.signal
  }

  /**
   * Abort any ongoing operations
   */
  abort(): void {
    if (this._abortController) {
      this._abortController.abort()
      this._abortController = null
    }
  }

  /**
   * Create fresh abort controller (call when starting new operation)
   */
  resetAbortController(): AbortSignal {
    this.abort()
    this._abortController = new AbortController()
    return this._abortController.signal
  }

  /**
   * Dispatch an action to transition state
   */
  dispatch(action: PlaybackAction): boolean {
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
    
    log.debug('State transition', { from: prevState.status, to: this.state.status, action: action.type })

    // Notify listeners
    this.notifyListeners(prevState)

    // Sync to Zustand store
    this.syncToStore()

    return true
  }

  /**
   * Force set state (use sparingly, mainly for initialization)
   */
  setState(partial: Partial<PlaybackState>): void {
    // Validate numeric values
    if (partial.sectionIndex !== undefined && isNaN(partial.sectionIndex)) {
      log.error('setState with invalid sectionIndex', { sectionIndex: partial.sectionIndex })
      partial.sectionIndex = 0
    }
    if (partial.chunkIndex !== undefined && isNaN(partial.chunkIndex)) {
      log.error('setState with invalid chunkIndex', { chunkIndex: partial.chunkIndex })
      partial.chunkIndex = 0
    }
    
    const prevState = { ...this.state }
    this.state = { ...this.state, ...partial }
    this.notifyListeners(prevState)
    this.syncToStore()
  }

  /**
   * Subscribe to state changes
   */
  subscribe(callback: StateChangeCallback): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  /**
   * Reducer - pure function that computes next state
   */
  private reduce(state: PlaybackState, action: PlaybackAction): PlaybackState {
    switch (action.type) {
      case 'LOAD_BOOK':
        this.resetAbortController()
        return {
          ...state,
          status: 'loading',
          bookId: action.bookId,
          sectionIndex: 0,
          chunkIndex: 0,
          error: null,
        }

      case 'LOADED':
        return {
          ...state,
          status: 'ready',
          error: null,
        }

      case 'PLAY':
        return {
          ...state,
          status: 'playing',
        }

      case 'PAUSE':
        return {
          ...state,
          status: 'paused',
        }

      case 'RESUME':
        return {
          ...state,
          status: 'playing',
        }

      case 'STOP':
        this.abort()
        return {
          ...state,
          status: 'ready',
        }

      case 'UNLOAD':
        this.abort()
        return {
          status: 'idle',
          bookId: null,
          sectionIndex: 0,
          chunkIndex: 0,
          error: null,
        }

      case 'BUFFER_NEEDED':
        return {
          ...state,
          status: 'buffering',
        }

      case 'BUFFER_READY':
        return {
          ...state,
          status: 'playing',
        }

      case 'CHUNK_ENDED':
        return {
          ...state,
          status: 'ready',
        }

      case 'ADVANCE_CHUNK':
        // Validate indices to prevent NaN
        if (isNaN(action.sectionIndex) || isNaN(action.chunkIndex)) {
          log.error('ADVANCE_CHUNK with invalid indices', action)
          return state
        }
        // Transition to ready so playCurrentChunk can dispatch PLAY
        return {
          ...state,
          status: 'ready',
          sectionIndex: action.sectionIndex,
          chunkIndex: action.chunkIndex,
        }

      case 'SEEK_CHUNK':
        // Validate indices to prevent NaN
        if (isNaN(action.sectionIndex) || isNaN(action.chunkIndex)) {
          log.error('SEEK_CHUNK with invalid indices', action)
          return state
        }
        this.abort()
        this.resetAbortController()
        // Transition to ready so playCurrentChunk can dispatch PLAY
        return {
          ...state,
          status: 'ready',
          sectionIndex: action.sectionIndex,
          chunkIndex: action.chunkIndex,
        }

      case 'ERROR':
        this.abort()
        return {
          ...state,
          status: 'ready',
          error: action.error,
        }

      case 'CLEAR_ERROR':
        return {
          ...state,
          error: null,
        }

      default:
        return state
    }
  }

  private notifyListeners(prevState: PlaybackState): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state, prevState)
      } catch (e) {
        log.error('State listener error', e)
      }
    }
  }

  /**
   * Sync state machine state to Zustand store for UI consumption
   */
  private syncToStore(): void {
    const store = usePlayerStore.getState()
    
    store.setPlaybackStatus(this.state.status)
    store.setPosition({
      sectionIndex: this.state.sectionIndex,
      chunkIndex: this.state.chunkIndex,
    })
    
    if (this.state.error) {
      store.setError(this.state.error)
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  isPlaying(): boolean {
    return this.state.status === 'playing'
  }

  isPaused(): boolean {
    return this.state.status === 'paused'
  }

  isBuffering(): boolean {
    return this.state.status === 'buffering'
  }

  isReady(): boolean {
    return this.state.status === 'ready'
  }

  isIdle(): boolean {
    return this.state.status === 'idle'
  }

  isActive(): boolean {
    return ['playing', 'paused', 'buffering'].includes(this.state.status)
  }

  getCurrentBookId(): string | null {
    return this.state.bookId
  }

  getCurrentPosition(): { sectionIndex: number; chunkIndex: number } {
    return {
      sectionIndex: this.state.sectionIndex,
      chunkIndex: this.state.chunkIndex,
    }
  }

  /**
   * Reset state machine to initial state (for debugging)
   */
  reset(): void {
    this.abort()
    this._abortController = new AbortController()
    const prevState = { ...this.state }
    this.state = { ...INITIAL_STATE }
    this.notifyListeners(prevState)
    this.syncToStore()
    log.info('State machine reset to initial state')
  }
}

// Singleton instance
export const playbackStateMachine = new PlaybackStateMachine()

