import { useState, useEffect, useCallback } from 'react'
import {
  bookRepository,
  sectionRepository,
  playbackRepository,
  storageStats,
} from '@/services/storage'
import type { Book, Section, PlaybackState } from '@/services/storage'

export interface BookDetails extends Book {
  sections: Section[]
  playbackState?: PlaybackState
  storageStats?: {
    audioSizeMB: number
    chunkCount: number
    bookmarkCount: number
  }
}

export function useBook(bookId: string | undefined) {
  const [book, setBook] = useState<BookDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadBook = useCallback(async () => {
    if (!bookId) {
      setBook(null)
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)

      const [bookData, sections, playbackState, stats] = await Promise.all([
        bookRepository.get(bookId),
        sectionRepository.getForBook(bookId),
        playbackRepository.get(bookId),
        storageStats.getBookStats(bookId),
      ])

      if (!bookData) {
        setError('Book not found')
        setBook(null)
        return
      }

      setBook({
        ...bookData,
        sections,
        playbackState,
        storageStats: stats,
      })
      setError(null)
    } catch (err) {
      console.error('Failed to load book:', err)
      setError('Failed to load book')
    } finally {
      setIsLoading(false)
    }
  }, [bookId])

  useEffect(() => {
    loadBook()
  }, [loadBook])

  const deleteBook = useCallback(async () => {
    if (!bookId) return
    await bookRepository.delete(bookId)
  }, [bookId])

  const deleteAudioCache = useCallback(async () => {
    if (!bookId) return
    await bookRepository.deleteAudioCache(bookId)
    await loadBook() // Refresh stats
  }, [bookId, loadBook])

  const markPlayed = useCallback(async () => {
    if (!bookId) return
    await bookRepository.markPlayed(bookId)
  }, [bookId])

  return {
    book,
    isLoading,
    error,
    refresh: loadBook,
    deleteBook,
    deleteAudioCache,
    markPlayed,
  }
}
