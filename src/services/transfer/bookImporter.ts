/**
 * Book Importer
 * 
 * Interface and implementation for importing received books.
 * Abstracts the storage/parsing layer for testability.
 */

import { createLogger } from '@/services/logging'
import { parseEPUB } from '@/services/epub'
import { bookRepository, sectionRepository, playbackRepository } from '@/services/storage'
import { settingsRepository } from '@/services/storage/settingsRepository'
import { hashBlob } from '@/services/storage/db'
import type { BookManifest } from './transferProtocol'

const log = createLogger('transfer')

// ============================================================================
// Types
// ============================================================================

export interface ImportResult {
  success: boolean
  error?: string
  alreadyExists?: boolean
}

// ============================================================================
// Interface
// ============================================================================

/**
 * Handles importing received books into local storage.
 * Abstracted to enable testing without real storage.
 */
export interface BookImporter {
  /**
   * Get content hashes of all books already in the library.
   * Used by receiver to tell sender what books to skip.
   */
  getExistingHashes(): Promise<string[]>
  
  /**
   * Import a received book into the library.
   * Handles parsing, deduplication, and storage.
   */
  importBook(manifest: BookManifest, data: Blob): Promise<ImportResult>
}

// ============================================================================
// Default Implementation
// ============================================================================

/**
 * Default implementation using real storage and parsing.
 */
export class DefaultBookImporter implements BookImporter {
  async getExistingHashes(): Promise<string[]> {
    return bookRepository.getAllContentHashes()
  }
  
  async importBook(manifest: BookManifest, data: Blob): Promise<ImportResult> {
    try {
      // Create a File object from the blob
      const file = new File([data], `${manifest.title}.epub`, {
        type: 'application/epub+zip',
      })
      
      // Verify content hash matches
      const computedHash = await hashBlob(file)
      if (computedHash !== manifest.contentHash) {
        log.warn('Content hash mismatch', {
          expected: manifest.contentHash,
          computed: computedHash,
          title: manifest.title,
        })
        // Continue anyway - the book might still be valid
      }
      
      // Parse the EPUB
      log.debug('Parsing EPUB', { title: manifest.title })
      const { book: parsedBook, sections } = await parseEPUB(file)
      
      // Check if book already exists (by ID or hash)
      const existsById = await bookRepository.exists(parsedBook.id)
      const existsByHash = await bookRepository.existsByContentHash(manifest.contentHash)
      
      if (existsById || existsByHash) {
        log.info('Book already exists', { title: manifest.title })
        return { success: true, alreadyExists: true }
      }
      
      // Save the book
      log.debug('Saving book', { title: parsedBook.title, sections: sections.length })
      await bookRepository.add({
        ...parsedBook,
        epubBlob: file,
        contentHash: manifest.contentHash,
      })
      
      // Save sections
      if (sections.length > 0) {
        await sectionRepository.addBulk(sections)
      }
      
      // Initialize playback state with current voice settings
      const voiceId = await settingsRepository.get('voiceId')
      const modelConfig = await settingsRepository.get('modelConfig')
      await playbackRepository.initialize(parsedBook.id, voiceId, modelConfig)
      
      log.info('Book imported successfully', { title: parsedBook.title })
      return { success: true }
      
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      log.error('Failed to import book', { title: manifest.title, error: message })
      return { success: false, error: message }
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a book importer instance.
 * Uses the default implementation with real storage.
 */
export function createBookImporter(): BookImporter {
  return new DefaultBookImporter()
}
