/**
 * Unified Import Hook
 *
 * Manages the multi-source import flow:
 * 1. Parse source (EPUB, PDF, URL, or pasted text)
 * 2. Show section preview for user confirmation
 * 3. Save to library
 *
 * Coordinates parsers, progress, and the save pipeline.
 */

import { useState, useCallback } from 'react'
import { createLogger } from '@/services/logging'
import type {
  ParsedContent,
  ImportProgressCallback,
  DiscoveredPage,
  DetectedSection,
} from '@/services/contentParsers'
import {
  parseEPUBToContent,
  parsePDF,
  parseText,
  parseMultiPageWebsite,
  fetchAndDiscover,
  parseHtmlContent,
  parseUrlWithReader,
  FetchError,
  ThinContentError,
} from '@/services/contentParsers'
import { saveImportedContent } from './saveImport'

const log = createLogger('import')

// ============================================================================
// Types
// ============================================================================

export type ImportStep =
  | 'idle'
  | 'processing'
  | 'pagePicker'
  | 'preview'
  | 'saving'
  | 'success'
  | 'error'

export interface ImportState {
  step: ImportStep
  progressLabel: string
  progressPercent: number
  error: string | null
  parsedContent: ParsedContent | null
  bookId: string | null
  /** When URL fetch fails, suggest paste fallback */
  suggestPaste: boolean
  /** Discovered sibling pages for multi-page sites */
  discoveredPages: DiscoveredPage[]
  /** HTML from the initial fetch (reused if user skips page picker) */
  fetchedHtml: string | null
  fetchedUrl: string | null
}

const INITIAL_STATE: ImportState = {
  step: 'idle',
  progressLabel: '',
  progressPercent: 0,
  error: null,
  parsedContent: null,
  bookId: null,
  suggestPaste: false,
  discoveredPages: [],
  fetchedHtml: null,
  fetchedUrl: null,
}

// ============================================================================
// Hook
// ============================================================================

export function useImport() {
  const [state, setState] = useState<ImportState>(INITIAL_STATE)

  const updateProgress: ImportProgressCallback = useCallback(
    (step: string, progress?: number) => {
      setState((prev) => ({
        ...prev,
        progressLabel: step,
        progressPercent: progress ?? prev.progressPercent,
      }))
    },
    [],
  )

  // ---- File Import (EPUB or PDF) ----

  const importFile = useCallback(
    async (file: File) => {
      setState({
        ...INITIAL_STATE,
        step: 'processing',
        progressLabel: 'Reading file...',
      })

      try {
        let content: ParsedContent

        if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
          content = await parsePDF(file, {
            onProgress: updateProgress,
            onScanDetected: async () => {
              // For now, auto-proceed with OCR
              // Future: could prompt user via a callback
              return true
            },
          })
        } else {
          content = await parseEPUBToContent(file, {
            onProgress: updateProgress,
          })
        }

        setState((prev) => ({
          ...prev,
          step: 'preview',
          parsedContent: content,
          progressLabel: '',
          progressPercent: 100,
        }))
      } catch (error) {
        log.error('File import failed', error)
        setState((prev) => ({
          ...prev,
          step: 'error',
          error: error instanceof Error ? error.message : 'Failed to read file',
        }))
      }
    },
    [updateProgress],
  )

  // ---- URL Import (two-step: fetch+discover, then parse) ----

  const importUrl = useCallback(
    async (url: string) => {
      setState({
        ...INITIAL_STATE,
        step: 'processing',
        progressLabel: 'Fetching page...',
      })

      try {
        // Step 1: Fetch HTML and discover sibling pages
        const { html, finalUrl, pages } = await fetchAndDiscover(url, updateProgress)

        if (pages.length >= 2) {
          setState((prev) => ({
            ...prev,
            step: 'pagePicker',
            discoveredPages: pages,
            fetchedHtml: html,
            fetchedUrl: finalUrl,
            progressLabel: '',
          }))
          return
        }

        // Step 2: Extract article with Readability
        updateProgress('Extracting article...', 50)
        const content = await parseHtmlContent(html, finalUrl, updateProgress)

        setState((prev) => ({
          ...prev,
          step: 'preview',
          parsedContent: content,
          progressLabel: '',
          progressPercent: 100,
        }))
      } catch (error) {
        const shouldTryReader =
          error instanceof FetchError || error instanceof ThinContentError

        if (!shouldTryReader) {
          log.error('URL import failed', error)
          setState((prev) => ({
            ...prev,
            step: 'error',
            error: error instanceof Error ? error.message : 'Failed to fetch URL',
            suggestPaste: true,
          }))
          return
        }

        // Step 3: Fetch or Readability failed — try Jina Reader (once)
        log.info('Primary strategy failed, trying reader service', {
          reason: error instanceof ThinContentError
            ? `thin content (${error.extractedChars} chars)`
            : 'fetch failed',
        })

        try {
          const content = await parseUrlWithReader(url, updateProgress)
          setState((prev) => ({
            ...prev,
            step: 'preview',
            parsedContent: content,
            progressLabel: '',
            progressPercent: 100,
          }))
        } catch (readerError) {
          log.error('All URL import strategies exhausted', readerError)
          setState((prev) => ({
            ...prev,
            step: 'error',
            error:
              'Could not extract content from this page. Try pasting the article text instead.',
            suggestPaste: true,
          }))
        }
      }
    },
    [updateProgress],
  )

  // ---- Import selected pages from a multi-page site ----

  const importSelectedPages = useCallback(
    async (pages: { url: string; title: string }[]) => {
      setState((prev) => ({
        ...prev,
        step: 'processing',
        progressLabel: 'Fetching pages...',
        discoveredPages: [],
      }))

      try {
        const content = await parseMultiPageWebsite(pages, {
          onProgress: updateProgress,
        })

        setState((prev) => ({
          ...prev,
          step: 'preview',
          parsedContent: content,
          progressLabel: '',
          progressPercent: 100,
        }))
      } catch (error) {
        log.error('Multi-page import failed', error)
        setState((prev) => ({
          ...prev,
          step: 'error',
          error: error instanceof Error ? error.message : 'Failed to fetch pages',
        }))
      }
    },
    [updateProgress],
  )

  // ---- Import single page (skip page picker) ----

  const importSinglePage = useCallback(async () => {
    if (!state.fetchedHtml || !state.fetchedUrl) return

    setState((prev) => ({
      ...prev,
      step: 'processing',
      progressLabel: 'Extracting article...',
      discoveredPages: [],
    }))

    try {
      const content = await parseHtmlContent(
        state.fetchedHtml,
        state.fetchedUrl,
        updateProgress,
      )

      setState((prev) => ({
        ...prev,
        step: 'preview',
        parsedContent: content,
        progressLabel: '',
        progressPercent: 100,
      }))
    } catch (error) {
      log.error('Single page parse failed', error)
      setState((prev) => ({
        ...prev,
        step: 'error',
        error: error instanceof Error ? error.message : 'Failed to parse page',
      }))
    }
  }, [state.fetchedHtml, state.fetchedUrl, updateProgress])

  // ---- Paste Import ----

  const importText = useCallback(
    async (text: string, title: string, author?: string) => {
      setState({
        ...INITIAL_STATE,
        step: 'processing',
        progressLabel: 'Processing text...',
      })

      try {
        const content = await parseText(text, {
          title,
          author,
          onProgress: updateProgress,
        })

        setState((prev) => ({
          ...prev,
          step: 'preview',
          parsedContent: content,
          progressLabel: '',
          progressPercent: 100,
        }))
      } catch (error) {
        log.error('Text import failed', error)
        setState((prev) => ({
          ...prev,
          step: 'error',
          error: error instanceof Error ? error.message : 'Failed to process text',
        }))
      }
    },
    [updateProgress],
  )

  // ---- Update metadata before saving ----

  const updateMetadata = useCallback(
    (updates: { title?: string; author?: string }) => {
      setState((prev) => {
        if (!prev.parsedContent) return prev
        return {
          ...prev,
          parsedContent: {
            ...prev.parsedContent,
            metadata: {
              ...prev.parsedContent.metadata,
              ...updates,
            },
          },
        }
      })
    },
    [],
  )

  // ---- Save to library ----
  // Accepts optional overrides so callers (e.g. the book editor) can pass
  // edited sections/metadata directly without async state-update races.

  const save = useCallback(async (overrides?: {
    sections?: DetectedSection[]
    metadata?: { title?: string; author?: string }
  }): Promise<string | null> => {
    if (!state.parsedContent) return null

    const content: ParsedContent = overrides
      ? {
          ...state.parsedContent,
          ...(overrides.sections && { sections: overrides.sections }),
          metadata: { ...state.parsedContent.metadata, ...overrides.metadata },
        }
      : state.parsedContent

    setState((prev) => ({
      ...prev,
      step: 'saving',
      progressLabel: 'Saving to library...',
    }))

    try {
      const result = await saveImportedContent(content)

      if ('error' in result) {
        setState((prev) => ({
          ...prev,
          step: 'error',
          error: result.error,
        }))
        return null
      }

      setState((prev) => ({
        ...prev,
        step: 'success',
        bookId: result.bookId,
        progressLabel: 'Import complete!',
      }))

      return result.bookId
    } catch (error) {
      log.error('Save failed', error)
      setState((prev) => ({
        ...prev,
        step: 'error',
        error: error instanceof Error ? error.message : 'Failed to save',
      }))
      return null
    }
  }, [state.parsedContent])

  // ---- Reset ----

  const reset = useCallback(() => {
    setState(INITIAL_STATE)
  }, [])

  return {
    ...state,
    importFile,
    importUrl,
    importSelectedPages,
    importSinglePage,
    importText,
    updateMetadata,
    save,
    reset,
  }
}
