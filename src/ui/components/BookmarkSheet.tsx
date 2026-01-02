import { useState } from 'react'
import { useBookmarks } from '@/features/player/useBookmarks'
import { usePlayerStore } from '@/features/player/playerStore'
import { playbackController } from '@/features/player/PlaybackController'
import { BookmarkIcon, TrashIcon, PlusIcon } from '@/ui/icons'
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

  if (!isOpen) return null

  const handleAddBookmark = async () => {
    if (isAdding) {
      await addBookmark(newNote.trim() || undefined)
      setNewNote('')
      setIsAdding(false)
    } else {
      setIsAdding(true)
    }
  }

  const handleGoToBookmark = async (bookmark: Bookmark) => {
    await playbackController.goToSection(bookmark.sectionIndex)
    // TODO: Seek to exact chunk/time position
    onClose()
  }

  const formatPosition = (bookmark: Bookmark) => {
    return `Chapter ${bookmark.sectionIndex + 1}`
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
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet - bottom on mobile, centered modal on desktop */}
      <div className="relative max-h-[70vh] w-full max-w-lg overflow-hidden rounded-t-3xl bg-surface-1 pb-[max(1.5rem,var(--safe-area-bottom))] md:rounded-2xl md:pb-4">
        {/* Handle - mobile only */}
        <div className="flex justify-center py-3 md:hidden">
          <div className="h-1 w-10 rounded-full bg-surface-4" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pb-4 md:pt-4">
          <div className="flex items-center gap-3">
            <BookmarkIcon className="h-6 w-6 text-accent" />
            <h2 className="text-lg font-semibold text-text-primary">Bookmarks</h2>
          </div>
          <button
            onClick={handleAddBookmark}
            className="pressable flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white"
            aria-label="Add bookmark"
          >
            <PlusIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Add bookmark input */}
        {isAdding && (
          <div className="border-b border-border-muted px-4 pb-4">
            <input
              type="text"
              placeholder="Add a note (optional)"
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
                Cancel
              </button>
              <button
                onClick={handleAddBookmark}
                className="flex-1 rounded-lg bg-accent py-2 text-white"
              >
                Save
              </button>
            </div>
          </div>
        )}

        {/* Bookmarks list */}
        <div className="max-h-[50vh] overflow-y-auto px-4">
          {bookmarks.length === 0 ? (
            <div className="py-12 text-center text-text-muted">
              <BookmarkIcon className="mx-auto mb-3 h-12 w-12 opacity-30" />
              <p>No bookmarks yet</p>
              <p className="mt-1 text-sm">Tap + to bookmark your current position</p>
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
                    onClick={() => deleteBookmark(bookmark.id)}
                    className="pressable flex h-8 w-8 items-center justify-center rounded-full text-text-muted hover:bg-surface-3 hover:text-error"
                    aria-label="Delete bookmark"
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
