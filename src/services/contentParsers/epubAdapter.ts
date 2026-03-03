/**
 * EPUB Adapter
 *
 * Wraps the existing EPUB parser to produce ParsedContent
 * for the shared import pipeline. The epubjs-based parser stays
 * unchanged internally — this is just a thin output adapter.
 *
 * EPUB sections from the spine are already high-quality,
 * so they skip the sectionDetector and map directly with confidence: 'high'.
 */

import { createLogger } from '@/services/logging'
import { parseEPUB } from '@/services/epub'
import { hashBlob } from '@/services/storage/db'
import type { ParsedContent, ImportProgressCallback } from './types'

const log = createLogger('import')

// ============================================================================
// Public API
// ============================================================================

export interface EPUBParseOptions {
  onProgress?: ImportProgressCallback
}

export async function parseEPUBToContent(
  file: File,
  options: EPUBParseOptions = {},
): Promise<ParsedContent> {
  const { onProgress } = options

  onProgress?.('Reading EPUB...', 10)
  log.info('Starting EPUB import', { filename: file.name })

  const contentHash = await hashBlob(file)

  onProgress?.('Parsing EPUB...', 30)
  const { book, sections } = await parseEPUB(file)

  onProgress?.('Done', 100)

  log.info('EPUB parsed for import', {
    title: book.title,
    sections: sections.length,
  })

  return {
    metadata: {
      title: book.title,
      author: book.author,
      language: book.language,
      publisher: book.publisher,
      description: book.description,
      sourceType: 'epub',
    },
    coverBlob: book.coverBlob,
    sections: sections.map((s) => ({
      title: s.title,
      textContent: s.textContent,
      confidence: 'high' as const,
    })),
    originalBlob: file,
    contentHash,
  }
}
