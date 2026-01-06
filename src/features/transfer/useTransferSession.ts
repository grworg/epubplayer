/**
 * useTransferSession Hook
 * 
 * React hook that manages a transfer session.
 * Connects the TransferSession service to React components.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  TransferSession,
  type TransferState,
  type TransferRole,
} from '@/services/transfer'

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
// Hook
// ============================================================================

export interface UseTransferSessionResult {
  /** Current transfer state */
  state: TransferState
  
  /** Start the session. For receiver, pass the peer ID to connect to. */
  start: (peerId?: string) => void
  
  /** Cancel the current session */
  cancel: () => void
  
  /** Reset to idle state (for retry) */
  reset: () => void
}

/**
 * Hook for managing a transfer session.
 * 
 * @param role - Whether this is a 'sender' or 'receiver'
 * @returns Object with state and control functions
 * 
 * @example
 * // Sender usage
 * const { state, start, cancel } = useTransferSession('sender')
 * useEffect(() => { start() }, [start])
 * 
 * @example
 * // Receiver usage
 * const { state, start, cancel } = useTransferSession('receiver')
 * const handleConnect = (code: string) => start(code)
 */
export function useTransferSession(role: TransferRole): UseTransferSessionResult {
  const [state, setState] = useState<TransferState>(INITIAL_STATE)
  const sessionRef = useRef<TransferSession | null>(null)
  const startedRef = useRef(false)
  
  // Create session on mount
  useEffect(() => {
    const session = new TransferSession(role)
    sessionRef.current = session
    
    // Subscribe to state changes
    const unsubscribe = session.subscribe(setState)
    
    // Cleanup on unmount
    return () => {
      unsubscribe()
      session.destroy()
      sessionRef.current = null
    }
  }, [role])
  
  // Start the session
  const start = useCallback((peerId?: string) => {
    if (!sessionRef.current) return
    if (startedRef.current) return // Prevent double-start
    
    startedRef.current = true
    sessionRef.current.start(peerId).catch(() => {
      // Errors are handled via state machine
    })
  }, [])
  
  // Cancel the session
  const cancel = useCallback(() => {
    sessionRef.current?.cancel()
    startedRef.current = false
  }, [])
  
  // Reset for retry
  const reset = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.destroy()
      // Create new session
      const newSession = new TransferSession(role)
      sessionRef.current = newSession
      newSession.subscribe(setState)
      startedRef.current = false
      setState(INITIAL_STATE)
    }
  }, [role])
  
  return { state, start, cancel, reset }
}

// ============================================================================
// Convenience Hooks
// ============================================================================

/**
 * Hook specifically for sender mode.
 * Automatically starts the session on mount.
 */
export function useSenderSession() {
  const result = useTransferSession('sender')
  
  useEffect(() => {
    result.start()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  
  return result
}

/**
 * Hook specifically for receiver mode.
 * Does not auto-start - call start(peerId) when ready.
 */
export function useReceiverSession() {
  return useTransferSession('receiver')
}
