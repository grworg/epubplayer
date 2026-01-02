import { useState, useCallback } from 'react'
import { parseEPUB } from '@/services/epub'
import { bookRepository, sectionRepository, playbackRepository } from '@/services/storage'
import { settingsRepository } from '@/services/storage/settingsRepository'
import { hashBlob } from '@/services/storage/db'

export type ImportStatus = 'idle' | 'parsing' | 'saving' | 'success' | 'error'

export interface ImportState {
  status: ImportStatus
  progress: string
  error?: string
}

export function useImportEPUB() {
  const [state, setState] = useState<ImportState>({
    status: 'idle',
    progress: '',
  })

  const importFile = useCallback(async (file: File): Promise<string | null> => {
    try {
      setState({ status: 'parsing', progress: 'Reading EPUB...' })
      console.log('[Import] Starting import for:', file.name)

      // Calculate content hash for deduplication
      console.log('[Import] Calculating content hash...')
      const contentHash = await hashBlob(file)
      console.log('[Import] Content hash:', contentHash)

      // Parse the EPUB
      const { book, sections } = await parseEPUB(file)
      console.log('[Import] Parsed book:', book.title, 'with', sections.length, 'sections')

      // Check if book already exists (by ID or content hash)
      const existsById = await bookRepository.exists(book.id)
      if (existsById) {
        setState({
          status: 'error',
          progress: '',
          error: 'This book is already in your library',
        })
        return null
      }

      const existsByHash = await bookRepository.existsByContentHash(contentHash)
      if (existsByHash) {
        setState({
          status: 'error',
          progress: '',
          error: 'This book is already in your library (same content)',
        })
        return null
      }

      setState({ status: 'saving', progress: 'Saving to library...' })

      // Save book and sections (include original EPUB and content hash)
      console.log('[Import] Saving book...')
      await bookRepository.add({
        ...book,
        epubBlob: file,
        contentHash,
      })
      console.log('[Import] Book saved, saving', sections.length, 'sections...')
      if (sections.length > 0) {
        await sectionRepository.addBulk(sections)
        console.log('[Import] Sections saved')
      } else {
        console.warn('[Import] No sections to save!')
      }

      // Initialize playback state with default settings
      const voiceId = await settingsRepository.get('voiceId')
      const modelConfig = await settingsRepository.get('modelConfig')
      await playbackRepository.initialize(book.id, voiceId, modelConfig)

      setState({ status: 'success', progress: 'Import complete!' })
      return book.id
    } catch (error) {
      console.error('Import failed:', error)
      setState({
        status: 'error',
        progress: '',
        error: error instanceof Error ? error.message : 'Failed to import EPUB',
      })
      return null
    }
  }, [])

  const reset = useCallback(() => {
    setState({ status: 'idle', progress: '' })
  }, [])

  return {
    ...state,
    importFile,
    reset,
    isImporting: state.status === 'parsing' || state.status === 'saving',
  }
}
