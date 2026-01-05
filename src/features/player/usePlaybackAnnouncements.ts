/**
 * Playback Announcements Hook
 * 
 * Subscribes to playback state changes and announces them to screen readers.
 * This hook should be used once at the app level.
 */

import { useEffect, useRef } from 'react'
import { usePlayerStore } from './playerStore'
import { useAnnounce } from '@/ui/accessibility'

export function usePlaybackAnnouncements() {
  const { announce } = useAnnounce()
  
  // Track previous values to detect changes
  const prevStatus = useRef<string | null>(null)
  const prevBook = useRef<string | null>(null)
  const prevSection = useRef<string | null>(null)
  const prevError = useRef<string | null>(null)
  
  // Subscribe to relevant state changes
  const status = usePlayerStore((s) => s.status)
  const currentBook = usePlayerStore((s) => s.currentBook)
  const currentSectionTitle = usePlayerStore((s) => s.currentSectionTitle)
  const error = usePlayerStore((s) => s.error)
  const isBuffering = usePlayerStore((s) => s.isBuffering)
  const bufferProgress = usePlayerStore((s) => s.bufferProgress)
  
  // Announce playback status changes
  useEffect(() => {
    if (prevStatus.current === status) return
    
    // Skip initial idle state
    if (prevStatus.current === null && status === 'idle') {
      prevStatus.current = status
      return
    }
    
    prevStatus.current = status
    
    switch (status) {
      case 'playing':
        announce('Playback started')
        break
      case 'paused':
        announce('Playback paused')
        break
      case 'buffering':
        // Only announce buffering after a brief delay to avoid spam
        // The actual announcement is handled below with progress
        break
      case 'ready':
        announce('Ready to play')
        break
      case 'error':
        // Error is announced separately with the error message
        break
    }
  }, [status, announce])
  
  // Announce book changes
  useEffect(() => {
    const bookId = currentBook?.id ?? null
    if (prevBook.current === bookId) return
    prevBook.current = bookId
    
    if (currentBook) {
      announce(`Now playing: ${currentBook.title} by ${currentBook.author}`)
    }
  }, [currentBook, announce])
  
  // Announce chapter/section changes
  useEffect(() => {
    if (prevSection.current === currentSectionTitle) return
    if (!currentSectionTitle) return
    
    const isInitialLoad = prevSection.current === null
    prevSection.current = currentSectionTitle
    
    // Don't announce on initial load (book announcement covers it)
    if (isInitialLoad) return
    
    announce(`Chapter: ${currentSectionTitle}`)
  }, [currentSectionTitle, announce])
  
  // Announce errors
  useEffect(() => {
    if (prevError.current === error) return
    prevError.current = error
    
    if (error) {
      announce(`Error: ${error}`, 'assertive')
    }
  }, [error, announce])
  
  // Announce buffering progress periodically (not on every update)
  const lastBufferAnnounce = useRef(0)
  useEffect(() => {
    if (!isBuffering) return
    
    const now = Date.now()
    // Only announce every 5 seconds to avoid spam
    if (now - lastBufferAnnounce.current < 5000) return
    lastBufferAnnounce.current = now
    
    if (bufferProgress > 0) {
      announce(`Buffering: ${Math.round(bufferProgress * 100)}% complete`)
    } else {
      announce('Buffering audio...')
    }
  }, [isBuffering, bufferProgress, announce])
}

