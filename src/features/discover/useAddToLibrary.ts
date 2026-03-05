/**
 * Add to Library Hook
 *
 * Downloads a Gutenberg EPUB via the CORS proxy, parses it with
 * the existing EPUB adapter, and saves it via saveImportedContent.
 * Handles loading states, duplicate detection, and errors.
 */

import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { createLogger } from '@/services/logging'
import { parseEPUBToContent } from '@/services/contentParsers'
import { saveImportedContent } from '@/features/import/saveImport'
import { getEpubUrl, proxyUrl, formatAuthors, type GutenbergBook } from '@/services/gutendex'

const log = createLogger('import')

type AddStatus = 'idle' | 'downloading' | 'parsing' | 'saving' | 'success' | 'duplicate' | 'error'

export function useAddToLibrary() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<AddStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [existingBookId, setExistingBookId] = useState<string | null>(null)

  const addToLibrary = useCallback(async (book: GutenbergBook) => {
    const epubUrl = getEpubUrl(book)
    if (!epubUrl) {
      setStatus('error')
      setError('No EPUB format available')
      return
    }

    try {
      // Download
      setStatus('downloading')
      setError(null)
      setExistingBookId(null)

      log.info('Downloading Gutenberg EPUB', { id: book.id, title: book.title })

      const response = await fetch(proxyUrl(epubUrl), {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`)
      }

      const blob = await response.blob()
      const file = new File([blob], `pg${book.id}.epub`, {
        type: 'application/epub+zip',
      })

      // Parse
      setStatus('parsing')
      log.info('Parsing downloaded EPUB', { size: blob.size })

      const content = await parseEPUBToContent(file)

      // Override metadata with Gutenberg's (often better than what's in the EPUB)
      content.metadata.title = book.title || content.metadata.title
      content.metadata.author = formatAuthors(book.authors) || content.metadata.author

      // Save
      setStatus('saving')
      const result = await saveImportedContent(content)

      if ('error' in result) {
        log.info('Book is a duplicate', { title: book.title })
        setStatus('duplicate')
        setError(result.error)
        return
      }

      log.info('Gutenberg book added to library', { bookId: result.bookId, title: book.title })
      setStatus('success')

      // Navigate to the new book after a brief moment
      setTimeout(() => {
        navigate(`/app/book/${result.bookId}`)
      }, 1200)
    } catch (err) {
      log.error('Failed to add Gutenberg book', err)
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Failed to download book')
    }
  }, [navigate])

  return { status, error, existingBookId, addToLibrary }
}
