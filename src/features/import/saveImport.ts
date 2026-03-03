/**
 * Shared Save Pipeline
 *
 * Converts ParsedContent from any parser (EPUB, PDF, Web, Text)
 * into Book + Section records in IndexedDB.
 *
 * Single save path for all import methods — deduplication, section creation,
 * and playback initialization happen exactly once here.
 */

import { createLogger } from '@/services/logging'
import {
  bookRepository,
  sectionRepository,
  playbackRepository,
  hashText,
  sectionId,
} from '@/services/storage'
import { settingsRepository } from '@/services/storage/settingsRepository'
import type { Section } from '@/services/storage'
import type { ParsedContent } from '@/services/contentParsers'

const log = createLogger('import')

// ============================================================================
// Public API
// ============================================================================

/**
 * Save parsed content to the library.
 * Returns the book ID on success, or null if the book already exists.
 */
export async function saveImportedContent(
  content: ParsedContent,
): Promise<{ bookId: string } | { error: string }> {
  const { metadata, sections, coverBlob, originalBlob, contentHash } = content

  log.info('Saving imported content', {
    title: metadata.title,
    sourceType: metadata.sourceType,
    sections: sections.length,
  })

  // Generate a stable book ID from the content hash
  const bookId = await hashText(`${metadata.sourceType}:${contentHash}`)

  // Deduplication checks
  const existsById = await bookRepository.exists(bookId)
  if (existsById) {
    log.info('Book already in library (by ID)', { bookId })
    return { error: 'This content is already in your library' }
  }

  const existsByHash = await bookRepository.existsByContentHash(contentHash)
  if (existsByHash) {
    log.info('Book already in library (by content hash)', { contentHash })
    return { error: 'This content is already in your library (same content)' }
  }

  // Build Section records
  const sectionRecords: Section[] = await Promise.all(
    sections.map(async (detected, index) => {
      const textContent = detected.textContent.replace(/\s+/g, ' ').trim()
      const textHash = await hashText(textContent)
      const charCount = textContent.length
      const estimatedDuration = Math.ceil((charCount / 5 / 150) * 60)

      return {
        id: sectionId(bookId, index),
        bookId,
        index,
        title: detected.title || `Section ${index + 1}`,
        href: '',
        textContent,
        textHash,
        charCount,
        estimatedDuration,
      }
    }),
  )

  // Filter out empty sections
  const nonEmptySections = sectionRecords.filter((s) => s.charCount > 0)

  if (nonEmptySections.length === 0) {
    return { error: 'No readable text content found' }
  }

  // Re-index after filtering
  const finalSections = nonEmptySections.map((s, i) => ({
    ...s,
    index: i,
    id: sectionId(bookId, i),
  }))

  // Save book record
  await bookRepository.add({
    id: bookId,
    title: metadata.title,
    author: metadata.author,
    coverBlob,
    language: metadata.language,
    publisher: metadata.publisher,
    description: metadata.description,
    totalSections: finalSections.length,
    epubBlob: originalBlob,
    contentHash,
  })

  // Save section records
  if (finalSections.length > 0) {
    await sectionRepository.addBulk(finalSections)
  }

  // Initialize playback state
  const voiceId = await settingsRepository.get('voiceId')
  const modelConfig = await settingsRepository.get('modelConfig')
  await playbackRepository.initialize(bookId, voiceId, modelConfig)

  log.info('Import saved', {
    bookId,
    title: metadata.title,
    sections: finalSections.length,
  })

  return { bookId }
}
