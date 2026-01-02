import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from './playerStore'
import { playbackController } from './PlaybackController'
import { PlayIcon, PauseIcon } from '@/ui/icons'

export function MiniPlayer() {
  const navigate = useNavigate()
  const currentBook = usePlayerStore((s) => s.currentBook)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const isBuffering = usePlayerStore((s) => s.isBuffering)
  const position = usePlayerStore((s) => s.position)

  if (!currentBook) return null

  const handleTogglePlayback = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await playbackController.togglePlayback()
  }

  // Calculate progress
  const progress = playbackController.getProgress() * 100

  return (
    <div
      className="glass cursor-pointer border-t border-border-muted"
      onClick={() => navigate('/app/playing')}
    >
      {/* Aligned container matching AppShell max-width */}
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center gap-3 px-4 py-3 md:gap-4 md:px-6">
          {/* Cover art */}
          <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-surface-3 md:h-14 md:w-14">
            {currentBook.coverUrl ? (
              <img
                src={currentBook.coverUrl}
                alt={currentBook.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-text-muted">
                <span className="text-xl">📖</span>
              </div>
            )}
          </div>

          {/* Title and info */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-text-primary md:text-base">{currentBook.title}</p>
            <p className="truncate text-xs text-text-secondary md:text-sm">
              {isBuffering
                ? 'Generating audio...'
                : `Chapter ${position.sectionIndex + 1} · ${currentBook.author}`}
            </p>
          </div>

          {/* Progress percentage - desktop only */}
          <span className="hidden text-sm text-text-muted md:block">
            {Math.round(progress)}%
          </span>

          {/* Play/Pause button */}
          <button
            onClick={handleTogglePlayback}
            className="pressable flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white md:h-12 md:w-12"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isBuffering ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent md:h-6 md:w-6" />
            ) : isPlaying ? (
              <PauseIcon className="h-5 w-5 md:h-6 md:w-6" />
            ) : (
              <PlayIcon className="h-5 w-5 md:h-6 md:w-6" />
            )}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 w-full bg-surface-3 md:h-1">
        <div
          className="h-full bg-accent transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}
