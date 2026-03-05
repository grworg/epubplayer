/**
 * Book Editor Page
 *
 * Standalone route for editing an existing book's sections.
 * Loads book + sections from IndexedDB, presents the editor,
 * and writes changes back on save.
 */

import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import { ArrowLeftIcon, LoaderIcon } from '@/ui/icons'
import { bookRepository, sectionRepository } from '@/services/storage'
import type { Book, Section } from '@/services/storage'
import { createLogger } from '@/services/logging'
import { saveEditedSections } from '@/features/import/saveImport'
import { BookEditorView } from './BookEditorView'
import type { EditorSection } from './useBookEditor'

const log = createLogger('app')

export function BookEditorPage() {
  const { bookId } = useParams<{ bookId: string }>()
  const navigate = useNavigate()
  const [book, setBook] = useState<Book | null>(null)
  const [sections, setSections] = useState<Section[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!bookId) return
    Promise.all([bookRepository.get(bookId), sectionRepository.getForBook(bookId)])
      .then(([b, s]) => {
        setBook(b || null)
        setSections(s)
      })
      .finally(() => setIsLoading(false))
  }, [bookId])

  const handleSave = useCallback(
    async (activeSections: EditorSection[]) => {
      if (!bookId || !book) return
      setIsSaving(true)

      try {
        await saveEditedSections(bookId, activeSections)
        navigate(-1)
      } catch (err) {
        log.error('Failed to save book edits', err)
        setIsSaving(false)
      }
    },
    [bookId, book, navigate],
  )

  const handleCancel = () => navigate(-1)

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoaderIcon className="h-8 w-8 text-accent" />
      </div>
    )
  }

  if (!book || !sections) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8">
        <p className="mb-4 text-text-secondary"><Trans>Book not found</Trans></p>
        <button
          onClick={() => navigate('/app')}
          className="pressable rounded-full bg-surface-2 px-6 py-2 text-text-primary"
        >
          <Trans>Go to Library</Trans>
        </button>
      </div>
    )
  }

  if (isSaving) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <LoaderIcon className="mb-4 h-8 w-8 text-accent" />
        <p className="text-text-secondary"><Trans>Saving changes...</Trans></p>
      </div>
    )
  }

  const initialSections = sections.map((s) => ({
    title: s.title,
    textContent: s.textContent,
    id: s.id,
  }))

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 px-5 py-4">
        <button
          onClick={handleCancel}
          className="pressable flex h-10 w-10 items-center justify-center rounded-full bg-surface-1 text-text-primary hover:bg-surface-2"
          aria-label={t`Back`}
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold text-text-primary">
          <Trans>Edit Book</Trans>
        </h1>
      </header>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl px-5 pb-8">
          <BookEditorView
            mode="edit"
            initialSections={initialSections}
            bookTitle={book.title}
            bookAuthor={book.author}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        </div>
      </div>
    </div>
  )
}
