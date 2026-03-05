/**
 * Gutenberg Book Detail Sheet
 *
 * Bottom sheet (mobile) / centered modal (desktop) showing details
 * for a Gutenberg book with an "Add to Library" CTA.
 */

import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import { CloseIcon, DownloadIcon, ExternalLinkIcon, LoaderIcon, CheckCircleIcon, AlertCircleIcon } from '@/ui/icons'
import { useFocusTrap } from '@/ui/accessibility'
import { useAddToLibrary } from './useAddToLibrary'
import {
  getCoverUrl,
  formatAuthors,
  formatDownloadCount,
  getEpubUrl,
  type GutenbergBook,
} from '@/services/gutendex'

interface GutenbergBookSheetProps {
  book: GutenbergBook
  onClose: () => void
}

export function GutenbergBookSheet({ book, onClose }: GutenbergBookSheetProps) {
  const sheetRef = useFocusTrap<HTMLDivElement>({
    isActive: true,
    onEscape: onClose,
  })

  const { status, error, existingBookId, addToLibrary } = useAddToLibrary()

  const coverUrl = getCoverUrl(book)
  const authors = formatAuthors(book.authors)
  const epubUrl = getEpubUrl(book)
  const downloads = formatDownloadCount(book.download_count)
  const gutenbergUrl = `https://www.gutenberg.org/ebooks/${book.id}`

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-label={book.title}
        className="relative z-10 flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-3xl bg-surface-1 md:max-w-lg md:rounded-2xl"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="pressable absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-surface-2/80 text-text-muted backdrop-blur-sm hover:text-text-primary"
          aria-label={t`Close`}
        >
          <CloseIcon className="h-4 w-4" />
        </button>

        <div className="overflow-y-auto p-5">
          {/* Book info header */}
          <div className="flex gap-4">
            {/* Cover */}
            <div className="h-36 w-24 flex-shrink-0 overflow-hidden rounded-xl bg-surface-3">
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt={book.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-3 to-surface-4">
                  <span className="text-3xl opacity-50">📖</span>
                </div>
              )}
            </div>

            {/* Details */}
            <div className="min-w-0 flex-1 pt-1">
              <h2 className="text-lg font-bold leading-tight text-text-primary">
                {book.title}
              </h2>
              <p className="mt-1 text-sm text-text-secondary">{authors}</p>
              <p className="mt-2 text-xs text-text-muted">
                {downloads} <Trans>downloads</Trans>
              </p>
              {book.languages.length > 0 && (
                <p className="mt-1 text-xs text-text-muted">
                  {book.languages.map((l) => l.toUpperCase()).join(', ')}
                </p>
              )}
            </div>
          </div>

          {/* Subjects */}
          {book.subjects.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {book.subjects.slice(0, 8).map((subject) => (
                <span
                  key={subject}
                  className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-text-secondary"
                >
                  {subject}
                </span>
              ))}
              {book.subjects.length > 8 && (
                <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-text-muted">
                  +{book.subjects.length - 8}
                </span>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="mt-6 space-y-3">
            {/* Add to Library */}
            {epubUrl ? (
              <AddToLibraryButton
                status={status}
                error={error}
                existingBookId={existingBookId}
                onAdd={() => addToLibrary(book)}
                onClose={onClose}
              />
            ) : (
              <p className="text-center text-sm text-text-muted">
                <Trans>No EPUB available for this book</Trans>
              </p>
            )}

            {/* View on Gutenberg */}
            <a
              href={gutenbergUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="pressable flex w-full items-center justify-center gap-2 rounded-xl bg-surface-2 py-3 text-sm font-medium text-text-secondary hover:bg-surface-3"
            >
              <ExternalLinkIcon className="h-4 w-4" />
              <Trans>View on Project Gutenberg</Trans>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Add to Library Button (stateful)
// ============================================================================

function AddToLibraryButton({
  status,
  error,
  existingBookId,
  onAdd,
  onClose,
}: {
  status: 'idle' | 'downloading' | 'parsing' | 'saving' | 'success' | 'duplicate' | 'error'
  error: string | null
  existingBookId: string | null
  onAdd: () => void
  onClose: () => void
}) {
  if (status === 'success') {
    return (
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-2 text-green-400">
          <CheckCircleIcon className="h-5 w-5" />
          <span className="text-sm font-medium"><Trans>Added to your library!</Trans></span>
        </div>
      </div>
    )
  }

  if (status === 'duplicate') {
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm text-text-secondary">
          <Trans>Already in your library</Trans>
        </p>
        {existingBookId && (
          <a
            href={`/app/book/${existingBookId}`}
            onClick={(e) => {
              e.preventDefault()
              onClose()
              window.location.href = `/app/book/${existingBookId}`
            }}
            className="pressable rounded-full bg-accent px-5 py-2 text-sm font-medium text-white"
          >
            <Trans>Go to book</Trans>
          </a>
        )}
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-2 text-red-400">
          <AlertCircleIcon className="h-5 w-5" />
          <span className="text-sm">{error || <Trans>Something went wrong</Trans>}</span>
        </div>
        <button
          onClick={onAdd}
          className="pressable rounded-full bg-surface-2 px-5 py-2 text-sm font-medium text-text-primary hover:bg-surface-3"
        >
          <Trans>Try again</Trans>
        </button>
      </div>
    )
  }

  const isWorking = status !== 'idle'

  const statusText = {
    downloading: <Trans>Downloading...</Trans>,
    parsing: <Trans>Processing...</Trans>,
    saving: <Trans>Saving...</Trans>,
  }

  return (
    <button
      onClick={onAdd}
      disabled={isWorking}
      className="pressable flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3.5 font-medium text-white disabled:opacity-70"
    >
      {isWorking ? (
        <>
          <LoaderIcon className="h-5 w-5" />
          {statusText[status as keyof typeof statusText]}
        </>
      ) : (
        <>
          <DownloadIcon className="h-5 w-5" />
          <Trans>Add to Library</Trans>
        </>
      )}
    </button>
  )
}
