import { useState } from 'react'
import { Trans, t } from '@lingui/macro'
import { useBookmarks } from '@/features/player/useBookmarks'
import { usePlayerStore } from '@/features/player/playerStore'
import { playbackController } from '@/features/player/PlaybackController'
import { BookmarkIcon, TrashIcon, PlusIcon } from '@/ui/icons'
import { useFocusTrap, useAnnounce } from '@/ui/accessibility'
import type { Bookmark } from '@/services/storage'

interface BookmarkSheetProps {
  isOpen: boolean
  onClose: () => void
}

export function BookmarkSheet({ isOpen, onClose }: BookmarkSheetProps) {
  const currentBook = usePlayerStore((s) => s.currentBook)
  const { bookmarks, addBookmark, deleteBookmark } = useBookmarks(currentBook?.id)
  const [isAdding, setIsAdding] = useState(false)
  const [newNote, setNewNote] = useState('')
  const { announce } = useAnnounce()
  
  const sheetRef = useFocusTrap<HTMLDivElement>({
    isActive: isOpen,
    onEscape: onClose,
  })

  if (!isOpen) return null

  const handleAddBookmark = async () => {
    if (isAdding) {
      await addBookmark(newNote.trim() || undefined)
      setNewNote('')
      setIsAdding(false)
      announce(t`Bookmark added`)
    } else {
      setIsAdding(true)
    }
  }

  const handleDeleteBookmark = async (id: string) => {
    await deleteBookmark(id)
    announce(t`Bookmark deleted`)
  }

  const handleGoToBookmark = async (bookmark: Bookmark) => {
    await playbackController.goToSection(bookmark.sectionIndex)
    // TODO: Seek to exact chunk/time position
    announce(t`Jumped to ${formatPosition(bookmark)}`)
    onClose()
  }

  const formatPosition = (bookmark: Bookmark) => {
    return t`Chapter ${bookmark.sectionIndex + 1}`
  }

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

      {/* Sheet - bottom on mobile, centered modal on desktop */}
      <div 
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bookmarks-sheet-title"
        className="relative max-h-[70vh] w-full max-w-lg overflow-hidden rounded-t-3xl bg-surface-1 pb-[max(1.5rem,var(--safe-area-bottom))] md:rounded-2xl md:pb-4"
      >
        {/* Handle - mobile only */}
        <div className="flex justify-center py-3 md:hidden" aria-hidden="true">
          <div className="h-1 w-10 rounded-full bg-surface-4" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pb-4 md:pt-4">
          <div className="flex items-center gap-3">
            <BookmarkIcon className="h-6 w-6 text-accent" />
            <h2 id="bookmarks-sheet-title" className="text-lg font-semibold text-text-primary">
              <Trans>Bookmarks</Trans>
            </h2>
          </div>
          <button
            onClick={handleAddBookmark}
            className="pressable flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white"
            aria-label={t`Add bookmark`}
          >
            <PlusIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Add bookmark input */}
        {isAdding && (
          <div className="border-b border-border-muted px-4 pb-4">
            <label htmlFor="bookmark-note" className="sr-only"><Trans>Bookmark note</Trans></label>
            <input
              id="bookmark-note"
              type="text"
              placeholder={t`Add a note (optional)`}
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddBookmark()}
              className="w-full rounded-xl bg-surface-2 px-4 py-3 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
              autoFocus
            />
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => setIsAdding(false)}
                className="flex-1 rounded-lg bg-surface-3 py-2 text-text-secondary"
              >
                <Trans>Cancel</Trans>
              </button>
              <button
                onClick={handleAddBookmark}
                className="flex-1 rounded-lg bg-accent py-2 text-white"
              >
                <Trans>Save</Trans>
              </button>
            </div>
          </div>
        )}

        {/* Bookmarks list */}
        <div className="max-h-[50vh] overflow-y-auto px-4">
          {bookmarks.length === 0 ? (
            <div className="py-12 text-center text-text-muted">
              <BookmarkIcon className="mx-auto mb-3 h-12 w-12 opacity-30" />
              <p><Trans>No bookmarks yet</Trans></p>
              <p className="mt-1 text-sm"><Trans>Tap + to bookmark your current position</Trans></p>
            </div>
          ) : (
            <div className="space-y-2 py-2">
              {bookmarks.map((bookmark) => (
                <div
                  key={bookmark.id}
                  className="flex items-center gap-3 rounded-xl bg-surface-2 p-3"
                >
                  <button
                    onClick={() => handleGoToBookmark(bookmark)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="font-medium text-text-primary">
                      {bookmark.note || formatPosition(bookmark)}
                    </p>
                    <p className="text-xs text-text-muted">
                      {formatPosition(bookmark)} • {formatTime(bookmark.createdAt)}
                    </p>
                  </button>
                  <button
                    onClick={() => handleDeleteBookmark(bookmark.id)}
                    className="pressable flex h-11 w-11 items-center justify-center rounded-full text-text-muted hover:bg-surface-3 hover:text-error"
                    aria-label={t`Delete bookmark: ${bookmark.note || formatPosition(bookmark)}`}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
