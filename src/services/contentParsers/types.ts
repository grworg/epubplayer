/**
 * Content Parser Types
 *
 * Single source of truth for the multi-source import pipeline.
 * All parsers (EPUB, PDF, Web, Text) produce ParsedContent,
 * which feeds into the shared save pipeline.
 *
 * See ADR-0018 for rationale.
 */

// ============================================================================
// Source Types
// ============================================================================

export type ContentSourceType = 'epub' | 'pdf' | 'web' | 'text'

// ============================================================================
// Parsed Content (output of all parsers)
// ============================================================================

export interface ParsedContent {
  metadata: ContentMetadata
  coverBlob?: Blob
  sections: DetectedSection[]
  originalBlob?: Blob
  contentHash: string
}

export interface ContentMetadata {
  title: string
  author: string
  language?: string
  publisher?: string
  description?: string
  sourceType: ContentSourceType
  sourceUrl?: string
}

// ============================================================================
// Section Detection
// ============================================================================

/**
 * Confidence in a detected section boundary.
 * - high: Explicit heading or TOC entry (EPUB spine, PDF bookmark, HTML h1-h3)
 * - medium: Heuristic match (font size change, "Chapter N" pattern)
 * - low: Fallback split (paragraph boundary, page break, character limit)
 */
export type SectionConfidence = 'high' | 'medium' | 'low'

export interface DetectedSection {
  title: string
  textContent: string
  confidence: SectionConfidence
}

// ============================================================================
// Parser Progress Callbacks
// ============================================================================

export type ImportProgressCallback = (step: string, progress?: number) => void

// ============================================================================
// Section Detector Input Types
// ============================================================================

/**
 * A text block with optional font metadata (from PDF extraction).
 * The section detector uses font info to identify headings.
 */
export interface TextBlock {
  text: string
  fontSize?: number
  fontName?: string
  isBold?: boolean
  pageIndex?: number
}

/**
 * An HTML-structured content block (from web/readability extraction).
 * Preserves heading tags for section splitting.
 */
export interface HtmlBlock {
  tagName: string
  textContent: string
}
