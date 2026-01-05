/**
 * Live Region Provider
 * 
 * Provides a context for announcing messages to screen readers via ARIA live regions.
 * Wrap your app with LiveRegionProvider and use the useAnnounce hook to make announcements.
 */

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'

type Politeness = 'polite' | 'assertive'

interface LiveRegionContextValue {
  /** Announce a message to screen readers */
  announce: (message: string, politeness?: Politeness) => void
  /** Clear all announcements */
  clear: () => void
}

const LiveRegionContext = createContext<LiveRegionContextValue | null>(null)

interface LiveRegionProviderProps {
  children: ReactNode
}

export function LiveRegionProvider({ children }: LiveRegionProviderProps) {
  const [politeAnnouncement, setPoliteAnnouncement] = useState('')
  const [assertiveAnnouncement, setAssertiveAnnouncement] = useState('')
  const announcementId = useRef(0)
  
  // Clear announcement after screen reader has time to read it
  const clearAfterDelay = useCallback((politeness: Politeness) => {
    setTimeout(() => {
      if (politeness === 'polite') {
        setPoliteAnnouncement('')
      } else {
        setAssertiveAnnouncement('')
      }
    }, 1000)
  }, [])

  const announce = useCallback((message: string, politeness: Politeness = 'polite') => {
    // Increment ID to force re-render even if message is the same
    announcementId.current += 1
    
    if (politeness === 'polite') {
      // Clear first to ensure announcement is made
      setPoliteAnnouncement('')
      requestAnimationFrame(() => {
        setPoliteAnnouncement(message)
        clearAfterDelay('polite')
      })
    } else {
      setAssertiveAnnouncement('')
      requestAnimationFrame(() => {
        setAssertiveAnnouncement(message)
        clearAfterDelay('assertive')
      })
    }
  }, [clearAfterDelay])

  const clear = useCallback(() => {
    setPoliteAnnouncement('')
    setAssertiveAnnouncement('')
  }, [])

  return (
    <LiveRegionContext.Provider value={{ announce, clear }}>
      {children}
      
      {/* Polite live region - waits for user to stop interacting */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="a11y-live-region"
      >
        {politeAnnouncement}
      </div>
      
      {/* Assertive live region - interrupts immediately */}
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="a11y-live-region"
      >
        {assertiveAnnouncement}
      </div>
    </LiveRegionContext.Provider>
  )
}

/**
 * Hook to access the live region announcement function
 */
export function useAnnounce() {
  const context = useContext(LiveRegionContext)
  
  if (!context) {
    // Return a no-op function if used outside provider (graceful degradation)
    return {
      announce: (message: string, _politeness?: Politeness) => {
        console.warn('[useAnnounce] LiveRegionProvider not found. Message not announced:', message)
      },
      clear: () => {},
    }
  }
  
  return context
}

