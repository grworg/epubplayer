/**
 * Shared Save Pipeline
 *
 * Converts section data into IndexedDB Section records.
 * Used by both the import flow (new book) and the editor (existing book).
 *
 * buildSectionRecords: section data → Section[] (pure transform + hashing)
 * saveImportedContent: full import pipeline (dedup, create book, init playback)
 * saveEditedSections:  replace sections on an existing book
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
// Shared Section Builder
// ============================================================================

/**
 * Convert raw section data into IndexedDB Section records.
 * Normalizes whitespace, hashes text, estimates duration,
 * filters empties, and re-indexes.
 */
export async function buildSectionRecords(
  bookId: string,
  sections: { title: string; textContent: string }[],
): Promise<Section[]> {
  const records: Section[] = await Promise.all(
    sections.map(async (s, index) => {
      const textContent = s.textContent.replace(/\s+/g, ' ').trim()
      const textHash = await hashText(textContent)
      const charCount = textContent.length
      const estimatedDuration = Math.ceil((charCount / 5 / 150) * 60)

      return {
        id: sectionId(bookId, index),
        bookId,
        index,
        title: s.title || `Section ${index + 1}`,
        href: '',
        textContent,
        textHash,
        charCount,
        estimatedDuration,
      }
    }),
  )

  const nonEmpty = records.filter((s) => s.charCount > 0)

  return nonEmpty.map((s, i) => ({
    ...s,
    index: i,
    id: sectionId(bookId, i),
  }))
}

// ============================================================================
// Import (new book)
// ============================================================================

/**
 * Save parsed content to the library.
 * Returns the book ID on success, or an error if the book already exists.
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

  const bookId = await hashText(`${metadata.sourceType}:${contentHash}`)

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

  const finalSections = await buildSectionRecords(bookId, sections)

  if (finalSections.length === 0) {
    return { error: 'No readable text content found' }
  }

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

  await sectionRepository.addBulk(finalSections)

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

// ============================================================================
// Edit existing book
// ============================================================================

/**
 * Replace all sections of an existing book with editor output.
 * Clears audio cache since section content/ordering may have changed.
 */
export async function saveEditedSections(
  bookId: string,
  sections: { title: string; textContent: string }[],
): Promise<void> {
  const finalSections = await buildSectionRecords(bookId, sections)

  await sectionRepository.replaceForBook(bookId, finalSections)
  await bookRepository.update(bookId, { totalSections: finalSections.length })
  await bookRepository.deleteAudioCache(bookId)

  log.info('Book sections updated', { bookId, sections: finalSections.length })
}
