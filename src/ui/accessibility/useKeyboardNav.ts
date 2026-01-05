/**
 * Keyboard Navigation Hook
 * 
 * Provides arrow key navigation for lists and grids.
 * Supports both vertical (Up/Down) and horizontal (Left/Right) navigation.
 */

import { useState, useCallback, type KeyboardEvent } from 'react'

interface UseKeyboardNavOptions {
  /** Total number of items */
  itemCount: number
  /** Initial focused index */
  initialIndex?: number
  /** Navigation direction */
  direction?: 'vertical' | 'horizontal' | 'both'
  /** Callback when selection changes via Enter key */
  onSelect?: (index: number) => void
  /** Whether navigation wraps around at boundaries */
  wrap?: boolean
}

interface UseKeyboardNavReturn {
  /** Currently focused index */
  focusedIndex: number
  /** Set focused index manually */
  setFocusedIndex: (index: number) => void
  /** Event handler to attach to the container */
  handleKeyDown: (event: KeyboardEvent) => void
  /** Get props to spread on each item */
  getItemProps: (index: number) => {
    tabIndex: number
    'aria-selected': boolean
    onFocus: () => void
  }
}

export function useKeyboardNav({
  itemCount,
  initialIndex = 0,
  direction = 'vertical',
  onSelect,
  wrap = true,
}: UseKeyboardNavOptions): UseKeyboardNavReturn {
  const [focusedIndex, setFocusedIndex] = useState(initialIndex)

  const moveFocus = useCallback(
    (delta: number) => {
      setFocusedIndex((current) => {
        let next = current + delta
        
        if (wrap) {
          if (next < 0) next = itemCount - 1
          if (next >= itemCount) next = 0
        } else {
          next = Math.max(0, Math.min(itemCount - 1, next))
        }
        
        return next
      })
    },
    [itemCount, wrap]
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const { key } = event

      // Vertical navigation
      if (direction === 'vertical' || direction === 'both') {
        if (key === 'ArrowUp') {
          event.preventDefault()
          moveFocus(-1)
          return
        }
        if (key === 'ArrowDown') {
          event.preventDefault()
          moveFocus(1)
          return
        }
      }

      // Horizontal navigation
      if (direction === 'horizontal' || direction === 'both') {
        if (key === 'ArrowLeft') {
          event.preventDefault()
          moveFocus(-1)
          return
        }
        if (key === 'ArrowRight') {
          event.preventDefault()
          moveFocus(1)
          return
        }
      }

      // Selection
      if (key === 'Enter' || key === ' ') {
        event.preventDefault()
        onSelect?.(focusedIndex)
        return
      }

      // Home/End
      if (key === 'Home') {
        event.preventDefault()
        setFocusedIndex(0)
        return
      }
      if (key === 'End') {
        event.preventDefault()
        setFocusedIndex(itemCount - 1)
        return
      }
    },
    [direction, moveFocus, onSelect, focusedIndex, itemCount]
  )

  const getItemProps = useCallback(
    (index: number) => ({
      tabIndex: index === focusedIndex ? 0 : -1,
      'aria-selected': index === focusedIndex,
      onFocus: () => setFocusedIndex(index),
    }),
    [focusedIndex]
  )

  return {
    focusedIndex,
    setFocusedIndex,
    handleKeyDown,
    getItemProps,
  }
}

