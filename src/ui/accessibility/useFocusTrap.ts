/**
 * Focus Trap Hook
 * 
 * Traps keyboard focus within a container element (e.g., modals, dialogs).
 * Handles Tab cycling and Escape key to close.
 */

import { useEffect, useRef, useCallback, type RefObject } from 'react'

interface UseFocusTrapOptions {
  /** Whether the focus trap is active */
  isActive: boolean
  /** Callback when Escape key is pressed */
  onEscape?: () => void
  /** Whether to auto-focus the first focusable element when activated */
  autoFocus?: boolean
  /** Whether to restore focus to the previously focused element when deactivated */
  restoreFocus?: boolean
}

// Selector for all focusable elements
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
].join(', ')

export function useFocusTrap<T extends HTMLElement = HTMLDivElement>({
  isActive,
  onEscape,
  autoFocus = true,
  restoreFocus = true,
}: UseFocusTrapOptions): RefObject<T | null> {
  const containerRef = useRef<T>(null)
  const previousActiveElement = useRef<Element | null>(null)

  // Get all focusable elements within the container
  const getFocusableElements = useCallback(() => {
    if (!containerRef.current) return []
    const elements = containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    return Array.from(elements).filter(
      (el) => el.offsetParent !== null && !el.hasAttribute('inert')
    )
  }, [])

  // Handle keydown events
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!isActive) return

      // Handle Escape
      if (event.key === 'Escape' && onEscape) {
        event.preventDefault()
        event.stopPropagation()
        onEscape()
        return
      }

      // Handle Tab
      if (event.key === 'Tab') {
        const focusableElements = getFocusableElements()
        if (focusableElements.length === 0) {
          event.preventDefault()
          return
        }

        const firstElement = focusableElements[0]
        const lastElement = focusableElements[focusableElements.length - 1]
        const activeElement = document.activeElement

        // Shift+Tab on first element -> focus last
        if (event.shiftKey && activeElement === firstElement) {
          event.preventDefault()
          lastElement.focus()
          return
        }

        // Tab on last element -> focus first
        if (!event.shiftKey && activeElement === lastElement) {
          event.preventDefault()
          firstElement.focus()
          return
        }

        // If focus is outside the container, bring it back
        if (!containerRef.current?.contains(activeElement)) {
          event.preventDefault()
          firstElement.focus()
        }
      }
    },
    [isActive, onEscape, getFocusableElements]
  )

  // Set up focus trap
  useEffect(() => {
    if (!isActive) return

    // Store the currently focused element
    if (restoreFocus) {
      previousActiveElement.current = document.activeElement
    }

    // Auto-focus the first focusable element
    if (autoFocus) {
      // Small delay to ensure the modal is rendered
      requestAnimationFrame(() => {
        const focusableElements = getFocusableElements()
        if (focusableElements.length > 0) {
          focusableElements[0].focus()
        } else if (containerRef.current) {
          // If no focusable elements, focus the container itself
          containerRef.current.setAttribute('tabindex', '-1')
          containerRef.current.focus()
        }
      })
    }

    // Add event listener
    document.addEventListener('keydown', handleKeyDown, true)

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)

      // Restore focus when deactivating
      if (restoreFocus && previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus()
      }
    }
  }, [isActive, autoFocus, restoreFocus, handleKeyDown, getFocusableElements])

  return containerRef
}

