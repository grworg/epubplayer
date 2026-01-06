/**
 * Book Provider
 * 
 * Interface and implementation for providing books to transfer.
 * Abstracts the storage layer for testability.
 */

import { bookRepository } from '@/services/storage'
import { hashBlob } from '@/services/storage/db'
import type { BookManifest } from './transferProtocol'

// ============================================================================
// Interface
// ============================================================================

/**
 * Provides access to books for transfer operations.
 * Abstracted to enable testing without real storage.
 */
export interface BookProvider {
  /**
   * Get list of all books that can be transferred.
   * Only includes books with valid EPUB data.
   */
  getTransferableBooks(): Promise<BookManifest[]>
  
  /**
   * Get the EPUB blob data for a specific book.
   */
  getBookData(id: string): Promise<Blob>
}

// ============================================================================
// Default Implementation
// ============================================================================

/**
 * Default implementation using the book repository.
 */
export class DefaultBookProvider implements BookProvider {
  async getTransferableBooks(): Promise<BookManifest[]> {
    const books = await bookRepository.getAll()
    const transferable: BookManifest[] = []
    
    for (const book of books) {
      // Only include books with EPUB data
      if (!book.epubBlob || book.epubBlob.size === 0) {
        continue
      }
      
      // Compute hash if not present
      const contentHash = book.contentHash || await hashBlob(book.epubBlob)
      
      transferable.push({
        id: book.id,
        title: book.title,
        author: book.author,
        contentHash,
        size: book.epubBlob.size,
      })
    }
    
    return transferable
  }
  
  async getBookData(id: string): Promise<Blob> {
    const book = await bookRepository.get(id)
    
    if (!book) {
      throw new Error(`Book not found: ${id}`)
    }
    
    if (!book.epubBlob || book.epubBlob.size === 0) {
      throw new Error(`Book has no EPUB data: ${id}`)
    }
    
    return book.epubBlob
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a book provider instance.
 * Uses the default implementation with real storage.
 */
export function createBookProvider(): BookProvider {
  return new DefaultBookProvider()
}
