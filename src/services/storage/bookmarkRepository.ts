import { db, type Bookmark } from './db'

// ============================================================================
// Bookmark Repository
// ============================================================================

export const bookmarkRepository = {
  /**
   * Add a new bookmark
   */
  async add(bookmark: Omit<Bookmark, 'id' | 'createdAt'>): Promise<string> {
    const id = crypto.randomUUID()
    const fullBookmark: Bookmark = {
      ...bookmark,
      id,
      createdAt: new Date(),
    }
    await db.bookmarks.add(fullBookmark)
    return id
  },

  /**
   * Get all bookmarks for a book, sorted by position
   */
  async getForBook(bookId: string): Promise<Bookmark[]> {
    const bookmarks = await db.bookmarks.where('bookId').equals(bookId).toArray()

    // Sort by section, chunk, then time
    return bookmarks.sort((a, b) => {
      if (a.sectionIndex !== b.sectionIndex) return a.sectionIndex - b.sectionIndex
      if (a.chunkIndex !== b.chunkIndex) return a.chunkIndex - b.chunkIndex
      return a.timeInChunk - b.timeInChunk
    })
  },

  /**
   * Get a specific bookmark
   */
  async get(id: string): Promise<Bookmark | undefined> {
    return await db.bookmarks.get(id)
  },

  /**
   * Update a bookmark's note
   */
  async updateNote(id: string, note: string): Promise<void> {
    await db.bookmarks.update(id, { note })
  },

  /**
   * Delete a bookmark
   */
  async delete(id: string): Promise<void> {
    await db.bookmarks.delete(id)
  },

  /**
   * Delete all bookmarks for a book
   */
  async deleteForBook(bookId: string): Promise<number> {
    return await db.bookmarks.where('bookId').equals(bookId).delete()
  },

  /**
   * Get bookmark count for a book
   */
  async countForBook(bookId: string): Promise<number> {
    return await db.bookmarks.where('bookId').equals(bookId).count()
  },
}
