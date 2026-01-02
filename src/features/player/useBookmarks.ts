import { useState, useEffect, useCallback } from 'react'
import { bookmarkRepository, type Bookmark } from '@/services/storage'
import { usePlayerStore } from './playerStore'

export function useBookmarks(bookId: string | undefined) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadBookmarks = useCallback(async () => {
    if (!bookId) {
      setBookmarks([])
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      const data = await bookmarkRepository.getForBook(bookId)
      setBookmarks(data)
    } catch (error) {
      console.error('Failed to load bookmarks:', error)
    } finally {
      setIsLoading(false)
    }
  }, [bookId])

  useEffect(() => {
    loadBookmarks()
  }, [loadBookmarks])

  const addBookmark = useCallback(
    async (note?: string) => {
      if (!bookId) return null

      const position = usePlayerStore.getState().position

      const id = await bookmarkRepository.add({
        bookId,
        sectionIndex: position.sectionIndex,
        chunkIndex: position.chunkIndex,
        timeInChunk: position.timeInChunk,
        note,
      })

      await loadBookmarks()
      return id
    },
    [bookId, loadBookmarks]
  )

  const deleteBookmark = useCallback(
    async (id: string) => {
      await bookmarkRepository.delete(id)
      await loadBookmarks()
    },
    [loadBookmarks]
  )

  const updateBookmarkNote = useCallback(
    async (id: string, note: string) => {
      await bookmarkRepository.updateNote(id, note)
      await loadBookmarks()
    },
    [loadBookmarks]
  )

  return {
    bookmarks,
    isLoading,
    addBookmark,
    deleteBookmark,
    updateBookmarkNote,
    refresh: loadBookmarks,
  }
}
