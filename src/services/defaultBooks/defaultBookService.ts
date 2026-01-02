import { parseEPUB } from '@/services/epub'
import { bookRepository, sectionRepository, playbackRepository } from '@/services/storage'
import { settingsRepository } from '@/services/storage/settingsRepository'

// ============================================================================
// Default Book Configuration
// ============================================================================

export interface DefaultBookInfo {
  id: string // Stable ID so we can check if it's installed
  path: string // Path relative to public folder
  filename: string // Original filename for parsing
}

/**
 * List of default books bundled with the app.
 * These are public domain works that users can try immediately.
 */
export const DEFAULT_BOOKS: DefaultBookInfo[] = [
  {
    id: 'default:alice-in-wonderland',
    path: '/books/alice-in-wonderland.epub',
    filename: 'alice-in-wonderland.epub',
  },
]

// ============================================================================
// Default Book Service
// ============================================================================

export const defaultBookService = {
  /**
   * Check if a default book is already installed
   */
  async isInstalled(bookId: string): Promise<boolean> {
    return bookRepository.exists(bookId)
  },

  /**
   * Check if any default books are installed
   */
  async hasAnyDefaultBooks(): Promise<boolean> {
    for (const book of DEFAULT_BOOKS) {
      if (await this.isInstalled(book.id)) {
        return true
      }
    }
    return false
  },

  /**
   * Install a specific default book
   */
  async installBook(bookInfo: DefaultBookInfo): Promise<string | null> {
    try {
      // Check if already installed
      if (await this.isInstalled(bookInfo.id)) {
        console.log('[DefaultBooks] Book already installed:', bookInfo.id)
        return bookInfo.id
      }

      console.log('[DefaultBooks] Installing default book:', bookInfo.path)

      // Fetch the EPUB from the public folder
      const response = await fetch(bookInfo.path)
      if (!response.ok) {
        throw new Error(`Failed to fetch default book: ${response.status}`)
      }

      const blob = await response.blob()
      
      // Create a File object (needed by parseEPUB)
      const file = new File([blob], bookInfo.filename, {
        type: 'application/epub+zip',
      })

      // Parse the EPUB
      const { book, sections } = await parseEPUB(file)
      console.log('[DefaultBooks] Parsed:', book.title, 'with', sections.length, 'sections')

      // Override the ID to use our stable default ID
      const bookWithStableId = {
        ...book,
        id: bookInfo.id,
        epubBlob: file,
      }

      // Update section IDs to match
      const sectionsWithStableId = sections.map((section) => ({
        ...section,
        bookId: bookInfo.id,
        id: `${bookInfo.id}:${section.index}`,
      }))

      // Save to database
      await bookRepository.add(bookWithStableId)
      if (sectionsWithStableId.length > 0) {
        await sectionRepository.addBulk(sectionsWithStableId)
      }

      // Initialize playback state
      const voiceId = await settingsRepository.get('voiceId')
      const modelConfig = await settingsRepository.get('modelConfig')
      await playbackRepository.initialize(bookInfo.id, voiceId, modelConfig)

      console.log('[DefaultBooks] Successfully installed:', book.title)
      return bookInfo.id
    } catch (error) {
      console.error('[DefaultBooks] Failed to install book:', error)
      return null
    }
  },

  /**
   * Install all default books that aren't already installed
   */
  async installAllDefaults(): Promise<string[]> {
    const installed: string[] = []

    for (const bookInfo of DEFAULT_BOOKS) {
      const id = await this.installBook(bookInfo)
      if (id) {
        installed.push(id)
      }
    }

    return installed
  },

  /**
   * Install the primary default book (first in the list)
   * This is the main sample book for new users.
   */
  async installPrimaryDefault(): Promise<string | null> {
    if (DEFAULT_BOOKS.length === 0) {
      return null
    }
    return this.installBook(DEFAULT_BOOKS[0])
  },
}

