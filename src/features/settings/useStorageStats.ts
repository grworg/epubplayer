import { useState, useEffect, useCallback } from 'react'
import { storageStats, bookRepository } from '@/services/storage'

export interface BookStorageInfo {
  id: string
  title: string
  audioSizeMB: number
  chunkCount: number
}

export interface StorageInfo {
  totalAudioSizeMB: number
  totalChunkCount: number
  bookCount: number
  quotaUsedMB: number
  quotaTotalMB: number
  quotaPercentUsed: number
  books: BookStorageInfo[]
}

export function useStorageStats() {
  const [stats, setStats] = useState<StorageInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadStats = useCallback(async () => {
    try {
      setIsLoading(true)

      // Get overall stats
      const overall = await storageStats.getStats()

      // Get per-book stats
      const allBooks = await bookRepository.getAll()
      const bookStats: BookStorageInfo[] = await Promise.all(
        allBooks.map(async (book) => {
          const bookStat = await storageStats.getBookStats(book.id)
          return {
            id: book.id,
            title: book.title,
            audioSizeMB: bookStat.audioSizeMB,
            chunkCount: bookStat.chunkCount,
          }
        })
      )

      // Sort by audio size (largest first)
      bookStats.sort((a, b) => b.audioSizeMB - a.audioSizeMB)

      setStats({
        totalAudioSizeMB: overall.audioSizeMB,
        totalChunkCount: overall.chunkCount,
        bookCount: overall.bookCount,
        quotaUsedMB: overall.quotaUsedMB,
        quotaTotalMB: overall.quotaTotalMB,
        quotaPercentUsed: overall.quotaPercentUsed,
        books: bookStats,
      })
    } catch (error) {
      console.error('Failed to load storage stats:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  const clearAllAudio = useCallback(async () => {
    await storageStats.clearAllAudio()
    await loadStats()
  }, [loadStats])

  const clearBookAudio = useCallback(
    async (bookId: string) => {
      await bookRepository.deleteAudioCache(bookId)
      await loadStats()
    },
    [loadStats]
  )

  const clearAllData = useCallback(async () => {
    await storageStats.clearAll()
    await loadStats()
  }, [loadStats])

  return {
    stats,
    isLoading,
    refresh: loadStats,
    clearAllAudio,
    clearBookAudio,
    clearAllData,
  }
}
