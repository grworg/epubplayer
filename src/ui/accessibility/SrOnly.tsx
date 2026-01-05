/**
 * Screen Reader Only Component
 * 
 * Renders content that is visually hidden but accessible to screen readers.
 * Useful for providing additional context that sighted users can infer visually.
 */

import type { ReactNode } from 'react'

interface SrOnlyProps {
  children: ReactNode
  /** If true, content becomes visible when focused (useful for skip links) */
  focusable?: boolean
  /** HTML element to render as */
  as?: 'span' | 'div' | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
}

export function SrOnly({ children, focusable = false, as: Component = 'span' }: SrOnlyProps) {
  return (
    <Component className={focusable ? 'sr-only sr-only-focusable' : 'sr-only'}>
      {children}
    </Component>
  )
}

