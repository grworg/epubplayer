/**
 * Global Keyboard Shortcuts Hook
 * 
 * Provides keyboard shortcuts for player control that work anywhere in the app.
 * Shortcuts are disabled when focus is on an input element.
 */

import { useEffect, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import { playbackController } from './PlaybackController'
import { usePlayerStore } from './playerStore'
import { useAnnounce } from '@/ui/accessibility'

interface ShortcutHelpItem {
  key: string
  description: string
}

export function getKeyboardShortcuts(): ShortcutHelpItem[] {
  return [
    { key: 'Space', description: t`Play / Pause` },
    { key: '←', description: t`Skip back` },
    { key: '→', description: t`Skip forward` },
    { key: '[', description: t`Previous chapter` },
    { key: ']', description: t`Next chapter` },
    { key: 'B', description: t`Add bookmark` },
    { key: '?', description: t`Show keyboard shortcuts` },
    { key: 'Escape', description: t`Close dialog / Go back` },
  ]
}

interface UseGlobalShortcutsOptions {
  /** Callback to show keyboard shortcuts help */
  onShowHelp?: () => void
  /** Callback to add a bookmark */
  onAddBookmark?: () => void
}

export function useGlobalShortcuts({ onShowHelp, onAddBookmark }: UseGlobalShortcutsOptions = {}) {
  const location = useLocation()
  const navigate = useNavigate()
  const { announce } = useAnnounce()
  
  const currentBook = usePlayerStore((s) => s.currentBook)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  
  // Check if an element is an input-like element where shortcuts should be disabled
  const isInputElement = useCallback((element: Element | null): boolean => {
    if (!element) return false
    
    const tagName = element.tagName.toLowerCase()
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
      return true
    }
    
    // Also check for contenteditable
    if (element.getAttribute('contenteditable') === 'true') {
      return true
    }
    
    return false
  }, [])
  
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Don't handle shortcuts when in an input
    if (isInputElement(document.activeElement)) {
      return
    }
    
    // Don't handle if modifier keys are pressed (except for ?)
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return
    }
    
    const { key } = event
    
    switch (key) {
      case ' ': // Space - Play/Pause
        event.preventDefault()
        if (currentBook) {
          playbackController.togglePlayback()
          announce(isPlaying ? t`Paused` : t`Playing`)
        }
        break
        
      case 'ArrowLeft': // Skip back
        event.preventDefault()
        if (currentBook) {
          playbackController.skipBack()
          announce(t`Skipped back`)
        }
        break
        
      case 'ArrowRight': // Skip forward
        event.preventDefault()
        if (currentBook) {
          playbackController.skipForward()
          announce(t`Skipped forward`)
        }
        break
        
      case '[': // Previous chapter
        event.preventDefault()
        if (currentBook) {
          playbackController.previousSection()
          announce(t`Previous chapter`)
        }
        break
        
      case ']': // Next chapter
        event.preventDefault()
        if (currentBook) {
          playbackController.nextSection()
          announce(t`Next chapter`)
        }
        break
        
      case 'b':
      case 'B': // Add bookmark
        event.preventDefault()
        if (currentBook && onAddBookmark) {
          onAddBookmark()
          announce(t`Adding bookmark`)
        }
        break
        
      case '?': // Show help
        event.preventDefault()
        onShowHelp?.()
        break
        
      case 'Escape': // Close or go back
        // Don't prevent default - let focus trap handle it first
        // Only navigate back if on Now Playing page
        if (location.pathname === '/app/playing') {
          navigate(-1)
        }
        break
        
      case 'p':
      case 'P': // Go to Now Playing
        if (currentBook && location.pathname !== '/app/playing') {
          event.preventDefault()
          navigate('/app/playing')
        }
        break
        
      default:
        // Ignore other keys
        break
    }
  }, [currentBook, isPlaying, isInputElement, location.pathname, navigate, announce, onAddBookmark, onShowHelp])
  
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}

/**
 * Keyboard Shortcuts Help Dialog Component
 */
export function KeyboardShortcutsHelp({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null
  
  const shortcuts = getKeyboardShortcuts()
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Dialog */}
      <div 
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-surface-1 p-6 shadow-2xl"
      >
        <h2 id="shortcuts-title" className="mb-4 text-xl font-bold text-text-primary">
          <Trans>Keyboard Shortcuts</Trans>
        </h2>
        
        <div className="space-y-3">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.key} className="flex items-center justify-between">
              <span className="text-text-secondary">{shortcut.description}</span>
              <kbd className="rounded bg-surface-3 px-2 py-1 font-mono text-sm text-text-primary">
                {shortcut.key}
              </kbd>
            </div>
          ))}
        </div>
        
        <button
          onClick={onClose}
          className="mt-6 w-full rounded-xl bg-surface-2 py-3 font-medium text-text-primary hover:bg-surface-3"
        >
          <Trans>Close</Trans>
        </button>
      </div>
    </div>
  )
}

