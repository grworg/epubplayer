import { useState, useEffect, useCallback } from 'react'
import { bookRepository, type Book, sectionRepository, storageStats } from '@/services/storage'

export interface LibraryBook extends Book {
  progress?: number
  sectionCount?: number
}

export function useLibrary() {
  const [books, setBooks] = useState<LibraryBook[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadBooks = useCallback(async () => {
    try {
      setIsLoading(true)
      const allBooks = await bookRepository.getAll()

      // Enrich with section counts
      const enrichedBooks: LibraryBook[] = await Promise.all(
        allBooks.map(async (book) => {
          const sectionCount = await sectionRepository.count(book.id)
          // TODO: Calculate actual progress from playback state
          return {
            ...book,
            sectionCount,
            progress: 0,
          }
        })
      )

      setBooks(enrichedBooks)
      setError(null)
    } catch (err) {
      console.error('Failed to load books:', err)
      setError('Failed to load library')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadBooks()
  }, [loadBooks])

  const deleteBook = useCallback(
    async (bookId: string) => {
      try {
        await bookRepository.delete(bookId)
        await loadBooks() // Refresh the list
      } catch (err) {
        console.error('Failed to delete book:', err)
        throw err
      }
    },
    [loadBooks]
  )

  const deleteAudioCache = useCallback(async (bookId: string) => {
    try {
      await bookRepository.deleteAudioCache(bookId)
    } catch (err) {
      console.error('Failed to delete audio cache:', err)
      throw err
    }
  }, [])

  const getStorageStats = useCallback(async () => {
    return await storageStats.getStats()
  }, [])

  return {
    books,
    isLoading,
    error,
    refresh: loadBooks,
    deleteBook,
    deleteAudioCache,
    getStorageStats,
  }
}
